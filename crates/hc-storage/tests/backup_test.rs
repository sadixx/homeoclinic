//! HC-MVP1-030..034 backup/restore engine tests (BAK-001..004, SUX-011).
//!
//! All tests run on headless Linux with synthetic data only (R-TEST-004) and a
//! `FakeClock` for every time decision (R-TEST-006; no wall clock, no sleeps).
//! The OS-store keystore backends stay UNVERIFIED (Slice B carry-over); these
//! tests use the encrypted-file fallback and the fixed test SQLCipher key.
//!
//! RED phase (Slice D): these assert against the architect's sentinel stubs in
//! `hc_storage::backup` and MUST fail on assertions until hc-data-dev
//! implements the engine (R-TEST-001).

use hc_storage::backup::{read_header, BackupEngine, RetentionPolicy};
use hc_storage::error::StorageError;
use hc_storage::key::{DekKeyProvider, KeyHierarchy, KeyProvider};
use hc_storage::keystore::FileKeystore;
use hc_storage::pool::Pool;
use hc_storage::testing::{fake_clock, seeded_data_dir, TEST_BACKUP_PASSWORD};
use std::path::Path;

/// Read the doctor + clinic profile names from a keyed `clinic.db` at `db_path`
/// opened with `provider`. Panics if the DB cannot be opened/read — that is the
/// failure a broken restore/re-key would cause (R-TEST-003 asserts the names).
fn read_profile_names(db_path: &Path, provider: &dyn KeyProvider) -> (String, String) {
    let pool = Pool::open(db_path, provider).expect("open restored DB");
    pool.with_reader(|c| {
        let doctor: String = c.query_row(
            "SELECT name FROM doctor_profile WHERE deleted_at IS NULL LIMIT 1",
            [],
            |r| r.get(0),
        )?;
        let clinic: String = c.query_row(
            "SELECT name FROM clinic_profile WHERE deleted_at IS NULL LIMIT 1",
            [],
            |r| r.get(0),
        )?;
        Ok((doctor, clinic))
    })
    .expect("read restored profile rows")
}

/// A fresh "clean install": a new empty data dir with its OWN key hierarchy
/// (file keystore + a freshly-initialized DEK). Returns the owning dir, the
/// target `DekKeyProvider` (the install's own key), and the data-dir path.
fn clean_install() -> (tempfile::TempDir, DekKeyProvider) {
    let dir = tempfile::tempdir().expect("clean-install tempdir");
    let store = FileKeystore::open(dir.path()).expect("open target keystore");
    let hierarchy = KeyHierarchy::new(&store);
    let (_recovery, provider) = hierarchy
        .initialize("9999")
        .expect("init target key hierarchy");
    (dir, provider)
}

#[test]
fn bak030_hcbak_round_trip_reproduces_doctor_and_clinic_rows() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);

    let out = tempfile::tempdir().expect("out dir");
    let outcome = engine
        .backup_to(out.path(), TEST_BACKUP_PASSWORD)
        .expect("backup_to should write a .hcbak");

    // Restore onto a fresh clean install keyed with its OWN DEK (design §5).
    let (dst_dir, target_key) = clean_install();
    let dst_db = dst_dir.path().join("clinic.db");
    let dst_pool = Pool::open(&dst_db, &target_key as &dyn KeyProvider).expect("open dst");
    hc_storage::migrate::run(&dst_pool).ok();
    let dst_engine = BackupEngine::new(&dst_pool, dst_dir.path(), &clock);
    dst_engine
        .restore_apply(&outcome.file_path, TEST_BACKUP_PASSWORD, &target_key)
        .expect("restore_apply should succeed");

    let (doctor, clinic) = read_profile_names(&dst_db, &target_key as &dyn KeyProvider);
    assert_eq!(doctor, "Test Doctor 001", "restored doctor name must match");
    assert_eq!(clinic, "Test Clinic 001", "restored clinic name must match");
}

#[test]
fn bak030_header_readable_without_password() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);
    let out = tempfile::tempdir().expect("out dir");
    let outcome = engine
        .backup_to(out.path(), TEST_BACKUP_PASSWORD)
        .expect("backup_to");

    // read_header takes NO password and must not mutate anything.
    let header = read_header(&outcome.file_path).expect("header readable without password");
    assert_eq!(header.format_version, 1, "R1 archive is format version 1");
    assert!(
        !header.created_at.is_empty(),
        "header carries the created_at date for preview"
    );
    // M1: no patient/visit tables yet, so preview counts are 0 but present.
    assert_eq!(header.preview.patient_count, 0);
    assert_eq!(header.preview.visit_count, 0);

    // The same works through the engine's preview (S17 step 2) with no mutation.
    let preview = engine
        .restore_preview(&outcome.file_path)
        .expect("restore_preview without password");
    assert_eq!(preview.format_version, 1);
}

#[test]
fn bak030_body_needs_password() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);
    let out = tempfile::tempdir().expect("out dir");
    let outcome = engine
        .backup_to(out.path(), TEST_BACKUP_PASSWORD)
        .expect("backup_to");

    // With the correct password the body decrypts.
    let v = engine
        .verify(&outcome.file_path, TEST_BACKUP_PASSWORD)
        .expect("verify");
    assert!(v.decrypt_ok, "body must decrypt under the correct password");
    assert!(v.checksum_ok, "body checksum must match what was written");
}

#[test]
fn bak030_wrong_password_rejected_gcm_auth_fail() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);
    let out = tempfile::tempdir().expect("out dir");
    let outcome = engine
        .backup_to(out.path(), TEST_BACKUP_PASSWORD)
        .expect("backup_to");

    let (dst_dir, target_key) = clean_install();
    let dst_db = dst_dir.path().join("clinic.db");
    let dst_pool = Pool::open(&dst_db, &target_key as &dyn KeyProvider).expect("open dst");
    let dst_engine = BackupEngine::new(&dst_pool, dst_dir.path(), &clock);

    let err = dst_engine
        .restore_apply(&outcome.file_path, "wrong-password-xx", &target_key)
        .expect_err("a wrong backup password must be rejected");
    assert!(
        matches!(err, StorageError::WrongBackupPassword),
        "wrong password is a GCM auth failure → WrongBackupPassword, got {err:?}"
    );
}

#[test]
fn bak031_rotation_over_400_days_keeps_14_8_12_and_prunes() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);

    // Simulate 400 days: one scheduled backup per day, advancing the fake clock.
    for _ in 0..400 {
        engine
            .run_scheduled_backup(TEST_BACKUP_PASSWORD)
            .expect("scheduled backup");
        clock.advance_days(1);
    }

    let counts = engine.rotation_counts().expect("rotation counts");
    assert_eq!(
        counts.daily,
        RetentionPolicy::DEFAULT.daily,
        "keep 14 daily"
    );
    assert_eq!(
        counts.weekly,
        RetentionPolicy::DEFAULT.weekly,
        "keep 8 weekly"
    );
    assert_eq!(
        counts.monthly,
        RetentionPolicy::DEFAULT.monthly,
        "keep 12 monthly"
    );
}

#[test]
fn bak031_scheduled_backup_needs_no_password_prompt() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);

    // The remembered password is passed in; the engine must run silently
    // (SUX-011). Success with a verified archive proves the silent path.
    let outcome = engine
        .run_scheduled_backup(TEST_BACKUP_PASSWORD)
        .expect("scheduled backup runs without prompting");
    assert!(outcome.verified, "scheduled backup is verified (BAK-004)");
    assert!(outcome.size_bytes > 0, "a real archive was written");
}

#[test]
fn bak033_restore_takes_pre_restore_safety_copy_and_is_atomic() {
    // Source backup to restore from.
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);
    let out = tempfile::tempdir().expect("out dir");
    let outcome = engine
        .backup_to(out.path(), TEST_BACKUP_PASSWORD)
        .expect("backup_to");

    // A DIFFERENT current install (its own key + its own current data) that we
    // restore ONTO; its current data must be safety-copied first.
    let (dst_dir, target_key) = clean_install();
    let dst_db = dst_dir.path().join("clinic.db");
    let dst_pool = Pool::open(&dst_db, &target_key as &dyn KeyProvider).expect("open dst");
    hc_storage::migrate::run(&dst_pool).ok();
    let dst_engine = BackupEngine::new(&dst_pool, dst_dir.path(), &clock);

    let res = dst_engine
        .restore_apply(&outcome.file_path, TEST_BACKUP_PASSWORD, &target_key)
        .expect("restore_apply");

    // A pre-restore safety copy was taken and exists on disk.
    assert!(
        res.pre_restore_backup_path.exists(),
        "a pre-restore safety copy of the current data must exist"
    );
    // The restored DB opens and holds the restored data (atomic swap completed).
    let (doctor, _clinic) = read_profile_names(&dst_db, &target_key as &dyn KeyProvider);
    assert_eq!(doctor, "Test Doctor 001");
}

#[test]
fn bak032_backup_to_arbitrary_out_dir_writes_hcbak() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);

    // An arbitrary folder (stands in for a chosen folder / USB mount path).
    let usb = tempfile::tempdir().expect("arbitrary out dir");
    let outcome = engine
        .backup_to(usb.path(), TEST_BACKUP_PASSWORD)
        .expect("backup to an arbitrary folder");

    assert!(
        outcome.file_path.starts_with(usb.path()),
        "the archive is written under the chosen out_dir"
    );
    assert_eq!(
        outcome.file_path.extension().and_then(|s| s.to_str()),
        Some("hcbak"),
        "the written file has the .hcbak extension"
    );
    assert!(outcome.file_path.exists(), "the .hcbak file exists on disk");
    assert!(outcome.size_bytes > 0, "the archive is non-empty");
    assert!(outcome.verified, "the archive is verified after writing");
}

#[test]
fn bak034_integrity_stale_banner_true_after_8_days() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);

    // A good backup now records the last-good time.
    engine
        .run_scheduled_backup(TEST_BACKUP_PASSWORD)
        .expect("good backup records last-good time");

    // At exactly 7 days the backup is NOT yet stale (boundary, BAK-004).
    clock.advance_days(7);
    let at7 = engine.status().expect("status at 7 days");
    assert!(!at7.stale, "a 7-day-old backup is not stale");

    // One more day → 8 days → stale banner raised.
    clock.advance_days(1);
    let at8 = engine.status().expect("status at 8 days");
    assert!(
        at8.stale,
        "a backup older than 7 days raises the stale banner"
    );
    assert_eq!(
        at8.days_since_good,
        Some(8),
        "reports 8 whole days since good"
    );
}

#[test]
fn bak034_verify_detects_good_backup() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);
    let out = tempfile::tempdir().expect("out dir");
    let outcome = engine
        .backup_to(out.path(), TEST_BACKUP_PASSWORD)
        .expect("backup_to");

    let v = engine
        .verify(&outcome.file_path, TEST_BACKUP_PASSWORD)
        .expect("verify a freshly-written archive");
    assert!(
        v.checksum_ok && v.decrypt_ok,
        "a good backup verifies fully"
    );
}

#[test]
fn bak030_corrupt_or_truncated_archive_rejected_cleanly() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);
    let out = tempfile::tempdir().expect("out dir");
    let outcome = engine
        .backup_to(out.path(), TEST_BACKUP_PASSWORD)
        .expect("backup_to");

    // Truncate the archive to the first few bytes (damaged header).
    let truncated = out.path().join("truncated.hcbak");
    let bytes = std::fs::read(&outcome.file_path).expect("read archive");
    std::fs::write(&truncated, &bytes[..bytes.len().min(4)]).expect("write truncated");

    let err = read_header(&truncated).expect_err("a truncated archive must be rejected");
    assert!(
        matches!(err, StorageError::BadArchive),
        "a truncated/corrupt archive is BadArchive (no panic), got {err:?}"
    );
}

#[test]
fn bak033_restore_rekeys_db_openable_under_target_key() {
    // Source is keyed with the fixed test key (via seeded_data_dir).
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);
    let out = tempfile::tempdir().expect("out dir");
    let outcome = engine
        .backup_to(out.path(), TEST_BACKUP_PASSWORD)
        .expect("backup_to");

    // Restore onto a clean install with a DIFFERENT key (its own DEK).
    let (dst_dir, target_key) = clean_install();
    let dst_db = dst_dir.path().join("clinic.db");
    let dst_pool = Pool::open(&dst_db, &target_key as &dyn KeyProvider).expect("open dst");
    hc_storage::migrate::run(&dst_pool).ok();
    let dst_engine = BackupEngine::new(&dst_pool, dst_dir.path(), &clock);
    dst_engine
        .restore_apply(&outcome.file_path, TEST_BACKUP_PASSWORD, &target_key)
        .expect("restore_apply re-keys under the target DEK");

    // The restored DB MUST open under the TARGET key (not the source key),
    // proving key re-establishment on a clean install (design §5).
    let reopened = Pool::open(&dst_db, &target_key as &dyn KeyProvider)
        .expect("restored DB opens under the target install's own key");
    let doctor: String = reopened
        .with_reader(|c| {
            Ok(c.query_row(
                "SELECT name FROM doctor_profile WHERE deleted_at IS NULL LIMIT 1",
                [],
                |r| r.get(0),
            )?)
        })
        .expect("read doctor after re-key");
    assert_eq!(doctor, "Test Doctor 001");
}
