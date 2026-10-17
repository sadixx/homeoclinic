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
