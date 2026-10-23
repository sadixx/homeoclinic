//! M3-RW Slice A3: the patient read returns a DERIVED age from DOB when present,
//! and falls back to the stored `age_years` when DOB is NULL (ADR 0018 "patient
//! age auto-updates from DOB on read"; no new column).
//!
//! CUT: `hc_app::patient::PatientService::get_dashboard` (the read) over the real
//! migrated `hc_storage` DB. The only fakes are dependencies (R-TEST-002): a
//! `FakeClock` (R-TEST-006), the headless-Linux file keystore seam, and the
//! `seed_patient_demographics` storage seam that stores a genuinely-null DOB so
//! the fallback branch is reachable. Synthetic data only (R-TEST-004).
//!
//! Determinism via the injected clock: the DOB test pins the app clock to Jan
//! 2027 and asserts the exact derived age, so it does not depend on the real
//! wall clock. RED until the read derives age from DOB anchored to the app
//! clock (A2/A3).

use hc_app::clock::Clock;
use hc_app::patient::{GetDashboardRequest, PatientService};

use hc_storage::testing::{seed_patient_demographics, temp_db, temp_file_keystore};

/// Deterministic clock (dependency fake, R-TEST-006).
struct FakeClock {
    now: String,
}
impl Clock for FakeClock {
    fn now_rfc3339(&self) -> String {
        self.now.clone()
    }
}

/// A3: the dashboard age is derived from the DOB AND anchored to the app clock
/// (consuming the pure `hc_domain::age` helper), so the read is deterministic
/// rather than dependent on the real wall clock. DOB 1990-11-20 against the
/// injected `today` 2027-01-10 is exactly 36 (the Nov-2026 birthday has passed).
/// RED while the read uses `OffsetDateTime::now_utc()` and ignores the clock.
#[test]
fn dashboard_age_label_is_derived_from_dob_not_stored() {
    let (_data, pool) = temp_db();
    let (_ks_dir, keystore) = temp_file_keystore();
    let svc_dir = tempfile::tempdir().expect("svc data dir");
    // The app clock is in Jan 2027; the patient's Nov-2026 birthday has passed.
    let clock = FakeClock {
        now: "2027-01-10T09:00:00Z".to_string(),
    };
    let svc = PatientService::new(&keystore, &clock, svc_dir.path());

    // DOB 1990-11-20, stored age deliberately wrong (5).
    let patient_id = seed_patient_demographics(
        &pool,
        "HC-000001",
        "Test Patient A3-dob",
        Some("1990-11-20"),
        Some(5),
    );

    let dash = svc
        .get_dashboard(
            &pool,
            GetDashboardRequest {
                patient_id: patient_id.clone(),
            },
        )
        .expect("get dashboard");

    assert_eq!(
        dash.demographics.age_label, "36y",
        "age is derived from the DOB and anchored to the app clock (A3), \
         not the stored age and not the real wall clock"
    );
}

/// A3: with NO DOB the dashboard age label falls back to the stored `age_years`.
#[test]
fn dashboard_age_label_falls_back_to_stored_age_when_no_dob() {
    let (_data, pool) = temp_db();
    let (_ks_dir, keystore) = temp_file_keystore();
    let svc_dir = tempfile::tempdir().expect("svc data dir");
    let clock = FakeClock {
        now: "2026-05-15T09:00:00Z".to_string(),
    };
    let svc = PatientService::new(&keystore, &clock, svc_dir.path());

    // No DOB, stored age 42.
    let patient_id =
        seed_patient_demographics(&pool, "HC-000002", "Test Patient A3-age", None, Some(42));

    let dash = svc
        .get_dashboard(
            &pool,
            GetDashboardRequest {
                patient_id: patient_id.clone(),
            },
        )
        .expect("get dashboard");

    assert_eq!(
        dash.demographics.age_label, "42y",
        "with no DOB the read falls back to the stored age_years (A3)"
    );
}
