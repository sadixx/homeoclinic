//! Patient, family-link and patient-code-sequence repositories
//! (HC-MVP1-036..043, PAT-001/002/004/005/006/008).
//!
//! Parameterised SQL only (R-SEC-001). Every write runs inside the caller's
//! transaction and commits exactly one `audit_log` row via
//! [`crate::audit::write_audit`] (R-DATA-001). Rows carry UUIDv7 ids + standard
//! audit columns (R-DATA-005); money is integer paise (R-DATA-004). The writer
//! populates the four normalised search columns (`name_norm`, `name_phonetic`,
//! `mobile_digits`, `code_digits`) so the migration-0004 FTS/trigram sync
//! triggers mirror them in the same transaction (PSR-012, R-DATA-006).

use crate::audit::{write_audit, AuditAction, AuditEntry};
use crate::error::StorageError;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::json;

/// A full persisted patient (read + write). `None` fields are absent columns.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PatientRow {
    /// UUIDv7 primary key.
    pub id: String,
    /// Assigned code, e.g. `HC-000123` (PAT-002).
    pub code: String,
    /// Display name as entered (required).
    pub name: String,
    /// Sex (free-form single value), or `None`.
    pub sex: Option<String>,
    /// RFC3339 date of birth, or `None` when only age is known.
    pub dob: Option<String>,
    /// Whether `dob` was estimated from an entered age (PAT-001).
    pub dob_is_estimated: bool,
    /// Age in years when DOB is unknown, or `None`.
    pub age_years: Option<i64>,
    /// Mobile as entered (may hold `+91`/spaces), or `None`.
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
    /// Referred-by free text, or `None`.
    pub referred_by: Option<String>,
    /// Opaque photo attachment ref (R-PRIV-007), or `None`.
    pub photo_path: Option<String>,
    /// Allergies (alerts banner, PAT-005), or `None`.
    pub allergies: Option<String>,
    /// Other alerts, or `None`.
    pub alerts: Option<String>,
    /// DPDP consent instant (R-PRIV-003), or `None`.
    pub consent_at: Option<String>,
    /// Serialised tags JSON array (PAT-007, stored only this slice), or `None`.
    pub tags_json: Option<String>,
}

/// The four normalised search columns, computed by the caller through the
/// `hc_search` helpers so the normalisation logic lives in exactly one place.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct NormalizedCols {
    /// Lowercase, dots/diacritics stripped, single-spaced name (PSR-003).
    pub name_norm: String,
    /// Space-joined phonetic keys, one per name word (PSR-003).
    pub name_phonetic: String,
    /// Digits-only mobile (`+91` stripped), or `None`.
    pub mobile_digits: Option<String>,
    /// Digits-only code (PSR-002).
    pub code_digits: String,
}

/// One candidate duplicate match (PAT-004); never blocks, only warns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateMatch {
    /// The matched patient's UUIDv7 id.
    pub patient_id: String,
    /// The matched patient's code.
    pub code: String,
    /// The matched patient's display name.
    pub name: String,
    /// The matched patient's mobile as entered, or `None`.
    pub mobile: Option<String>,
    /// The matched patient's DOB, or `None`.
    pub dob: Option<String>,
}

/// A family-link row (PAT-006).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FamilyLinkRow {
    /// UUIDv7 primary key.
    pub id: String,
    /// The patient the link hangs off.
    pub patient_id: String,
    /// The related patient.
    pub related_patient_id: String,
    /// Relation free text (e.g. `Wife`).
    pub relation: String,
    /// Whether the related patient shares this patient's address.
    pub share_address: bool,
}

/// A linked family member as shown on the dashboard (PAT-006).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FamilyMember {
    /// The related patient's id.
    pub patient_id: String,
    /// The related patient's display name.
    pub name: String,
    /// The relation (e.g. `Wife`).
    pub relation: String,
}

/// Column list shared by the two patient read helpers (keeps the two SELECTs in
/// lock-step so a schema change touches one place).
const PATIENT_COLUMNS: &str = "id, code, name, sex, dob, dob_is_estimated, age_years, \
     mobile, mobile_alt, address, city, occupation, marital_status, blood_group, \
     referred_by, photo_path, allergies, alerts, consent_at, tags_json";

/// Map a `patient` row (selected with [`PATIENT_COLUMNS`]) into a [`PatientRow`].
fn map_patient_row(r: &rusqlite::Row<'_>) -> Result<PatientRow, rusqlite::Error> {
    Ok(PatientRow {
        id: r.get(0)?,
        code: r.get(1)?,
        name: r.get(2)?,
        sex: r.get(3)?,
        dob: r.get(4)?,
        dob_is_estimated: r.get::<_, i64>(5)? != 0,
        age_years: r.get(6)?,
        mobile: r.get(7)?,
        mobile_alt: r.get(8)?,
        address: r.get(9)?,
        city: r.get(10)?,
        occupation: r.get(11)?,
        marital_status: r.get(12)?,
        blood_group: r.get(13)?,
        referred_by: r.get(14)?,
        photo_path: r.get(15)?,
        allergies: r.get(16)?,
        alerts: r.get(17)?,
        consent_at: r.get(18)?,
        tags_json: r.get(19)?,
    })
}

// ---------------------------------------------------------------------------
// Patient code sequence (PAT-002): monotonic, never reused.
// ---------------------------------------------------------------------------

/// Read the configured prefix + next number WITHOUT consuming the sequence
/// (code preview). Formats `{prefix}{next_seq:06}` for the single seed row.
///
/// Previewing never bumps the counter, so cancelling a new-patient form leaves
/// no gap (PAT-002, S06 open-question).
pub fn peek_next_patient_code(conn: &Connection) -> Result<String, StorageError> {
    let (prefix, next_seq): (String, i64) = conn.query_row(
        "SELECT prefix, next_seq FROM patient_sequence WHERE id = 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(format_code(&prefix, next_seq))
}

/// Read the sequence, format `{prefix}{next_seq:06}`, bump `next_seq` by one,
/// and return the assigned code — all in the caller's transaction. Monotonic:
/// no delete/restore path ever touches `patient_sequence`, so a code is NEVER
/// reused (PAT-002).
pub fn next_patient_code(tx: &Transaction<'_>, now: &str) -> Result<String, StorageError> {
    let (prefix, next_seq): (String, i64) = tx.query_row(
        "SELECT prefix, next_seq FROM patient_sequence WHERE id = 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let code = format_code(&prefix, next_seq);
    // Bump the counter in the same transaction; it only ever increases.
    tx.execute(
        "UPDATE patient_sequence SET next_seq = next_seq + 1, updated_at = ?1 WHERE id = 1",
        params![now],
    )?;
    Ok(code)
}

/// Format a patient code as `{prefix}{seq:06}` (e.g. `HC-000001`).
fn format_code(prefix: &str, seq: i64) -> String {
    format!("{prefix}{seq:06}")
}

// ---------------------------------------------------------------------------
// Create / update / read.
// ---------------------------------------------------------------------------

/// Insert the patient row + normalised search columns and write one audit row
/// (R-DATA-001) in the caller's transaction; the 0004 triggers mirror the FTS /
/// trigram rows (PSR-012).
pub fn insert_patient(
    tx: &Transaction<'_>,
    patient: &PatientRow,
    norm: &NormalizedCols,
    now: &str,
    user: Option<&str>,
) -> Result<(), StorageError> {
    tx.execute(
        "INSERT INTO patient (\
            id, code, name, name_norm, name_phonetic, sex, dob, dob_is_estimated, \
            age_years, mobile, mobile_digits, mobile_alt, code_digits, city, address, \
            occupation, marital_status, blood_group, referred_by, photo_path, \
            allergies, alerts, consent_at, tags_json, \
            created_at, updated_at, created_by, updated_by, row_version\
        ) VALUES (\
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, \
            ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?25, ?26, ?26, 0\
        )",
        params![
            patient.id,
            patient.code,
            patient.name,
            norm.name_norm,
            norm.name_phonetic,
            patient.sex,
            patient.dob,
            patient.dob_is_estimated as i64,
            patient.age_years,
            patient.mobile,
            norm.mobile_digits,
            patient.mobile_alt,
            norm.code_digits,
            patient.city,
            patient.address,
            patient.occupation,
            patient.marital_status,
            patient.blood_group,
            patient.referred_by,
            patient.photo_path,
            patient.allergies,
            patient.alerts,
            patient.consent_at,
            patient.tags_json,
            now,
            user,
        ],
    )?;
    // One audit row; the diff snapshots the non-identifying shape of the create.
    // Patient free-text (name/mobile/etc.) is NOT echoed into the audit diff to
    // keep the audit trail free of avoidable PII beyond the entity id
    // (R-PRIV-001); the audited fact is "a patient with this code was created".
    write_audit(
        tx,
        &AuditEntry {
            user_id: user,
            entity: "patient",
            entity_id: &patient.id,
            action: AuditAction::Create,
            diff: json!({ "code": {"new": patient.code} }),
        },
        now,
    )?;
    Ok(())
}

/// Update the patient row (re-normalising the search columns), bump
/// `row_version`, and write one audit row (R-DATA-001). The `name`/demographic
/// change drives the 0004 `AFTER UPDATE` trigger so the FTS index reflects the
/// new name in the same transaction (PSR-012).
pub fn update_patient(
    tx: &Transaction<'_>,
    patient: &PatientRow,
    norm: &NormalizedCols,
    now: &str,
    user: Option<&str>,
) -> Result<(), StorageError> {
    let changed = tx.execute(
        "UPDATE patient SET \
            name = ?2, name_norm = ?3, name_phonetic = ?4, sex = ?5, dob = ?6, \
            dob_is_estimated = ?7, age_years = ?8, mobile = ?9, mobile_digits = ?10, \
            mobile_alt = ?11, code_digits = ?12, city = ?13, address = ?14, \
            occupation = ?15, marital_status = ?16, blood_group = ?17, \
            referred_by = ?18, photo_path = ?19, allergies = ?20, alerts = ?21, \
            consent_at = ?22, tags_json = ?23, updated_at = ?24, updated_by = ?25, \
            row_version = row_version + 1 \
         WHERE id = ?1 AND deleted_at IS NULL",
        params![
            patient.id,
            patient.name,
            norm.name_norm,
            norm.name_phonetic,
            patient.sex,
            patient.dob,
            patient.dob_is_estimated as i64,
            patient.age_years,
            patient.mobile,
            norm.mobile_digits,
            patient.mobile_alt,
            norm.code_digits,
            patient.city,
            patient.address,
            patient.occupation,
            patient.marital_status,
            patient.blood_group,
            patient.referred_by,
            patient.photo_path,
            patient.allergies,
            patient.alerts,
            patient.consent_at,
            patient.tags_json,
            now,
            user,
        ],
    )?;
    if changed == 0 {
        // No live row matched: nothing was updated. The service maps this to a
        // not-found at the boundary; here it is a plain no-match signal.
        return Err(StorageError::Db(rusqlite::Error::QueryReturnedNoRows));
    }
    write_audit(
        tx,
        &AuditEntry {
            user_id: user,
            entity: "patient",
            entity_id: &patient.id,
            action: AuditAction::Update,
            diff: json!({ "code": {"new": patient.code} }),
        },
        now,
    )?;
    Ok(())
}

/// Read one non-deleted patient by id, or `None`.
pub fn get_patient(conn: &Connection, id: &str) -> Result<Option<PatientRow>, StorageError> {
    let sql = format!("SELECT {PATIENT_COLUMNS} FROM patient WHERE id = ?1 AND deleted_at IS NULL");
    let row = conn
        .query_row(&sql, params![id], map_patient_row)
        .optional()?;
    Ok(row)
}

/// Read one patient by id INCLUDING a soft-deleted row (recycle-bin read).
pub fn get_patient_including_deleted(
    conn: &Connection,
    id: &str,
) -> Result<Option<PatientRow>, StorageError> {
    let sql = format!("SELECT {PATIENT_COLUMNS} FROM patient WHERE id = ?1");
    let row = conn
        .query_row(&sql, params![id], map_patient_row)
        .optional()?;
    Ok(row)
}

// ---------------------------------------------------------------------------
// Duplicate detection (PAT-004) — warns, never blocks.
// ---------------------------------------------------------------------------

/// Find candidate duplicates: a non-deleted patient whose `name_norm` OR
/// `name_phonetic` matches, together with a matching `mobile_digits` OR `dob`
/// (PAT-004). Bounded result (R-DATA-007).
///
/// All predicates are parameter-bound equalities over indexed columns
/// (R-SEC-001, R-DATA-008); phonetic matching reuses the stored
/// `name_phonetic` key so Indian-name spelling variants (Sharma/Sarma) collide
/// (PSR-003). A branch whose narrowing value is absent is disabled via a
/// `?N IS NOT NULL` guard so it cannot widen the match.
pub fn find_duplicates(
    conn: &Connection,
    name_norm: &str,
    name_phonetic: &str,
    mobile_digits: Option<&str>,
    dob: Option<&str>,
) -> Result<Vec<DuplicateMatch>, StorageError> {
    // Bounded (R-DATA-007): duplicate warnings only need a handful of hits.
    const DUPLICATE_LIMIT: usize = 20;

    let sql = format!(
        "SELECT id, code, name, mobile, dob FROM patient \
         WHERE deleted_at IS NULL \
           AND (name_norm = ?1 OR name_phonetic = ?2) \
           AND ( \
             (?3 IS NOT NULL AND mobile_digits = ?3) \
             OR (?4 IS NOT NULL AND dob = ?4) \
           ) \
         LIMIT {DUPLICATE_LIMIT}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![name_norm, name_phonetic, mobile_digits, dob], |r| {
            Ok(DuplicateMatch {
                patient_id: r.get(0)?,
                code: r.get(1)?,
                name: r.get(2)?,
                mobile: r.get(3)?,
                dob: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Soft delete / restore / permanent (PIN-gated) delete (PAT-008, R-DATA-003).
// ---------------------------------------------------------------------------

/// Soft-delete: set `deleted_at` (the recycle-window start) + one audit row
/// (R-DATA-001). The row leaves normal search (which filters
/// `deleted_at IS NULL`) but stays recoverable.
pub fn soft_delete_patient(
    tx: &Transaction<'_>,
    id: &str,
    deleted_at: &str,
    user: Option<&str>,
) -> Result<(), StorageError> {
    let changed = tx.execute(
        "UPDATE patient SET deleted_at = ?2, updated_at = ?2, updated_by = ?3, \
            row_version = row_version + 1 \
         WHERE id = ?1 AND deleted_at IS NULL",
        params![id, deleted_at, user],
    )?;
    if changed == 0 {
        return Err(StorageError::Db(rusqlite::Error::QueryReturnedNoRows));
    }
    write_audit(
        tx,
        &AuditEntry {
            user_id: user,
            entity: "patient",
            entity_id: id,
            action: AuditAction::Delete,
            diff: json!({ "deleted_at": {"new": deleted_at} }),
        },
        deleted_at,
    )?;
    Ok(())
}

/// Restore from the recycle bin: clear `deleted_at` + one audit row.
pub fn restore_patient(
    tx: &Transaction<'_>,
    id: &str,
    now: &str,
    user: Option<&str>,
) -> Result<(), StorageError> {
    let changed = tx.execute(
        "UPDATE patient SET deleted_at = NULL, updated_at = ?2, updated_by = ?3, \
            row_version = row_version + 1 \
         WHERE id = ?1 AND deleted_at IS NOT NULL",
        params![id, now, user],
    )?;
    if changed == 0 {
        return Err(StorageError::Db(rusqlite::Error::QueryReturnedNoRows));
    }
    write_audit(
        tx,
        &AuditEntry {
            user_id: user,
            entity: "patient",
            entity_id: id,
            action: AuditAction::Update,
            diff: json!({ "deleted_at": {"old": "<set>", "new": serde_json::Value::Null} }),
        },
        now,
    )?;
    Ok(())
}

/// Hard-delete the patient row (and its family links) + one audit `delete` row
/// (R-DATA-001). The ONLY permitted hard delete of a clinical row (R-DATA-003
/// exception, DPDP erase path); callers gate it behind a PIN re-verify.
/// `patient_sequence` is never touched, so the freed code is still never reused
/// (PAT-002).
///
/// The `family_link` rows that reference this patient on either side are
/// removed first so the `patient(id)` foreign keys (foreign_keys=ON) do not
/// block the erase. The 0004 `AFTER DELETE` trigger drops the FTS/trigram shadow
/// rows in the same transaction (R-DATA-006). `now` is the caller's clock
/// instant, stamped on the audit row.
pub fn hard_delete_patient(
    tx: &Transaction<'_>,
    id: &str,
    now: &str,
    user: Option<&str>,
) -> Result<(), StorageError> {
    // Remove dependent family links (both directions) so the FK holds.
    tx.execute(
        "DELETE FROM family_link WHERE patient_id = ?1 OR related_patient_id = ?1",
        params![id],
    )?;
    let changed = tx.execute("DELETE FROM patient WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(StorageError::Db(rusqlite::Error::QueryReturnedNoRows));
    }
    // One audit row records the erase (R-DATA-001); it carries no patient
    // free-text, only the entity id and the fact of a hard delete (R-PRIV-001).
    write_audit(
        tx,
        &AuditEntry {
            user_id: user,
            entity: "patient",
            entity_id: id,
            action: AuditAction::Delete,
            diff: json!({ "hard_deleted": {"new": true} }),
        },
        now,
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Family linking (PAT-006).
// ---------------------------------------------------------------------------

/// Insert a family link + one audit row (R-DATA-001).
pub fn insert_family_link(
    tx: &Transaction<'_>,
    link: &FamilyLinkRow,
    now: &str,
    user: Option<&str>,
) -> Result<(), StorageError> {
    tx.execute(
        "INSERT INTO family_link (\
            id, patient_id, related_patient_id, relation, share_address, \
            created_at, updated_at, created_by, updated_by, row_version\
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?7, 0)",
        params![
            link.id,
            link.patient_id,
            link.related_patient_id,
            link.relation,
            link.share_address as i64,
            now,
            user,
        ],
    )?;
    write_audit(
        tx,
        &AuditEntry {
            user_id: user,
            entity: "family_link",
            entity_id: &link.id,
            action: AuditAction::Create,
            diff: json!({
                "patient_id": {"new": link.patient_id},
                "related_patient_id": {"new": link.related_patient_id},
                "relation": {"new": link.relation},
            }),
        },
        now,
    )?;
    Ok(())
}

/// List the linked family members of a patient (PAT-006). Returns the related
/// patient's id + display name + the relation, for non-deleted links whose
/// related patient is itself non-deleted. Bounded (R-DATA-007).
pub fn list_family(conn: &Connection, patient_id: &str) -> Result<Vec<FamilyMember>, StorageError> {
    // Bounded (R-DATA-007): a household is small; cap defensively.
    const FAMILY_LIMIT: usize = 50;

    let sql = format!(
        "SELECT rp.id, rp.name, fl.relation \
         FROM family_link fl \
         JOIN patient rp ON rp.id = fl.related_patient_id \
         WHERE fl.patient_id = ?1 \
           AND fl.deleted_at IS NULL \
           AND rp.deleted_at IS NULL \
         ORDER BY fl.created_at ASC \
         LIMIT {FAMILY_LIMIT}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![patient_id], |r| {
            Ok(FamilyMember {
                patient_id: r.get(0)?,
                name: r.get(1)?,
                relation: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
