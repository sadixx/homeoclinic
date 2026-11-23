#![forbid(unsafe_code)]
//! `hc-docs` — print/PDF rendering from HTML templates (Rx, receipt, case
//! summary, licence certificate), amount-in-words and Indian number format
//! for HomeoClinic.
//!
//! Depends only on `hc-domain`. R5 adds the pure helpers [`inr`], [`words`],
//! [`qr`] and [`collection`] (design §4, ADR 0021).

pub mod collection;
pub mod inr;
pub mod qr;
pub mod words;

/// Rendering error. Messages are generic (no patient data, no paths).
#[derive(Debug, thiserror::Error)]
pub enum DocsError {
    /// The QR payload does not fit a QR code.
    #[error("qr payload too long")]
    QrTooLong,
    /// The xlsx writer failed.
    #[error("xlsx render failed")]
    Xlsx,
}
