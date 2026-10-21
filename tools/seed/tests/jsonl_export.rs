//! HC-MVP1-M2d (OPTION A E2E seeding): `hc-seed` emits a plaintext JSONL
//! fixture that the provisioned app imports through its real `patient_create`
//! path — so a seeded >= 200-patient DB does not need to share the seed's key
//! with the boot-gated app (the key-mismatch blocker).
//!
//! RED before green: `export_fixture_jsonl` does not exist yet, so this file
//! fails to compile against the absent CUT; once it lands, the assertions below
//! (>= 200 records, deterministic, register-form fields present, no normalised
//! columns trusted from the file) are what must hold. Synthetic data only
//! (R-TEST-004, R-PRIV-001).

use hc_seed::{export_fixture_jsonl, FixtureRecord, GenConfig, FIXTURE_MIN_PATIENTS};
use std::path::PathBuf;

fn out() -> PathBuf {
    PathBuf::from("/tmp/unused-jsonl-export.db")
}

/// Deserialise a JSONL buffer into the records the app would import.
fn parse_jsonl(buf: &[u8]) -> Vec<FixtureRecord> {
    let text = String::from_utf8(buf.to_vec()).expect("JSONL is valid UTF-8");
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str::<FixtureRecord>(l).expect("each line is a FixtureRecord"))
        .collect()
}

#[test]
fn m2d_jsonl_export_has_at_least_the_fixture_minimum() {
    let cfg = GenConfig::fixture(21, out());
    let mut buf: Vec<u8> = Vec::new();
    let n = export_fixture_jsonl(&cfg, &mut buf).expect("export JSONL fixture");

    let records = parse_jsonl(&buf);
    assert_eq!(
        n,
        records.len(),
        "the returned count must equal the number of JSONL lines written"
    );
    assert!(
        records.len() >= FIXTURE_MIN_PATIENTS,
        "the E2E fixture must carry >= {FIXTURE_MIN_PATIENTS} patients (got {})",
        records.len()
    );
}

#[test]
fn m2d_jsonl_export_is_deterministic_for_a_seed() {
    let cfg = GenConfig::fixture(7, out());
    let mut a = Vec::new();
    let mut b = Vec::new();
    export_fixture_jsonl(&cfg, &mut a).expect("export A");
    export_fixture_jsonl(&cfg, &mut b).expect("export B");
    assert_eq!(
        a, b,
        "identical (seed, mode) must produce a byte-identical JSONL fixture (reproducible E2E)"
    );
}

#[test]
fn m2d_jsonl_records_carry_register_form_fields() {
    let cfg = GenConfig::fixture(9, out());
    let mut buf = Vec::new();
    export_fixture_jsonl(&cfg, &mut buf).expect("export");
    let records = parse_jsonl(&buf);

    // Every record must carry the fields the app's create path needs: a name
    // and either a DOB or an age (PAT-001). The fixture always has both.
    for r in &records {
        assert!(!r.name.trim().is_empty(), "every fixture record has a name");
        assert!(!r.dob.trim().is_empty(), "every fixture record has a DOB");
        assert!(r.age_years >= 1, "every fixture record has a positive age");
        assert!(
            r.sex == "M" || r.sex == "F",
            "sex is one of M/F (got {:?})",
            r.sex
        );
    }
}

#[test]
fn m2d_jsonl_lines_deserialise_without_trusting_normalised_columns() {
    // The app recomputes name_norm / phonetic / mobile_digits / code_digits via
    // the real write path; the JSONL must NOT carry them (so the file can never
    // smuggle a mismatched index into the DB). Assert the raw JSON has only the
    // register-form keys.
    let cfg = GenConfig::fixture(3, out());
    let mut buf = Vec::new();
    export_fixture_jsonl(&cfg, &mut buf).expect("export");
    let first_line = String::from_utf8(buf)
        .expect("utf8")
        .lines()
        .next()
        .expect("at least one line")
        .to_string();

    for forbidden in ["name_norm", "nameNorm", "name_phonetic", "code_digits"] {
        assert!(
            !first_line.contains(forbidden),
            "JSONL must not carry the normalised column {forbidden}; the app recomputes it"
        );
    }
}
