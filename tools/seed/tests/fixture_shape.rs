//! HC-MVP1-056 / NFR-007 (USER REQUIREMENT): the functional fixture has at
//! least 200 patients spanning many diseases and the PSR-003 variant families,
//! with unique codes.
//!
//! RED before green: `build_patients` returns an empty Vec (stub), so these
//! assertions fail. Synthetic data only (R-TEST-004, R-PRIV-001).

use std::collections::HashSet;
use std::path::PathBuf;

use hc_seed::diseases::DISEASES;
use hc_seed::names::NAME_VARIANT_FAMILIES;
use hc_seed::{build_patients, GenConfig, FIXTURE_MIN_PATIENTS};

fn fixture() -> Vec<hc_seed::GeneratedPatient> {
    build_patients(&GenConfig::fixture(
        7,
        PathBuf::from("/tmp/unused-shape.db"),
    ))
}

#[test]
fn nfr007_fixture_has_at_least_200_patients() {
    let patients = fixture();
    assert!(
        patients.len() >= FIXTURE_MIN_PATIENTS,
        "functional fixture must have >= {FIXTURE_MIN_PATIENTS} patients, got {}",
        patients.len()
    );
}

#[test]
fn nfr007_fixture_spans_at_least_ten_distinct_diagnoses() {
    let patients = fixture();
    let distinct: HashSet<&str> = patients.iter().map(|p| p.diagnosis).collect();
    assert!(
        distinct.len() >= 10,
        "fixture must span >= 10 distinct diagnoses, got {}",
        distinct.len()
    );
    assert_eq!(
        distinct.len(),
        DISEASES.len(),
        "fixture must cover EVERY diagnosis in DISEASES ({} total)",
        DISEASES.len()
    );
}

#[test]
fn nfr007_fixture_covers_every_variant_family() {
    let patients = fixture();
    let covered: HashSet<usize> = patients.iter().filter_map(|p| p.variant_family).collect();
    for (i, family) in NAME_VARIANT_FAMILIES.iter().enumerate() {
        assert!(
            covered.contains(&i),
            "fixture must include a patient from variant family {i} ({family:?}) \
             so the phonetic search (PSR-003) is exercised"
        );
    }
}

#[test]
fn nfr007_patient_codes_are_unique() {
    let patients = fixture();
    assert!(
        patients.len() >= FIXTURE_MIN_PATIENTS,
        "fixture must be populated before the uniqueness check is meaningful"
    );
    let distinct: HashSet<&str> = patients.iter().map(|p| p.code.as_str()).collect();
    assert_eq!(
        distinct.len(),
        patients.len(),
        "every patient code must be unique (patient.code is UNIQUE — a duplicate would fail insert)"
    );
}
