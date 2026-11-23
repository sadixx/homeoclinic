//! PAT-002 / A9: patient-ID prefix value type (R-RUST-007).
//!
//! CUT: `hc_domain::patient_code::IdPrefix::parse`. Pure domain, no IO.
//! The S18 save path is covered end to end by
//! `pat002_save_general_validates_the_id_prefix` (hc-app).

use hc_domain::error::DomainError;
use hc_domain::patient_code::IdPrefix;

/// Bug caught: a prefix typed in lower case or with stray spaces is stored
/// as typed, so codes come out as `hc-000124` or ` HC-000124`.
#[test]
fn pat002_id_prefix_parse_trims_and_uppercases() {
    let p = IdPrefix::parse("  hc- ").expect("valid after trim + uppercase");
    assert_eq!(p.as_str(), "HC-");
    assert_eq!(p.to_string(), "HC-");
    assert_eq!(p.into_string(), "HC-");
}

/// Bug caught: the boundary lengths (1 and MAX_LEN) or digits / dashes in
/// the middle are refused.
#[test]
fn pat002_id_prefix_parse_accepts_the_allowed_shapes() {
    assert_eq!(IdPrefix::MAX_LEN, 6);
    for ok in ["A", "HC-", "CLN1A", "AB-CD-", "Q2W3E-", "ABCDEF"] {
        let p = IdPrefix::parse(ok).unwrap_or_else(|e| panic!("{ok:?} must be accepted: {e}"));
        assert_eq!(p.as_str(), ok);
    }
}

/// Bug caught: a prefix that makes codes ambiguous (ends in a digit), is
/// empty or too long, or has spaces / symbols / non-ASCII is accepted.
#[test]
fn pat002_id_prefix_parse_rejects_invalid_prefixes() {
    for bad in [
        "", "   ", "HC1", "ABCDEFG", "H C", "HC_", "HC.", "HC/", "डॉ", "ÄB", "HC-9",
    ] {
        assert_eq!(
            IdPrefix::parse(bad),
            Err(DomainError::Invalid),
            "{bad:?} must be refused"
        );
    }
}
