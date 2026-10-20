//! HC-MVP1-056 / NFR-007: the generator reuses hc-search's normalise + phonetic
//! functions for the four denormalised columns (no ad-hoc duplication), so
//! seeded rows are byte-identical to the real writer's output and are therefore
//! findable by the Slice A search engine.
//!
//! RED before green: `build_patients` returns an empty Vec (stub), so the loop
//! body never runs and the non-empty guard fails. Synthetic data only.

use std::path::PathBuf;

use hc_search::{normalize, phonetic};
use hc_seed::{build_patients, GenConfig};

#[test]
fn nfr007_normalised_columns_match_hc_search_fns() {
    let patients = build_patients(&GenConfig::fixture(
        99,
        PathBuf::from("/tmp/unused-norm.db"),
    ));
    assert!(
        !patients.is_empty(),
        "fixture must generate patients so the normalisation contract can be checked"
    );

    for p in &patients {
        assert_eq!(
            p.name_norm,
            normalize::name_norm(&p.name),
            "name_norm must equal hc_search::normalize::name_norm(name) for {}",
            p.code
        );
        assert_eq!(
            p.name_phonetic,
            phonetic::phonetic_key(&p.name),
            "name_phonetic must equal hc_search::phonetic::phonetic_key(name) for {}",
            p.code
        );
        assert_eq!(
            p.mobile_digits,
            normalize::mobile_digits(&p.mobile),
            "mobile_digits must equal hc_search::normalize::mobile_digits(mobile) for {}",
            p.code
        );
        assert_eq!(
            p.code_digits,
            normalize::code_digits(&p.code),
            "code_digits must equal hc_search::normalize::code_digits(code) for {}",
            p.code
        );
        // Mobile digits are a valid-looking Indian 10-digit number (PSR-002).
        assert_eq!(
            p.mobile_digits.len(),
            10,
            "mobile_digits must be 10 digits for {}",
            p.code
        );
    }
}
