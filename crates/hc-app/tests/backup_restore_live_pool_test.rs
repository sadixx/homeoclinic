//! b23-n1-d2: restore must switch the RUNNING session onto the restored DB
//! (BAK-003, NFR-011, R-DATA-002).
//!
//! Real bug (restore E2E, b23-n1): `restore_apply` moved the live `clinic.db`
//! aside to `pre-restore-*/` and put the restored file in its place, but the
//! open pool in `AppState.lock.pool` kept its connections on the MOVED file.
//! Same-session reads showed the old data (the restore "did nothing" until a
//! restart) and writes made after the restore landed in the pre-restore copy,
//! not in the live `clinic.db`: silent data loss on the next launch.
//!
//! CUT: `hc_app::backup::restore_apply_in_state` (the body of the
//! `restore_apply` command) over a REAL `AppState`: real file keystore with a
//! real wrapped DEK (`KeyHierarchy::initialize`), real encrypted pool,
//! migrations, the real `PatientService` and the real storage backup engine.
//! The only fake is the deterministic storage clock (R-TEST-006). Synthetic
//! data only (R-TEST-004). Names carry the defect / req id (R-TEST-008). Each
//! test asserts resulting data (R-TEST-003).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use hc_app::backup::{restore_apply_in_state, BackupService};
use hc_app::error::{map_error, AppError, ErrorCode};
use hc_app::patient::{
    CreatePatientRequest, ListQueryRequest, PatientFilter, PatientService, PatientSort, SortDir,
    SortField,
};
use hc_app::state::AppState;
use hc_storage::key::{DekKeyProvider, KeyHierarchy};
use hc_storage::keystore::FileKeystore;
use hc_storage::testing::{fake_clock, TEST_BACKUP_PASSWORD};
use hc_storage::Pool;

const TEST_PIN: &str = "2468";

/// A real, unlocked `AppState` over `data_dir`: file keystore with a REAL DEK,
/// encrypted + migrated `clinic.db`, pool and key stashed exactly as
/// `auth_unlock` does.
fn unlocked_state(data_dir: &Path) -> AppState {
    let state = AppState::with_file_keystore(data_dir.to_path_buf()).expect("file keystore");
    let (_recovery, dek) = KeyHierarchy::new(state.keystore.as_ref())
        .initialize(TEST_PIN)
        .expect("mint DEK");
    let pool = Pool::open(&data_dir.join("clinic.db"), &dek).expect("open encrypted DB");
    hc_storage::migrate::run(&pool).expect("migrate");
    {
        let mut lock = state.lock.lock().unwrap();
        lock.locked = false;
        lock.pool = Some(pool);
        lock.key = Some(Arc::new(dek));
    }
    state
}

/// Re-derive the install DEK from the on-disk keystore (a fresh launch).
fn dek_from_disk(data_dir: &Path) -> DekKeyProvider {
    let ks = FileKeystore::open(data_dir).expect("reopen keystore");
    KeyHierarchy::new(&ks)
        .unlock_with_pin(TEST_PIN)
        .expect("unlock with PIN")
}

fn patient(name: &str) -> CreatePatientRequest {
    CreatePatientRequest {
        name: name.to_string(),
        sex: Some("F".to_string()),
        age_years: Some(40),
        ..Default::default()
    }
}

/// Register one patient through the real use case on the state's CURRENT pool.
fn add_patient(state: &AppState, name: &str) {
    let lock = state.lock.lock().unwrap();
    let pool = lock.pool.as_ref().expect("app is unlocked");
    PatientService::new(
        state.keystore.as_ref(),
        state.clock.as_ref(),
        &state.data_dir,
    )
    .create(pool, patient(name))
    .expect("create patient");
}

/// Sorted patient names from `pool` via the real list use case.
fn names_in(state: &AppState, pool: &Pool) -> Vec<String> {
    let resp = PatientService::new(
        state.keystore.as_ref(),
        state.clock.as_ref(),
        &state.data_dir,
    )
    .list_query(
        pool,
        ListQueryRequest {
            filters: PatientFilter::default(),
            sort: PatientSort {
                field: SortField::Name,
                dir: SortDir::Asc,
            },
            cursor: None,
            limit: 100,
        },
    )
    .expect("list patients");
    resp.rows.into_iter().map(|r| r.name).collect()
}

/// Sorted patient names seen by the state's CURRENT pool (same session).
fn session_names(state: &AppState) -> Vec<String> {
    let lock = state.lock.lock().unwrap();
    let pool = lock.pool.as_ref().expect("app is unlocked");
    names_in(state, pool)
}

/// Sorted patient names in the DB file at `db`, opened fresh from disk.
fn names_on_disk(state_for_svc: &AppState, db: &Path, dek: &DekKeyProvider) -> Vec<String> {
    let pool = Pool::open(db, dek).expect("open DB fresh from disk");
    names_in(state_for_svc, &pool)
}

/// Back up the state's current pool to `out` and return the archive path.
fn backup(state: &AppState, out: &Path) -> String {
    let lock = state.lock.lock().unwrap();
    let pool = lock.pool.as_ref().expect("app is unlocked");
    let clock = fake_clock();
    BackupService::new(pool, &state.data_dir, &clock)
        .backup_now(out.to_str().unwrap(), TEST_BACKUP_PASSWORD)
        .expect("backup_now")
        .file_path
}

/// `pre-restore-*` safety dirs under `data_dir`.
fn pre_restore_dirs(data_dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(data_dir)
        .expect("read data dir")
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("pre-restore-"))
        })
        .collect()
}

/// b23-n1-d2 / BAK-003: after a restore, the SAME session reads the restored
/// data (A only, not A+B and not empty), the app stays unlocked, and a write
/// made after the restore (C) lands in the LIVE `clinic.db` that a fresh launch
/// opens, NOT in the pre-restore safety copy.
#[test]
fn b23n1d2_restore_switches_session_to_restored_db_and_later_writes_survive_relaunch() {
    let data = tempfile::tempdir().expect("data dir");
    let out = tempfile::tempdir().expect("backup out dir");
    let state = unlocked_state(data.path());

    add_patient(&state, "Asha Alpha");
    let archive = backup(&state, out.path());
    add_patient(&state, "Bina Beta");
    assert_eq!(
        session_names(&state),
        vec!["Asha Alpha".to_string(), "Bina Beta".to_string()],
        "precondition: A and B are live before the restore"
    );

    let clock = fake_clock();
    let resp = restore_apply_in_state(&state, &clock, &archive, TEST_BACKUP_PASSWORD)
        .expect("restore_apply succeeds");
    assert!(resp.ok, "restore reports ok");

    {
        let lock = state.lock.lock().unwrap();
        assert!(!lock.locked, "a successful restore keeps the app unlocked");
        assert!(
            lock.pool.is_some(),
            "a successful restore leaves an open pool"
        );
        assert!(lock.key.is_some(), "the retained DEK is kept");
    }
    assert_eq!(
        session_names(&state),
        vec!["Asha Alpha".to_string()],
        "same session must show the RESTORED data (A only), not the moved DB (A+B)"
    );

    // Write after restore, then simulate a relaunch from disk.
    add_patient(&state, "Chitra Gamma");
    assert_eq!(
        session_names(&state),
        vec!["Asha Alpha".to_string(), "Chitra Gamma".to_string()],
        "the post-restore write is visible in the same session"
    );
    let safety = PathBuf::from(&resp.pre_restore_backup_path);

    // Fresh launch: drop the whole session (closes the pool), reopen from disk.
    let probe = AppState::with_file_keystore(data.path().to_path_buf()).expect("probe state");
    drop(state);
    let dek = dek_from_disk(data.path());

    assert_eq!(
        names_on_disk(&probe, &data.path().join("clinic.db"), &dek),
        vec!["Asha Alpha".to_string(), "Chitra Gamma".to_string()],
        "the live clinic.db holds the restored data PLUS the post-restore write C"
    );
    let moved = names_on_disk(&probe, &safety.join("clinic.db"), &dek);
    assert!(
        !moved.iter().any(|n| n == "Chitra Gamma"),
        "the post-restore write must NOT land in the pre-restore copy, got {moved:?}"
    );
    assert_eq!(
        moved,
        vec!["Asha Alpha".to_string(), "Bina Beta".to_string()],
        "the pre-restore copy keeps the pre-restore data (A+B) intact"
    );
}

/// b23-n1-d2 / BAK-003 AC4: a wrong backup password is refused BEFORE anything
/// live changes: typed WrongBackupPassword, no safety copy, the app stays
/// unlocked on the SAME working pool, and a later write survives a relaunch.
#[test]
fn b23n1d2_wrong_password_restore_leaves_old_pool_working() {
    let data = tempfile::tempdir().expect("data dir");
    let out = tempfile::tempdir().expect("backup out dir");
    let state = unlocked_state(data.path());

    add_patient(&state, "Asha Alpha");
    let archive = backup(&state, out.path());
    add_patient(&state, "Bina Beta");

    let clock = fake_clock();
    let err = restore_apply_in_state(&state, &clock, &archive, "wrong-password-xx")
        .expect_err("a wrong password must be refused");
    assert!(
        matches!(err, AppError::WrongBackupPassword),
        "wrong password maps to WrongBackupPassword, got {err:?}"
    );
    assert!(
        pre_restore_dirs(data.path()).is_empty(),
        "nothing live is touched on a wrong password (no safety copy)"
    );
    {
        let lock = state.lock.lock().unwrap();
        assert!(!lock.locked, "a wrong password does not lock the app");
        assert!(lock.pool.is_some(), "the old pool is still open");
        assert!(lock.key.is_some(), "the retained DEK is kept");
    }
    assert_eq!(
        session_names(&state),
        vec!["Asha Alpha".to_string(), "Bina Beta".to_string()],
        "the old pool still reads the live data"
    );

    add_patient(&state, "Dev Delta");
    let probe = AppState::with_file_keystore(data.path().to_path_buf()).expect("probe state");
    drop(state);
    let dek = dek_from_disk(data.path());
    assert_eq!(
        names_on_disk(&probe, &data.path().join("clinic.db"), &dek),
        vec![
            "Asha Alpha".to_string(),
            "Bina Beta".to_string(),
            "Dev Delta".to_string()
        ],
        "a write after the refused restore lands in the live clinic.db"
    );
}

/// b23-n1-d2: two restores in one session both take effect on the live pool
/// (the second restore must not operate on a stale handle from the first).
#[test]
fn b23n1d2_second_restore_in_same_session_also_switches_pool() {
    let data = tempfile::tempdir().expect("data dir");
    let out_a = tempfile::tempdir().expect("backup out dir A");
    let out_ab = tempfile::tempdir().expect("backup out dir AB");
    let state = unlocked_state(data.path());

    add_patient(&state, "Asha Alpha");
    let archive_a = backup(&state, out_a.path());
    add_patient(&state, "Bina Beta");
    let archive_ab = backup(&state, out_ab.path());

    // Distinct safety-dir stamps: the fake clock is fixed, so use two clocks.
    let clock1 = hc_storage::clock::FakeClock::at_unix(hc_storage::testing::TEST_EPOCH_UNIX);
    restore_apply_in_state(&state, &clock1, &archive_a, TEST_BACKUP_PASSWORD)
        .expect("first restore");
    assert_eq!(session_names(&state), vec!["Asha Alpha".to_string()]);

    let clock2 = hc_storage::clock::FakeClock::at_unix(hc_storage::testing::TEST_EPOCH_UNIX + 60);
    restore_apply_in_state(&state, &clock2, &archive_ab, TEST_BACKUP_PASSWORD)
        .expect("second restore");
    assert_eq!(
        session_names(&state),
        vec!["Asha Alpha".to_string(), "Bina Beta".to_string()],
        "the second restore also switches the live session"
    );
}

/// b23-n1-d2: if the restored DB cannot be reopened, the app is LOCKED and the
/// UI gets a distinct typed code so it routes to the unlock screen (never a
/// pool left on the moved file, never a raw internal message).
#[test]
fn b23n1d2_reopen_failure_maps_to_typed_restore_reopen_failed_code() {
    let ufe = map_error(&AppError::RestoreReopenFailed);
    assert_eq!(ufe.code, ErrorCode::RestoreReopenFailed);
    assert!(!ufe.message.is_empty() && !ufe.suggested_action.is_empty());
    assert!(
        !ufe.message.contains("clinic.db") && !ufe.message.contains("pre-restore"),
        "no file path leaks to the UI"
    );
}
