//! Test seams for `hc-storage` (behind `cfg(any(test, feature = "testing"))`).
//!
//! Provides a fixed test key, a file-backed temp DB with migrations applied,
//! and the crash-safety child entry point. File-backed (not `:memory:`) so the
//! pool's multi-connection + WAL + crash-safety semantics are exercised for
//! real (R-TEST-006).
#![cfg(any(test, feature = "testing"))]

use crate::audit::{write_audit, AuditAction, AuditEntry};
use crate::key::DevKeyProvider;
use crate::pool::Pool;
use std::path::Path;
/// A [`DevKeyProvider`] holding a fixed test key.
pub fn test_key() -> DevKeyProvider {
    DevKeyProvider::new_test()
}

/// Open a fresh temp-file SQLCipher DB keyed with the test key and run all
/// migrations. Returns the owning `TempDir` (kept alive for the DB's lifetime)
/// and the open [`Pool`].
pub fn temp_db() -> (tempfile::TempDir, Pool) {
    let dir = tempfile::tempdir().expect("create tempdir for test DB");
    let path = dir.path().join("clinic.db");
    let key = test_key();
    let pool = Pool::open(&path, &key as &dyn crate::key::KeyProvider).expect("open test pool");
    crate::migrate::run(&pool).expect("run migrations on test DB");
    (dir, pool)
}

/// Crash-safety child entry point (HC-MVP1-023): open the DB at the given path
/// with the test key and loop inserting `setting` + `audit_log` rows under WAL
/// until the process is killed.
///
/// The DB is expected to already be migrated by the parent. Each iteration is
/// one transaction that writes a `setting` row and exactly one audit row
/// (R-DATA-001), so a kill at any point leaves either a complete transaction or
/// none — WAL guarantees the file stays consistent (NFR-010/012). This loops
/// forever; the parent SIGKILLs it, so it only returns on an open/setup error.
pub fn crash_child_main(db_path: &Path) -> Result<(), crate::error::StorageError> {
    let key = test_key();
    let pool = Pool::open(db_path, &key as &dyn crate::key::KeyProvider)?;

    let mut counter: u64 = 0;
    loop {
        counter = counter.wrapping_add(1);
        let now = "2026-10-17T12:00:00Z";
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            let key_name = format!("crash_key_{counter}");
            // Synthetic, non-patient data only (R-TEST-004, R-PRIV-001).
            tx.execute(
                "INSERT OR REPLACE INTO setting(key, value_json) VALUES (?1, ?2)",
                rusqlite::params![key_name, "\"x\""],
            )?;
            write_audit(
                &tx,
                &AuditEntry {
                    user_id: None,
                    entity: "setting",
                    entity_id: &key_name,
                    action: AuditAction::Create,
                    diff: serde_json::json!({"value_json": {"new": "x"}}),
                },
                now,
            )?;
            tx.commit()?;
            Ok(())
        })?;
    }
}

// ---------------------------------------------------------------------------
// HC-MVP1-021 / 024 Slice B helpers: everything on headless Linux via the
// always-available encrypted-file fallback keystore (NFR-020). No DPAPI /
// Secret Service here (those are UNVERIFIED; their tests are #[cfg]/#[ignore]).
// ---------------------------------------------------------------------------

use crate::keystore::FileKeystore;

/// A [`FileKeystore`] rooted in a fresh temp dir (the headless-Linux fallback
/// path). Returns the owning `TempDir` (kept alive for the keystore's lifetime)
/// and the keystore.
pub fn temp_file_keystore() -> (tempfile::TempDir, FileKeystore) {
    let dir = tempfile::tempdir().expect("create tempdir for test keystore");
    let store = FileKeystore::open(dir.path()).expect("open file keystore");
    (dir, store)
}

// ---------------------------------------------------------------------------
// HC-MVP1-030..034 Slice D backup/restore test seams.
// ---------------------------------------------------------------------------

use crate::clock::FakeClock;
use crate::profile::{upsert_clinic_profile, upsert_doctor_profile, ClinicProfile, DoctorProfile};

/// The synthetic backup password used across Slice D tests (≥ 8 chars per
/// OQ-S17-2). Clearly fake (R-TEST-004).
pub const TEST_BACKUP_PASSWORD: &str = "backup-pass-001";

/// A fixed Unix instant for deterministic backup tests: 2026-01-01T00:00:00Z.
/// R-TEST-006 (no wall clock).
pub const TEST_EPOCH_UNIX: i64 = 1_767_225_600;

/// A [`FakeClock`] fixed at [`TEST_EPOCH_UNIX`] for rotation/staleness tests.
pub fn fake_clock() -> FakeClock {
    FakeClock::at_unix(TEST_EPOCH_UNIX)
}

/// Create a temp data dir holding a migrated, keyed `clinic.db` seeded with ONE
/// synthetic doctor profile and ONE synthetic clinic profile (R1 demo step 3
/// round-trip data). Returns the owning `TempDir`, the open [`Pool`], and the
/// `(doctor_id, clinic_id)` so a restore test can assert the SAME rows came
/// back (R-TEST-003: assert data effects).
///
/// Synthetic data only (R-TEST-004). The DB is keyed with the fixed
/// [`test_key`]; a restore test that re-keys under a DIFFERENT target key uses
/// its own key hierarchy (design §5).
pub fn seeded_data_dir() -> (tempfile::TempDir, Pool, (String, String)) {
    let dir = tempfile::tempdir().expect("create tempdir for seeded data dir");
    let db_path = dir.path().join("clinic.db");
    let key = test_key();
    let pool =
        Pool::open(&db_path, &key as &dyn crate::key::KeyProvider).expect("open seeded pool");
    crate::migrate::run(&pool).expect("migrate seeded DB");

    let doctor_id = uuid::Uuid::now_v7().to_string();
    let clinic_id = uuid::Uuid::now_v7().to_string();
    let now = "2026-01-01T00:00:00Z";
    let doctor = DoctorProfile {
        id: doctor_id.clone(),
        name: "Test Doctor 001".to_string(),
        qualification: "BHMS".to_string(),
        reg_no: "TESTREG-001".to_string(),
        reg_council: "Test Council".to_string(),
        phone: None,
        email: None,
        signature_ref: None,
        logo_ref: None,
    };
    let clinic = ClinicProfile {
        id: clinic_id.clone(),
        name: "Test Clinic 001".to_string(),
        address: "1 Test Street".to_string(),
        phone: None,
        timings: None,
        fee_first_paise: 50_000,
        fee_followup_paise: 30_000,
        gstin: None,
    };
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        upsert_doctor_profile(&tx, &doctor, now)?;
        upsert_clinic_profile(&tx, &clinic, now)?;
        tx.commit()?;
        Ok(())
    })
    .expect("seed doctor + clinic profiles");

    (dir, pool, (doctor_id, clinic_id))
}

// ---------------------------------------------------------------------------
// HC-MVP1-068..072 M3-A visit + case-template test seams.
// ---------------------------------------------------------------------------

use crate::visit::{self, VisitRow};

/// Seed ONE minimal synthetic patient into a migrated `pool` and return its id
/// (R-TEST-004: synthetic only). Inserts the required NOT NULL search columns
/// directly (the FTS triggers fire in-txn); the visit tests only need a live
/// patient row to hang visits off, not the full registration path.
pub fn seed_patient(pool: &Pool, code: &str, name: &str) -> String {
    let id = uuid::Uuid::now_v7().to_string();
    let id_ret = id.clone();
    let now = "2026-10-20T00:00:00Z";
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO patient \
               (id, code, name, name_norm, name_phonetic, code_digits, \
                created_at, updated_at, row_version) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, 0)",
            rusqlite::params![
                id,
                code,
                name,
                name.to_lowercase(),
                name.to_lowercase(),
                code.chars()
                    .filter(|c| c.is_ascii_digit())
                    .collect::<String>(),
                now,
            ],
        )?;
        tx.commit()?;
        Ok(())
    })
    .expect("seed synthetic patient");
    id_ret
}

/// Seed ONE synthetic patient with explicit `dob` and/or `age_years` and return
/// its id (R-TEST-004: synthetic only). Used by the M3-RW A3 read tests that
/// assert the patient read derives age from DOB when present and falls back to
/// the stored `age_years` when DOB is NULL — so the caller must be able to store
/// a genuinely-null DOB (which the create path's DOB estimation would not give).
/// Inserts the required NOT NULL search columns directly; the FTS triggers fire
/// in-txn.
pub fn seed_patient_demographics(
    pool: &Pool,
    code: &str,
    name: &str,
    dob: Option<&str>,
    age_years: Option<i64>,
) -> String {
    let id = uuid::Uuid::now_v7().to_string();
    let id_ret = id.clone();
    let now = "2026-10-20T00:00:00Z";
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO patient \
               (id, code, name, name_norm, name_phonetic, code_digits, \
                dob, age_years, \
                created_at, updated_at, row_version) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 0)",
            rusqlite::params![
                id,
                code,
                name,
                name.to_lowercase(),
                name.to_lowercase(),
                code.chars()
                    .filter(|c| c.is_ascii_digit())
                    .collect::<String>(),
                dob,
                age_years,
                now,
            ],
        )?;
        tx.commit()?;
        Ok(())
    })
    .expect("seed synthetic patient with demographics");
    id_ret
}

/// Insert a synthetic visit for `patient_id` through the REAL [`visit`] repo +
/// denormalise path, so Today tests seed due/overdue/registered rows the same
/// way production writes them (R-TEST-003). Sets `visit_at`, optional
/// `next_followup_on` (on the visit AND the patient, matching the service's
/// `visit_set_next_followup`), and bumps the patient's denormalised counters.
/// Returns the new visit id. Synthetic data only (R-TEST-004).
pub fn insert_visit_for(
    pool: &Pool,
    patient_id: &str,
    visit_at: &str,
    next_followup_on: Option<&str>,
) -> String {
    let visit_id = uuid::Uuid::now_v7().to_string();
    let id_ret = visit_id.clone();
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        let row = VisitRow {
            id: visit_id.clone(),
            patient_id: patient_id.to_string(),
            visit_at: visit_at.to_string(),
            visit_type: "follow_up".to_string(),
            next_followup_on: next_followup_on.map(|s| s.to_string()),
            observations: Some("synthetic visit".to_string()),
            ..Default::default()
        };
        visit::insert_visit(&tx, &row, visit_at)?;
        visit::denormalise_patient_after_visit(&tx, patient_id, visit_at, visit_at, true)?;
        if next_followup_on.is_some() {
            visit::set_patient_next_followup(&tx, patient_id, next_followup_on, visit_at)?;
        }
        tx.commit()?;
        Ok(())
    })
    .expect("seed synthetic visit");
    id_ret
}
