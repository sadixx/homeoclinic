//! MS (S18 Settings) data-folder relocation over the RUNNING app (SET-006,
//! ADR 0020; design §3.2–§3.4) and the F5 auto-lock-after-relaunch fix.
//!
//! CUT: `hc_app::data_folder::{move_data_folder_in_state, resolve_data_dir,
//! write_location, recheck_in_state, forget_in_state}`, `AppState::
//! {with_file_keystore, data_dir}` and `hc_app::auth::unlock_in_state` over a
//! REAL `AppState`: real file keystore with a real wrapped DEK, real encrypted
//! and migrated pool, the real `PatientService` and the real storage relocation
//! engine. Dependency fakes only: a fixed clock and `tempfile` folders.
//! Synthetic data only (R-TEST-004). Each test asserts data effects.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use hc_app::auth::unlock_in_state;
use hc_app::clock::Clock;
use hc_app::data_folder::{
    forget_in_state, move_data_folder_in_state, recheck_in_state, resolve_data_dir, write_location,
    DataDirResolution, LOCATION_FILE,
};
use hc_app::error::AppError;
use hc_app::patient::{CreatePatientRequest, PatientService};
use hc_app::state::AppState;
use hc_storage::key::{DekKeyProvider, KeyHierarchy};
use hc_storage::keystore::FileKeystore;
use hc_storage::profile::{put_setting, upsert_clinic_profile, upsert_doctor_profile};
use hc_storage::profile::{ClinicProfile, DoctorProfile};
use hc_storage::testing::temp_file_keystore;
use hc_storage::Pool;

const PIN: &str = "2468";
const NOW: &str = "2026-11-04T15:47:18Z";

struct FixedClock;
impl Clock for FixedClock {
    fn now_rfc3339(&self) -> String {
        NOW.to_string()
    }
}

/// A real install in `home`: keystore with a DEK under [`PIN`], a migrated
/// encrypted `clinic.db` with one synthetic doctor + clinic. Pools dropped.
fn provision(home: &Path) -> DekKeyProvider {
    let ks = FileKeystore::open(home).expect("file keystore");
    let (_recovery, dek) = KeyHierarchy::new(&ks).initialize(PIN).expect("mint DEK");
    let pool = Pool::open(&home.join("clinic.db"), &dek).expect("open DB");
    hc_storage::migrate::run(&pool).expect("migrate");
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        upsert_doctor_profile(
            &tx,
            &DoctorProfile {
                id: uuid::Uuid::now_v7().to_string(),
                name: "Test Doctor 001".to_string(),
                qualification: "BHMS".to_string(),
                reg_no: "TESTREG-001".to_string(),
                reg_council: "Test Council".to_string(),
                phone: None,
                email: None,
                signature_ref: None,
                logo_ref: None,
            },
            NOW,
        )?;
        upsert_clinic_profile(
            &tx,
            &ClinicProfile {
                id: uuid::Uuid::now_v7().to_string(),
                name: "Test Clinic 001".to_string(),
                address: "1 Test Street".to_string(),
                phone: None,
                timings: None,
                fee_first_paise: 50_000,
                fee_followup_paise: 30_000,
                gstin: None,
            },
            NOW,
        )?;
        tx.commit()?;
        Ok(())
    })
    .expect("seed profiles");
    dek
}

/// A real, unlocked `AppState` over `home` (pool + DEK stashed as unlock does).
fn unlocked_state(home: &Path) -> AppState {
    let dek = provision(home);
    let state = AppState::with_file_keystore(home.to_path_buf()).expect("state");
    let pool = Pool::open(&home.join("clinic.db"), &dek).expect("open DB");
    {
        let mut lock = state.lock.lock().unwrap();
        lock.locked = false;
        lock.pool = Some(pool);
        lock.key = Some(Arc::new(dek));
    }
    state
}

fn add_patient(state: &AppState, name: &str) {
    let (_ks_dir, ks) = temp_file_keystore();
    let clock = FixedClock;
    let lock = state.lock.lock().unwrap();
    let pool = lock.pool.as_ref().expect("unlocked");
    PatientService::new(&ks, &clock, &state.data_dir())
        .create(
            pool,
            CreatePatientRequest {
                name: name.to_string(),
                sex: Some("F".to_string()),
                age_years: Some(40),
                ..Default::default()
            },
        )
        .expect("create patient");
}

fn names_in(pool: &Pool) -> Vec<String> {
    pool.with_reader(|c| {
        let mut st = c.prepare("SELECT name FROM patient ORDER BY name")?;
        let v = st
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(v)
    })
    .expect("list patients")
}

fn session_names(state: &AppState) -> Vec<String> {
    let lock = state.lock.lock().unwrap();
    names_in(lock.pool.as_ref().expect("unlocked"))
}

/// Names in the DB file at `db`, opened fresh with the install PIN's DEK
/// re-derived from the keystore next to it (a relaunch).
fn names_on_disk(data_dir: &Path) -> Vec<String> {
    let ks = FileKeystore::open(data_dir).expect("keystore at data dir");
    let dek = KeyHierarchy::new(&ks)
        .unlock_with_pin(PIN)
        .expect("PIN unlocks");
    let pool = Pool::open(&data_dir.join("clinic.db"), &dek).expect("open fresh");
    names_in(&pool)
}

fn data_dir_audits(pool: &Pool) -> i64 {
    pool.with_reader(|c| {
        Ok(c.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE entity = 'app_setting' AND entity_id = 'data_dir'",
            [],
            |r| r.get(0),
        )?)
    })
    .expect("count audit rows")
}

fn moved_out_dirs(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .expect("read dir")
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("moved-out-"))
        })
        .collect()
}

fn write_file(path: &Path, bytes: &[u8]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

// ---------------------------------------------------------------------------
// move_data_folder_in_state
// ---------------------------------------------------------------------------

/// SET-006 bug caught: after "move" the app keeps writing to the OLD folder
/// (data loss on next launch), the pointer is not written, the old data is
/// deleted instead of kept, logs are moved, or no audit row records the move.
#[test]
fn set006_move_switches_the_running_app_to_the_verified_copy_and_keeps_a_safety_copy() {
    let home = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let state = unlocked_state(home.path());
    write_file(&home.path().join("logs/app.log"), b"log line");
    add_patient(&state, "Asha Alpha");
    let target = parent.path().join("HomeoClinic");

    let clock = FixedClock;
    let resp = move_data_folder_in_state(&state, &clock, parent.path().to_str().unwrap())
        .expect("move succeeds");

    assert_eq!(PathBuf::from(&resp.data_folder), target);
    assert_eq!(
        state.data_dir(),
        target,
        "the running app uses the new folder"
    );
    assert!(target.join("clinic.db").is_file());
    assert!(
        target.join("licence").is_dir(),
        "keystore moved with the data"
    );
    assert_eq!(
        resolve_data_dir(home.path()),
        DataDirResolution::Custom(target.clone()),
        "pointer written in the fixed home"
    );
    {
        let lock = state.lock.lock().unwrap();
        assert!(!lock.locked, "no relaunch / relock needed");
        assert!(lock.pool.is_some() && lock.key.is_some());
        assert_eq!(
            data_dir_audits(lock.pool.as_ref().unwrap()),
            1,
            "one audit row"
        );
    }
    assert_eq!(session_names(&state), vec!["Asha Alpha".to_string()]);

    // Safety copy: the old data is kept, logs stay in the home.
    let safety = PathBuf::from(&resp.safety_copy_folder);
    assert_eq!(moved_out_dirs(home.path()), vec![safety.clone()]);
    assert!(
        safety.join("clinic.db").is_file(),
        "old DB kept as a safety copy"
    );
    assert!(!home.path().join("clinic.db").exists(), "old DB retired");
    assert!(
        home.path().join("logs/app.log").is_file(),
        "logs never move"
    );

    // A write after the move lands in the NEW folder (survives a relaunch).
    add_patient(&state, "Bina Beta");
    drop(state);
    assert_eq!(
        names_on_disk(&target),
        vec!["Asha Alpha".to_string(), "Bina Beta".to_string()]
    );
    assert_eq!(names_on_disk(&safety), vec!["Asha Alpha".to_string()]);
}

/// ms-review-1 bug caught: on Linux the default data folder is also the
/// WebKitGTK data folder. A move that copies "everything but a denylist"
/// copies the live webview files (random SHA mismatch) and then renames the
/// webview's localStorage / caches into the safety copy. Only the clinic's
/// own files may move; the webview files stay exactly where they are.
#[test]
fn set006_move_leaves_the_webviews_own_files_in_the_home_and_moves_the_clinic_data() {
    let home = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let state = unlocked_state(home.path());
    add_patient(&state, "Asha Alpha");
    let webview = [
        "CacheStorage/cache-001",
        "WebKitCache/Version 16/blob-001",
        "storage/localstorage/origin-001.sqlite3",
        "mediakeys/key-001",
        "hsts-storage.sqlite",
    ];
    for rel in webview {
        write_file(&home.path().join(rel), b"webview data");
    }
    write_file(
        &home.path().join("files/blob-001.bin"),
        b"synthetic attachment",
    );
    let target = parent.path().join("HomeoClinic");

    let clock = FixedClock;
    let resp = move_data_folder_in_state(&state, &clock, parent.path().to_str().unwrap())
        .expect("move succeeds");

    let safety = PathBuf::from(&resp.safety_copy_folder);
    for rel in webview {
        assert_eq!(
            std::fs::read(home.path().join(rel)).ok().as_deref(),
            Some(&b"webview data"[..]),
            "{rel} stays in the home, untouched"
        );
        assert!(!target.join(rel).exists(), "{rel} not copied");
        assert!(!safety.join(rel).exists(), "{rel} not retired");
    }
    assert!(target.join("clinic.db").is_file());
    assert!(target.join("licence").is_dir());
    assert_eq!(
        std::fs::read(target.join("files/blob-001.bin"))
            .ok()
            .as_deref(),
        Some(&b"synthetic attachment"[..]),
        "attachments move with the data"
    );
    assert_eq!(session_names(&state), vec!["Asha Alpha".to_string()]);
}

/// ADR 0020 bug caught: after a move, lock + PIN unlock reopens the OLD folder
/// (or fails), so the doctor sees yesterday's data.
#[test]
fn set006_after_a_move_lock_and_pin_unlock_open_the_new_folder() {
    let home = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let state = unlocked_state(home.path());
    add_patient(&state, "Asha Alpha");
    let clock = FixedClock;
    move_data_folder_in_state(&state, &clock, parent.path().to_str().unwrap())
        .expect("move succeeds");
    {
        let mut lock = state.lock.lock().unwrap();
        lock.locked = true;
        lock.pool = None;
        lock.key = None;
    }

    unlock_in_state(&state, PIN).expect("PIN unlock after move");

    assert_eq!(session_names(&state), vec!["Asha Alpha".to_string()]);
    add_patient(&state, "Chitra Gamma");
    drop(state);
    assert_eq!(
        names_on_disk(&parent.path().join("HomeoClinic")),
        vec!["Asha Alpha".to_string(), "Chitra Gamma".to_string()]
    );
}

/// Bug caught: an unusable folder is accepted, or a refused move closes the
/// working DB (the doctor is stranded mid-clinic).
#[test]
fn set006_move_to_an_invalid_folder_is_refused_and_the_app_keeps_working() {
    let home = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    write_file(
        &parent.path().join("HomeoClinic/other.txt"),
        b"someone else's data",
    );
    let state = unlocked_state(home.path());
    add_patient(&state, "Asha Alpha");

    let clock = FixedClock;
    let r = move_data_folder_in_state(&state, &clock, parent.path().to_str().unwrap());

    assert!(matches!(r, Err(AppError::DataFolderInvalid)), "got {r:?}");
    assert_eq!(state.data_dir(), home.path());
    assert!(!home.path().join(LOCATION_FILE).exists(), "no pointer");
    assert!(moved_out_dirs(home.path()).is_empty(), "nothing retired");
    assert_eq!(session_names(&state), vec!["Asha Alpha".to_string()]);
    add_patient(&state, "Bina Beta");
    assert_eq!(session_names(&state).len(), 2, "writes still work");
}

/// Bug caught: a copy failure (unreadable file, full disk) leaves the app on a
/// half-copied folder, writes the pointer, or closes the DB.
#[cfg(unix)]
#[test]
fn set006_move_copy_failure_leaves_the_old_folder_in_use() {
    use std::os::unix::fs::PermissionsExt;
    let home = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let state = unlocked_state(home.path());
    add_patient(&state, "Asha Alpha");
    let unreadable = home.path().join("files/blob-001.bin");
    write_file(&unreadable, b"synthetic attachment");
    std::fs::set_permissions(&unreadable, std::fs::Permissions::from_mode(0o000)).unwrap();

    let clock = FixedClock;
    let r = move_data_folder_in_state(&state, &clock, parent.path().to_str().unwrap());
    std::fs::set_permissions(&unreadable, std::fs::Permissions::from_mode(0o644)).unwrap();

    assert!(
        matches!(r, Err(AppError::DataFolderMoveFailed)),
        "got {r:?}"
    );
    assert_eq!(state.data_dir(), home.path(), "old folder still in use");
    assert!(
        !home.path().join(LOCATION_FILE).exists(),
        "no pointer written"
    );
    assert!(
        !parent.path().join("HomeoClinic").exists(),
        "no half copy left"
    );
    assert!(moved_out_dirs(home.path()).is_empty());
    {
        let lock = state.lock.lock().unwrap();
        assert!(
            !lock.locked && lock.pool.is_some(),
            "DB reopened, still unlocked"
        );
    }
    add_patient(&state, "Bina Beta");
    drop(state);
    assert_eq!(
        names_on_disk(home.path()).len(),
        2,
        "writes land in the old folder"
    );
}

/// Bug caught: a move can be started while locked (no key to verify the copy).
#[test]
fn set006_move_while_locked_is_refused_and_touches_nothing() {
    let home = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    provision(home.path());
    let state = AppState::with_file_keystore(home.path().to_path_buf()).unwrap();

    let clock = FixedClock;
    let r = move_data_folder_in_state(&state, &clock, parent.path().to_str().unwrap());

    assert!(matches!(r, Err(AppError::NotFound)), "got {r:?}");
    assert_eq!(std::fs::read_dir(parent.path()).unwrap().count(), 0);
    assert!(home.path().join("clinic.db").is_file());
}

// ---------------------------------------------------------------------------
// Pointer resolution + boot
// ---------------------------------------------------------------------------

/// Bug caught: the pointer is ignored (app opens an empty default folder and
/// runs the setup wizard over a moved install), or a missing drive is treated
/// as "no pointer" (silently starts fresh).
#[test]
fn set006_resolve_data_dir_reads_default_custom_and_missing() {
    let home = tempfile::tempdir().unwrap();
    let custom = tempfile::tempdir().unwrap();
    assert_eq!(
        resolve_data_dir(home.path()),
        DataDirResolution::Default(home.path().to_path_buf())
    );

    write_location(home.path(), custom.path()).expect("write pointer");
    assert!(home.path().join(LOCATION_FILE).is_file());
    assert_eq!(
        resolve_data_dir(home.path()),
        DataDirResolution::Custom(custom.path().to_path_buf())
    );

    let gone = custom.path().join("unplugged/HomeoClinic");
    write_location(home.path(), &gone).expect("write pointer");
    assert_eq!(
        resolve_data_dir(home.path()),
        DataDirResolution::Missing(gone)
    );

    write_location(home.path(), home.path()).expect("point home");
    assert!(
        !home.path().join(LOCATION_FILE).exists(),
        "home removes the pointer"
    );
    assert_eq!(
        resolve_data_dir(home.path()),
        DataDirResolution::Default(home.path().to_path_buf())
    );
}

/// Bug caught: a corrupt pointer with no readable path crashes startup or is
/// trusted; a well-formed pointer (`{"version":1,"dataDir":..}`) is ignored.
#[test]
fn set006_resolve_data_dir_reads_the_pointer_format_and_falls_back_for_garbage() {
    let home = tempfile::tempdir().unwrap();
    let custom = tempfile::tempdir().unwrap();
    let pointer = serde_json::json!({ "version": 1, "dataDir": custom.path() });
    std::fs::write(home.path().join(LOCATION_FILE), pointer.to_string()).unwrap();
    assert_eq!(
        resolve_data_dir(home.path()),
        DataDirResolution::Custom(custom.path().to_path_buf()),
        "the documented pointer format is read"
    );

    std::fs::write(home.path().join(LOCATION_FILE), b"not json at all").unwrap();
    assert_eq!(
        resolve_data_dir(home.path()),
        DataDirResolution::Default(home.path().to_path_buf())
    );
}

/// Bug caught: on relaunch the app opens the home folder instead of the moved
/// data.
#[test]
fn set006_with_file_keystore_opens_the_pointed_folder() {
    let home = tempfile::tempdir().unwrap();
    let custom = tempfile::tempdir().unwrap();
    write_location(home.path(), custom.path()).expect("write pointer");
    let state = AppState::with_file_keystore(home.path().to_path_buf()).expect("state");
    assert_eq!(state.data_dir(), custom.path());
    assert_eq!(state.home_dir, home.path());
    assert!(state.data_folder_missing.lock().unwrap().is_none());
}

/// A5 bug caught: with the USB drive unplugged the app creates an empty folder
/// at the missing path (or in home) and starts a fresh install over it.
#[test]
fn set006_with_file_keystore_flags_a_missing_folder_and_creates_nothing_there() {
    let home = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let gone = elsewhere.path().join("usb/HomeoClinic");
    write_location(home.path(), &gone).expect("write pointer");

    let state = AppState::with_file_keystore(home.path().to_path_buf()).expect("state");

    assert_eq!(
        state.data_folder_missing.lock().unwrap().as_deref(),
        Some(gone.as_path())
    );
    assert!(!gone.exists(), "nothing created at the missing path");
}

/// Bug caught: "Try again" after re-plugging the drive does not switch to it.
#[test]
fn set006_recheck_switches_to_the_folder_once_it_is_back() {
    let home = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let gone = elsewhere.path().join("usb/HomeoClinic");
    write_location(home.path(), &gone).expect("write pointer");
    let state = AppState::with_file_keystore(home.path().to_path_buf()).expect("state");

    let still = recheck_in_state(&state).expect("recheck");
    assert!(!still.available);
    assert_eq!(still.data_folder, gone.display().to_string());

    std::fs::create_dir_all(&gone).unwrap();
    let back = recheck_in_state(&state).expect("recheck");
    assert!(back.available);
    assert_eq!(state.data_dir(), gone);
    assert!(state.data_folder_missing.lock().unwrap().is_none());
}

/// Bug caught: "Use the default folder" keeps the dead pointer (the screen
/// comes back on every launch).
#[test]
fn set006_forget_returns_to_the_default_folder() {
    let home = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let gone = elsewhere.path().join("usb/HomeoClinic");
    write_location(home.path(), &gone).expect("write pointer");
    let state = AppState::with_file_keystore(home.path().to_path_buf()).expect("state");
    assert_eq!(
        resolve_data_dir(home.path()),
        DataDirResolution::Missing(gone.clone()),
        "precondition: the pointer names the missing folder"
    );

    forget_in_state(&state).expect("forget");

    assert_eq!(
        resolve_data_dir(home.path()),
        DataDirResolution::Default(home.path().to_path_buf())
    );
    assert!(state.data_folder_missing.lock().unwrap().is_none());
    assert_eq!(state.data_dir(), home.path());
}

// ---------------------------------------------------------------------------
// F5: auto-lock restored on unlock
// ---------------------------------------------------------------------------

/// F5 regression: the doctor sets auto-lock to 30 minutes, relaunches, and the
/// app locks after 15 because unlock never reads the saved value.
#[test]
fn set004_unlock_restores_the_persisted_autolock_minutes() {
    let home = tempfile::tempdir().unwrap();
    let dek = provision(home.path());
    {
        let pool = Pool::open(&home.path().join("clinic.db"), &dek).unwrap();
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            put_setting(&tx, "autolock_minutes", "30", NOW)?;
            tx.commit()?;
            Ok(())
        })
        .unwrap();
    }
    let state = AppState::with_file_keystore(home.path().to_path_buf()).unwrap();

    unlock_in_state(&state, PIN).expect("unlock");

    let lock = state.lock.lock().unwrap();
    assert!(!lock.locked && lock.pool.is_some() && lock.key.is_some());
    assert_eq!(lock.autolock_minutes, 30);
}

/// F5: an install that never stored the key unlocks with the 15-minute default.
#[test]
fn set004_unlock_uses_15_minutes_when_autolock_was_never_saved() {
    let home = tempfile::tempdir().unwrap();
    provision(home.path());
    let state = AppState::with_file_keystore(home.path().to_path_buf()).unwrap();
    state.lock.lock().unwrap().autolock_minutes = 99;

    unlock_in_state(&state, PIN).expect("unlock");

    assert_eq!(state.lock.lock().unwrap().autolock_minutes, 15);
}

/// SUX-005: a wrong PIN through the state body stays locked with WrongPin.
#[test]
fn sux005_unlock_with_a_wrong_pin_stays_locked() {
    let home = tempfile::tempdir().unwrap();
    provision(home.path());
    let state = AppState::with_file_keystore(home.path().to_path_buf()).unwrap();

    let r = unlock_in_state(&state, "0000");

    assert!(matches!(r, Err(AppError::WrongPin)), "got {r:?}");
    let lock = state.lock.lock().unwrap();
    assert!(lock.locked && lock.pool.is_none() && lock.key.is_none());
}
