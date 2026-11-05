//! S18 Settings use-case service (MS: SET-002/003/004/005/007, PAT-002,
//! LIC-006, ADM-001; design §1.1, §3.1).
//!
//! One Save of the General form = one use-case command = one transaction = one
//! audit row (`settings`/`general`; product rule 3). Validation runs before
//! the transaction. The LIC-006 identity lock is the [`IdentityLock`] seam.

use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use hc_domain::error::DomainError;
use hc_domain::patient_code::IdPrefix;
use hc_storage::profile::{ClinicProfile, DoctorProfile};
use hc_storage::settings::{peek_next_seq, read_general, write_general, GeneralSettingsRecord};
use hc_storage::{Pool, StorageError};

use crate::clock::Clock;
use crate::error::AppError;
use crate::setup::{optional, require, FontSize};

/// A remembered camera choice (SET-007). `device_id` is the webview
/// `MediaDeviceInfo.deviceId`; `label` is kept to re-match when the id changes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CameraChoice {
    /// Webview device id.
    pub device_id: String,
    /// Device label at the time it was chosen.
    pub label: String,
}

/// Doctor section of the General form.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DoctorSettings {
    /// Full name (identity-locked under a licence).
    pub name: String,
    /// Qualification.
    pub qualification: String,
    /// Registration number (identity-locked under a licence).
    pub reg_no: String,
    /// Registration council (identity-locked under a licence).
    pub reg_council: String,
    /// Phone, asked once; also saved as the clinic phone.
    pub phone: Option<String>,
    /// Email.
    pub email: Option<String>,
}

/// Clinic section of the General form. Fees are integer paise.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ClinicSettings {
    /// Clinic name.
    pub name: String,
    /// Clinic address.
    pub address: String,
    /// `ClinicTimingsInput` output string (or legacy text).
    pub timings: Option<String>,
    /// GSTIN.
    pub gstin: Option<String>,
    /// Default consultation fee, integer paise.
    #[specta(type = specta_typescript::Number)]
    pub fee_first_paise: i64,
    /// Default follow-up fee, integer paise.
    #[specta(type = specta_typescript::Number)]
    pub fee_followup_paise: i64,
}

/// App preferences of the General form.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppPrefs {
    /// Patient-ID prefix (PAT-002).
    pub id_prefix: String,
    /// Idle auto-lock minutes (SET-004).
    pub autolock_minutes: u16,
    /// Font size (SET-005).
    pub font_size: FontSize,
    /// Remembered camera, or `None` = system default (SET-007).
    pub default_camera: Option<CameraChoice>,
}

/// `settings_get` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    /// Doctor section.
    pub doctor: DoctorSettings,
    /// Clinic section.
    pub clinic: ClinicSettings,
    /// App preferences.
    pub app: AppPrefs,
    /// Next running number, 6-digit zero-padded, e.g. `"000124"`.
    pub next_number: String,
    /// Current data folder, display only.
    pub data_folder: String,
    /// LIC-006: name / reg no / council read-only when true.
    pub identity_locked: bool,
}

/// `settings_save_general` request: the whole General form.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveGeneralSettingsRequest {
    /// Doctor section.
    pub doctor: DoctorSettings,
    /// Clinic section.
    pub clinic: ClinicSettings,
    /// App preferences.
    pub app: AppPrefs,
}

/// `settings_save_general` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SaveGeneralSettingsResponse {
    /// Fresh settings after the save.
    pub settings: SettingsView,
    /// `false` = nothing differed; no row and no audit row was written.
    pub changed: bool,
}

/// `settings_pick_data_folder` response (`None` = cancelled).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PickDataFolderResponse {
    /// The chosen parent folder.
    pub parent_path: Option<String>,
}

/// `settings_move_data_folder` request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MoveDataFolderRequest {
    /// The parent folder returned by the picker.
    pub parent_path: String,
}

/// `settings_move_data_folder` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MoveDataFolderResponse {
    /// `<parent>/HomeoClinic`, now live.
    pub data_folder: String,
    /// `<old>/moved-out-<stamp>`, or the old folder if retiring failed.
    pub safety_copy_folder: String,
}

/// `settings_recheck_data_folder` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DataFolderCheck {
    /// Whether the pointed folder is present now.
    pub available: bool,
    /// The pointed folder (display only).
    pub data_folder: String,
}

/// LIC-006 identity-lock seam (design §3.1).
pub trait IdentityLock: Send + Sync {
    /// True once a verified licence binds name + reg no.
    fn is_locked(&self, pool: &Pool) -> Result<bool, AppError>;
}

/// Production guard. MS: no imported-licence storage exists before R8
/// (design finding F4), so this always reports unlocked; R8 (LIC-061) replaces
/// the body with "a verified imported licence is present". Single seam, used
/// by `settings_get` and `settings_save_general` only.
pub struct LicenceIdentityLock;

impl IdentityLock for LicenceIdentityLock {
    fn is_locked(&self, _pool: &Pool) -> Result<bool, AppError> {
        Ok(false)
    }
}

/// Fee cap: Rs 10,00,000 in paise (catches an extra-zeros typo; A13).
pub const MAX_FEE_PAISE: i64 = 100_000_000;
/// Auto-lock range in minutes (A10).
pub const AUTOLOCK_RANGE: std::ops::RangeInclusive<u16> = 1..=120;
/// Longest accepted webview camera device id.
const MAX_CAMERA_ID_LEN: usize = 512;
/// Longest accepted camera label.
const MAX_CAMERA_LABEL_LEN: usize = 256;

fn invalid() -> AppError {
    AppError::Validation(DomainError::Invalid)
}

fn check_fee(paise: i64) -> Result<i64, AppError> {
    if (0..=MAX_FEE_PAISE).contains(&paise) {
        Ok(paise)
    } else {
        Err(invalid())
    }
}

fn check_camera(camera: Option<CameraChoice>) -> Result<Option<String>, AppError> {
    let Some(camera) = camera else {
        return Ok(None);
    };
    let id_len = camera.device_id.chars().count();
    let label_len = camera.label.chars().count();
    if !(1..=MAX_CAMERA_ID_LEN).contains(&id_len) || label_len > MAX_CAMERA_LABEL_LEN {
        return Err(invalid());
    }
    let json = serde_json::to_string(&camera).map_err(StorageError::from)?;
    Ok(Some(json))
}

fn font_size_str(size: FontSize) -> &'static str {
    match size {
        FontSize::Normal => "normal",
        FontSize::Large => "large",
        FontSize::Xlarge => "xlarge",
    }
}

fn font_size_from(raw: &str) -> FontSize {
    match raw {
        "large" => FontSize::Large,
        "xlarge" => FontSize::Xlarge,
        _ => FontSize::Normal,
    }
}

/// The validated, normalised General form (before it meets the stored row).
struct ValidForm {
    doctor_name: String,
    qualification: String,
    reg_no: String,
    reg_council: String,
    phone: Option<String>,
    email: Option<String>,
    clinic_name: String,
    address: String,
    timings: Option<String>,
    gstin: Option<String>,
    fee_first_paise: i64,
    fee_followup_paise: i64,
    id_prefix: String,
    autolock_minutes: u16,
    font_size: FontSize,
    camera_json: Option<String>,
}

fn validate(req: SaveGeneralSettingsRequest) -> Result<ValidForm, AppError> {
    if !AUTOLOCK_RANGE.contains(&req.app.autolock_minutes) {
        return Err(invalid());
    }
    Ok(ValidForm {
        doctor_name: require(&req.doctor.name)?,
        qualification: require(&req.doctor.qualification)?,
        reg_no: require(&req.doctor.reg_no)?,
        reg_council: require(&req.doctor.reg_council)?,
        phone: optional(req.doctor.phone),
        email: optional(req.doctor.email),
        clinic_name: require(&req.clinic.name)?,
        address: require(&req.clinic.address)?,
        timings: optional(req.clinic.timings),
        gstin: optional(req.clinic.gstin),
        fee_first_paise: check_fee(req.clinic.fee_first_paise)?,
        fee_followup_paise: check_fee(req.clinic.fee_followup_paise)?,
        // PAT-002 / A9: the invariant lives in the hc-domain value type.
        id_prefix: IdPrefix::parse(&req.app.id_prefix)?.into_string(),
        autolock_minutes: req.app.autolock_minutes,
        font_size: req.app.font_size,
        camera_json: check_camera(req.app.default_camera)?,
    })
}

impl ValidForm {
    /// LIC-006: does the form change the licence-bound identity?
    fn changes_identity(&self, old: &DoctorProfile) -> bool {
        self.doctor_name != old.name
            || self.reg_no != old.reg_no
            || self.reg_council != old.reg_council
    }

    /// The new record over `old` (ids and attachment refs kept; phone once).
    fn apply_to(&self, old: &GeneralSettingsRecord) -> GeneralSettingsRecord {
        GeneralSettingsRecord {
            doctor: DoctorProfile {
                id: old.doctor.id.clone(),
                name: self.doctor_name.clone(),
                qualification: self.qualification.clone(),
                reg_no: self.reg_no.clone(),
                reg_council: self.reg_council.clone(),
                phone: self.phone.clone(),
                email: self.email.clone(),
                signature_ref: old.doctor.signature_ref.clone(),
                logo_ref: old.doctor.logo_ref.clone(),
            },
            clinic: ClinicProfile {
                id: old.clinic.id.clone(),
                name: self.clinic_name.clone(),
                address: self.address.clone(),
                // Phone asked once (A11): the doctor phone is the clinic phone.
                phone: self.phone.clone(),
                timings: self.timings.clone(),
                fee_first_paise: self.fee_first_paise,
                fee_followup_paise: self.fee_followup_paise,
                gstin: self.gstin.clone(),
            },
            id_prefix: self.id_prefix.clone(),
            autolock_minutes: self.autolock_minutes,
            font_size: font_size_str(self.font_size).to_string(),
            default_camera_json: self.camera_json.clone(),
        }
    }
}

/// What the save transaction did.
enum SaveOutcome {
    /// No profile yet (setup not finished).
    NoProfile,
    /// LIC-006 refusal; the transaction was rolled back.
    IdentityRefused,
    /// Written (`true`) or nothing differed (`false`).
    Saved(bool),
}

/// S18 Settings use-case service.
pub struct SettingsService<'a> {
    clock: &'a dyn Clock,
    identity: &'a dyn IdentityLock,
}

impl<'a> SettingsService<'a> {
    /// Bind the service to its injected dependencies.
    pub fn new(clock: &'a dyn Clock, identity: &'a dyn IdentityLock) -> Self {
        SettingsService { clock, identity }
    }

    /// Read the General form values (`settings_get`). `NotFound` before setup
    /// stored the profiles. `data_dir` is display only.
    pub fn get(&self, pool: &Pool, data_dir: &Path) -> Result<SettingsView, AppError> {
        let (rec, next_seq) = pool.with_reader(|c| Ok((read_general(c)?, peek_next_seq(c)?)))?;
        let rec = rec.ok_or(AppError::NotFound)?;
        let identity_locked = self.identity.is_locked(pool)?;
        let default_camera = rec
            .default_camera_json
            .as_deref()
            .and_then(|raw| serde_json::from_str::<CameraChoice>(raw).ok());
        Ok(SettingsView {
            doctor: DoctorSettings {
                name: rec.doctor.name,
                qualification: rec.doctor.qualification,
                reg_no: rec.doctor.reg_no,
                reg_council: rec.doctor.reg_council,
                // Phone asked once: seed from the doctor, else the clinic.
                phone: rec.doctor.phone.or(rec.clinic.phone),
                email: rec.doctor.email,
            },
            clinic: ClinicSettings {
                name: rec.clinic.name,
                address: rec.clinic.address,
                timings: rec.clinic.timings,
                gstin: rec.clinic.gstin,
                fee_first_paise: rec.clinic.fee_first_paise,
                fee_followup_paise: rec.clinic.fee_followup_paise,
            },
            app: AppPrefs {
                id_prefix: rec.id_prefix,
                autolock_minutes: rec.autolock_minutes,
                font_size: font_size_from(&rec.font_size),
                default_camera,
            },
            next_number: format!("{next_seq:06}"),
            data_folder: data_dir.display().to_string(),
            identity_locked,
        })
    }

    /// Validate + save the whole General form in one transaction with one
    /// audit row (`settings_save_general`).
    ///
    /// Every rule is checked before the transaction (`Validation`). While the
    /// identity is locked (LIC-006) a changed name / reg no / council (after
    /// trim) is refused with [`AppError::IdentityLocked`] and nothing is
    /// written. A Save with nothing changed writes nothing (`changed: false`).
    /// Existing patient codes are never touched (PAT-002).
    pub fn save_general(
        &self,
        pool: &Pool,
        data_dir: &Path,
        req: SaveGeneralSettingsRequest,
    ) -> Result<SaveGeneralSettingsResponse, AppError> {
        let form = validate(req)?;
        let locked = self.identity.is_locked(pool)?;
        let now = self.clock.now_rfc3339();
        let outcome = pool.with_writer(|c| {
            let tx = c.transaction()?;
            let Some(old) = read_general(&tx)? else {
                return Ok(SaveOutcome::NoProfile);
            };
            if locked && form.changes_identity(&old.doctor) {
                return Ok(SaveOutcome::IdentityRefused);
            }
            let new = form.apply_to(&old);
            let changed = write_general(&tx, &old, &new, &now)?;
            tx.commit()?;
            Ok(SaveOutcome::Saved(changed))
        })?;
        let changed = match outcome {
            SaveOutcome::NoProfile => return Err(AppError::NotFound),
            SaveOutcome::IdentityRefused => return Err(AppError::IdentityLocked),
            SaveOutcome::Saved(changed) => changed,
        };
        Ok(SaveGeneralSettingsResponse {
            settings: self.get(pool, data_dir)?,
            changed,
        })
    }
}
