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

// ---------------------------------------------------------------------------
// M3-RW Slice A1: migration 0011_case_template_journal bumps the schema to 11.
// ---------------------------------------------------------------------------

/// M3-RW A1 (R-DATA-002): the journal-template migration 0011 is wired into the
/// forward-only runner as step 11 (a later release appends 12+, so this pins
/// "0011 exists and lands at 11", not "11 is the latest").
#[test]
fn m3rw_migration_0011_advances_user_version() {
    assert!(
        migrate::latest_version() >= 11,
        "migration 0011_case_template_journal must stay in the runner (M3-RW A1)"
    );
    assert_eq!(
        migrate::migrations()[10].target,
        11,
        "0011 is the 11th forward-only step"
    );

    let (_dir, _path, pool) = fresh_unmigrated();
    hc_storage::testing::migrate_to(&pool, 11);
    let uv = pool.with_reader(migrate::current_version).unwrap();
    assert_eq!(uv, 11, "migrating through 0011 lands at user_version 11");
}

// ---------------------------------------------------------------------------
// R5 (HC-MVP1-148..153): migration 0012_billing (design §2, T-MIG).
// ---------------------------------------------------------------------------

/// Bug caught: 0012 not registered, so billing tables never exist on upgrade.
#[test]
fn r5_migration_0012_advances_user_version_to_12_and_creates_billing_tables() {
    assert_eq!(
        migrate::latest_version(),
        12,
        "0012_billing bumps latest 11 -> 12"
    );
    let (_dir, _path, pool) = fresh_unmigrated();
    assert_eq!(migrate::run(&pool).expect("migrate from empty"), 12);
    for t in ["receipt_sequence", "invoice", "invoice_line", "payment"] {
        assert!(table_exists(&pool, t), "{t} must exist after 0012");
    }
}

/// Bug caught: upgrading an R3/R4 install (user_version 11) loses or rewrites
/// existing patients/visits, or skips the pre-migration backup (NFR-011).
#[test]
fn r5_migrate_from_11_keeps_existing_data_and_backs_up_first() {
    let (_dir, path, pool) = fresh_unmigrated();
    hc_storage::testing::migrate_to(&pool, 11);
    let pid = hc_storage::testing::seed_patient(&pool, "HC-0001", "Test Patient R5");
    let vid = hc_storage::testing::insert_visit_for(&pool, &pid, "2026-10-16T05:00:00Z", None);
    let backup = migrate::backup_path_for(&path, 11);

    assert_eq!(migrate::run(&pool).expect("migrate 11 -> 12"), 12);
    assert!(
        backup.exists(),
        "pre-migration backup at {backup:?} (NFR-011)"
    );

    let (name, balance, visits): (String, i64, i64) = pool
        .with_reader(|c| {
            Ok(c.query_row(
                "SELECT p.name, p.balance_paise, (SELECT COUNT(*) FROM visit v WHERE v.id = ?2) \
                 FROM patient p WHERE p.id = ?1",
                rusqlite::params![pid, vid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?)
        })
        .expect("read migrated patient");
    assert_eq!(name, "Test Patient R5");
    assert_eq!(
        balance, 0,
        "existing dues untouched (0) by the additive migration"
    );
    assert_eq!(visits, 1, "existing visit kept");
}

/// Insert an invoice row with raw SQL (schema-level test only).
/// `m` = [subtotal, discount, total, paid, balance] in paise.
fn raw_invoice(
    pool: &Pool,
    patient: &str,
    visit: &str,
    seq: i64,
    status: &str,
    m: [i64; 5],
) -> Result<String, rusqlite::Error> {
    let [subtotal, discount, total, paid, balance] = m;
    let id = format!("inv-{seq}-{status}-{subtotal}-{discount}-{total}-{paid}-{balance}");
    let id2 = id.clone();
    pool.with_writer(|c| {
        c.execute(
            "INSERT INTO invoice (id, patient_id, visit_id, fy, seq, number, issued_on, issued_at, \
               status, discount_kind, discount_value, subtotal_paise, discount_paise, total_paise, \
               paid_paise, balance_paise, created_at, updated_at) \
             VALUES (?1, ?2, ?3, '2026-27', ?4, '2026-27/' || ?4, '2026-10-16', \
               '2026-10-16T05:00:00Z', ?5, 'none', 0, ?6, ?7, ?8, ?9, ?10, \
               '2026-10-16T05:00:00Z', '2026-10-16T05:00:00Z')",
            rusqlite::params![id2, patient, visit, seq, status, subtotal, discount, total, paid, balance],
        )?;
        Ok(())
    })
    .map(|_| id)
    .map_err(|e| match e {
        hc_storage::StorageError::Db(d) => d,
        other => panic!("unexpected {other:?}"),
    })
}

/// Bug caught: the DB accepts an invoice whose stored totals do not add up
/// (a bug in the service would then persist wrong money silently).
#[test]
fn r5_billing_schema_rejects_inconsistent_money() {
    let (_dir, pool) = hc_storage::testing::temp_db();
    let pid = hc_storage::testing::seed_patient(&pool, "HC-0001", "Test Patient R5");
    let vid = hc_storage::testing::insert_visit_for(&pool, &pid, "2026-10-16T05:00:00Z", None);

    // total != subtotal - discount
    assert!(raw_invoice(
        &pool,
        &pid,
        &vid,
        1,
        "issued",
        [35_000, 1_750, 35_000, 0, 35_000]
    )
    .is_err());
    // balance != total - paid
    assert!(raw_invoice(
        &pool,
        &pid,
        &vid,
        2,
        "issued",
        [35_000, 0, 35_000, 10_000, 35_000]
    )
    .is_err());
    // paid > total
    assert!(raw_invoice(&pool, &pid, &vid, 3, "issued", [100, 0, 100, 200, -100]).is_err());
    // discount > subtotal
    assert!(raw_invoice(&pool, &pid, &vid, 4, "issued", [100, 200, -100, 0, -100]).is_err());
    // unknown status
    assert!(raw_invoice(&pool, &pid, &vid, 5, "draft", [100, 0, 100, 0, 100]).is_err());
    // consistent row is accepted
    assert!(raw_invoice(
        &pool,
        &pid,
        &vid,
        6,
        "issued",
        [35_000, 1_750, 33_250, 20_000, 13_250]
    )
    .is_ok());
}

/// Bug caught: a receipt number (fy, seq) can be stored twice, or a visit can
/// hold two live bills; a void must still allow re-billing the visit.
#[test]
fn r5_billing_schema_unique_number_and_one_live_invoice_per_visit() {
    let (_dir, pool) = hc_storage::testing::temp_db();
    let pid = hc_storage::testing::seed_patient(&pool, "HC-0001", "Test Patient R5");
    let v1 = hc_storage::testing::insert_visit_for(&pool, &pid, "2026-10-16T05:00:00Z", None);
    let v2 = hc_storage::testing::insert_visit_for(&pool, &pid, "2026-10-17T05:00:00Z", None);

    raw_invoice(&pool, &pid, &v1, 1, "void", [100, 0, 100, 0, 100]).expect("void #1");
    // Same (fy, seq) on another visit -> refused (number never reused).
    assert!(raw_invoice(&pool, &pid, &v2, 1, "issued", [100, 0, 100, 0, 100]).is_err());
    // v1 may be billed again after the void (new number).
    raw_invoice(&pool, &pid, &v1, 2, "issued", [100, 0, 100, 0, 100]).expect("re-bill after void");
    // A second LIVE invoice for v1 -> refused.
    assert!(raw_invoice(&pool, &pid, &v1, 3, "issued", [100, 0, 100, 0, 100]).is_err());
}

/// Bug caught: a zero / negative payment or an unknown mode is stored and
/// skews the daily collection.
#[test]
fn r5_billing_schema_rejects_bad_payments() {
    let (_dir, pool) = hc_storage::testing::temp_db();
    let pid = hc_storage::testing::seed_patient(&pool, "HC-0001", "Test Patient R5");
    let vid = hc_storage::testing::insert_visit_for(&pool, &pid, "2026-10-16T05:00:00Z", None);
    let inv = raw_invoice(&pool, &pid, &vid, 1, "issued", [100, 0, 100, 0, 100]).unwrap();
    let pay = |id: &str, amount: i64, mode: &str| {
        pool.with_writer(|c| {
            c.execute(
                "INSERT INTO payment (id, invoice_id, patient_id, paid_on, recorded_at, amount_paise, \
                   mode, created_at, updated_at) VALUES (?1, ?2, ?3, '2026-10-16', \
                   '2026-10-16T05:00:00Z', ?4, ?5, '2026-10-16T05:00:00Z', '2026-10-16T05:00:00Z')",
                rusqlite::params![id, inv, pid, amount, mode],
            )?;
            Ok(())
        })
    };
    assert!(pay("p0", 0, "cash").is_err(), "zero payment refused");
    assert!(pay("pn", -5, "cash").is_err(), "negative payment refused");
    assert!(pay("pq", 50, "cheque").is_err(), "unknown mode refused");
    assert!(pay("pok", 50, "upi").is_ok(), "valid payment accepted");
}
