//! R5 clinic UPI QR rendering (BILL-005, HC-MVP1-151; R5 design §4).
//!
//! CUT: the REAL `hc_docs::qr`. Pure. RED until hc-dev replaces the stubs.

use base64::Engine as _;
use hc_docs::qr::{qr_svg, svg_data_url};
use hc_docs::DocsError;

const URL: &str =
    "upi://pay?pa=testclinic@upi&pn=Test%20Clinic&am=227.50&cu=INR&tn=Receipt%202026-27%2F0001";

/// Bug caught: no QR is produced for a normal UPI link (P1 panel empty).
#[test]
fn qr_svg_renders_an_svg_document_for_a_upi_url() {
    let svg = qr_svg(URL).expect("a UPI URL fits a QR code");
    assert!(svg.contains("<svg"), "must be an SVG document");
    assert!(svg.contains("</svg>"), "must be a complete SVG document");
    assert!(
        svg.to_lowercase().contains("#000"),
        "dark modules are black (#000)"
    );
}

/// Bug caught: QR output is non-deterministic or ignores its input (every bill
/// shows the same code).
#[test]
fn qr_svg_is_deterministic_and_depends_on_the_payload() {
    let a = qr_svg(URL).unwrap();
    assert_eq!(a, qr_svg(URL).unwrap(), "same input -> same SVG");
    let other = URL.replace("227.50", "100.00");
    assert_ne!(
        a,
        qr_svg(&other).unwrap(),
        "different amount -> different QR"
    );
}

/// Bug caught: an oversize payload panics instead of returning an error.
#[test]
fn qr_svg_refuses_a_payload_too_long_for_a_qr_code() {
    let huge = "x".repeat(5_000);
    assert!(matches!(qr_svg(&huge), Err(DocsError::QrTooLong)));
}

/// Bug caught: the data URL has the wrong MIME prefix (CSP img-src data: is
/// allowed, but the browser will not render it) or corrupts the SVG.
#[test]
fn svg_data_url_is_a_base64_svg_data_url_that_round_trips() {
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect fill=\"#000\"/></svg>";
    let url = svg_data_url(svg);
    let b64 = url
        .strip_prefix("data:image/svg+xml;base64,")
        .unwrap_or_else(|| panic!("wrong prefix: {url:?}"));
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .expect("standard base64");
    assert_eq!(String::from_utf8(decoded).unwrap(), svg);
}
