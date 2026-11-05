//! S18 General settings record: read + one-transaction-one-audit write
//! (MS, SET-002/003/004/005/007, PAT-002; design §2.2).
//!
//! The General form edits one logical record spread over `doctor_profile`,
//! `clinic_profile`, `patient_sequence.prefix` and three `app_setting` keys.
//! [`write_general`] updates only what changed, in the caller's transaction,
//! and writes EXACTLY ONE `audit_log` row for the whole use case
//! (R-DATA-001). Rows are updated in place (`created_at` kept, `row_version`
//! bumped), unlike the setup upserts. Parameterised SQL only (R-SEC-001).
//! Existing `patient.code` rows are never read or written here (PAT-002).

use crate::audit::{diff_objects, write_audit, AuditAction, AuditEntry};
use crate::error::StorageError;
use crate::profile::{get_clinic_profile, get_doctor_profile, get_setting};
use crate::profile::{ClinicProfile, DoctorProfile};
use rusqlite::{params, Connection, Transaction};
use serde_json::{json, Value};

/// `app_setting` key of the idle auto-lock minutes (JSON number).
const KEY_AUTOLOCK: &str = "autolock_minutes";
/// `app_setting` key of the font size (JSON string).
const KEY_FONT_SIZE: &str = "font_size";
/// `app_setting` key of the remembered camera (JSON object), absent = default.
const KEY_CAMERA: &str = "default_camera";
/// Auto-lock minutes when the key was never written.
const DEFAULT_AUTOLOCK: u16 = 15;
/// Font size when the key was never written.
const DEFAULT_FONT_SIZE: &str = "normal";

/// Flat snapshot of everything the General form edits (one logical record).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneralSettingsRecord {
    /// The doctor profile (id kept).
    pub doctor: DoctorProfile,
    /// The clinic profile (id kept).
    pub clinic: ClinicProfile,
    /// `patient_sequence.prefix` (PAT-002).
    pub id_prefix: String,
    /// Idle auto-lock minutes; 15 when the key is absent.
    pub autolock_minutes: u16,
    /// `"normal"` | `"large"` | `"xlarge"`; `"normal"` when absent.
    pub font_size: String,
    /// Raw JSON of the remembered camera (`{"deviceId":..,"label":..}`), or
    /// `None` = system default (SET-007).
    pub default_camera_json: Option<String>,
}

/// Read the record; `Ok(None)` when the doctor or clinic profile is missing.
pub fn read_general(conn: &Connection) -> Result<Option<GeneralSettingsRecord>, StorageError> {
    let (Some(doctor), Some(clinic)) = (get_doctor_profile(conn)?, get_clinic_profile(conn)?)
    else {
        return Ok(None);
    };
    let id_prefix: String = conn.query_row(
        "SELECT prefix FROM patient_sequence WHERE id = 1",
        [],
        |r| r.get(0),
    )?;
    let autolock_minutes = read_autolock_minutes(conn)?.unwrap_or(DEFAULT_AUTOLOCK);
    let font_size = get_setting(conn, KEY_FONT_SIZE)?
        .and_then(|raw| serde_json::from_str::<String>(&raw).ok())
        .unwrap_or_else(|| DEFAULT_FONT_SIZE.to_string());
    let default_camera_json = get_setting(conn, KEY_CAMERA)?;
    Ok(Some(GeneralSettingsRecord {
        doctor,
        clinic,
        id_prefix,
        autolock_minutes,
        font_size,
        default_camera_json,
    }))
}

/// Next running number of `patient_sequence` (no consume).
pub fn peek_next_seq(conn: &Connection) -> Result<i64, StorageError> {
    Ok(conn.query_row(
        "SELECT next_seq FROM patient_sequence WHERE id = 1",
        [],
        |r| r.get(0),
    )?)
}

/// Persisted auto-lock minutes, or `None` if never set (used by unlock).
///
/// The value is a JSON number (`"15"`); a quoted number is accepted too. An
/// unparseable value reads as `None` so the caller falls back to the default.
pub fn read_autolock_minutes(conn: &Connection) -> Result<Option<u16>, StorageError> {
    let Some(raw) = get_setting(conn, KEY_AUTOLOCK)? else {
        return Ok(None);
    };
    let parsed = match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Number(n)) => n.as_u64().and_then(|v| u16::try_from(v).ok()),
        Ok(Value::String(s)) => s.trim().parse::<u16>().ok(),
        _ => None,
    };
    Ok(parsed)
}

/// The flat, namespaced audit view of a record (config/doctor data only; never
/// patient data, PIN or key material — R-PRIV-001).
fn flat(rec: &GeneralSettingsRecord) -> Value {
    let camera: Value = rec
        .default_camera_json
        .as_deref()
        .map(|raw| serde_json::from_str(raw).unwrap_or(Value::String(raw.to_string())))
        .unwrap_or(Value::Null);
    json!({
        "doctor.name": rec.doctor.name,
        "doctor.qualification": rec.doctor.qualification,
        "doctor.reg_no": rec.doctor.reg_no,
        "doctor.reg_council": rec.doctor.reg_council,
        "doctor.phone": rec.doctor.phone,
        "doctor.email": rec.doctor.email,
        "clinic.name": rec.clinic.name,
        "clinic.address": rec.clinic.address,
        "clinic.phone": rec.clinic.phone,
        "clinic.timings": rec.clinic.timings,
        "clinic.gstin": rec.clinic.gstin,
        "clinic.fee_first_paise": rec.clinic.fee_first_paise,
        "clinic.fee_followup_paise": rec.clinic.fee_followup_paise,
        "app.id_prefix": rec.id_prefix,
        "app.autolock_minutes": rec.autolock_minutes,
        "app.font_size": rec.font_size,
        "app.default_camera": camera,
    })
}

/// Upsert one `app_setting` key WITHOUT its own audit row (the use case writes
/// a single audit row for the whole form).
fn set_key(tx: &Transaction<'_>, key: &str, value_json: &str) -> Result<(), StorageError> {
    tx.execute(
        "INSERT INTO app_setting (key, value_json) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        params![key, value_json],
    )?;
    Ok(())
}

/// Write `new` over `old` in the caller's transaction with EXACTLY ONE audit
/// row (`settings`/`general`, update). Returns `Ok(false)` and writes nothing
/// when `old == new`.
///
/// Only the changed tables/keys are touched: `doctor_profile` and
/// `clinic_profile` are `UPDATE`d by id (`updated_at = now`, `row_version + 1`,
/// `created_at` kept); `patient_sequence.prefix` (id 1) is updated without
/// touching `next_seq`; `autolock_minutes` / `font_size` / `default_camera`
/// are upserted (the camera key is deleted on `None`).
pub fn write_general(
    tx: &Transaction<'_>,
    old: &GeneralSettingsRecord,
    new: &GeneralSettingsRecord,
    now: &str,
) -> Result<bool, StorageError> {
    if old == new {
        return Ok(false);
    }

    if old.doctor != new.doctor {
        let d = &new.doctor;
        tx.execute(
            "UPDATE doctor_profile SET name = ?2, qualification = ?3, reg_no = ?4, \
             reg_council = ?5, phone = ?6, email = ?7, signature_ref = ?8, logo_ref = ?9, \
             updated_at = ?10, row_version = row_version + 1 WHERE id = ?1",
            params![
                d.id,
                d.name,
                d.qualification,
                d.reg_no,
                d.reg_council,
                d.phone,
                d.email,
                d.signature_ref,
                d.logo_ref,
                now
            ],
        )?;
    }
    if old.clinic != new.clinic {
        let c = &new.clinic;
        tx.execute(
            "UPDATE clinic_profile SET name = ?2, address = ?3, phone = ?4, timings = ?5, \
             fee_first_paise = ?6, fee_followup_paise = ?7, gstin = ?8, updated_at = ?9, \
             row_version = row_version + 1 WHERE id = ?1",
            params![
                c.id,
                c.name,
                c.address,
                c.phone,
                c.timings,
                c.fee_first_paise,
                c.fee_followup_paise,
                c.gstin,
                now
            ],
        )?;
    }
    if old.id_prefix != new.id_prefix {
        tx.execute(
            "UPDATE patient_sequence SET prefix = ?1, updated_at = ?2 WHERE id = 1",
            params![new.id_prefix, now],
        )?;
    }
    if old.autolock_minutes != new.autolock_minutes {
        set_key(tx, KEY_AUTOLOCK, &new.autolock_minutes.to_string())?;
    }
    if old.font_size != new.font_size {
        set_key(tx, KEY_FONT_SIZE, &serde_json::to_string(&new.font_size)?)?;
    }
    if old.default_camera_json != new.default_camera_json {
        match &new.default_camera_json {
            Some(raw) => set_key(tx, KEY_CAMERA, raw)?,
            None => {
                tx.execute(
                    "DELETE FROM app_setting WHERE key = ?1",
                    params![KEY_CAMERA],
                )?;
            }
        }
    }

    write_audit(
        tx,
        &AuditEntry {
            user_id: None,
            entity: "settings",
            entity_id: "general",
            action: AuditAction::Update,
            diff: diff_objects(&flat(old), &flat(new)),
        },
        now,
    )?;
    Ok(true)
}
