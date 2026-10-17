//! Doctor/clinic profile, settings and trial repositories (HC-MVP1-026/027).
//!
//! Parameterised SQL only (R-SEC-001). Every write runs inside the caller's
//! transaction and writes exactly one `audit_log` row (R-DATA-001); the
//! use-case command in `hc-app` owns the transaction boundary. Money is integer
//! paise (R-DATA-004). Rows carry UUIDv7 ids + standard audit columns
//! (R-DATA-005).
//!
//! Each writer runs inside the caller's transaction and, with
//! [`crate::audit::write_audit`], commits exactly one `audit_log` row in the
//! same transaction (R-DATA-001).

use crate::audit::{write_audit, AuditAction, AuditEntry};
use crate::error::StorageError;
use rusqlite::{Connection, Transaction};
use serde_json::json;

/// The practising doctor (SET-002). `id` is a UUIDv7.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DoctorProfile {
    /// UUIDv7 primary key.
    pub id: String,
    /// Full name (printed on documents; LIC-006).
    pub name: String,
    /// Qualification (e.g. BHMS / MD(Hom)).
    pub qualification: String,
    /// Registration number (printed on documents; LIC-006).
    pub reg_no: String,
    /// Registration council.
    pub reg_council: String,
    /// Optional phone (digits only).
    pub phone: Option<String>,
    /// Optional email.
    pub email: Option<String>,
    /// Optional opaque signature attachment uuid (R-PRIV-007).
    pub signature_ref: Option<String>,
    /// Optional opaque logo attachment uuid.
    pub logo_ref: Option<String>,
}

/// The clinic (SET-003). Fees are integer paise (R-DATA-004).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClinicProfile {
    /// UUIDv7 primary key.
    pub id: String,
    /// Clinic name.
    pub name: String,
    /// Clinic address.
    pub address: String,
    /// Optional phone.
    pub phone: Option<String>,
    /// Optional timings free text.
    pub timings: Option<String>,
    /// Default consultation fee, integer paise.
    pub fee_first_paise: i64,
    /// Default follow-up fee, integer paise.
    pub fee_followup_paise: i64,
    /// Optional GSTIN.
    pub gstin: Option<String>,
}

/// The local 30-day trial seed (LIC-063).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Trial {
    /// UUIDv7 primary key.
    pub id: String,
    /// RFC3339 UTC start.
    pub started_at: String,
    /// RFC3339 UTC expiry (`started_at` + 30 days).
    pub valid_until: String,
}

/// Insert/replace the doctor profile and write one audit row (R-DATA-001).
///
/// The profile is a single logical row; a re-run of setup replaces it. The
/// `audit_log` row carries a field snapshot (no PIN, no key material —
/// R-PRIV-001). All values are bound as parameters (R-SEC-001).
pub fn upsert_doctor_profile(
    tx: &Transaction<'_>,
    profile: &DoctorProfile,
    now: &str,
) -> Result<(), StorageError> {
    tx.execute(
        "INSERT OR REPLACE INTO doctor_profile (\
            id, name, qualification, reg_no, reg_council, phone, email, \
            signature_ref, logo_ref, created_at, updated_at, deleted_at, \
            created_by, updated_by, row_version\
        ) VALUES (\
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, NULL, NULL, NULL, 0\
        )",
        rusqlite::params![
            profile.id,
            profile.name,
            profile.qualification,
            profile.reg_no,
            profile.reg_council,
            profile.phone,
            profile.email,
            profile.signature_ref,
            profile.logo_ref,
            now,
        ],
    )?;
    write_audit(
        tx,
        &AuditEntry {
            user_id: None,
            entity: "doctor_profile",
            entity_id: &profile.id,
            action: AuditAction::Create,
            diff: json!({
                "name": {"new": profile.name},
                "qualification": {"new": profile.qualification},
                "reg_no": {"new": profile.reg_no},
                "reg_council": {"new": profile.reg_council},
            }),
        },
        now,
    )?;
    Ok(())
}

/// Insert/replace the clinic profile and write one audit row (R-DATA-001).
///
/// Fees are stored as the exact integer paise supplied (R-DATA-004). All values
/// are bound as parameters (R-SEC-001).
pub fn upsert_clinic_profile(
    tx: &Transaction<'_>,
    profile: &ClinicProfile,
    now: &str,
) -> Result<(), StorageError> {
    tx.execute(
        "INSERT OR REPLACE INTO clinic_profile (\
            id, name, address, phone, timings, fee_first_paise, \
            fee_followup_paise, gstin, created_at, updated_at, deleted_at, \
            created_by, updated_by, row_version\
        ) VALUES (\
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, NULL, NULL, NULL, 0\
        )",
        rusqlite::params![
            profile.id,
            profile.name,
            profile.address,
            profile.phone,
            profile.timings,
            profile.fee_first_paise,
            profile.fee_followup_paise,
            profile.gstin,
            now,
        ],
    )?;
    write_audit(
        tx,
        &AuditEntry {
            user_id: None,
            entity: "clinic_profile",
            entity_id: &profile.id,
            action: AuditAction::Create,
            diff: json!({
                "name": {"new": profile.name},
                "fee_first_paise": {"new": profile.fee_first_paise},
                "fee_followup_paise": {"new": profile.fee_followup_paise},
            }),
        },
        now,
    )?;
    Ok(())
}

/// Read the doctor profile, or `None` if setup has not stored one.
pub fn get_doctor_profile(conn: &Connection) -> Result<Option<DoctorProfile>, StorageError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, qualification, reg_no, reg_council, phone, email, \
         signature_ref, logo_ref FROM doctor_profile \
         WHERE deleted_at IS NULL LIMIT 1",
    )?;
    let mut rows = stmt.query([])?;
    match rows.next()? {
        Some(r) => Ok(Some(DoctorProfile {
            id: r.get(0)?,
            name: r.get(1)?,
            qualification: r.get(2)?,
            reg_no: r.get(3)?,
            reg_council: r.get(4)?,
            phone: r.get(5)?,
            email: r.get(6)?,
            signature_ref: r.get(7)?,
            logo_ref: r.get(8)?,
        })),
        None => Ok(None),
    }
}

/// Read the clinic profile, or `None`.
pub fn get_clinic_profile(conn: &Connection) -> Result<Option<ClinicProfile>, StorageError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, address, phone, timings, fee_first_paise, \
         fee_followup_paise, gstin FROM clinic_profile \
         WHERE deleted_at IS NULL LIMIT 1",
    )?;
    let mut rows = stmt.query([])?;
    match rows.next()? {
        Some(r) => Ok(Some(ClinicProfile {
            id: r.get(0)?,
            name: r.get(1)?,
            address: r.get(2)?,
            phone: r.get(3)?,
            timings: r.get(4)?,
            fee_first_paise: r.get(5)?,
            fee_followup_paise: r.get(6)?,
            gstin: r.get(7)?,
        })),
        None => Ok(None),
    }
}

/// Insert/replace an `app_setting` key and write one audit row (R-DATA-001).
///
/// `value_json` is the already-serialised JSON value. The audit snapshot
/// records only the key and value (config, never patient data — R-PRIV-001).
pub fn put_setting(
    tx: &Transaction<'_>,
    key: &str,
    value_json: &str,
    now: &str,
) -> Result<(), StorageError> {
    tx.execute(
        "INSERT OR REPLACE INTO app_setting (key, value_json) VALUES (?1, ?2)",
        rusqlite::params![key, value_json],
    )?;
    write_audit(
        tx,
        &AuditEntry {
            user_id: None,
            entity: "app_setting",
            entity_id: key,
            action: AuditAction::Update,
            diff: json!({ "value_json": {"new": value_json} }),
        },
        now,
    )?;
    Ok(())
}

/// Read an `app_setting` value JSON by key, or `None`.
pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, StorageError> {
    let mut stmt = conn.prepare("SELECT value_json FROM app_setting WHERE key = ?1")?;
    let mut rows = stmt.query(rusqlite::params![key])?;
    match rows.next()? {
        Some(r) => Ok(Some(r.get(0)?)),
        None => Ok(None),
    }
}

/// Insert the trial row and write one audit row (R-DATA-001).
pub fn start_trial(tx: &Transaction<'_>, trial: &Trial, now: &str) -> Result<(), StorageError> {
    tx.execute(
        "INSERT OR REPLACE INTO trial (\
            id, started_at, valid_until, created_at, updated_at, deleted_at, \
            created_by, updated_by, row_version\
        ) VALUES (?1, ?2, ?3, ?4, ?4, NULL, NULL, NULL, 0)",
        rusqlite::params![trial.id, trial.started_at, trial.valid_until, now],
    )?;
    write_audit(
        tx,
        &AuditEntry {
            user_id: None,
            entity: "trial",
            entity_id: &trial.id,
            action: AuditAction::Create,
            diff: json!({
                "started_at": {"new": trial.started_at},
                "valid_until": {"new": trial.valid_until},
            }),
        },
        now,
    )?;
    Ok(())
}

/// Read the trial row, or `None`.
pub fn get_trial(conn: &Connection) -> Result<Option<Trial>, StorageError> {
    let mut stmt = conn.prepare(
        "SELECT id, started_at, valid_until FROM trial \
         WHERE deleted_at IS NULL LIMIT 1",
    )?;
    let mut rows = stmt.query([])?;
    match rows.next()? {
        Some(r) => Ok(Some(Trial {
            id: r.get(0)?,
            started_at: r.get(1)?,
            valid_until: r.get(2)?,
        })),
        None => Ok(None),
    }
}
