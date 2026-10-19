//! RED tests for the licence-status read service (Feature 1 + LIC-005,
//! HC-MVP1-M1a). CUT: `hc_app::licence::LicenceService::get_licence_status`
//! over the REAL setup flow (`SetupService` mints the DEK, opens the DB and
//! starts the trial) and the REAL `hc_storage::licence::ClockGuard`.
//!
//! The ONLY fakes are DEPENDENCIES (R-TEST-002): the encrypted-file keystore
//! and a `FakeClock` (deterministic trial + guard math, R-TEST-006). The DB,
//! key hierarchy, trial repository and clock guard are the real CUT. Synthetic
//! data only (R-TEST-004). Names carry the req id (R-TEST-008).
//!
//! Red-first: `LicenceService::get_licence_status` returns a sentinel
//! (`Unlicensed`, zeroed) and `ClockGuard::observe` echoes system-now, so every
//! assertion below fails until the implementation lands. Each asserts the
//! resulting status (R-TEST-003), not merely `is_ok()`.

use std::cell::Cell;

use hc_app::clock::Clock;
use hc_app::licence::{LicenceKind, LicenceService};
use hc_app::setup::{
    SaveClinicProfileRequest, SaveDoctorProfileRequest, SetPinRequest, SetupService,
};

use hc_storage::key::{DekKeyProvider, KeyHierarchy};
use hc_storage::Pool;

/// A clock whose instant can be reset between calls (a scripted sequence of
/// wall-clock reads), so a test can simulate elapsed days or a backward jump.
/// Dependency fake (R-TEST-006).
struct ScriptedClock {
    now: Cell<String>,
}
impl ScriptedClock {
    fn at(now: &str) -> Self {
        ScriptedClock {
            now: Cell::new(now.to_string()),
        }
    }
    fn set(&self, now: &str) {
        self.now.set(now.to_string());
    }
}
// Only used single-threaded in these tests; Clock requires Send + Sync.
unsafe impl Sync for ScriptedClock {}
impl Clock for ScriptedClock {
    fn now_rfc3339(&self) -> String {
        let v = self.now.take();
        self.now.set(v.clone());
        v
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
        address: "1 Test Road, Test City".to_string(),
        phone: None,
        timings: None,
        fee_first_paise: 125_000,
        fee_followup_paise: 50_000,
        gstin: None,
    }
}

/// Run the real wizard (doctor + clinic + PIN + trial) at `start`, returning the
/// open pool, the install DEK provider (re-derived with the PIN, as the shell
/// does) and the keystore/dir temp handles kept alive for the DB's lifetime.
fn setup_started_trial(
    clock: &ScriptedClock,
    start: &str,
) -> (tempfile::TempDir, tempfile::TempDir, Pool, DekKeyProvider) {
    clock.set(start);
    let (ks_dir, keystore) = hc_storage::testing::temp_file_keystore();
    let data_dir = tempfile::tempdir().expect("data dir");
    let svc = SetupService::new(&keystore, clock, data_dir.path());
    svc.save_doctor_profile(valid_doctor()).expect("doctor");
    svc.save_clinic_profile(valid_clinic()).expect("clinic");
    let (_resp, pool) = svc
        .set_pin(SetPinRequest {
            pin: "1234".to_string(),
            confirm_pin: "1234".to_string(),
            autolock_minutes: 15,
        })
        .expect("set pin");
    svc.start_trial(&pool).expect("start trial");
    let dek = KeyHierarchy::new(&keystore)
        .unlock_with_pin("1234")
        .expect("re-derive DEK");
    (ks_dir, data_dir, pool, dek)
}

/// Feature 1 / LIC-063 (R-TEST-008): right after setup the status reads a Trial
/// with ~30 days remaining and valid_until = start + 30 days, computed against
/// the (effective) clock.
#[test]
fn lic_status_after_setup_is_trial_30_days() {
    let clock = ScriptedClock::at("2026-01-01T00:00:00Z");
    let (_ks, _dir, pool, dek) = setup_started_trial(&clock, "2026-01-01T00:00:00Z");

    let svc = LicenceService::new(&clock, &dek);
    let status = svc.get_licence_status(&pool).expect("read status");

    assert_eq!(
        status.kind,
        LicenceKind::Trial,
        "a fresh install is in Trial"
    );
    assert_eq!(
        status.valid_until, "2026-01-31T00:00:00Z",
        "valid_until is trial start + 30 days (LIC-063)"
    );
    assert!(!status.expired, "a fresh 30-day trial is not expired");
    assert_eq!(
        status.days_remaining, 30,
        "a fresh trial reports 30 days remaining"
    );
}

/// Feature 1 (R-TEST-008): after 10 days elapse, days_remaining drops to ~20,
/// computed from the (forward) effective now.
#[test]
fn lic_status_counts_down_as_time_passes() {
    let clock = ScriptedClock::at("2026-01-01T00:00:00Z");
    let (_ks, _dir, pool, dek) = setup_started_trial(&clock, "2026-01-01T00:00:00Z");

    // 10 days later.
    clock.set("2026-01-11T00:00:00Z");
    let svc = LicenceService::new(&clock, &dek);
    let status = svc.get_licence_status(&pool).expect("read status");

    assert_eq!(status.kind, LicenceKind::Trial);
    assert!(!status.expired, "still 20 days left, not expired");
    assert_eq!(
        status.days_remaining, 20,
        "10 of 30 trial days elapsed -> 20 remaining"
    );
}

/// LIC-005 (R-TEST-008): after advancing 10 days and THEN winding the system
/// clock back 20 days, days_remaining does NOT go back up — the clock guard
/// pins the effective now near the max-seen, so a rollback cannot extend the
/// trial. This is the core anti-tamper assertion.
#[test]
fn lic005_status_does_not_increase_after_backward_clock_jump() {
    let clock = ScriptedClock::at("2026-01-01T00:00:00Z");
    let (_ks, _dir, pool, dek) = setup_started_trial(&clock, "2026-01-01T00:00:00Z");

    let svc = LicenceService::new(&clock, &dek);

    // Let 10 days pass and read once so the guard records max-seen ~ day 10.
    clock.set("2026-01-11T00:00:00Z");
    let before = svc.get_licence_status(&pool).expect("read day 10");
    assert_eq!(before.days_remaining, 20, "sanity: 20 days left at day 10");

    // Attacker winds the clock back 20 days (to before the trial even started).
    clock.set("2025-12-22T00:00:00Z");
    let after = svc.get_licence_status(&pool).expect("read after rollback");

    assert!(
        after.days_remaining <= before.days_remaining,
        "a backward clock jump must NOT increase days_remaining (LIC-005): \
         before={} after={}",
        before.days_remaining,
        after.days_remaining
    );
    assert!(
        after.days_remaining <= 20,
        "days_remaining stays pinned near the max-seen (<= 20), never back near 30"
    );
}
