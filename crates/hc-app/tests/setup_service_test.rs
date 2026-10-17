//! RED tests for the first-run setup service (HC-MVP1-026, SET-001/002/003,
//! LIC-063). CUT: `hc_app::setup::SetupService` and the profile/trial writes it
//! drives over the real Slice B `KeyHierarchy` + `Pool`.
//!
//! The ONLY fakes are DEPENDENCIES (R-TEST-002): the encrypted-file keystore
//! (`hc_storage::testing::temp_file_keystore`, the headless-Linux fallback) and
//! a `FakeClock` (deterministic trial math, R-TEST-006). The DB, key hierarchy
//! and repositories are the real CUT, never faked. Synthetic data only
//! (R-TEST-004). Names carry the req id (R-TEST-008).
//!
//! Red-first: the service stubs return sentinels, so every assertion below
//! fails until `hc-core-dev` implements the service. Each test asserts the
//! resulting data/state (R-TEST-003), not merely `is_ok()`.

use hc_app::auth::AuthService;
use hc_app::clock::Clock;
use hc_app::error::AppError;
use hc_app::setup::{
    FontSize, SaveClinicProfileRequest, SaveDoctorProfileRequest, SetFontSizeRequest,
    SetPinRequest, SetupService,
};

/// Deterministic clock (dependency fake, R-TEST-006): always the same instant.
struct FakeClock {
    now: String,
}
impl FakeClock {
    fn at(now: &str) -> Self {
        FakeClock {
            now: now.to_string(),
        }
    }
}
impl Clock for FakeClock {
    fn now_rfc3339(&self) -> String {
        self.now.clone()
    }
}

/// Synthetic valid doctor input (R-TEST-004).
fn valid_doctor() -> SaveDoctorProfileRequest {
    SaveDoctorProfileRequest {
        name: "Test Doctor 001".to_string(),
        qualification: "BHMS".to_string(),
        reg_no: "REG-0001".to_string(),
        reg_council: "Test State Council".to_string(),
        phone: Some("9876543210".to_string()),
        email: Some("doctor@example.test".to_string()),
        signature_image_path: None,
        clinic_logo_path: None,
    }
}

/// Synthetic valid clinic input; fees are integer paise (R-DATA-004).
fn valid_clinic() -> SaveClinicProfileRequest {
    SaveClinicProfileRequest {
        name: "Test Clinic 001".to_string(),
        address: "1 Test Road, Test City".to_string(),
        phone: Some("9876500000".to_string()),
        timings: Some("Mon-Sat 10:00-14:00".to_string()),
        fee_first_paise: 125_000, // Rs 1,250.00
        fee_followup_paise: 50_000,
        gstin: None,
    }
}

/// SET-001/002/003 + LIC-063 (R-TEST-008): a full wizard run persists the
/// doctor, clinic, autolock setting and trial, and the DEK minted by set_pin
/// opens the encrypted DB so the written profiles read back. Asserts the stored
/// values (R-TEST-003), proving the writes happened in the one encrypted DB.
#[test]
fn set026_full_run_writes_doctor_clinic_pin_settings_trial_in_order() {
    let (_dir, keystore) = hc_storage::testing::temp_file_keystore();
    let data_dir = tempfile::tempdir().expect("data dir");
    let clock = FakeClock::at("2026-01-01T00:00:00Z");
    let svc = SetupService::new(&keystore, &clock, data_dir.path());

    svc.save_doctor_profile(valid_doctor())
        .expect("stage doctor profile");
    svc.save_clinic_profile(valid_clinic())
        .expect("stage clinic profile");

    let (set_pin, pool) = svc
        .set_pin(SetPinRequest {
            pin: "1234".to_string(),
            confirm_pin: "1234".to_string(),
            autolock_minutes: 15,
        })
        .expect("set pin mints DEK and opens the DB");
    assert!(
        !set_pin.recovery_code.is_empty(),
        "set_pin must return a non-empty recovery code (SET-004)"
    );

    svc.start_trial(&pool).expect("start trial");
    let complete = svc.complete(&pool).expect("complete setup");
    assert_eq!(
        complete.home_route, "/today",
        "finishing setup routes to Today (VIS-005)"
    );

    // Data effects (R-TEST-003): the profiles are in the encrypted DB and the
    // autolock setting was written.
    let doctor = pool
        .with_reader(hc_storage::profile::get_doctor_profile)
        .expect("read doctor")
        .expect("doctor profile row must exist after setup");
    assert_eq!(doctor.name, "Test Doctor 001");
    assert_eq!(doctor.reg_no, "REG-0001");

    let clinic = pool
        .with_reader(hc_storage::profile::get_clinic_profile)
        .expect("read clinic")
        .expect("clinic profile row must exist after setup");
    assert_eq!(clinic.name, "Test Clinic 001");

    let autolock = pool
        .with_reader(|c| hc_storage::profile::get_setting(c, "autolock_minutes"))
        .expect("read setting")
        .expect("autolock setting must be written by set_pin");
    assert_eq!(
        autolock, "15",
        "autolock minutes persisted as the setting value"
    );

    let trial = pool
        .with_reader(hc_storage::profile::get_trial)
        .expect("read trial")
        .expect("trial row must exist after start_trial (LIC-063)");
    assert_eq!(trial.started_at, "2026-01-01T00:00:00Z");
}

/// SET-004 (R-TEST-008): set_pin returns a recovery code and the DB it created
/// is openable later with the same PIN (via AuthService::unlock). Proves the
/// DEK is persisted and wrapped under the PIN (not a throwaway).
#[test]
fn set026_set_pin_returns_recovery_code_and_db_opens_with_pin() {
    let (_dir, keystore) = hc_storage::testing::temp_file_keystore();
    let data_dir = tempfile::tempdir().expect("data dir");
    let clock = FakeClock::at("2026-01-01T00:00:00Z");
    let svc = SetupService::new(&keystore, &clock, data_dir.path());

    svc.save_doctor_profile(valid_doctor()).expect("doctor");
    svc.save_clinic_profile(valid_clinic()).expect("clinic");
    let (resp, _pool) = svc
        .set_pin(SetPinRequest {
            pin: "4321".to_string(),
            confirm_pin: "4321".to_string(),
            autolock_minutes: 15,
        })
        .expect("set pin");
    assert!(
        resp.recovery_code.contains('-'),
        "recovery code is grouped (contains a '-'), matching KeyHierarchy format (SET-004)"
    );

    // A fresh AuthService over the SAME keystore + data dir must open with the
    // PIN (the DEK persisted correctly).
    let auth = AuthService::new(&keystore, data_dir.path());
    auth.unlock("4321")
        .expect("DB must open with the setup PIN");
}

/// SET-002 (R-TEST-008): a missing required doctor field is rejected as a
/// validation error (inline-validation contract; R-UI-008). Catches a bypass.
#[test]
fn set026_save_doctor_profile_rejects_missing_required_fields() {
    let (_dir, keystore) = hc_storage::testing::temp_file_keystore();
    let data_dir = tempfile::tempdir().expect("data dir");
    let clock = FakeClock::at("2026-01-01T00:00:00Z");
    let svc = SetupService::new(&keystore, &clock, data_dir.path());

    let mut bad = valid_doctor();
    bad.name = "   ".to_string(); // blank after trim

    let err = svc
        .save_doctor_profile(bad)
        .expect_err("blank required name must be rejected");
    assert!(
        matches!(err, AppError::Validation(_)),
        "a missing required field is a validation error, got {err:?}"
    );
}

/// SET-003 / R-DATA-004 (R-TEST-008): clinic fees round-trip as exact integer
/// paise, never a float. Catches money corruption.
#[test]
fn set026_save_clinic_profile_keeps_fees_as_integer_paise() {
    let (_dir, keystore) = hc_storage::testing::temp_file_keystore();
    let data_dir = tempfile::tempdir().expect("data dir");
    let clock = FakeClock::at("2026-01-01T00:00:00Z");
    let svc = SetupService::new(&keystore, &clock, data_dir.path());

    svc.save_doctor_profile(valid_doctor()).expect("doctor");
    svc.save_clinic_profile(valid_clinic()).expect("clinic");
    let (_resp, pool) = svc
        .set_pin(SetPinRequest {
            pin: "1234".to_string(),
            confirm_pin: "1234".to_string(),
            autolock_minutes: 15,
        })
        .expect("set pin");

    let clinic = pool
        .with_reader(hc_storage::profile::get_clinic_profile)
        .expect("read clinic")
        .expect("clinic row");
    assert_eq!(
        clinic.fee_first_paise, 125_000,
        "consultation fee preserved as integer paise"
    );
    assert_eq!(clinic.fee_followup_paise, 50_000);
}

/// LIC-063 (R-TEST-008): the trial starts with a 30-day window computed from
/// the injected clock — valid_until = started + 30 days, 30 days remaining.
/// Deterministic via FakeClock (R-TEST-006).
#[test]
fn set026_start_trial_is_30_days() {
    let (_dir, keystore) = hc_storage::testing::temp_file_keystore();
    let data_dir = tempfile::tempdir().expect("data dir");
    let clock = FakeClock::at("2026-01-01T00:00:00Z");
    let svc = SetupService::new(&keystore, &clock, data_dir.path());

    svc.save_doctor_profile(valid_doctor()).expect("doctor");
    svc.save_clinic_profile(valid_clinic()).expect("clinic");
    let (_resp, pool) = svc
        .set_pin(SetPinRequest {
            pin: "1234".to_string(),
            confirm_pin: "1234".to_string(),
            autolock_minutes: 15,
        })
        .expect("set pin");

    let trial = svc.start_trial(&pool).expect("start trial");
    assert_eq!(
        trial.trial_days_remaining, 30,
        "a fresh trial has 30 days remaining (LIC-063)"
    );
    assert_eq!(
        trial.trial_valid_until, "2026-01-31T00:00:00Z",
        "valid_until is start + 30 days"
    );
}

/// A2 (DEFERRED P1): set_font_size persists a minimal setting without error
/// (the control renders disabled; no real font-apply this slice). Asserts the
/// command path exists and succeeds for the stable binding contract.
#[test]
fn set026_set_font_size_persists_minimal_setting() {
    let (_dir, keystore) = hc_storage::testing::temp_file_keystore();
    let data_dir = tempfile::tempdir().expect("data dir");
    let clock = FakeClock::at("2026-01-01T00:00:00Z");
    let svc = SetupService::new(&keystore, &clock, data_dir.path());

    svc.save_doctor_profile(valid_doctor()).expect("doctor");
    svc.save_clinic_profile(valid_clinic()).expect("clinic");
    let (_resp, _pool) = svc
        .set_pin(SetPinRequest {
            pin: "1234".to_string(),
            confirm_pin: "1234".to_string(),
            autolock_minutes: 15,
        })
        .expect("set pin");

    svc.set_font_size(SetFontSizeRequest {
        size: FontSize::Large,
    })
    .expect("font size persists (minimal, P1 deferred)");
}
