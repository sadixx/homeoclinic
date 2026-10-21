//! Visit repository + the Today-overview queries (HC-MVP1-068..072,
//! VIS-001..005, CASE-005/009).
//!
//! Parameterised SQL only (R-SEC-001); every column read/written through a
//! typed [`VisitRow`]. Writes run inside the caller's transaction so the
//! `hc-app` [`crate`] service can commit the visit row, the denormalised
//! `patient` counters (R-DATA-009) and exactly one `audit_log` row atomically
//! (R-DATA-001). The `visit_fts` shadow row is kept in sync by the migration
//! 0009 triggers in the SAME transaction (R-DATA-006). Visit rows carry UUIDv7
//! ids + standard audit columns (R-DATA-005). The Today queries are bounded
//! with an explicit `LIMIT` + keyset-stable ordering (R-DATA-007) and read the
//! denormalised `patient` columns so they need no join (§3 / D6).

use crate::error::StorageError;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

/// A full persisted visit (read + write). JSON columns are carried as `String`
/// (opaque to storage); the service owns their shape.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VisitRow {
    /// UUIDv7 primary key.
    pub id: String,
    /// Owning patient id (FK `patient`).
    pub patient_id: String,
    /// RFC3339 UTC visit instant.
    pub visit_at: String,
    /// Visit type: `first | follow_up | acute | tele` (VIS-001).
    pub visit_type: String,
    /// Case-template id (FK `case_template`), or `None` for follow-ups.
    pub template_id: Option<String>,
    /// Case form answers JSON (per the template schema), or `None`.
    pub data_json: Option<String>,
    /// Vitals JSON (weight/height/bmi/bp/…), or `None`.
    pub vitals_json: Option<String>,
    /// Per-complaint status JSON (VIS-002), or `None`.
    pub complaint_status_json: Option<String>,
    /// Per-complaint improvement % JSON (VIS-002, D1), or `None`.
    pub improvement_pct_json: Option<String>,
    /// Remedy-response quick-pick value (VIS-003), or `None`.
    pub remedy_response: Option<String>,
    /// Next follow-up date (RFC3339 date, VIS-004), or `None`.
    pub next_followup_on: Option<String>,
    /// Free-text observations, or `None`.
    pub observations: Option<String>,
    /// Free-text notes, or `None`.
    pub notes: Option<String>,
}

/// A Today-list patient row (due-today / overdue), read from the denormalised
/// `patient` columns (no join, D6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodayPatientRow {
    /// Patient id.
    pub patient_id: String,
    /// Patient code.
    pub code: String,
    /// Display name.
    pub name: String,
    /// Sex, or `None`.
    pub sex: Option<String>,
    /// RFC3339 DOB, or `None`.
    pub dob: Option<String>,
    /// Age in years when DOB is unknown, or `None`.
    pub age_years: Option<i64>,
    /// Opaque photo attachment ref, or `None`.
    pub photo_path: Option<String>,
    /// Next-follow-up date (RFC3339 date), or `None`.
    pub next_followup_on: Option<String>,
}

/// A Today-list registered-visit row (today's registered visits).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodayVisitRow {
    /// Patient id.
    pub patient_id: String,
    /// Patient code.
    pub code: String,
    /// Patient display name.
    pub name: String,
    /// Opaque photo attachment ref, or `None`.
    pub photo_path: Option<String>,
    /// RFC3339 visit instant.
    pub visit_at: String,
    /// Visit type.
    pub visit_type: String,
}

/// Column list shared by the visit read helpers (keeps the SELECTs aligned).
const VISIT_COLUMNS: &str = "id, patient_id, visit_at, type, template_id, data_json, \
     vitals_json, complaint_status_json, improvement_pct_json, remedy_response, \
     next_followup_on, observations, notes";

/// Map a row selected with [`VISIT_COLUMNS`] into a [`VisitRow`].
fn map_visit_row(r: &rusqlite::Row<'_>) -> Result<VisitRow, rusqlite::Error> {
    Ok(VisitRow {
        id: r.get(0)?,
        patient_id: r.get(1)?,
        visit_at: r.get(2)?,
        visit_type: r.get(3)?,
        template_id: r.get(4)?,
        data_json: r.get(5)?,
        vitals_json: r.get(6)?,
        complaint_status_json: r.get(7)?,
        improvement_pct_json: r.get(8)?,
        remedy_response: r.get(9)?,
        next_followup_on: r.get(10)?,
        observations: r.get(11)?,
        notes: r.get(12)?,
    })
}

// ---------------------------------------------------------------------------
// Visit create / read / update. Writes run in the caller's transaction; the
// service writes the single audit row (R-DATA-001) so one use case = one row.
// ---------------------------------------------------------------------------

/// Insert a visit row (the 0009 `AFTER INSERT` trigger mirrors `visit_fts` in
/// the same transaction, R-DATA-006). Does NOT write an audit row — the service
/// writes exactly one per use case.
pub fn insert_visit(tx: &Transaction<'_>, v: &VisitRow, now: &str) -> Result<(), StorageError> {
    tx.execute(
        "INSERT INTO visit (\
            id, patient_id, visit_at, type, template_id, data_json, vitals_json, \
            complaint_status_json, improvement_pct_json, remedy_response, \
            next_followup_on, observations, notes, \
            created_at, updated_at, created_by, updated_by, row_version\
        ) VALUES (\
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, NULL, NULL, 0\
        )",
        params![
            v.id,
            v.patient_id,
            v.visit_at,
            v.visit_type,
            v.template_id,
            v.data_json,
            v.vitals_json,
            v.complaint_status_json,
            v.improvement_pct_json,
            v.remedy_response,
            v.next_followup_on,
            v.observations,
            v.notes,
            now,
        ],
    )?;
    Ok(())
}

/// Read one non-deleted visit by id, or `None`.
pub fn get_visit(conn: &Connection, id: &str) -> Result<Option<VisitRow>, StorageError> {
    let sql = format!("SELECT {VISIT_COLUMNS} FROM visit WHERE id = ?1 AND deleted_at IS NULL");
    let row = conn
        .query_row(&sql, params![id], map_visit_row)
        .optional()?;
    Ok(row)
}

/// Read the most recent non-deleted visit for a patient, or `None`. Uses the
/// `visit(patient_id, visit_at DESC)` index (R-DATA-008).
pub fn latest_visit_for_patient(
    conn: &Connection,
    patient_id: &str,
) -> Result<Option<VisitRow>, StorageError> {
    let sql = format!(
        "SELECT {VISIT_COLUMNS} FROM visit \
         WHERE patient_id = ?1 AND deleted_at IS NULL \
         ORDER BY visit_at DESC, id DESC LIMIT 1"
    );
    let row = conn
        .query_row(&sql, params![patient_id], map_visit_row)
        .optional()?;
    Ok(row)
}

/// Update the mutable visit fields on autosave (the 0009 `AFTER UPDATE` trigger
/// re-syncs `visit_fts` in the same transaction, R-DATA-006). Bumps
/// `row_version`. Does NOT write an audit row — the service does.
pub fn update_visit_autosave(
    tx: &Transaction<'_>,
    v: &VisitRow,
    now: &str,
) -> Result<(), StorageError> {
    let changed = tx.execute(
        "UPDATE visit SET \
            type = ?2, template_id = ?3, data_json = ?4, vitals_json = ?5, \
            complaint_status_json = ?6, improvement_pct_json = ?7, remedy_response = ?8, \
            next_followup_on = ?9, observations = ?10, notes = ?11, \
            updated_at = ?12, row_version = row_version + 1 \
         WHERE id = ?1 AND deleted_at IS NULL",
        params![
            v.id,
            v.visit_type,
            v.template_id,
            v.data_json,
            v.vitals_json,
            v.complaint_status_json,
            v.improvement_pct_json,
            v.remedy_response,
            v.next_followup_on,
            v.observations,
            v.notes,
            now,
        ],
    )?;
    if changed == 0 {
        return Err(StorageError::Db(rusqlite::Error::QueryReturnedNoRows));
    }
    Ok(())
}

/// Set `visit.next_followup_on` on one visit (VIS-004). Does NOT write audit.
pub fn set_next_followup(
    tx: &Transaction<'_>,
    visit_id: &str,
    on: Option<&str>,
    now: &str,
) -> Result<(), StorageError> {
    let changed = tx.execute(
        "UPDATE visit SET next_followup_on = ?2, updated_at = ?3, \
            row_version = row_version + 1 \
         WHERE id = ?1 AND deleted_at IS NULL",
        params![visit_id, on, now],
    )?;
    if changed == 0 {
        return Err(StorageError::Db(rusqlite::Error::QueryReturnedNoRows));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Patient denormalisation maintained in the write transaction (R-DATA-009).
// ---------------------------------------------------------------------------

/// Maintain the denormalised `patient` counters after a visit write, in the
/// SAME transaction (R-DATA-009): set `last_visit_at` to the visit instant when
/// it is newer than the stored value (COALESCE handles the first visit), and
/// bump `visit_count` when `bump_count` is set (first persist of a new visit).
pub fn denormalise_patient_after_visit(
    tx: &Transaction<'_>,
    patient_id: &str,
    visit_at: &str,
    now: &str,
    bump_count: bool,
) -> Result<(), StorageError> {
    let count_expr = if bump_count {
        "visit_count + 1"
    } else {
        "visit_count"
    };
    let sql = format!(
        "UPDATE patient SET \
            last_visit_at = CASE \
                WHEN last_visit_at IS NULL OR ?2 > last_visit_at THEN ?2 \
                ELSE last_visit_at END, \
            visit_count = {count_expr}, \
            updated_at = ?3, row_version = row_version + 1 \
         WHERE id = ?1 AND deleted_at IS NULL"
    );
    let changed = tx.execute(&sql, params![patient_id, visit_at, now])?;
    if changed == 0 {
        return Err(StorageError::Db(rusqlite::Error::QueryReturnedNoRows));
    }
    Ok(())
}

/// Set `patient.next_followup_on` in the write transaction so the Today list
/// needs no join (D6). Does NOT write audit.
pub fn set_patient_next_followup(
    tx: &Transaction<'_>,
    patient_id: &str,
    on: Option<&str>,
    now: &str,
) -> Result<(), StorageError> {
    let changed = tx.execute(
        "UPDATE patient SET next_followup_on = ?2, updated_at = ?3, \
            row_version = row_version + 1 \
         WHERE id = ?1 AND deleted_at IS NULL",
        params![patient_id, on, now],
    )?;
    if changed == 0 {
        return Err(StorageError::Db(rusqlite::Error::QueryReturnedNoRows));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Today overview queries (VIS-005). Bounded (R-DATA-007); read denormalised
// patient columns (no join, D6). `today` is an RFC3339 date (YYYY-MM-DD).
// ---------------------------------------------------------------------------

/// Column list for the Today patient-row projection.
const TODAY_PATIENT_COLUMNS: &str =
    "id, code, name, sex, dob, age_years, photo_path, next_followup_on";

/// Map a Today patient row.
fn map_today_patient(r: &rusqlite::Row<'_>) -> Result<TodayPatientRow, rusqlite::Error> {
    Ok(TodayPatientRow {
        patient_id: r.get(0)?,
        code: r.get(1)?,
        name: r.get(2)?,
        sex: r.get(3)?,
        dob: r.get(4)?,
        age_years: r.get(5)?,
        photo_path: r.get(6)?,
        next_followup_on: r.get(7)?,
    })
}

/// Patients whose follow-up is due today: `date(next_followup_on) == today`
/// (VIS-005). Bounded + keyset-stable order (R-DATA-007).
pub fn due_today(
    conn: &Connection,
    today: &str,
    limit: i64,
) -> Result<Vec<TodayPatientRow>, StorageError> {
    let sql = format!(
        "SELECT {TODAY_PATIENT_COLUMNS} FROM patient \
         WHERE deleted_at IS NULL \
           AND next_followup_on IS NOT NULL \
           AND date(next_followup_on) = date(?1) \
         ORDER BY next_followup_on ASC, id ASC LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![today, limit], map_today_patient)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Patients whose follow-up is overdue: `date(next_followup_on) < today`
/// (VIS-005). Bounded + keyset-stable order (R-DATA-007).
pub fn overdue(
    conn: &Connection,
    today: &str,
    limit: i64,
) -> Result<Vec<TodayPatientRow>, StorageError> {
    let sql = format!(
        "SELECT {TODAY_PATIENT_COLUMNS} FROM patient \
         WHERE deleted_at IS NULL \
           AND next_followup_on IS NOT NULL \
           AND date(next_followup_on) < date(?1) \
         ORDER BY next_followup_on ASC, id ASC LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![today, limit], map_today_patient)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Visits registered today: `date(visit_at) == today` (VIS-005). Joins patient
/// only for the row's display fields (the follow-up lists avoid joins; this one
/// needs the patient's name/code/photo for the registered-visit row). Bounded +
/// keyset-stable order (R-DATA-007).
pub fn registered_today(
    conn: &Connection,
    today: &str,
    limit: i64,
) -> Result<Vec<TodayVisitRow>, StorageError> {
    let sql = "SELECT v.patient_id, p.code, p.name, p.photo_path, v.visit_at, v.type \
         FROM visit v JOIN patient p ON p.id = v.patient_id \
         WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL \
           AND date(v.visit_at) = date(?1) \
         ORDER BY v.visit_at DESC, v.id DESC LIMIT ?2";
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(params![today, limit], |r| {
            Ok(TodayVisitRow {
                patient_id: r.get(0)?,
                code: r.get(1)?,
                name: r.get(2)?,
                photo_path: r.get(3)?,
                visit_at: r.get(4)?,
                visit_type: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Count `visit_fts` rows matching `query` within one connection (test seam for
/// R-DATA-006 "findable immediately"). Bounded by the FTS match itself.
pub fn fts_match_count(conn: &Connection, query: &str) -> Result<i64, StorageError> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM visit_fts WHERE visit_fts MATCH ?1",
        params![query],
        |r| r.get(0),
    )?;
    Ok(n)
}
