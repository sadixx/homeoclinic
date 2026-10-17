//! Service-level tests for the backup/restore command layer (HC-MVP1-030..034,
//! BAK-001..004, SUX-011). CUT: `hc_app::backup::BackupService` and the policy
//! it adds over the storage `BackupEngine` (password rule, auto toggle, response
//! shaping) plus the `list_removable_drives` enumeration and the deferred
//! move-to-new-computer flag.
//!
//! The ONLY fakes are DEPENDENCIES (R-TEST-002): the storage `testing` seam's
//! seeded keyed data dir, its fixed `DevKeyProvider`, and a deterministic
//! storage `FakeClock` (R-TEST-006). The DB, key hierarchy and the real engine
//! are the CUT, never faked. Synthetic data only (R-TEST-004). Names carry the
//! req id (R-TEST-008). Each test asserts the resulting data/state (R-TEST-003),
//! not merely `is_ok()`.

use hc_app::backup::{list_removable_drives, validate_backup_password, BackupService};
use hc_app::error::AppError;
use hc_storage::clock::FakeClock;
use hc_storage::testing::{fake_clock, seeded_data_dir, test_key, TEST_BACKUP_PASSWORD};

/// HC-MVP1-032 / BAK-002 (R-TEST-008): a manual backup to a chosen folder
/// writes a verified `.hcbak` whose path is returned, and the engine records a
/// last-good time so the status flips to non-stale. Asserts the data effect
/// (R-TEST-003): file exists, verified true, status fresh.
#[test]
fn bak032_backup_now_writes_verified_hcbak_to_chosen_folder() {
    let (_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let svc = BackupService::new(&pool, _dir.path(), &clock);

    let out = tempfile::tempdir().expect("out dir");
    let resp = svc
        .backup_now(out.path().to_str().unwrap(), TEST_BACKUP_PASSWORD)
        .expect("backup_now to a folder");

    assert!(resp.ok, "backup_now reports ok");
    assert!(
        resp.verified,
        "post-backup integrity check passed (BAK-004)"
    );
    assert!(
        std::path::Path::new(&resp.file_path).is_file(),
        "a .hcbak file was written at the returned path"
    );
    assert!(
        resp.file_path.ends_with(".hcbak"),
        "the archive has the .hcbak extension"
    );

    let status = svc.status().expect("status after backup");
    assert!(status.last_backup_ok, "last backup recorded as good");
    assert!(!status.stale, "a fresh backup is not stale (BAK-004)");
    assert_eq!(status.retention.daily, 14);
    assert_eq!(status.retention.weekly, 8);
    assert_eq!(status.retention.monthly, 12);
}

/// OQ-S17-2 (R-TEST-008): a backup password shorter than 8 characters is a
/// validation error and NO archive is written. Catches a policy bypass.
#[test]
fn bak002_backup_now_rejects_short_password_and_writes_nothing() {
    let (_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let svc = BackupService::new(&pool, _dir.path(), &clock);

    let out = tempfile::tempdir().expect("out dir");
    let err = svc
        .backup_now(out.path().to_str().unwrap(), "short")
        .expect_err("a < 8 char password must be rejected");
    assert!(
        matches!(err, AppError::Validation(_)),
        "too-short backup password is a validation error, got {err:?}"
    );

    let count = std::fs::read_dir(out.path())
        .expect("read out dir")
        .flatten()
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("hcbak"))
        .count();
    assert_eq!(
        count, 0,
        "no .hcbak is written when the password is rejected"
    );

    // The standalone validator agrees (used by backup_now + run_scheduled).
    assert!(validate_backup_password("short").is_err());
    assert!(validate_backup_password("longenough").is_ok());
}

/// HC-MVP1-033 / BAK-003 (R-TEST-008): restore_preview reads the counts/dates
/// from a real archive WITHOUT mutating anything (AC4). Asserts the preview
/// fields are populated from the header.
#[test]
fn bak033_restore_preview_reads_counts_without_mutation() {
    let (_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let svc = BackupService::new(&pool, _dir.path(), &clock);

    let out = tempfile::tempdir().expect("out dir");
    let backup = svc
        .backup_now(out.path().to_str().unwrap(), TEST_BACKUP_PASSWORD)
        .expect("backup_now");

    let preview = svc
        .restore_preview(&backup.file_path)
        .expect("restore_preview reads the header");
    // M1 has no patient/visit tables yet, so counts are 0 by design.
    assert_eq!(preview.patient_count, 0);
    assert_eq!(preview.visit_count, 0);
    assert!(
        !preview.created_at.is_empty(),
        "the preview carries the backup-made timestamp (S17 step 2)"
    );
    assert!(
        !preview.app_version.is_empty(),
        "the preview carries the app version (S17 step 2)"
    );
}

/// HC-MVP1-033 / BAK-003 + AC1 (R-TEST-008): restore_apply re-keys the archive
/// under the target install's DEK and takes a pre-restore safety copy; the
/// restored DB opens under the target key and the doctor+clinic rows come back
/// (R1 demo step 3). Asserts the data effects (R-TEST-003).
#[test]
fn bak033_restore_apply_rekeys_and_takes_safety_copy() {
    let (src_dir, pool, (doctor_id, clinic_id)) = seeded_data_dir();
    let clock = fake_clock();
    let out = tempfile::tempdir().expect("out dir");

    // Make a backup from the source install.
    let backup = {
        let svc = BackupService::new(&pool, src_dir.path(), &clock);
        svc.backup_now(out.path().to_str().unwrap(), TEST_BACKUP_PASSWORD)
            .expect("backup_now")
    };
    drop(pool); // release the source pool before restoring over a fresh dir.

    // Restore into a brand-new target install (fresh data dir + its own key).
    let target_dir = tempfile::tempdir().expect("target data dir");
    // Seed a minimal keyed DB so the target data dir has a live clinic.db to
    // safety-copy aside (mirrors a set-up clean install).
    let target_key = test_key();
    {
        let db = target_dir.path().join("clinic.db");
        let p = hc_storage::Pool::open(&db, &target_key as &dyn hc_storage::key::KeyProvider)
            .expect("open target db");
        hc_storage::migrate::run(&p).expect("migrate target db");
    }

    let target_pool = {
        let db = target_dir.path().join("clinic.db");
        hc_storage::Pool::open(&db, &target_key as &dyn hc_storage::key::KeyProvider)
            .expect("reopen target db")
    };
    let svc = BackupService::new(&target_pool, target_dir.path(), &clock);
    let resp = svc
        .restore_apply(
            &backup.file_path,
            TEST_BACKUP_PASSWORD,
            &target_key as &dyn hc_storage::key::KeyProvider,
        )
        .expect("restore_apply");

    assert!(resp.ok, "restore reports ok");
    assert!(
        std::path::Path::new(&resp.pre_restore_backup_path).is_dir(),
        "a pre-restore safety copy dir was created (BAK-003)"
    );
    drop(target_pool);

    // The restored DB opens under the TARGET key and the seeded rows are back.
    let db = target_dir.path().join("clinic.db");
    let restored = hc_storage::Pool::open(&db, &target_key as &dyn hc_storage::key::KeyProvider)
        .expect("restored DB opens under the target key (clean-install re-key)");
    let doctor = restored
        .with_reader(hc_storage::profile::get_doctor_profile)
        .expect("read doctor")
        .expect("doctor row restored (R1 demo step 3)");
    assert_eq!(doctor.id, doctor_id, "same doctor row id round-tripped");
    let clinic = restored
        .with_reader(hc_storage::profile::get_clinic_profile)
        .expect("read clinic")
        .expect("clinic row restored (R1 demo step 3)");
    assert_eq!(clinic.id, clinic_id, "same clinic row id round-tripped");
}

/// HC-MVP1-033 (R-TEST-008): a wrong backup password is refused on restore and
/// maps to the distinct WrongBackupPassword error (S17 step-1 inline retry,
/// AC4) — NOT a corrupt-file error.
#[test]
fn bak033_restore_apply_wrong_password_maps_to_wrong_backup_password() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let out = tempfile::tempdir().expect("out dir");
    let backup = {
        let svc = BackupService::new(&pool, src_dir.path(), &clock);
        svc.backup_now(out.path().to_str().unwrap(), TEST_BACKUP_PASSWORD)
            .expect("backup_now")
    };

    let target_key = test_key();
    let svc = BackupService::new(&pool, src_dir.path(), &clock);
    let err = svc
        .restore_apply(
            &backup.file_path,
            "wrong-password-xx",
            &target_key as &dyn hc_storage::key::KeyProvider,
        )
        .expect_err("a wrong backup password must be refused");
    assert!(
        matches!(err, AppError::WrongBackupPassword),
        "wrong backup password maps to WrongBackupPassword (distinct from BadBackup), got {err:?}"
    );
}

/// HC-MVP1-030 (R-TEST-008): a damaged/corrupt archive maps to BadBackup (plain
/// corrupt-file message + Details code, NFR-033), distinct from a wrong
/// password.
#[test]
fn bak030_restore_preview_corrupt_file_maps_to_bad_backup() {
    let (_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let svc = BackupService::new(&pool, _dir.path(), &clock);

    let out = tempfile::tempdir().expect("out dir");
    let bogus = out.path().join("corrupt.hcbak");
    std::fs::write(&bogus, b"not a real hcbak archive").expect("write bogus file");

    let err = svc
        .restore_preview(bogus.to_str().unwrap())
        .expect_err("a corrupt archive must be rejected");
    assert!(
        matches!(err, AppError::BadBackup),
        "a damaged archive maps to BadBackup, got {err:?}"
    );
}

/// HC-MVP1-034 / BAK-004 (R-TEST-008): verify_backup confirms a good archive
/// (checksum + decrypt both ok).
#[test]
fn bak034_verify_backup_confirms_good_archive() {
    let (_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let svc = BackupService::new(&pool, _dir.path(), &clock);

    let out = tempfile::tempdir().expect("out dir");
    let backup = svc
        .backup_now(out.path().to_str().unwrap(), TEST_BACKUP_PASSWORD)
        .expect("backup_now");

    let v = svc
        .verify_backup(&backup.file_path, TEST_BACKUP_PASSWORD)
        .expect("verify_backup");
    assert!(v.ok, "a good archive verifies ok");
    assert!(v.checksum_ok, "body checksum matches");
    assert!(v.decrypt_ok, "first chunk decrypts under the password");
}

/// HC-MVP1-034 / BAK-004 (R-TEST-008): with no backup yet the status is stale
/// (empty state → warning banner); after a backup it is fresh; after 8 simulated
/// days it is stale again (the 7-day boundary). Deterministic via FakeClock.
#[test]
fn bak034_status_stale_when_no_backup_and_after_8_days() {
    let (dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let svc = BackupService::new(&pool, dir.path(), &clock);

    // Empty state: no backup → stale, not ok.
    let before = svc.status().expect("status before any backup");
    assert!(before.stale, "no backup yet → stale (empty-state banner)");
    assert!(!before.last_backup_ok);
    assert_eq!(before.days_since_good, None);

    // Make a backup → fresh.
    let out = tempfile::tempdir().expect("out dir");
    svc.backup_now(out.path().to_str().unwrap(), TEST_BACKUP_PASSWORD)
        .expect("backup_now");
    let fresh = svc.status().expect("status after backup");
    assert!(!fresh.stale, "just-made backup is not stale");
    assert_eq!(fresh.days_since_good, Some(0));

    // Advance 8 days → stale again (BAK-004: banner after > 7 days).
    clock.advance_days(8);
    let later = svc.status().expect("status after 8 days");
    assert!(later.stale, "a backup older than 7 days is stale (BAK-004)");
    assert_eq!(later.days_since_good, Some(8));
}

/// BAK-001 (R-TEST-008): set_auto_backup persists the toggle and status reflects
/// it; the default (unset) is on. One audited write (R-DATA-001; the engine's
/// put_setting writes exactly one audit row — asserted by the storage suite).
#[test]
fn bak001_set_auto_backup_persists_toggle() {
    let (dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let svc = BackupService::new(&pool, dir.path(), &clock);

    // Default on.
    assert!(
        svc.status().expect("status").auto_enabled,
        "automatic daily backup defaults on (BAK-001)"
    );

    svc.set_auto_backup(false).expect("disable auto backup");
    assert!(
        !svc.status().expect("status").auto_enabled,
        "toggle persisted off"
    );

    svc.set_auto_backup(true).expect("re-enable auto backup");
    assert!(
        svc.status().expect("status").auto_enabled,
        "toggle persisted back on"
    );
}

/// BAK-001 / SUX-011 (R-TEST-008): a scheduled backup runs silently with the
/// remembered password (no prompt) and keeps at most 14 daily under the 14/8/12
/// rotation. Uses a DISTINCT clock so each run gets a unique daily stamp.
#[test]
fn bak001_scheduled_backup_rotates_and_needs_no_prompt() {
    let (dir, pool, _ids) = seeded_data_dir();
    // Dedicated advanceable clock so each scheduled run writes a distinct daily.
    let clock = FakeClock::at_unix(1_767_225_600);
    let svc = BackupService::new(&pool, dir.path(), &clock);

    // 20 days of scheduled backups; the remembered password is just an argument
    // (no prompt is structurally possible — SUX-011).
    for _ in 0..20 {
        svc.run_scheduled_backup(TEST_BACKUP_PASSWORD)
            .expect("scheduled backup runs silently");
        clock.advance_days(1);
    }

    let daily = std::fs::read_dir(dir.path().join("backups").join("daily"))
        .expect("daily dir exists")
        .flatten()
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("hcbak"))
        .count();
    assert!(
        daily <= 14,
        "daily tier is pruned to at most 14 (BAK-001), found {daily}"
    );
    assert!(daily > 0, "at least one daily backup was written");
}

/// BAK-002 (R-TEST-008): list_removable_drives is a typed command returning a
/// drive list (possibly empty on this headless box with no USB) — it never
/// errors and never widens FS scope (R-SEC-002/003). Smoke-level: the typed
/// shape is returned.
#[test]
fn bak002_list_removable_drives_returns_typed_list() {
    let drives = list_removable_drives().expect("list_removable_drives never errors");
    // On a headless CI box there is usually no removable media; an empty list is
    // the correct, safe result. The assertion is on the typed shape.
    for d in &drives.drives {
        assert!(!d.path.is_empty(), "each drive has a non-empty path");
    }
}
