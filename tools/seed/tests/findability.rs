//! HC-MVP1-056 / NFR-007 + PSR-002/003: every seeded patient is inserted
//! through the REAL hc-storage write path, so the migration-0004 triggers keep
//! patient_fts / patient_trgm in sync and a seeded patient is immediately
//! findable by the Slice A ranked search — by exact code, by last-4 mobile
//! digits, and by a phonetic misspelling of its name.
//!
//! RED before green: `generate_and_open` returns `SeedError::NotImplemented`
//! (stub), so every `.expect(...)` fails. A few hundred rows only (fast); the
//! 50k/100k perf run is M2-perf. Synthetic data only (R-TEST-004, R-PRIV-001).

use std::path::PathBuf;

use hc_search::query::search;
use hc_seed::names::{other_spelling_in_family, NAME_VARIANT_FAMILIES};
use hc_seed::{generate_and_open, generate_into_pool, GenConfig, GeneratedPatient};

/// Build a fixture config whose output DB lives under a fresh temp dir. Returns
/// the owning TempDir (kept alive for the DB's lifetime) and the config.
fn fixture_cfg(seed: u64) -> (tempfile::TempDir, GenConfig) {
    let dir = tempfile::tempdir().expect("create tempdir for seed output DB");
    let out: PathBuf = dir.path().join("clinic.db");
    (dir, GenConfig::fixture(seed, out))
}

#[test]
fn nfr007_seeded_patient_findable_by_exact_code() {
    let (_dir, cfg) = fixture_cfg(11);
    let (pool, patients) = generate_and_open(&cfg).expect("generate + open seeded pool");
    let p = &patients[0];

    let page = pool
        .with_reader(|c| Ok(search(c, &p.code, None).expect("search by code")))
        .expect("reader lease");
    assert!(
        page.hits.iter().any(|h| h.code == p.code),
        "a seeded patient must be findable by its exact code {} (rank 0) — \
         proves it was inserted through the real write path (FTS in sync)",
        p.code
    );
}

#[test]
fn nfr007_seeded_patient_findable_by_last4_mobile_digits() {
    let (_dir, cfg) = fixture_cfg(12);
    let (pool, patients) = generate_and_open(&cfg).expect("generate + open seeded pool");
    let p = &patients[0];
    let last4 = &p.mobile_digits[p.mobile_digits.len() - 4..];

    let page = pool
        .with_reader(|c| Ok(search(c, last4, None).expect("search by last-4 mobile")))
        .expect("reader lease");
    assert!(
        page.hits.iter().any(|h| h.code == p.code),
        "a seeded patient must be findable by the last 4 of its mobile digits ({last4}) \
         (PSR-002 4+ digits -> trigram) — proves patient_trgm is populated"
    );
}

#[test]
fn nfr007_seeded_patient_findable_by_phonetic_misspelling() {
    let (_dir, cfg) = fixture_cfg(13);
    let (pool, patients) = generate_and_open(&cfg).expect("generate + open seeded pool");

    // Find a patient that came from a PSR-003 variant family, then search a
    // DIFFERENT spelling of that family — it must still match (ties the seed to
    // the Slice A phonetic engine).
    let fam_patient: &GeneratedPatient = patients
        .iter()
        .find(|p| p.variant_family.is_some())
        .expect("fixture includes variant-family patients");
    let fam = fam_patient.variant_family.unwrap();

    let other = other_spelling_in_family(fam, &fam_patient.name);
    assert!(
        !other.is_empty(),
        "other_spelling_in_family must return a different spelling in family {fam} ({:?})",
        NAME_VARIANT_FAMILIES[fam]
    );
    assert_ne!(
        other, fam_patient.name,
        "the misspelling must differ from the registered name"
    );

    let page = pool
        .with_reader(|c| Ok(search(c, &other, None).expect("phonetic search")))
        .expect("reader lease");
    assert!(
        page.hits.iter().any(|h| h.code == fam_patient.code),
        "searching a phonetic variant '{other}' must find the patient registered as '{}' \
         (PSR-003) — ties the seed to Slice A",
        fam_patient.name
    );
}

#[test]
fn nfr007_inserted_count_matches_generated() {
    let (_dir, cfg) = fixture_cfg(14);
    let inserted = generate_into_pool(&cfg).expect("generate into pool");
    assert_eq!(
        inserted,
        cfg.patient_count(),
        "generate_into_pool must insert exactly patient_count() patients"
    );
}
