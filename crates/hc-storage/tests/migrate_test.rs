//! HC-MVP1-022 migration tests (NFR-011, R-DATA-002). Red before green.
//!
//! Forward-only runner with `user_version` + automatic pre-migration backup.
//! From-empty and from-previous-version paths (the DoD for 022). Each test uses
//! its own temp-file DB (R-TEST-006).

use hc_storage::key::KeyProvider;
use hc_storage::migrate;
use hc_storage::pool::Pool;

/// Open a fresh, UNMIGRATED keyed temp DB and return (dir, path, pool).
/// Unlike `testing::temp_db`, this does NOT run migrations, so the migration
/// runner itself is the code under test (R-TEST-002).
fn fresh_unmigrated() -> (tempfile::TempDir, std::path::PathBuf, Pool) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("clinic.db");
    let key = hc_storage::testing::test_key();
    let pool = Pool::open(&path, &key as &dyn KeyProvider).expect("open pool");
    (dir, path, pool)
}

fn table_exists(pool: &Pool, name: &str) -> bool {
    pool.with_reader(|c| {
        let n: i64 = c.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            rusqlite::params![name],
            |r| r.get(0),
        )?;
        Ok(n)
    })
    .expect("query sqlite_master")
        == 1
}

/// From an empty DB, the runner creates the schema at the latest version and
/// `audit_log` + `setting` exist.
#[test]
fn nfr011_migrate_from_empty_creates_schema_at_latest() {
    let (_dir, _path, pool) = fresh_unmigrated();

    let to = migrate::run(&pool).expect("migrate from empty");
    assert_eq!(to, migrate::latest_version(), "must migrate to latest");
    assert!(
        migrate::latest_version() >= 1,
        "at least migration 0001 exists"
    );

    assert!(table_exists(&pool, "audit_log"), "audit_log must exist");
    assert!(table_exists(&pool, "setting"), "setting must exist");

    let uv = pool
        .with_reader(migrate::current_version)
        .expect("read user_version");
    assert_eq!(
        uv,
        migrate::latest_version(),
        "user_version must equal latest"
    );
}

/// From a previous version (fresh DB at user_version 0), the runner migrates
/// forward and is idempotent on a second run (DoD for 022).
#[test]
fn nfr011_migrate_from_previous_version_is_forward_only() {
    let (_dir, _path, pool) = fresh_unmigrated();

    let start = pool
        .with_reader(migrate::current_version)
        .expect("start version");
    assert_eq!(start, 0, "a fresh DB starts at user_version 0");

    let to = migrate::run(&pool).expect("first migrate");
    assert_eq!(to, migrate::latest_version());

    // Running again changes nothing (no migration has target > current).
    let again = migrate::run(&pool).expect("second migrate is a no-op");
    assert_eq!(
        again,
        migrate::latest_version(),
        "second run stays at latest"
    );
    assert!(table_exists(&pool, "audit_log"));
}

/// Migrating a NON-EMPTY DB that is below latest writes a pre-migration backup
/// first, and that backup is openable with the same key and holds the
/// pre-migration version (R-DATA-002, NFR-011).
#[test]
fn nfr011_migrate_backs_up_before_applying_to_nonempty_db() {
    // Build a non-empty DB that is still at a pre-latest version by writing a
    // row through a raw table but leaving user_version at 0.
    let (_dir, path, pool) = fresh_unmigrated();
    pool.with_writer(|c| {
        c.execute_batch("CREATE TABLE legacy(x); INSERT INTO legacy VALUES (1);")?;
        Ok(())
    })
    .expect("seed legacy data");

    let from = pool
        .with_reader(migrate::current_version)
        .expect("from version");
    let backup = migrate::backup_path_for(&path, from);

    let to = migrate::run(&pool).expect("migrate non-empty");
    assert_eq!(to, migrate::latest_version());

    assert!(
        backup.exists(),
        "a pre-migration backup must exist at {:?} (NFR-011)",
        backup
    );

    // The backup opens with the same key and is at the pre-migration version.
    let key = hc_storage::testing::test_key();
    let backup_pool = Pool::open(&backup, &key as &dyn KeyProvider).expect("open backup");
    let backup_version = backup_pool
        .with_reader(migrate::current_version)
        .expect("backup version");
    assert_eq!(
        backup_version, from,
        "backup holds the pre-migration version"
    );
}

/// A DB whose version is HIGHER than latest is refused (forward-only).
#[test]
fn nfr011_migrate_refuses_downgrade() {
    let (_dir, _path, pool) = fresh_unmigrated();
    let too_new = migrate::latest_version() + 5;
    pool.with_writer(|c| {
        c.execute_batch(&format!("PRAGMA user_version = {too_new};"))?;
        Ok(())
    })
    .expect("bump user_version");

    let err = migrate::run(&pool).expect_err("downgrade must be refused");
    assert!(
        matches!(err, hc_storage::StorageError::SchemaTooNew { .. }),
        "expected SchemaTooNew, got {err:?}"
    );
}
