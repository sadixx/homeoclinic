//! Pure domain validation errors for HomeoClinic (HC-MVP1-018, R-RUST-001).
//!
//! `DomainError` is a `thiserror` enum with no IO, no filesystem, no clock and
//! no patient data in its messages (R-ARCH-002, R-PRIV-001). It is wrapped by
//! `hc_app::error::AppError` and never serialised to the UI directly; the
//! command boundary only ever emits a mapped `UserFacingError`.

/// Pure domain validation error. Every message is generic plain language that
/// carries no patient identifier, SQL or filesystem path (R-PRIV-001).
#[derive(Debug, thiserror::Error, Clone, PartialEq, Eq)]
pub enum DomainError {
    /// A required field was missing or failed a value-type invariant.
    ///
    /// Extended per value type (`Money`, `PatientCode`, `Potency`) as they
    /// land; the message stays generic by design.
    #[error("a required field was missing or invalid")]
    Invalid,
}
