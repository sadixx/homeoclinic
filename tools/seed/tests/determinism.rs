//! HC-MVP1-056 / NFR-007: the generator is deterministic given `--seed`.
//!
//! RED before green: `build_patients` returns an empty Vec (stub), so these
//! assertions fail. Synthetic data only (R-TEST-004, R-PRIV-001).

use hc_seed::{build_patients, GenConfig};
use std::path::PathBuf;

fn out() -> PathBuf {
    PathBuf::from("/tmp/unused-determinism.db")
}

#[test]
fn nfr007_same_seed_produces_identical_patient_set() {
    let cfg = GenConfig::fixture(42, out());
    let a = build_patients(&cfg);
    let b = build_patients(&cfg);

    assert!(
        !a.is_empty(),
        "fixture must generate patients (>= the 200 minimum)"
    );
    assert_eq!(
        a.len(),
        cfg.patient_count(),
        "build_patients must produce exactly patient_count() rows"
    );
    assert_eq!(
        a, b,
        "same (seed, mode) must produce an identical patient set \
         (count, codes, names, phonetic keys, diagnosis) — NFR-007 reproducible fixture"
    );
}

#[test]
fn nfr007_different_seed_changes_the_set() {
    let a = build_patients(&GenConfig::fixture(1, out()));
    let b = build_patients(&GenConfig::fixture(2, out()));

    assert_eq!(
        a.len(),
        b.len(),
        "both fixtures use the default size regardless of seed"
    );
    // The generator must actually consume the seed: a different seed changes
    // the data (names/mobiles), even though coverage and count are invariant.
    let names_a: Vec<&str> = a.iter().map(|p| p.name.as_str()).collect();
    let names_b: Vec<&str> = b.iter().map(|p| p.name.as_str()).collect();
    assert_ne!(
        names_a, names_b,
        "a different --seed must change the generated set (the RNG must be seeded)"
    );
}
