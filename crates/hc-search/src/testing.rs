//! Test seams for `hc-search` (behind `cfg(any(test, feature = "testing"))`).
//!
//! An in-memory SQLite DB carrying exactly the patient-search schema from
//! migration `0004_patient_search.sql`, plus a synthetic-patient insert helper
//! that computes the normalised columns through the real
//! [`crate::normalize`]/[`crate::phonetic`] functions and inserts in one
//! transaction so the FTS triggers fire in-txn (PSR-012).
//!
//! In-memory (not file-backed) is fine here: the engine tests exercise SQL and
//! triggers, not SQLCipher/WAL/crash-safety (those belong to hc-storage).
//! Synthetic data only (R-TEST-004, R-PRIV-001).
#![cfg(any(test, feature = "testing"))]

use crate::error::SearchError;
use crate::{normalize, phonetic};
use rusqlite::Connection;

/// The target version of the patient-search migration in hc-storage.
const PATIENT_SEARCH_MIGRATION_TARGET: u32 = 4;

/// A minimal synthetic patient for in-code fixtures.
#[derive(Debug, Clone)]
pub struct TestPatient<'a> {
    /// Patient code, e.g. `"HC-000123"`.
    pub code: &'a str,
    /// Display name, e.g. `"Ramesh Kumar"`.
    pub name: &'a str,
    /// Mobile as entered (may include `+91`/spaces), or `None`.
    pub mobile: Option<&'a str>,
    /// City, or `None`.
    pub city: Option<&'a str>,
    /// Most recent visit timestamp (RFC3339) for tie-ordering, or `None`.
    pub last_visit_at: Option<&'a str>,
}

/// Open an in-memory DB with ONLY the patient-search schema (migration 0004)
/// applied. The SQL is taken from `hc_storage`'s compiled migration set so the
/// schema under test is exactly the released migration.
pub fn memory_search_db() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    let sql = hc_storage::migrate::migrations()
        .iter()
        .find(|m| m.target == PATIENT_SEARCH_MIGRATION_TARGET)
        .expect("migration 0004 (patient search) is registered")
        .sql;
    conn.execute_batch(sql)
        .expect("apply patient-search schema");
    conn
}

/// Insert a synthetic patient, computing `name_norm`/`name_phonetic`/
/// `mobile_digits`/`code_digits` via the real helpers, in ONE transaction so
/// the FTS triggers run in-txn (PSR-012). Returns the new patient id.
///
/// Parameterised SQL only (R-SEC-001).
pub fn insert_patient(conn: &mut Connection, p: &TestPatient) -> Result<String, SearchError> {
    let id = uuid::Uuid::now_v7().to_string();
    let name_norm = normalize::name_norm(p.name);
    let name_phonetic = phonetic::phonetic_key(p.name);
    let mobile_digits = p.mobile.map(normalize::mobile_digits);
    let code_digits = normalize::code_digits(p.code);
    let now = "2026-10-20T00:00:00Z";

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO patient \
           (id, code, name, name_norm, name_phonetic, mobile, mobile_digits, \
            code_digits, city, last_visit_at, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        rusqlite::params![
            id,
            p.code,
            p.name,
            name_norm,
            name_phonetic,
            p.mobile,
            mobile_digits,
            code_digits,
            p.city,
            p.last_visit_at,
            now,
        ],
    )?;
    tx.commit()?;
    Ok(id)
}
