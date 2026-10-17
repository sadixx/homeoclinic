//! First-run setup use-case service (HC-MVP1-026, SET-001/002/003, LIC-063).
//!
//! Orchestrates the wizard writes over the Slice B `KeyHierarchy` + the
//! profile/settings/trial repositories: validate doctor + clinic, mint the DEK
//! and recovery code (`KeyHierarchy::initialize`), open + migrate the encrypted
//! DB, persist profiles + autolock setting, start the 30-day trial, mark setup
//! complete. Dependencies (`Keystore`, `Clock`, data dir) are INJECTED so the
//! service is testable on the file-fallback keystore + a temp dir with no Tauri
//! runtime (R-ARCH-002, R-TEST-006).
//!
//! STUB STATE (Slice C red): services return `Err(AppError::...)` / default
//! sentinels so the unit tests fail on assertions, not compilation.
//! `hc-core-dev` implements them to green.

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;

use hc_storage::key::KeyHierarchy;
use hc_storage::keystore::Keystore;
use hc_storage::profile::{ClinicProfile, DoctorProfile, Trial};
use hc_storage::Pool;

use crate::clock::{trial_valid_until, Clock, TRIAL_DURATION_DAYS};
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Request / response types (money = integer paise; camelCase; specta::Type).
// Secrets (pin/confirmPin) are request-only and never echoed or logged.
// ---------------------------------------------------------------------------

/// Wizard progress snapshot (`setup_get_state`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetupState {
    /// Whether first-run setup has completed.
    pub completed: bool,
    /// The step the wizard should resume on (1..=4).
    pub current_step: u8,
    /// The resolved data directory (display only; UI never builds paths).
    pub data_dir: String,
}

/// Doctor profile input (SET-002).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveDoctorProfileRequest {
    /// Full name (required).
    pub name: String,
    /// Qualification (required).
    pub qualification: String,
    /// Registration number (required).
    pub reg_no: String,
    /// Registration council (required).
    pub reg_council: String,
    /// Optional phone.
    pub phone: Option<String>,
    /// Optional email.
    pub email: Option<String>,
    /// Optional signature image source path (opaque; stored as attachment ref).
    pub signature_image_path: Option<String>,
    /// Optional clinic logo source path.
    pub clinic_logo_path: Option<String>,
}

/// Result of staging the doctor profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveDoctorProfileResponse {
    /// The UUIDv7 assigned to the doctor profile.
    pub doctor_id: String,
}

/// Clinic profile input (SET-003). Fees are integer paise (R-DATA-004).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveClinicProfileRequest {
    /// Clinic name (required).
    pub name: String,
    /// Clinic address (required).
    pub address: String,
    /// Optional phone.
    pub phone: Option<String>,
    /// Optional timings.
    pub timings: Option<String>,
    /// Default consultation fee, integer paise (required).
    ///
    /// Kept as `i64` in Rust (R-DATA-004); exported as a TS `number` via the
    /// `Number` override because paise amounts are always within JS
    /// safe-integer range, so no precision is lost.
    #[specta(type = specta_typescript::Number)]
    pub fee_first_paise: i64,
    /// Default follow-up fee, integer paise (required).
    #[specta(type = specta_typescript::Number)]
    pub fee_followup_paise: i64,
    /// Optional GSTIN.
    pub gstin: Option<String>,
}

/// Result of staging the clinic profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveClinicProfileResponse {
    /// The UUIDv7 assigned to the clinic profile.
    pub clinic_id: String,
}

/// PIN set input (SET-004). `pin` must be 4–6 numeric digits and equal
/// `confirm_pin`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetPinRequest {
    /// The chosen PIN (request-only secret; never echoed or logged).
    pub pin: String,
    /// Confirmation; must equal `pin`.
    pub confirm_pin: String,
    /// Idle auto-lock timeout in minutes (default 15).
    pub autolock_minutes: u16,
}

/// Result of setting the PIN: the one-time recovery code (shown once, SET-004).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetPinResponse {
    /// Grouped recovery code to show once and print; never shown again.
    pub recovery_code: String,
}

/// Data-folder chooser input (SET-006, DEFERRED/P1 — minimal persist only).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetDataDirRequest {
    /// The chosen data directory.
    pub path: String,
}

/// Resolved data directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetDataDirResponse {
    /// The data directory now in effect.
    pub data_dir: String,
}

/// Global font size (SET-005, DEFERRED/P1 — minimal persist only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum FontSize {
    /// 14px base.
    Normal,
    /// 16px base.
    Large,
    /// 18px base.
    Xlarge,
}

/// Font size input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetFontSizeRequest {
    /// The chosen font size.
    pub size: FontSize,
}

/// Result of starting the local trial (LIC-063).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StartTrialResponse {
    /// RFC3339 UTC expiry.
    pub trial_valid_until: String,
    /// Whole days remaining in the trial (30 at start).
    pub trial_days_remaining: u32,
}

/// Result of completing setup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CompleteSetupResponse {
    /// Route to open after setup (`"/today"`).
    pub home_route: String,
}

// ---------------------------------------------------------------------------
// Service.
// ---------------------------------------------------------------------------

/// Keys under which setup state is persisted in `app_setting`.
const SETTING_AUTOLOCK: &str = "autolock_minutes";
const SETTING_FONT_SIZE: &str = "font_size";
const SETTING_DATA_DIR: &str = "data_dir";
const SETTING_SETUP_COMPLETE: &str = "setup_complete";

/// Pre-DB staging buffer (design §3.2).
///
/// The encrypted DB does not exist until [`SetupService::set_pin`] mints the
/// DEK, so the doctor/clinic steps VALIDATE and stash their rows here; `set_pin`
/// then flushes them into the opened DB, each in its own transaction with one
/// audit row (R-DATA-001). An in-memory buffer (not a plaintext pre-DB table)
/// keeps profile data off disk until it can be written encrypted.
#[derive(Debug, Clone, Default)]
pub struct SetupStaging {
    doctor: Option<DoctorProfile>,
    clinic: Option<ClinicProfile>,
}

/// First-run setup use-case service. Holds injected dependencies by reference
/// plus an in-process staging buffer for the pre-DB wizard steps.
pub struct SetupService<'a> {
    keystore: &'a dyn Keystore,
    clock: &'a dyn Clock,
    data_dir: &'a Path,
    staging: RefCell<SetupStaging>,
    /// The encrypted DB opened by [`SetupService::set_pin`], reused by the P1
    /// settings commands within the same wizard session.
    pool: RefCell<Option<Pool>>,
}

/// Trim-and-require: a field that is empty after trimming is a validation error.
fn require(value: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(AppError::Validation(hc_domain::error::DomainError::Invalid))
    } else {
        Ok(trimmed.to_string())
    }
}

/// Optional field: trim, treat an all-whitespace/empty value as absent.
fn optional(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Validate the PIN policy (A3): 4–6 numeric digits and `pin == confirm`.
fn validate_pin(pin: &str, confirm: &str) -> Result<(), AppError> {
    let len_ok = (4..=6).contains(&pin.chars().count());
    let digits_ok = !pin.is_empty() && pin.chars().all(|c| c.is_ascii_digit());
    if !len_ok || !digits_ok || pin != confirm {
        return Err(AppError::Validation(hc_domain::error::DomainError::Invalid));
    }
    Ok(())
}

/// The encrypted database file path within the data dir.
fn db_path(data_dir: &Path) -> PathBuf {
    data_dir.join("clinic.db")
}

impl<'a> SetupService<'a> {
    /// Bind the service to its injected dependencies.
    pub fn new(keystore: &'a dyn Keystore, clock: &'a dyn Clock, data_dir: &'a Path) -> Self {
        SetupService {
            keystore,
            clock,
            data_dir,
            staging: RefCell::new(SetupStaging::default()),
            pool: RefCell::new(None),
        }
    }

    /// Current wizard state: completed iff the keystore is initialised (the DEK
    /// exists). `current_step` resumes at 1 (the wizard is short and restartable
    /// before completion); `data_dir` is display-only.
    pub fn get_state(&self) -> Result<SetupState, AppError> {
        let completed = KeyHierarchy::new(self.keystore).is_initialized()?;
        Ok(SetupState {
            completed,
            current_step: 1,
            data_dir: self.data_dir.display().to_string(),
        })
    }

    /// Validate and stage the doctor profile (persisted by [`Self::set_pin`]).
    /// Required: name, qualification, reg_no, reg_council (SET-002).
    pub fn save_doctor_profile(
        &self,
        req: SaveDoctorProfileRequest,
    ) -> Result<SaveDoctorProfileResponse, AppError> {
        let profile = DoctorProfile {
            id: uuid::Uuid::now_v7().to_string(),
            name: require(&req.name)?,
            qualification: require(&req.qualification)?,
            reg_no: require(&req.reg_no)?,
            reg_council: require(&req.reg_council)?,
            phone: optional(req.phone),
            email: optional(req.email),
            signature_ref: optional(req.signature_image_path),
            logo_ref: optional(req.clinic_logo_path),
        };
        let doctor_id = profile.id.clone();
        self.staging.borrow_mut().doctor = Some(profile);
        Ok(SaveDoctorProfileResponse { doctor_id })
    }

    /// Validate and stage the clinic profile. Required: name, address; fees must
    /// be non-negative integer paise (SET-003, R-DATA-004).
    pub fn save_clinic_profile(
        &self,
        req: SaveClinicProfileRequest,
    ) -> Result<SaveClinicProfileResponse, AppError> {
        if req.fee_first_paise < 0 || req.fee_followup_paise < 0 {
            return Err(AppError::Validation(hc_domain::error::DomainError::Invalid));
        }
        let profile = ClinicProfile {
            id: uuid::Uuid::now_v7().to_string(),
            name: require(&req.name)?,
            address: require(&req.address)?,
            phone: optional(req.phone),
            timings: optional(req.timings),
            fee_first_paise: req.fee_first_paise,
            fee_followup_paise: req.fee_followup_paise,
            gstin: optional(req.gstin),
        };
        let clinic_id = profile.id.clone();
        self.staging.borrow_mut().clinic = Some(profile);
        Ok(SaveClinicProfileResponse { clinic_id })
    }

    /// Set the app PIN: validate the policy, mint the DEK + recovery code via
    /// [`KeyHierarchy::initialize`], open and migrate the encrypted DB, then
    /// flush the staged doctor + clinic rows and the autolock setting — each in
    /// its own transaction with exactly one audit row (R-DATA-001). Returns the
    /// one-time recovery code and the opened [`Pool`].
    pub fn set_pin(&self, req: SetPinRequest) -> Result<(SetPinResponse, Pool), AppError> {
        validate_pin(&req.pin, &req.confirm_pin)?;

        // Mint the DEK + recovery code and open the encrypted DB.
        let hierarchy = KeyHierarchy::new(self.keystore);
        let (recovery, dek) = hierarchy.initialize(&req.pin)?;
        let pool = Pool::open(&db_path(self.data_dir), &dek)?;
        hc_storage::migrate::run(&pool)?;

        let now = self.clock.now_rfc3339();

        // Flush staged doctor + clinic, then the autolock setting. Each write is
        // its own transaction + one audit row, committed in causal order
        // (doctor → clinic → setting).
        if let Some(doctor) = self.staging.borrow().doctor.clone() {
            pool.with_writer(|c| {
                let tx = c.transaction()?;
                hc_storage::profile::upsert_doctor_profile(&tx, &doctor, &now)?;
                tx.commit()?;
                Ok(())
            })?;
        }
        if let Some(clinic) = self.staging.borrow().clinic.clone() {
            pool.with_writer(|c| {
                let tx = c.transaction()?;
                hc_storage::profile::upsert_clinic_profile(&tx, &clinic, &now)?;
                tx.commit()?;
                Ok(())
            })?;
        }
        let autolock_value = req.autolock_minutes.to_string();
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            hc_storage::profile::put_setting(&tx, SETTING_AUTOLOCK, &autolock_value, &now)?;
            tx.commit()?;
            Ok(())
        })?;

        Ok((
            SetPinResponse {
                recovery_code: recovery.reveal().to_string(),
            },
            {
                // Cache a clone (Arc inside) so the P1 settings commands reuse
                // this open DB within the wizard session.
                *self.pool.borrow_mut() = Some(pool.clone());
                pool
            },
        ))
    }

    /// Persist the chosen data dir (P1/DEFERRED minimal, A2): records the value
    /// only; no real relocation happens this slice. Requires an opened DB.
    pub fn set_data_dir(&self, req: SetDataDirRequest) -> Result<SetDataDirResponse, AppError> {
        let path = require(&req.path)?;
        let pool = self.open_existing()?;
        let now = self.clock.now_rfc3339();
        let value = serde_json::to_string(&path).unwrap_or_else(|_| "\"\"".to_string());
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            hc_storage::profile::put_setting(&tx, SETTING_DATA_DIR, &value, &now)?;
            tx.commit()?;
            Ok(())
        })?;
        Ok(SetDataDirResponse { data_dir: path })
    }

    /// Persist the chosen font size (P1/DEFERRED minimal, A2): records the value
    /// only; the real font-apply is not implemented this slice.
    pub fn set_font_size(&self, req: SetFontSizeRequest) -> Result<(), AppError> {
        let value = serde_json::to_string(&req.size).unwrap_or_else(|_| "\"normal\"".to_string());
        let pool = self.open_existing()?;
        let now = self.clock.now_rfc3339();
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            hc_storage::profile::put_setting(&tx, SETTING_FONT_SIZE, &value, &now)?;
            tx.commit()?;
            Ok(())
        })?;
        Ok(())
    }

    /// Start the local 30-day trial (LIC-063) in the opened DB. `started_at` is
    /// the injected clock's instant; `valid_until` is + 30 days.
    pub fn start_trial(&self, pool: &Pool) -> Result<StartTrialResponse, AppError> {
        let now = self.clock.now_rfc3339();
        let valid_until = trial_valid_until(&now);
        let trial = Trial {
            id: uuid::Uuid::now_v7().to_string(),
            started_at: now.clone(),
            valid_until: valid_until.clone(),
        };
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            hc_storage::profile::start_trial(&tx, &trial, &now)?;
            tx.commit()?;
            Ok(())
        })?;
        Ok(StartTrialResponse {
            trial_valid_until: valid_until,
            trial_days_remaining: TRIAL_DURATION_DAYS,
        })
    }

    /// Mark setup complete and return the home route (`/today`, VIS-005).
    pub fn complete(&self, pool: &Pool) -> Result<CompleteSetupResponse, AppError> {
        let now = self.clock.now_rfc3339();
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            hc_storage::profile::put_setting(&tx, SETTING_SETUP_COMPLETE, "true", &now)?;
            tx.commit()?;
            Ok(())
        })?;
        Ok(CompleteSetupResponse {
            home_route: "/today".to_string(),
        })
    }

    /// Return the encrypted DB opened by [`Self::set_pin`] earlier in this
    /// wizard session, used by the P1 settings commands (A2, DEFERRED minimal).
    /// `set_pin` must have run first; otherwise there is no open DB.
    fn open_existing(&self) -> Result<Pool, AppError> {
        self.pool.borrow().clone().ok_or(AppError::NotFound)
    }
}
