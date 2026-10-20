//! Patient use-case service (HC-MVP1-036..043, PAT-001/002/004/005/006/008/011).
//!
//! Over the `hc-storage` patient/family/sequence repositories + `hc-search`
//! normalisation, with the injected [`Clock`] and the open [`Pool`] passed per
//! call (like setup's `start_trial`/`complete`). Each write runs in ONE
//! transaction with exactly ONE audit row (R-DATA-001). Money is integer paise
//! (R-DATA-004); ids are UUIDv7 (R-DATA-005). `patient_create` populates the
//! four normalised search columns through `hc_search` so a new patient is
//! findable immediately (PSR-012, R-DATA-006). Permanent delete re-verifies the
//! PIN via `KeyHierarchy::unlock_with_pin` and is the ONLY hard delete
//! (R-DATA-003 exception path).

use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use hc_storage::key::KeyHierarchy;
use hc_storage::keystore::Keystore;
use hc_storage::patient as repo;
use hc_storage::Pool;

use crate::clock::Clock;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Request / response types (camelCase; specta::Type; i64 paise = Number).
// Secrets (pin) are request-only and never echoed or logged (R-PRIV-001).
// ---------------------------------------------------------------------------

/// Preview of the next patient code (`patient_next_code`, PAT-002). The
/// sequence is consumed only on create, so Cancel leaves no gap (S06 open-Q).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NextCodeResponse {
    /// The code that would be assigned next, e.g. `HC-000123`.
    pub code: String,
}

/// Duplicate-check input (`patient_check_duplicate`, PAT-004). At least a name;
/// mobile and/or dob narrow the match. Never blocks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CheckDuplicateRequest {
    /// Entered name (drives name_norm + phonetic).
    pub name: String,
    /// Entered mobile, or `None`.
    pub mobile: Option<String>,
    /// Entered DOB (RFC3339 date), or `None`.
    pub dob: Option<String>,
}

/// One candidate duplicate (PAT-004).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateMatch {
    /// Matched patient id.
    pub patient_id: String,
    /// Matched patient code.
    pub code: String,
    /// Matched patient name.
    pub name: String,
    /// Matched patient mobile, or `None`.
    pub mobile: Option<String>,
    /// Matched patient DOB, or `None`.
    pub dob: Option<String>,
}

/// Duplicate-check result: zero or more warnings (PAT-004).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CheckDuplicateResponse {
    /// The candidate matches (empty = no duplicate warning).
    pub matches: Vec<DuplicateMatch>,
}

/// Create-patient input (`patient_create`, PAT-001). `name` is required and
/// either `dob` or `age_years` must be present.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreatePatientRequest {
    /// Full name (required).
    pub name: String,
    /// Sex, or `None`.
    pub sex: Option<String>,
    /// RFC3339 DOB, or `None` when only age is known.
    pub dob: Option<String>,
    /// Age in years when DOB is unknown, or `None`.
    #[specta(type = Option<specta_typescript::Number>)]
    pub age_years: Option<i64>,
    /// Whether the stored DOB was estimated from the age (PAT-001).
    pub dob_is_estimated: Option<bool>,
    /// Mobile, or `None`.
    pub mobile: Option<String>,
    /// Alternate mobile, or `None`.
    pub mobile_alt: Option<String>,
    /// Address, or `None`.
    pub address: Option<String>,
    /// City, or `None`.
    pub city: Option<String>,
    /// Occupation, or `None`.
    pub occupation: Option<String>,
    /// Marital status, or `None`.
    pub marital_status: Option<String>,
    /// Blood group, or `None`.
    pub blood_group: Option<String>,
    /// Referred-by, or `None`.
    pub referred_by: Option<String>,
    /// Opaque photo attachment ref, or `None`.
    pub photo_path: Option<String>,
    /// Allergies (alerts banner, PAT-005), or `None`.
    pub allergies: Option<String>,
    /// Other alerts, or `None`.
    pub alerts: Option<String>,
    /// Tags (PAT-007; persisted this slice, filter UI is P1), or `None`.
    pub tags: Option<Vec<String>>,
    /// DPDP consent instant (R-PRIV-003), or `None`.
    pub consent_at: Option<String>,
}

/// Create-patient result (PAT-001/002).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreatePatientResponse {
    /// The new patient's UUIDv7 id.
    pub patient_id: String,
    /// The assigned code (PAT-002), e.g. `HC-000123`.
    pub code: String,
}

/// Update-patient input (`patient_update`, PAT-001). Same editable fields plus
/// the target id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePatientRequest {
    /// The patient to update.
    pub patient_id: String,
    /// Full name (required).
    pub name: String,
    /// Sex, or `None`.
    pub sex: Option<String>,
    /// RFC3339 DOB, or `None`.
    pub dob: Option<String>,
    /// Age in years, or `None`.
    #[specta(type = Option<specta_typescript::Number>)]
    pub age_years: Option<i64>,
    /// Whether DOB is estimated.
    pub dob_is_estimated: Option<bool>,
    /// Mobile, or `None`.
    pub mobile: Option<String>,
    /// Alternate mobile, or `None`.
    pub mobile_alt: Option<String>,
    /// Address, or `None`.
    pub address: Option<String>,
    /// City, or `None`.
    pub city: Option<String>,
    /// Occupation, or `None`.
    pub occupation: Option<String>,
    /// Marital status, or `None`.
    pub marital_status: Option<String>,
    /// Blood group, or `None`.
    pub blood_group: Option<String>,
    /// Referred-by, or `None`.
    pub referred_by: Option<String>,
    /// Opaque photo attachment ref, or `None`.
    pub photo_path: Option<String>,
    /// Allergies, or `None`.
    pub allergies: Option<String>,
    /// Other alerts, or `None`.
    pub alerts: Option<String>,
    /// Tags, or `None`.
    pub tags: Option<Vec<String>>,
    /// Consent instant, or `None`.
    pub consent_at: Option<String>,
}

/// Dashboard request (`patient_get_dashboard`, PAT-005).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GetDashboardRequest {
    /// The patient to load.
    pub patient_id: String,
}

/// Demographics block (PAT-005).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Demographics {
    /// Patient code.
    pub code: String,
    /// Display name.
    pub name: String,
    /// Human age label, e.g. `34y` (from DOB preferred, else age_years).
    pub age_label: String,
    /// Sex, or `None`.
    pub sex: Option<String>,
    /// Mobile, or `None`.
    pub mobile: Option<String>,
    /// City, or `None`.
    pub city: Option<String>,
    /// Referred-by, or `None`.
    pub referred_by: Option<String>,
    /// Opaque photo ref, or `None`.
    pub photo_path: Option<String>,
}

/// A visit timeline entry (PAT-005). R3+; EMPTY list for R2.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VisitSummary {
    /// Visit id.
    pub visit_id: String,
    /// RFC3339 visit instant.
    pub visit_at: String,
    /// Visit kind label.
    pub kind: String,
    /// Headline remedy label, or `None`.
    pub headline_remedy_label: Option<String>,
}

/// Last-prescription card (PAT-005). R4+; `None` for R2.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RxSummary {
    /// Prescription id.
    pub prescription_id: String,
    /// RFC3339 printed instant, or `None`.
    pub printed_at: Option<String>,
    /// One-line items preview.
    pub items_preview: String,
}

/// A linked family member (PAT-006).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FamilyMember {
    /// Related patient id.
    pub patient_id: String,
    /// Related patient name.
    pub name: String,
    /// Relation (e.g. `Wife`).
    pub relation: String,
}

/// The single patient dashboard payload (PAT-005). For R2 the visits list is
/// empty, `last_prescription` is `None` and `dues_paise` is 0 (visits/Rx/billing
/// are R3/R4/R5, R-DEL-002); demographics, alerts and family are REAL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PatientDashboard {
    /// Real demographics.
    pub demographics: Demographics,
    /// Allergies (alerts banner), or `None`.
    pub allergies: Option<String>,
    /// Other alerts, or `None`.
    pub alerts: Option<String>,
    /// Outstanding dues, integer paise. ALWAYS 0 for R2 (billing is R5).
    #[specta(type = specta_typescript::Number)]
    pub dues_paise: i64,
    /// Visit timeline (newest first). ALWAYS empty for R2.
    pub visits: Vec<VisitSummary>,
    /// Most recent prescription. ALWAYS `None` for R2.
    pub last_prescription: Option<RxSummary>,
    /// Linked family (REAL, PAT-006).
    pub family: Vec<FamilyMember>,
}

/// Soft-delete input (`patient_soft_delete`, PAT-008).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SoftDeleteRequest {
    /// The patient to move to the recycle bin.
    pub patient_id: String,
}

/// Soft-delete result: the recycle-bin expiry (`deleted_at` + 30 days, PAT-008).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SoftDeleteResponse {
    /// RFC3339 instant until which the patient is recoverable (+30 days).
    pub recycle_until: String,
}

/// Restore input (`patient_restore`, PAT-008).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RestoreRequest {
    /// The patient to restore from the recycle bin.
    pub patient_id: String,
}

/// Permanent-delete input (`patient_permanent_delete`, PAT-008). Requires the
/// app PIN (re-verified). `pin` is a request-only secret; never logged.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PermanentDeleteRequest {
    /// The patient to erase.
    pub patient_id: String,
    /// The app PIN, re-verified before the hard delete (PAT-008, R-DATA-003).
    pub pin: String,
}

/// Family-link input (`patient_link_family`, PAT-006).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinkFamilyRequest {
    /// The patient the link hangs off.
    pub patient_id: String,
    /// The related patient.
    pub related_patient_id: String,
    /// The relation (e.g. `Wife`).
    pub relation: String,
    /// Whether the related patient shares this patient's address.
    pub share_address: bool,
}

/// Family-link result (PAT-006).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinkFamilyResponse {
    /// The new family-link id.
    pub family_link_id: String,
}

/// Export input (`patient_export_pdf` / `patient_export_json`, PAT-011).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    /// The patient to export.
    pub patient_id: String,
}

/// Export result: the written file path (revealed in the folder, PAT-011).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExportResponse {
    /// The absolute path of the written export file.
    pub file_path: String,
}

// ---------------------------------------------------------------------------
// Service.
// ---------------------------------------------------------------------------

/// Patient use-case service. Injected `Clock` + keystore + data dir; the open
/// `Pool` is passed per call (the command fetches it from `AppState.lock`).
pub struct PatientService<'a> {
    keystore: &'a dyn Keystore,
    clock: &'a dyn Clock,
    data_dir: &'a Path,
}

impl<'a> PatientService<'a> {
    /// Bind the service to its injected dependencies.
    pub fn new(keystore: &'a dyn Keystore, clock: &'a dyn Clock, data_dir: &'a Path) -> Self {
        PatientService {
            keystore,
            clock,
            data_dir,
        }
    }

    /// Preview the next patient code WITHOUT consuming the sequence (PAT-002).
    /// Two previews with no create in between return the same code (no gap).
    pub fn next_code(&self, pool: &Pool) -> Result<NextCodeResponse, AppError> {
        let code = pool.with_reader(repo::peek_next_patient_code)?;
        Ok(NextCodeResponse { code })
    }

    /// Return candidate duplicates for a name together with mobile and/or DOB
    /// (PAT-004); never blocks. Matches on the normalised name OR phonetic key
    /// AND (mobile digits OR DOB), so Indian-name spelling variants collide.
    pub fn check_duplicate(
        &self,
        pool: &Pool,
        req: CheckDuplicateRequest,
    ) -> Result<CheckDuplicateResponse, AppError> {
        let name_norm = hc_search::normalize::name_norm(&req.name);
        let name_phonetic = hc_search::phonetic_key(&req.name);
        let mobile_digits = req
            .mobile
            .as_deref()
            .map(hc_search::normalize::mobile_digits)
            .filter(|d| !d.is_empty());
        let dob = optional(req.dob);

        // With neither a mobile nor a DOB to narrow on there is no duplicate
        // signal (name alone is too broad to warn on — PAT-004 is name+mobile
        // or name+DOB), so return no matches rather than every namesake.
        if mobile_digits.is_none() && dob.is_none() {
            return Ok(CheckDuplicateResponse {
                matches: Vec::new(),
            });
        }

        let found = pool.with_reader(|c| {
            repo::find_duplicates(
                c,
                &name_norm,
                &name_phonetic,
                mobile_digits.as_deref(),
                dob.as_deref(),
            )
        })?;
        let matches = found
            .into_iter()
            .map(|m| DuplicateMatch {
                patient_id: m.patient_id,
                code: m.code,
                name: m.name,
                mobile: m.mobile,
                dob: m.dob,
            })
            .collect();
        Ok(CheckDuplicateResponse { matches })
    }

    /// Create a patient (PAT-001): validate, consume the next code (PAT-002),
    /// write the row + 4 normalised columns + ONE audit row in ONE txn; the 0004
    /// triggers make it findable immediately (PSR-012).
    pub fn create(
        &self,
        pool: &Pool,
        req: CreatePatientRequest,
    ) -> Result<CreatePatientResponse, AppError> {
        let name = require(&req.name)?;
        // PAT-001: at least one of DOB / age must be present.
        let dob = optional(req.dob.clone());
        if dob.is_none() && req.age_years.is_none() {
            return Err(AppError::Validation(hc_domain::error::DomainError::Invalid));
        }

        let id = uuid::Uuid::now_v7().to_string();
        let now = self.clock.now_rfc3339();

        let created = pool.with_writer(|c| {
            let tx = c.transaction()?;
            // Consume the sequence inside the create txn (PAT-002).
            let code = repo::next_patient_code(&tx, &now)?;
            let patient = build_patient_row(&id, &code, &name, &dob, &req);
            let norm = normalized_cols(&name, patient.mobile.as_deref(), &code);
            repo::insert_patient(&tx, &patient, &norm, &now, None)?;
            tx.commit()?;
            Ok(code)
        })?;

        Ok(CreatePatientResponse {
            patient_id: id,
            code: created,
        })
    }

    /// Update a patient (PAT-001): re-normalise the search columns, bump
    /// `row_version`, write ONE audit row. The read-modify path keeps the
    /// immutable `code` (and so `code_digits`) so the FTS/trigram stay correct.
    pub fn update(&self, pool: &Pool, req: UpdatePatientRequest) -> Result<(), AppError> {
        let name = require(&req.name)?;
        let dob = optional(req.dob.clone());
        if dob.is_none() && req.age_years.is_none() {
            return Err(AppError::Validation(hc_domain::error::DomainError::Invalid));
        }
        let now = self.clock.now_rfc3339();

        // The code is immutable; read the existing (live) row first to carry it
        // forward. A missing/soft-deleted row is a not-found at the boundary.
        let existing = pool
            .with_reader(|c| repo::get_patient(c, &req.patient_id))?
            .ok_or(AppError::NotFound)?;

        pool.with_writer(|c| {
            let tx = c.transaction()?;
            let patient = build_patient_row_for_update(&existing.code, &name, &dob, &req);
            let norm = normalized_cols(&name, patient.mobile.as_deref(), &existing.code);
            repo::update_patient(&tx, &patient, &norm, &now, None)?;
            tx.commit()?;
            Ok(())
        })?;
        Ok(())
    }

    /// Load the single-patient dashboard (PAT-005): REAL demographics + alerts +
    /// family; EMPTY visits, no last Rx, `dues_paise = 0` for R2 (R-DEL-002,
    /// visits/Rx/billing are R3/R4/R5 and not built yet — honest empty, no
    /// fabricated data and no dead end).
    pub fn get_dashboard(
        &self,
        pool: &Pool,
        req: GetDashboardRequest,
    ) -> Result<PatientDashboard, AppError> {
        let (row, family) = pool.with_reader(|c| {
            let row = repo::get_patient(c, &req.patient_id)?;
            let family = repo::list_family(c, &req.patient_id)?;
            Ok((row, family))
        })?;
        let row = row.ok_or(AppError::NotFound)?;

        let demographics = Demographics {
            code: row.code,
            name: row.name,
            age_label: age_label(row.dob.as_deref(), row.age_years),
            sex: row.sex,
            mobile: row.mobile,
            city: row.city,
            referred_by: row.referred_by,
            photo_path: row.photo_path,
        };
        let family = family
            .into_iter()
            .map(|f| FamilyMember {
                patient_id: f.patient_id,
                name: f.name,
                relation: f.relation,
            })
            .collect();

        Ok(PatientDashboard {
            demographics,
            allergies: row.allergies,
            alerts: row.alerts,
            // Honest-empty R2 fields (R-DEL-002): no fabricated visits/Rx/dues.
            dues_paise: 0,
            visits: Vec::new(),
            last_prescription: None,
            family,
        })
    }

    /// Soft-delete to the 30-day recycle bin (PAT-008): set `deleted_at`, return
    /// `recycle_until = deleted_at + 30d`; the patient leaves normal search.
    pub fn soft_delete(
        &self,
        pool: &Pool,
        req: SoftDeleteRequest,
    ) -> Result<SoftDeleteResponse, AppError> {
        let now = self.clock.now_rfc3339();
        let recycle_until = plus_days(&now, RECYCLE_WINDOW_DAYS);
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            repo::soft_delete_patient(&tx, &req.patient_id, &now, None)?;
            tx.commit()?;
            Ok(())
        })?;
        Ok(SoftDeleteResponse { recycle_until })
    }

    /// Restore a soft-deleted patient (PAT-008): clear `deleted_at` so the
    /// patient is searchable again.
    pub fn restore(&self, pool: &Pool, req: RestoreRequest) -> Result<(), AppError> {
        let now = self.clock.now_rfc3339();
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            repo::restore_patient(&tx, &req.patient_id, &now, None)?;
            tx.commit()?;
            Ok(())
        })?;
        Ok(())
    }

    /// Permanently delete (PAT-008, R-DATA-003 exception): RE-VERIFY the PIN via
    /// `KeyHierarchy::unlock_with_pin`; a wrong PIN ⇒ `WrongPin` and nothing is
    /// deleted. The correct PIN ⇒ the ONLY hard delete + one audit row.
    pub fn permanent_delete(
        &self,
        pool: &Pool,
        req: PermanentDeleteRequest,
    ) -> Result<(), AppError> {
        // Re-verify the PIN against the same keystore the DB was opened with.
        // A wrong PIN maps to `WrongPin` via the storage→app error conversion,
        // and the hard delete below never runs.
        KeyHierarchy::new(self.keystore).unlock_with_pin(&req.pin)?;

        let now = self.clock.now_rfc3339();
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            repo::hard_delete_patient(&tx, &req.patient_id, &now, None)?;
            tx.commit()?;
            Ok(())
        })?;
        Ok(())
    }

    /// Link a family member (PAT-006): write a `family_link` row + one audit
    /// row; the linked member then shows on the dashboard.
    pub fn link_family(
        &self,
        pool: &Pool,
        req: LinkFamilyRequest,
    ) -> Result<LinkFamilyResponse, AppError> {
        let relation = require(&req.relation)?;
        let id = uuid::Uuid::now_v7().to_string();
        let now = self.clock.now_rfc3339();
        let link = repo::FamilyLinkRow {
            id: id.clone(),
            patient_id: req.patient_id,
            related_patient_id: req.related_patient_id,
            relation,
            share_address: req.share_address,
        };
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            repo::insert_family_link(&tx, &link, &now, None)?;
            tx.commit()?;
            Ok(())
        })?;
        Ok(LinkFamilyResponse { family_link_id: id })
    }

    /// Export the single patient as JSON (PAT-011): the patient record + family
    /// + (empty, R2) visits, written under the data dir.
    pub fn export_json(&self, pool: &Pool, req: ExportRequest) -> Result<ExportResponse, AppError> {
        let value = self.export_value(pool, &req.patient_id)?;
        let body =
            serde_json::to_string_pretty(&value).map_err(|e| AppError::Storage(Box::new(e)))?;
        let path = self.write_export(&value, "json", body.as_bytes())?;
        Ok(ExportResponse { file_path: path })
    }

    /// Export the single patient as PDF (PAT-011): a deterministic plain-text
    /// render of the same record. A minimal single-page PDF is emitted with no
    /// external renderer so the export is byte-deterministic and offline.
    pub fn export_pdf(&self, pool: &Pool, req: ExportRequest) -> Result<ExportResponse, AppError> {
        let value = self.export_value(pool, &req.patient_id)?;
        let text = render_patient_text(&value);
        let pdf = render_minimal_pdf(&text);
        let path = self.write_export(&value, "pdf", &pdf)?;
        Ok(ExportResponse { file_path: path })
    }

    // -- internal helpers ---------------------------------------------------

    /// Build the export JSON for a patient: `{patient, family, visits:[]}`.
    /// Visits are EMPTY for R2 (R-DEL-002). Errors `NotFound` if the patient is
    /// absent.
    fn export_value(&self, pool: &Pool, patient_id: &str) -> Result<serde_json::Value, AppError> {
        let (row, family) = pool.with_reader(|c| {
            let row = repo::get_patient(c, patient_id)?;
            let family = repo::list_family(c, patient_id)?;
            Ok((row, family))
        })?;
        let row = row.ok_or(AppError::NotFound)?;

        let family_json: Vec<serde_json::Value> = family
            .into_iter()
            .map(|f| {
                serde_json::json!({
                    "patientId": f.patient_id,
                    "name": f.name,
                    "relation": f.relation,
                })
            })
            .collect();

        Ok(serde_json::json!({
            "patient": {
                "patientId": row.id,
                "code": row.code,
                "name": row.name,
                "sex": row.sex,
                "dob": row.dob,
                "ageYears": row.age_years,
                "mobile": row.mobile,
                "mobileAlt": row.mobile_alt,
                "address": row.address,
                "city": row.city,
                "occupation": row.occupation,
                "maritalStatus": row.marital_status,
                "bloodGroup": row.blood_group,
                "referredBy": row.referred_by,
                "allergies": row.allergies,
                "alerts": row.alerts,
            },
            "family": family_json,
            // Visits are a later milestone (R3); honest-empty for R2.
            "visits": [],
        }))
    }

    /// Write an export file under the data dir and return its absolute path.
    /// The filename is the patient's code + extension (opaque, no PII beyond the
    /// code already visible to the doctor — R-PRIV-001).
    fn write_export(
        &self,
        value: &serde_json::Value,
        ext: &str,
        bytes: &[u8],
    ) -> Result<String, AppError> {
        let code = value["patient"]["code"].as_str().unwrap_or("patient");
        let dir = self.data_dir.join("exports");
        std::fs::create_dir_all(&dir).map_err(|e| AppError::Storage(Box::new(e)))?;
        let path = dir.join(format!("{code}.{ext}"));
        std::fs::write(&path, bytes).map_err(|e| AppError::Storage(Box::new(e)))?;
        Ok(path.display().to_string())
    }
}

// ---------------------------------------------------------------------------
// Free helpers (pure where possible; no IO except where noted).
// ---------------------------------------------------------------------------

/// The recycle-bin retention window in days (PAT-008).
const RECYCLE_WINDOW_DAYS: i64 = 30;

/// Trim-and-require: a field empty after trimming is a validation error.
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

/// Compute the four normalised search columns via the single `hc_search`
/// source of truth (PSR-003), so the 0004 FTS/trigram triggers index the row.
fn normalized_cols(name: &str, mobile: Option<&str>, code: &str) -> repo::NormalizedCols {
    repo::NormalizedCols {
        name_norm: hc_search::normalize::name_norm(name),
        name_phonetic: hc_search::phonetic_key(name),
        mobile_digits: mobile
            .map(hc_search::normalize::mobile_digits)
            .filter(|d| !d.is_empty()),
        code_digits: hc_search::normalize::code_digits(code),
    }
}

/// Build a full `PatientRow` for insert from the create request.
fn build_patient_row(
    id: &str,
    code: &str,
    name: &str,
    dob: &Option<String>,
    req: &CreatePatientRequest,
) -> repo::PatientRow {
    repo::PatientRow {
        id: id.to_string(),
        code: code.to_string(),
        name: name.to_string(),
        sex: optional(req.sex.clone()),
        dob: dob.clone(),
        dob_is_estimated: req.dob_is_estimated.unwrap_or(false),
        age_years: req.age_years,
        mobile: optional(req.mobile.clone()),
        mobile_alt: optional(req.mobile_alt.clone()),
        address: optional(req.address.clone()),
        city: optional(req.city.clone()),
        occupation: optional(req.occupation.clone()),
        marital_status: optional(req.marital_status.clone()),
        blood_group: optional(req.blood_group.clone()),
        referred_by: optional(req.referred_by.clone()),
        photo_path: optional(req.photo_path.clone()),
        allergies: optional(req.allergies.clone()),
        alerts: optional(req.alerts.clone()),
        consent_at: optional(req.consent_at.clone()),
        tags_json: tags_json(&req.tags),
    }
}

/// Build a `PatientRow` for update, carrying the immutable `code`.
fn build_patient_row_for_update(
    code: &str,
    name: &str,
    dob: &Option<String>,
    req: &UpdatePatientRequest,
) -> repo::PatientRow {
    repo::PatientRow {
        id: req.patient_id.clone(),
        code: code.to_string(),
        name: name.to_string(),
        sex: optional(req.sex.clone()),
        dob: dob.clone(),
        dob_is_estimated: req.dob_is_estimated.unwrap_or(false),
        age_years: req.age_years,
        mobile: optional(req.mobile.clone()),
        mobile_alt: optional(req.mobile_alt.clone()),
        address: optional(req.address.clone()),
        city: optional(req.city.clone()),
        occupation: optional(req.occupation.clone()),
        marital_status: optional(req.marital_status.clone()),
        blood_group: optional(req.blood_group.clone()),
        referred_by: optional(req.referred_by.clone()),
        photo_path: optional(req.photo_path.clone()),
        allergies: optional(req.allergies.clone()),
        alerts: optional(req.alerts.clone()),
        consent_at: optional(req.consent_at.clone()),
        tags_json: tags_json(&req.tags),
    }
}

/// Serialise the optional tags list to a JSON array string, or `None`.
fn tags_json(tags: &Option<Vec<String>>) -> Option<String> {
    tags.as_ref()
        .filter(|t| !t.is_empty())
        .and_then(|t| serde_json::to_string(t).ok())
}

/// Human age label for the dashboard: `"{n}y"` from DOB (preferred) else the
/// entered age, or an empty string when neither is known.
fn age_label(dob: Option<&str>, age_years: Option<i64>) -> String {
    if let Some(dob) = dob {
        if let Ok(d) = time::Date::parse(
            dob,
            time::macros::format_description!("[year]-[month]-[day]"),
        ) {
            let today = time::OffsetDateTime::now_utc().date();
            let mut years = today.year() - d.year();
            // Subtract one if this year's birthday has not occurred yet.
            if (today.month() as u8, today.day()) < (d.month() as u8, d.day()) {
                years -= 1;
            }
            if years >= 0 {
                return format!("{years}y");
            }
        }
    }
    match age_years {
        Some(a) => format!("{a}y"),
        None => String::new(),
    }
}

/// Add `days` to an RFC3339 (`Z`-suffixed) instant and re-format with the `Z`
/// suffix. On an unparseable input the input is returned unchanged so the
/// caller never panics (R-RUST-002); valid service inputs always parse.
fn plus_days(instant: &str, days: i64) -> String {
    use time::format_description::well_known::Rfc3339;
    const UTC_Z: &[time::format_description::FormatItem<'static>] =
        time::macros::format_description!("[year]-[month]-[day]T[hour]:[minute]:[second]Z");
    match time::OffsetDateTime::parse(instant, &Rfc3339) {
        Ok(start) => {
            let end = start + time::Duration::days(days);
            end.format(UTC_Z).unwrap_or_else(|_| instant.to_string())
        }
        Err(_) => instant.to_string(),
    }
}

/// Render the export JSON as a plain-text patient summary for the PDF body.
fn render_patient_text(value: &serde_json::Value) -> String {
    let p = &value["patient"];
    let get = |k: &str| p[k].as_str().unwrap_or("").to_string();
    let mut out = String::new();
    out.push_str("Patient Record\n");
    out.push_str(&format!("Code: {}\n", get("code")));
    out.push_str(&format!("Name: {}\n", get("name")));
    out.push_str(&format!("Sex: {}\n", get("sex")));
    out.push_str(&format!("DOB: {}\n", get("dob")));
    out.push_str(&format!("Mobile: {}\n", get("mobile")));
    out.push_str(&format!("City: {}\n", get("city")));
    out.push_str(&format!("Allergies: {}\n", get("allergies")));
    out.push_str("Visits: (none)\n");
    out
}

/// Emit a minimal, valid single-page PDF embedding `text` as one content
/// stream. Deterministic and dependency-free so the export works fully offline
/// (MVP1 makes zero network calls). Not a rich layout — a faithful, printable
/// record of the same fields the JSON export carries.
fn render_minimal_pdf(text: &str) -> Vec<u8> {
    // Escape PDF string metacharacters and split into per-line Tj show ops.
    let mut body = String::new();
    body.push_str("BT\n/F1 12 Tf\n72 720 Td\n14 TL\n");
    for line in text.lines() {
        let escaped = line
            .replace('\\', "\\\\")
            .replace('(', "\\(")
            .replace(')', "\\)");
        body.push_str(&format!("({escaped}) Tj\nT*\n"));
    }
    body.push_str("ET");

    let mut objects: Vec<String> = Vec::new();
    objects.push("<< /Type /Catalog /Pages 2 0 R >>".to_string());
    objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string());
    objects.push(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] \
         /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
            .to_string(),
    );
    objects.push(format!(
        "<< /Length {} >>\nstream\n{}\nendstream",
        body.len(),
        body
    ));
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string());

    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets: Vec<usize> = Vec::with_capacity(objects.len());
    for (i, obj) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{}\nendobj\n", i + 1, obj));
    }
    let xref_pos = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n", objects.len() + 1));
    pdf.push_str("0000000000 65535 f \n");
    for off in &offsets {
        pdf.push_str(&format!("{off:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF",
        objects.len() + 1,
        xref_pos
    ));
    pdf.into_bytes()
}
