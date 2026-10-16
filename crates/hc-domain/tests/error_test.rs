//! RED tests for the pure domain error enum (HC-MVP1-018, design §018,
//! R-RUST-001, R-ARCH-002).
//!
//! Code under test (CUT): `hc_domain::error::DomainError`. A pure `thiserror`
//! enum with no IO and no patient data. Names carry the req id (R-TEST-008).
//!
//! Red-first state: until `hc-core-dev` implements `hc-domain/src/error.rs`,
//! this file fails to compile against the absent CUT. Once the enum exists per
//! the frozen API CONTRACT, the assertions below are what must hold — a
//! `Display` text that leaks IO/patient detail makes an ASSERTION fail.

use hc_domain::error::DomainError;

/// R-TEST-008 (R-ARCH-002): `DomainError::Invalid` carries a generic,
/// patient-data-free, IO-free message. Catches a `Display` string that leaks
/// a field value, a SQL fragment or a file path.
#[test]
fn hc_mvp1_018_domain_error_display_is_generic_no_patient_data() {
    let msg = DomainError::Invalid.to_string();

    assert!(
        !msg.is_empty(),
        "DomainError must render a non-empty plain-language message"
    );
    // No IO / SQL / path leakage (R-ARCH-002, R-PRIV-001).
    for needle in ["SELECT", "INSERT", "/", "\\", "0x", "patients"] {
        assert!(
            !msg.contains(needle),
            "DomainError message must not leak `{needle}`: got `{msg}`"
        );
    }
}

/// R-TEST-008: `DomainError` is comparable (`PartialEq`/`Eq`), which the
/// mapping layer and tests rely on to assert on a specific variant.
#[test]
fn hc_mvp1_018_domain_error_is_equatable() {
    assert_eq!(DomainError::Invalid, DomainError::Invalid);
}
