//! b21-d1 regression tests: unlocking an UPGRADED install must migrate its
//! encrypted DB forward before any service uses the pool (NFR-011, R-DEL-004,
//! R-DATA-002).
//!
//! Defect: `AuthService::unlock` only calls `Pool::open` (which never
//! migrates), so an R1 (user_version 3) or R2 (user_version 7) DB stays on its
//! old schema after the R3 binary unlocks it and every M3 command fails with
//! `unexpected`.
//!
//! CUT: `hc_app::auth::AuthService::{unlock, recover}` over the real
//! `KeyHierarchy` + `Pool` + `migrate`. Dependency fakes only (R-TEST-002): the
//! encrypted-file keystore (headless-Linux fallback), a fixed clock, and the
//! `hc_storage::testing::migrate_to` seam that freezes a DB at an older
//! release's schema exactly as that release's binary would have left it.
//! Synthetic data only (R-TEST-004). Each test asserts data/state effects
//! (R-TEST-003).

use std::path::{Path, PathBuf};

use hc_app::auth::AuthService;
use hc_app::clock::Clock;
use hc_app::error::AppError;
use hc_app::visit::{TodayOverviewRequest, VisitService};
use hc_storage::key::{KeyHierarchy, KeyProvider};
use hc_storage::keystore::FileKeystore;
use hc_storage::migrate;
use hc_storage::profile::{upsert_doctor_profile, DoctorProfile};
use hc_storage::testing::{migrate_to, seed_patient};
use hc_storage::{Pool, StorageError};
use sha2::{Digest, Sha256};

/// The synthetic app PIN (A3 policy: 4-6 digits).
const PIN: &str = "2468";
/// R1-final schema version (0003_licence_state).
const R1_FINAL: u32 = 3;
/// R2-final schema version (0007_patient_recent).
const R2_FINAL: u32 = 7;

struct FixedClock;
impl Clock for FixedClock {
    fn now_rfc3339(&self) -> String {
        "2026-11-03T09:00:00Z".to_string()
    }
}

/// An existing install frozen at an older release's schema: keystore holding a
/// real DEK wrapped under [`PIN`], the encrypted `clinic.db` at `version`, and
/// the one-time recovery code. All pools used to build it are DROPPED before
/// returning, mirroring "the old app was closed, the new app is launched".
struct OldInstall {
    ks_dir: tempfile::TempDir,
    data_dir: tempfile::TempDir,
    recovery_code: String,
    /// Synthetic patient codes seeded (empty for R1, which has no patient table).
    patient_codes: Vec<String>,
}

impl OldInstall {
    fn db_path(&self) -> PathBuf {
        self.data_dir.path().join("clinic.db")
    }
    fn keystore(&self) -> FileKeystore {
        FileKeystore::open(self.ks_dir.path()).expect("reopen keystore")
    }
}

/// Build an install at `version`, seeding one synthetic doctor profile and (if
/// the schema has the patient table, i.e. >= 4) two synthetic patients.
fn old_install(version: u32) -> OldInstall {
    let ks_dir = tempfile::tempdir().expect("keystore dir");
    let data_dir = tempfile::tempdir().expect("data dir");
    let keystore = FileKeystore::open(ks_dir.path()).expect("open file keystore");
    let (recovery, dek) = KeyHierarchy::new(&keystore)
        .initialize(PIN)
        .expect("mint DEK under PIN");
    let recovery_code = recovery.reveal().to_string();

    let mut patient_codes = Vec::new();
    {
        let pool = Pool::open(&data_dir.path().join("clinic.db"), &dek).expect("open old DB");
        migrate_to(&pool, version);

        let doctor = DoctorProfile {
            id: "01900000-0000-7000-8000-000000000001".to_string(),
            name: "Test Doctor 001".to_string(),
            qualification: "BHMS".to_string(),
            reg_no: "TESTREG-001".to_string(),
            reg_council: "Test Council".to_string(),
            phone: None,
            email: None,
            signature_ref: None,
            logo_ref: None,
        };
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            upsert_doctor_profile(&tx, &doctor, "2026-01-01T00:00:00Z")?;
            tx.commit()?;
            Ok(())
        })
        .expect("seed doctor profile");

        if version >= 4 {
            for (code, name) in [
                ("HC-000001", "Test Patient 001"),
                ("HC-000002", "Test Patient 002"),
            ] {
                seed_patient(&pool, code, name);
                patient_codes.push(code.to_string());
            }
        }
        assert_eq!(user_version(&pool), version, "fixture frozen at old schema");
    } // pool dropped: DB closed like the old app on exit.

    OldInstall {
        ks_dir,
        data_dir,
        recovery_code,
        patient_codes,
    }
}

fn user_version(pool: &Pool) -> u32 {
    pool.with_reader(migrate::current_version)
        .expect("read user_version")
}

fn patient_codes(pool: &Pool) -> Vec<String> {
    pool.with_reader(|c| {
        let mut st = c.prepare("SELECT code FROM patient ORDER BY code")?;
        let rows = st
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
    .expect("list patient codes")
}

fn doctor_names(pool: &Pool) -> Vec<String> {
    pool.with_reader(|c| {
        let mut st = c.prepare("SELECT name FROM doctor_profile ORDER BY name")?;
        let rows = st
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
    .expect("list doctor names")
}

/// Every pre-migration backup file currently in `dir`.
fn pre_migration_backups(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .expect("read data dir")
        .map(|e| e.expect("dir entry").path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.contains(".pre-migration."))
        })
        .collect();
    v.sort();
    v
}

/// SHA-256 of every file in `dir` (name + bytes), to prove "untouched".
fn dir_fingerprint(dir: &Path) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = std::fs::read_dir(dir)
        .expect("read data dir")
        .map(|e| {
            let p = e.expect("dir entry").path();
            let bytes = std::fs::read(&p).expect("read file");
            let hash = Sha256::digest(&bytes);
            let hex: String = hash.iter().map(|b| format!("{b:02x}")).collect();
            (p.file_name().unwrap().to_string_lossy().into_owned(), hex)
        })
        .collect();
    v.sort();
    v
}

/// Assert the post-M3 command paths the R3 UI hits right after unlock work on
/// the unlocked pool (they fail with `unexpected` on an un-migrated DB).
fn assert_m3_commands_work(pool: &Pool) {
    let clock = FixedClock;
    let svc = VisitService::new(&clock);
    let tpl = svc
        .template_get_default(pool)
        .expect("case_template default query works after unlock (migration 0008)");
    assert_eq!(
        tpl.template_id,
        hc_storage::case_template::CHRONIC_DETAILED_ID,
        "seeded default case template is present"
    );
    svc.today_overview(
        pool,
        TodayOverviewRequest {
            today: "2026-11-03".to_string(),
        },
    )
    .expect("today overview works after unlock (migration 0009 visit table)");
}

// ---------------------------------------------------------------------------
// (1) PIN unlock migrates an upgraded install.
// ---------------------------------------------------------------------------

/// NFR-011 / R-DEL-004: an R2-final DB (user_version 7) unlocked with the
/// correct PIN is migrated to latest, keeps its patients, and serves the M3
/// commands. Catches the b21-d1 defect (unlock opens without migrating).
#[test]
fn b21d1_unlock_migrates_r2_install_to_latest_and_keeps_patients() {
    let inst = old_install(R2_FINAL);
    let keystore = inst.keystore();
    let auth = AuthService::new(&keystore, inst.data_dir.path());

    let pool = auth.unlock(PIN).expect("correct PIN unlocks R2 install");

    assert_eq!(
        user_version(&pool),
        migrate::latest_version(),
        "unlock must migrate an R2 DB to the latest schema"
    );
    assert_eq!(patient_codes(&pool), inst.patient_codes, "patients survive");
    assert_eq!(doctor_names(&pool), vec!["Test Doctor 001".to_string()]);
    assert_m3_commands_work(&pool);
}

/// NFR-011 / R-DEL-004: an R1-final DB (user_version 3, pre-patient schema)
/// unlocked with the correct PIN is migrated to latest and keeps its doctor
/// profile. Catches the defect on the R1 -> R3 hop.
#[test]
fn b21d1_unlock_migrates_r1_install_to_latest_and_keeps_profile() {
    let inst = old_install(R1_FINAL);
    let keystore = inst.keystore();
    let auth = AuthService::new(&keystore, inst.data_dir.path());

    let pool = auth.unlock(PIN).expect("correct PIN unlocks R1 install");

    assert_eq!(
        user_version(&pool),
        migrate::latest_version(),
        "unlock must migrate an R1 DB to the latest schema"
    );
    assert_eq!(doctor_names(&pool), vec!["Test Doctor 001".to_string()]);
    assert!(
        patient_codes(&pool).is_empty(),
        "patient table now exists, empty"
    );
    assert_m3_commands_work(&pool);
}

// ---------------------------------------------------------------------------
// (2) Recovery-code path (forgot PIN -> reset -> unlock with new PIN).
// ---------------------------------------------------------------------------

/// SET-004 + NFR-011: after a forgot-PIN reset on an upgraded R2 install, the
/// unlock with the NEW PIN migrates the DB and keeps patients. Catches a fix
/// that only migrates on the first/old-PIN path.
#[test]
fn b21d1_recovery_reset_then_unlock_migrates_r2_install() {
    let inst = old_install(R2_FINAL);
    let keystore = inst.keystore();
    let auth = AuthService::new(&keystore, inst.data_dir.path());

    auth.recover(&inst.recovery_code, "1357", "1357")
        .expect("recovery code resets the PIN");
    let pool = auth.unlock("1357").expect("new PIN unlocks");

    assert_eq!(
        user_version(&pool),
        migrate::latest_version(),
        "unlock after recovery must migrate an R2 DB to the latest schema"
    );
    assert_eq!(patient_codes(&pool), inst.patient_codes, "patients survive");
    assert_m3_commands_work(&pool);
}

// ---------------------------------------------------------------------------
// (3) Backup-before-migrate.
// ---------------------------------------------------------------------------

/// NFR-011 / R-DATA-002: unlocking a non-empty R2 DB writes the pre-migration
/// backup at `migrate::backup_path_for(db, 7)`; it is a same-key encrypted copy
/// still at user_version 7 holding the same patients. Catches a fix that
/// migrates without the safety backup (or hand-rolls a different one).
#[test]
fn b21d1_unlock_writes_pre_migration_backup_of_r2_db() {
    let inst = old_install(R2_FINAL);
    let keystore = inst.keystore();
    let auth = AuthService::new(&keystore, inst.data_dir.path());

    let pool = auth.unlock(PIN).expect("correct PIN unlocks R2 install");
    drop(pool);

    let backup = migrate::backup_path_for(&inst.db_path(), R2_FINAL);
    assert!(
        backup.exists(),
        "pre-migration backup {} must exist after unlock-migrate",
        backup.display()
    );
    assert_eq!(
        pre_migration_backups(inst.data_dir.path()),
        vec![backup.clone()],
        "exactly one pre-migration backup"
    );

    let dek = KeyHierarchy::new(&keystore)
        .unlock_with_pin(PIN)
        .expect("re-derive DEK");
    let bpool = Pool::open(&backup, &dek as &dyn KeyProvider).expect("backup opens with DEK");
    assert_eq!(
        user_version(&bpool),
        R2_FINAL,
        "backup keeps the old version"
    );
    assert_eq!(
        patient_codes(&bpool),
        inst.patient_codes,
        "backup has the data"
    );
}

// ---------------------------------------------------------------------------
// (4) Wrong PIN never migrates or touches the DB.
// ---------------------------------------------------------------------------

/// SUX-005 + R-DATA-002: a wrong PIN on an R2 install returns WrongPin and
/// leaves the data dir byte-identical (no migration, no backup). Guard: catches
/// a fix that migrates before verifying the PIN.
#[test]
fn b21d1_wrong_pin_does_not_migrate_or_touch_db() {
    let inst = old_install(R2_FINAL);
    let keystore = inst.keystore();
    let auth = AuthService::new(&keystore, inst.data_dir.path());
    let before = dir_fingerprint(inst.data_dir.path());

    match auth.unlock("0000") {
        Ok(_) => panic!("wrong PIN must be refused"),
        Err(e) => assert!(matches!(e, AppError::WrongPin), "got {e:?}"),
    }

    assert_eq!(
        dir_fingerprint(inst.data_dir.path()),
        before,
        "wrong PIN must not touch the data dir"
    );
    assert!(pre_migration_backups(inst.data_dir.path()).is_empty());
}

// ---------------------------------------------------------------------------
// (5) Already-latest DB: no-op.
// ---------------------------------------------------------------------------

/// R-DATA-002: unlocking a DB already at latest takes no backup and keeps the
/// version. Guard: catches a fix that backs up on every unlock (disk bloat).
#[test]
fn b21d1_unlock_of_latest_db_is_noop_without_backup() {
    let inst = old_install(migrate::latest_version());
    let keystore = inst.keystore();
    let auth = AuthService::new(&keystore, inst.data_dir.path());

    let pool = auth.unlock(PIN).expect("correct PIN unlocks");
    assert_eq!(user_version(&pool), migrate::latest_version());
    assert_eq!(patient_codes(&pool), inst.patient_codes);
    drop(pool);

    let again = auth.unlock(PIN).expect("second unlock");
    drop(again);
    assert!(
        pre_migration_backups(inst.data_dir.path()).is_empty(),
        "no pre-migration backup when nothing migrates"
    );
}

// ---------------------------------------------------------------------------
// (6) Forward-only: a newer-than-build DB keeps the app locked.
// ---------------------------------------------------------------------------

/// R-DATA-002 (downgrade refused): unlocking a DB whose user_version exceeds
/// this build's latest must FAIL (app stays locked, typed error, not WrongPin)
/// and leave the version untouched. Catches a fix that ignores
/// `SchemaTooNew` and hands a too-new schema to the services.
#[test]
fn b21d1_unlock_refuses_db_newer_than_build() {
    let inst = old_install(migrate::latest_version());
    let too_new = migrate::latest_version() + 1;
    {
        let keystore = inst.keystore();
        let dek = KeyHierarchy::new(&keystore)
            .unlock_with_pin(PIN)
            .expect("dek");
        let pool = Pool::open(&inst.db_path(), &dek as &dyn KeyProvider).expect("open");
        pool.with_writer(|c| {
            c.execute_batch(&format!("PRAGMA user_version = {too_new};"))?;
            Ok::<_, StorageError>(())
        })
        .expect("bump version past latest");
    }

    let keystore = inst.keystore();
    let auth = AuthService::new(&keystore, inst.data_dir.path());
    match auth.unlock(PIN) {
        Ok(_) => panic!("unlock must refuse a DB newer than this build (stay locked)"),
        Err(e) => assert!(
            !matches!(e, AppError::WrongPin),
            "a too-new schema is not a wrong PIN, got {e:?}"
        ),
    }

    let dek = KeyHierarchy::new(&keystore)
        .unlock_with_pin(PIN)
        .expect("dek");
    let pool = Pool::open(&inst.db_path(), &dek as &dyn KeyProvider).expect("reopen");
    assert_eq!(
        user_version(&pool),
        too_new,
        "downgrade never rewrites version"
    );
}
