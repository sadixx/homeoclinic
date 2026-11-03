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
    // seeded_data_dir holds no patients/visits, so the counts are 0 but present
    // (the populated case is covered by the b21-a1 preview tests below).
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

// ---------------------------------------------------------------------------
// b21-a1: the plaintext header preview must carry the REAL aggregate counts
// (S17 restore step 2 / BackupScreen "Patients: N"). Before the fix the engine
// hard-codes patient_count 0 / visit_count 0 / last_visit_date None, so the
// restore wizard always tells the doctor a backup holds 0 patients.
//
// Counting rule (decided here, documented in test-plan.md):
// - patient_count = LIVE patients only (`patient.deleted_at IS NULL`); a
//   recycle-bin patient is NOT counted — the number matches what the doctor
//   will see in the patient list after the restore.
// - visit_count = LIVE visits (`visit.deleted_at IS NULL`) of LIVE patients;
//   a soft-deleted visit and a visit of a recycle-bin patient are not counted.
// - last_visit_date = the newest such visit's date as `YYYY-MM-DD` (the UTC
//   date part of `visit_at`), or None when there is none.
// Counts only, never a name (R-PRIV-001). No format change (still v1).
// ---------------------------------------------------------------------------

use hc_storage::testing::{insert_visit_for, seed_patient};

/// The expected preview of [`seed_counted_clinic`].
const EXPECTED_LIVE_PATIENTS: u64 = 3;
const EXPECTED_LIVE_VISITS: u64 = 3;
const EXPECTED_LAST_VISIT_DATE: &str = "2026-10-20";

/// Seed `pool` (already migrated, from `seeded_data_dir`) with a synthetic
/// clinic whose live vs. deleted rows differ, so a preview that counts the
/// wrong thing is caught:
/// - 3 live patients: 001 (2 visits), 002 (1 visit), 003 (no visit);
/// - 1 soft-deleted visit on 001, NEWER than every live visit;
/// - 1 recycle-bin patient 004 with its own visit, NEWEST of all.
///
/// Live result: 3 patients, 3 visits, last visit 2026-10-20. Visit times are
/// 06:00Z so the UTC date equals the IST date (no midnight ambiguity).
fn seed_counted_clinic(pool: &Pool) {
    let p1 = seed_patient(pool, "HC-000001", "Test Patient 001");
    let p2 = seed_patient(pool, "HC-000002", "Test Patient 002");
    let _p3 = seed_patient(pool, "HC-000003", "Test Patient 003");
    let p4 = seed_patient(pool, "HC-000004", "Test Patient 004");

    insert_visit_for(pool, &p1, "2026-10-01T06:00:00Z", None);
    insert_visit_for(pool, &p1, "2026-10-20T06:00:00Z", None);
    insert_visit_for(pool, &p2, "2026-10-15T06:00:00Z", None);

    // A soft-deleted visit (no repo delete API yet, so set deleted_at directly;
    // parameterised). Newer than every live visit -> must not set last date.
    let deleted_visit = insert_visit_for(pool, &p1, "2026-10-30T06:00:00Z", None);
    pool.with_writer(|c| {
        c.execute(
            "UPDATE visit SET deleted_at = ?2 WHERE id = ?1",
            rusqlite::params![deleted_visit, "2026-10-30T07:00:00Z"],
        )?;
        Ok(())
    })
    .expect("soft-delete one visit");

    // Patient 004 gets the newest visit, then goes to the recycle bin through
    // the real soft-delete path (PAT-008).
    insert_visit_for(pool, &p4, "2026-10-31T06:00:00Z", None);
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        hc_storage::patient::soft_delete_patient(&tx, &p4, "2026-11-01T00:00:00Z", None)?;
        tx.commit()?;
        Ok(())
    })
    .expect("move patient 004 to the recycle bin");
}

/// Live counts read straight from a DB, using the counting rule above. Used to
/// prove the header agrees with the snapshot the body actually carries.
fn live_counts(pool: &Pool) -> (u64, u64, Option<String>) {
    pool.with_reader(|c| {
        let patients: i64 = c.query_row(
            "SELECT COUNT(*) FROM patient WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        )?;
        let (visits, last): (i64, Option<String>) = c.query_row(
            "SELECT COUNT(*), substr(MAX(v.visit_at), 1, 10) \
               FROM visit v JOIN patient p ON p.id = v.patient_id \
              WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        Ok((patients as u64, visits as u64, last))
    })
    .expect("read live counts")
}

/// b21-a1 (S17 step 2, R-PRIV-001): a backup of a clinic with 3 live patients,
/// 1 recycle-bin patient, 3 live visits and 2 non-live visits previews
/// 3 patients / 3 visits / last visit 2026-10-20 — both via `read_header` and
/// via the engine's password-free `restore_preview`.
/// Bug caught: the preview hard-codes 0, or counts recycle-bin / deleted rows,
/// or picks the newest date from a deleted visit.
#[test]
fn bak030_preview_counts_live_patients_and_visits_excluding_recycle_bin() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    seed_counted_clinic(&pool);
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);
    let out = tempfile::tempdir().expect("out dir");
    let outcome = engine
        .backup_to(out.path(), TEST_BACKUP_PASSWORD)
        .expect("backup_to");

    let header = read_header(&outcome.file_path).expect("header without password");
    assert_eq!(
        header.preview.patient_count, EXPECTED_LIVE_PATIENTS,
        "preview must count live patients only (recycle-bin patient excluded)"
    );
    assert_eq!(
        header.preview.visit_count, EXPECTED_LIVE_VISITS,
        "preview must count live visits of live patients only"
    );
    assert_eq!(
        header.preview.last_visit_date.as_deref(),
        Some(EXPECTED_LAST_VISIT_DATE),
        "last visit date is the newest LIVE visit, as YYYY-MM-DD"
    );

    let preview = engine
        .restore_preview(&outcome.file_path)
        .expect("restore_preview without password");
    assert_eq!(
        preview.preview, header.preview,
        "restore_preview returns the same counts the header holds"
    );
}

/// b21-a1: an empty clinic (profiles only, no patients/visits) previews 0 / 0 /
/// None — the fix must not invent a date or fail on an empty visit table.
/// Bug caught: `MAX(visit_at)` over no rows mapped to "" or a panic instead of
/// None; COUNT on an empty table erroring.
#[test]
fn bak030_preview_counts_empty_clinic_is_zero_with_no_last_visit() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);
    let out = tempfile::tempdir().expect("out dir");
    let outcome = engine
        .backup_to(out.path(), TEST_BACKUP_PASSWORD)
        .expect("backup_to");

    let preview = engine
        .restore_preview(&outcome.file_path)
        .expect("restore_preview")
        .preview;
    assert_eq!(preview.patient_count, 0);
    assert_eq!(preview.visit_count, 0);
    assert_eq!(
        preview.last_visit_date, None,
        "no visits -> no last visit date"
    );
}

/// b21-a1 (consistency): the header counts describe the SAME snapshot the body
/// carries — after restoring the archive onto a clean install, the restored
/// DB's live counts equal the header preview (and the seeded truth). The DB is
/// changed AFTER the backup to prove the header was taken at backup time, not
/// re-read later.
/// Bug caught: counts computed from a different view than the exported
/// snapshot (e.g. outside the snapshot, or still hard-coded 0), so the preview
/// promises a different clinic than the restore delivers.
#[test]
fn bak030_preview_counts_match_the_restored_database() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    seed_counted_clinic(&pool);
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);
    let out = tempfile::tempdir().expect("out dir");
    let outcome = engine
        .backup_to(out.path(), TEST_BACKUP_PASSWORD)
        .expect("backup_to");

    // Change the live DB after the backup: must not affect this archive.
    let late = seed_patient(&pool, "HC-000005", "Test Patient 005");
    insert_visit_for(&pool, &late, "2026-11-02T06:00:00Z", None);

    let header = read_header(&outcome.file_path).expect("header");

    let (dst_dir, target_key) = clean_install();
    let dst_db = dst_dir.path().join("clinic.db");
    let dst_pool = Pool::open(&dst_db, &target_key as &dyn KeyProvider).expect("open dst");
    hc_storage::migrate::run(&dst_pool).ok();
    let dst_engine = BackupEngine::new(&dst_pool, dst_dir.path(), &clock);
    dst_engine
        .restore_apply(&outcome.file_path, TEST_BACKUP_PASSWORD, &target_key)
        .expect("restore_apply");
    drop(dst_pool);
    let restored = Pool::open(&dst_db, &target_key as &dyn KeyProvider).expect("reopen restored");
    let (patients, visits, last) = live_counts(&restored);

    assert_eq!(
        (patients, visits, last.as_deref()),
        (
            EXPECTED_LIVE_PATIENTS,
            EXPECTED_LIVE_VISITS,
            Some(EXPECTED_LAST_VISIT_DATE)
        ),
        "the restored DB holds the seeded live clinic (sanity)"
    );
    assert_eq!(
        (
            header.preview.patient_count,
            header.preview.visit_count,
            header.preview.last_visit_date.as_deref()
        ),
        (patients, visits, last.as_deref()),
        "header preview must equal what the restore actually lands"
    );
}

/// CRC-32 (IEEE) — test fixture only, needed to forge a self-consistent
/// pre-fix header (the archive format's documented header checksum).
fn fixture_crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

/// Rewrite the header of the `.hcbak` at `src` so its preview reads exactly
/// what a pre-b21-a1 build wrote (patient_count 0, visit_count 0,
/// last_visit_date null), keeping the body untouched and the header CRC valid.
/// Writes the result to `dst`.
fn forge_pre_fix_archive(src: &Path, dst: &Path) {
    let bytes = std::fs::read(src).expect("read archive");
    let magic_len = 8;
    let len = u32::from_le_bytes(bytes[magic_len..magic_len + 4].try_into().unwrap()) as usize;
    let json_start = magic_len + 4;
    let json_end = json_start + len;
    let body = &bytes[json_end + 4..];

    let mut header: serde_json::Value =
        serde_json::from_slice(&bytes[json_start..json_end]).expect("header json");
    header["preview"]["patient_count"] = serde_json::json!(0);
    header["preview"]["visit_count"] = serde_json::json!(0);
    header["preview"]["last_visit_date"] = serde_json::Value::Null;
    let json = serde_json::to_vec(&header).expect("re-encode header");

    let mut out = Vec::with_capacity(bytes.len());
    out.extend_from_slice(&bytes[..magic_len]);
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    out.extend_from_slice(&fixture_crc32(&json).to_le_bytes());
    out.extend_from_slice(body);
    std::fs::write(dst, out).expect("write forged archive");
}

/// b21-a1 backward compatibility: an archive written by an older build (header
/// preview 0 / 0 / None, same v1 format) still previews, verifies and restores
/// its real data — the fix must not start rejecting or "correcting" old files.
/// Bug caught: a format bump, a new required header field, or a reader that
/// treats a 0-count header as corrupt.
#[test]
fn bak030_older_backup_with_zero_preview_still_opens_and_restores() {
    let (src_dir, pool, _ids) = seeded_data_dir();
    seed_counted_clinic(&pool);
    let clock = fake_clock();
    let engine = BackupEngine::new(&pool, src_dir.path(), &clock);
    let out = tempfile::tempdir().expect("out dir");
    let outcome = engine
        .backup_to(out.path(), TEST_BACKUP_PASSWORD)
        .expect("backup_to");
    let old = out.path().join("pre-fix.hcbak");
    forge_pre_fix_archive(&outcome.file_path, &old);

    let header = engine.restore_preview(&old).expect("old archive previews");
    assert_eq!(
        header.format_version, 1,
        "still format v1 (no format change)"
    );
    assert_eq!(header.preview.patient_count, 0);
    assert_eq!(header.preview.visit_count, 0);
    assert_eq!(header.preview.last_visit_date, None);

    let v = engine
        .verify(&old, TEST_BACKUP_PASSWORD)
        .expect("verify old");
    assert!(v.checksum_ok && v.decrypt_ok, "old archive verifies fully");

    let (dst_dir, target_key) = clean_install();
    let dst_db = dst_dir.path().join("clinic.db");
    let dst_pool = Pool::open(&dst_db, &target_key as &dyn KeyProvider).expect("open dst");
    hc_storage::migrate::run(&dst_pool).ok();
    let dst_engine = BackupEngine::new(&dst_pool, dst_dir.path(), &clock);
    dst_engine
        .restore_apply(&old, TEST_BACKUP_PASSWORD, &target_key)
        .expect("old archive restores");
    drop(dst_pool);
    let restored = Pool::open(&dst_db, &target_key as &dyn KeyProvider).expect("reopen restored");
    assert_eq!(
        live_counts(&restored).0,
        EXPECTED_LIVE_PATIENTS,
        "the old archive's real patients come back despite its 0 preview"
    );
}
