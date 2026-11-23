//! Clinic UPI QR as SVG (BILL-005; R5 design §4).

use base64::Engine as _;
use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};

use crate::DocsError;

/// Minimal-size SVG (EcLevel::M, standard 4-module quiet zone, dark `#000`)
/// for `data`. `Err(QrTooLong)` when the payload does not fit a QR code.
pub fn qr_svg(data: &str) -> Result<String, DocsError> {
    let code = QrCode::with_error_correction_level(data.as_bytes(), EcLevel::M)
        .map_err(|_| DocsError::QrTooLong)?;
    Ok(code
        .render::<svg::Color<'_>>()
        .quiet_zone(true)
        .min_dimensions(200, 200)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build())
}

/// `"data:image/svg+xml;base64,<...>"` for an `<img>` (allowed by the CSP
/// `img-src data:`; the UI never injects HTML).
pub fn svg_data_url(svg: &str) -> String {
    format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(svg.as_bytes())
    )
}
