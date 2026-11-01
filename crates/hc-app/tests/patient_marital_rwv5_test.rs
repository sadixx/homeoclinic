//! M3-RWv5 (C): marital status stays READABLE for legacy stored values (PAT-005).
//!
//! RWv5 limits the marital-status choices to Single/Married/Divorced/Widowed.
//! A patient saved before that, with a legacy value (e.g. `other`), must still
//! show that value when the record is opened for edit. Today the edit form
//! seeds itself from the dashboard `Demographics` block, and that block has no
//! marital status at all. So the form never shows the stored value, and the
//! next edit-save sends `None` and silently wipes it.
//!
//! CUT: the real `PatientService::get_dashboard`. The test asserts the
//! serialised (camelCase, wire-shape) `demographics.maritalStatus` key through
//! `serde_json`, so it COMPILES against today's struct and FAILS on the
//! assertion until the field is added (additive; bindings regenerated).
//! Fakes are dependencies only (FakeClock, temp file keystore, temp
//! encrypted DB). Synthetic data only.

use hc_app::clock::Clock;
use hc_app::patient::{CreatePatientRequest, GetDashboardRequest, PatientService};
use hc_storage::key::KeyHierarchy;
use hc_storage::keystore::FileKeystore;
use hc_storage::Pool;

struct FakeClock;
impl Clock for FakeClock {
    fn now_rfc3339(&self) -> String {
        "2026-11-01T09:00:00Z".to_string()
    }
}

const TEST_PIN: &str = "2468";

fn env() -> (tempfile::TempDir, tempfile::TempDir, FileKeystore, Pool) {
    let ks_dir = tempfile::tempdir().expect("keystore dir");
    let data_dir = tempfile::tempdir().expect("data dir");
    let keystore = FileKeystore::open(ks_dir.path()).expect("open file keystore");
    let (_recovery, dek) = KeyHierarchy::new(&keystore)
        .initialize(TEST_PIN)
        .expect("mint DEK");
    let pool = Pool::open(&data_dir.path().join("clinic.db"), &dek).expect("open encrypted DB");
    hc_storage::migrate::run(&pool).expect("run migrations");
    (ks_dir, data_dir, keystore, pool)
}

fn dashboard_demographics_json(marital: Option<&str>) -> serde_json::Value {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock;
    let svc = PatientService::new(&keystore, &clock, data_dir.path());
    let created = svc
        .create(
            &pool,
            CreatePatientRequest {
                name: "Test Patient 001".to_string(),
                dob: Some("1990-05-01".to_string()),
                marital_status: marital.map(str::to_string),
                ..Default::default()
            },
        )
        .expect("create");
    let dash = svc
        .get_dashboard(
            &pool,
            GetDashboardRequest {
                patient_id: created.patient_id,
            },
        )
        .expect("dashboard");
    serde_json::to_value(&dash.demographics).expect("serialise demographics")
}

/// Real bug: a legacy `other` marital status is invisible on edit and gets
/// wiped by the next save. The dashboard must carry the stored value
/// verbatim so the edit form can show it.
#[test]
fn pat005_dashboard_demographics_carry_a_legacy_marital_status_verbatim() {
    let demo = dashboard_demographics_json(Some("other"));
    assert_eq!(
        demo.get("maritalStatus"),
        Some(&serde_json::Value::String("other".to_string())),
        "Demographics must expose the stored maritalStatus (legacy value kept \
         verbatim); got {demo}"
    );
}

/// Real bug: the new values must round-trip too, so a "Widowed" patient is
/// not shown as blank when the record is reopened.
#[test]
fn pat005_dashboard_demographics_carry_a_new_marital_status() {
    let demo = dashboard_demographics_json(Some("widowed"));
    assert_eq!(
        demo.get("maritalStatus"),
        Some(&serde_json::Value::String("widowed".to_string())),
        "Demographics must expose maritalStatus; got {demo}"
    );
}
