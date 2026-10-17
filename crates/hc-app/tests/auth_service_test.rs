//! RED tests for the PIN lock/unlock service (HC-MVP1-027, SET-004, SUX-003,
//! SUX-005). CUT: `hc_app::auth::AuthService` over the real Slice B
//! `KeyHierarchy` + `Pool`.
//!
//! Dependency fakes only (R-TEST-002): the encrypted-file keystore and a
//! `FakeClock`. The DB/key hierarchy are real. The service is driven exactly as
//! the commands will: setup mints the DEK + recovery code, then auth unlocks /
//! recovers. Asserts behaviour (R-TEST-003): a wrong PIN NEVER locks out a
//! later correct attempt (SUX-005). Names carry the req id (R-TEST-008).
//!
//! Red-first: service stubs return sentinels; every assertion fails until
//! `hc-core-dev` implements both services.

use hc_app::auth::AuthService;
use hc_app::clock::Clock;
use hc_app::error::AppError;
use hc_app::setup::{
    SaveClinicProfileRequest, SaveDoctorProfileRequest, SetPinRequest, SetupService,
};
use hc_storage::keystore::FileKeystore;

struct FakeClock;
impl Clock for FakeClock {
    fn now_rfc3339(&self) -> String {
        "2026-01-01T00:00:00Z".to_string()
    }
}

fn valid_doctor() -> SaveDoctorProfileRequest {
    SaveDoctorProfileRequest {
        name: "Test Doctor 001".to_string(),
        qualification: "BHMS".to_string(),
        reg_no: "REG-0001".to_string(),
        reg_council: "Test State Council".to_string(),
        phone: None,
        email: None,
        signature_image_path: None,
        clinic_logo_path: None,
    }
}
fn valid_clinic() -> SaveClinicProfileRequest {
    SaveClinicProfileRequest {
        name: "Test Clinic 001".to_string(),
        address: "1 Test Road".to_string(),
        phone: None,
        timings: None,
        fee_first_paise: 100_000,
        fee_followup_paise: 50_000,
        gstin: None,
    }
}

/// Run the setup flow with `pin`, returning the keystore dir + data dir (kept
/// alive) and the one-time recovery code. The returned keystore is reopened by
/// each test's `AuthService` over the same roots, mirroring an app restart.
fn setup_with_pin(keystore_dir: &std::path::Path, data_dir: &std::path::Path, pin: &str) -> String {
    let keystore = FileKeystore::open(keystore_dir).expect("open file keystore");
    let clock = FakeClock;
    let svc = SetupService::new(&keystore, &clock, data_dir);
    svc.save_doctor_profile(valid_doctor()).expect("doctor");
    svc.save_clinic_profile(valid_clinic()).expect("clinic");
    let (resp, pool) = svc
        .set_pin(SetPinRequest {
            pin: pin.to_string(),
            confirm_pin: pin.to_string(),
            autolock_minutes: 15,
        })
        .expect("set pin");
    svc.start_trial(&pool).expect("trial");
    svc.complete(&pool).expect("complete");
    resp.recovery_code
}

/// SET-004 / SUX-003 (R-TEST-008): the correct PIN unlocks (opens the encrypted
/// DB) in one entry. Asserts a usable Pool is returned (R-TEST-003).
#[test]
fn set027_unlock_accepts_correct_pin() {
    let ks_dir = tempfile::tempdir().expect("ks dir");
    let data_dir = tempfile::tempdir().expect("data dir");
    let _rc = setup_with_pin(ks_dir.path(), data_dir.path(), "1234");

    let keystore = FileKeystore::open(ks_dir.path()).expect("reopen keystore");
    let auth = AuthService::new(&keystore, data_dir.path());

    let pool = auth.unlock("1234").expect("correct PIN must unlock");
    // Prove the pool is really usable: the migrated schema is present.
    let n: i64 = pool
        .with_reader(|c| {
            c.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='doctor_profile'",
                [],
                |r| r.get(0),
            )
            .map_err(hc_storage::StorageError::from)
        })
        .expect("query opened DB");
    assert_eq!(n, 1, "unlocked pool opens the real encrypted DB");
}

/// SUX-005 (R-TEST-008): a wrong PIN is refused with WrongPin and NEVER causes
/// a lockout — a subsequent correct PIN still unlocks. Catches a false-lockout
/// regression or a wrong error code.
#[test]
fn set027_unlock_refuses_wrong_pin_without_lockout() {
    let ks_dir = tempfile::tempdir().expect("ks dir");
    let data_dir = tempfile::tempdir().expect("data dir");
    let _rc = setup_with_pin(ks_dir.path(), data_dir.path(), "1234");

    let keystore = FileKeystore::open(ks_dir.path()).expect("reopen keystore");
    let auth = AuthService::new(&keystore, data_dir.path());

    // Several wrong attempts, each refused with the precise error.
    for _ in 0..6 {
        match auth.unlock("0000") {
            Ok(_) => panic!("wrong PIN must be refused"),
            Err(err) => assert!(
                matches!(err, AppError::WrongPin),
                "wrong PIN maps to WrongPin, got {err:?}"
            ),
        }
    }

    // No lockout (SUX-005): the correct PIN still works after many failures.
    auth.unlock("1234")
        .expect("correct PIN still unlocks after wrong attempts (no lockout)");
}

/// SET-004 (R-TEST-008): forgot-PIN recovery resets the PIN. After recover, the
/// NEW pin unlocks and the OLD pin no longer does.
#[test]
fn set027_recover_with_code_resets_pin() {
    let ks_dir = tempfile::tempdir().expect("ks dir");
    let data_dir = tempfile::tempdir().expect("data dir");
    let recovery_code = setup_with_pin(ks_dir.path(), data_dir.path(), "1234");

    let keystore = FileKeystore::open(ks_dir.path()).expect("reopen keystore");
    let auth = AuthService::new(&keystore, data_dir.path());

    auth.recover(&recovery_code, "5678", "5678")
        .expect("recovery code resets the PIN");

    auth.unlock("5678").expect("new PIN unlocks after recovery");
    match auth.unlock("1234") {
        Ok(_) => panic!("old PIN must no longer unlock after a reset"),
        Err(old) => assert!(
            matches!(old, AppError::WrongPin),
            "old PIN now refused, got {old:?}"
        ),
    }
}

/// SET-004 (R-TEST-008): a wrong recovery code is refused with
/// WrongRecoveryCode (distinct from WrongPin so the UI message is precise).
#[test]
fn set027_recover_rejects_wrong_code() {
    let ks_dir = tempfile::tempdir().expect("ks dir");
    let data_dir = tempfile::tempdir().expect("data dir");
    let _rc = setup_with_pin(ks_dir.path(), data_dir.path(), "1234");

    let keystore = FileKeystore::open(ks_dir.path()).expect("reopen keystore");
    let auth = AuthService::new(&keystore, data_dir.path());

    let err = auth
        .recover("0000ffff-0000ffff-0000ffff-0000ffff", "5678", "5678")
        .expect_err("a wrong recovery code must be refused");
    assert!(
        matches!(err, AppError::WrongRecoveryCode),
        "wrong recovery code maps to WrongRecoveryCode, got {err:?}"
    );
}
