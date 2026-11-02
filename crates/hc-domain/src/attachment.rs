//! Report-attachment type detection (PAT-009). Pure, no IO (R-ARCH-002).
//!
//! Validates that a chosen file is a supported lab/ultrasound/CT report — a PDF
//! or a common image (png/jpg/jpeg/webp) — by agreement between the file's
//! extension AND its leading magic bytes, rejecting everything else. Used by the
//! `visit_attach_report` use case before the bytes are encrypted to the store.

/// A supported report kind and its canonical mime string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportMime {
    /// `application/pdf`.
    Pdf,
    /// `image/png`.
    Png,
    /// `image/jpeg` (`.jpg` / `.jpeg`).
    Jpeg,
    /// `image/webp`.
    Webp,
}

impl ReportMime {
    /// The canonical mime string for this kind.
    pub fn as_str(self) -> &'static str {
        match self {
            ReportMime::Pdf => "application/pdf",
            ReportMime::Png => "image/png",
            ReportMime::Jpeg => "image/jpeg",
            ReportMime::Webp => "image/webp",
        }
    }
}

/// Match `bytes`' leading magic against one supported [`ReportMime`], or `None`.
///
/// PDF: `%PDF-`. PNG: the 8-byte signature. JPEG: `FF D8 FF`. WEBP: a RIFF
/// container whose form type is `WEBP` (bytes `0..4 == "RIFF"`, `8..12 ==
/// "WEBP"`). Anything else is not a supported report.
fn magic_kind(bytes: &[u8]) -> Option<ReportMime> {
    if bytes.starts_with(b"%PDF-") {
        return Some(ReportMime::Pdf);
    }
    if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Some(ReportMime::Png);
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(ReportMime::Jpeg);
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(ReportMime::Webp);
    }
    None
}

/// Map a lowercase file extension to the single [`ReportMime`] it claims, or
/// `None` for an unsupported extension.
fn ext_kind(original_name: &str) -> Option<ReportMime> {
    // Take the substring after the last '.', lowercased. No filesystem access
    // (R-ARCH-002) — this is pure string handling over the display name.
    let ext = original_name.rsplit('.').next()?.to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => Some(ReportMime::Pdf),
        "png" => Some(ReportMime::Png),
        "jpg" | "jpeg" => Some(ReportMime::Jpeg),
        "webp" => Some(ReportMime::Webp),
        _ => None,
    }
}

/// Validate that `original_name`'s extension AND `bytes`' leading magic agree on
/// one supported type, returning the canonical mime string, or `None` when the
/// file is not a supported PDF/image (reject everything else).
///
/// Both signals must resolve to the SAME [`ReportMime`]: a spoofed extension
/// (PDF magic with a `.png` name) or a body that does not match its extension
/// is rejected. This runs before the bytes are encrypted to the store so only
/// genuine PDF/image reports are ever persisted (PAT-009).
pub fn detect_report_mime(original_name: &str, bytes: &[u8]) -> Option<&'static str> {
    let by_ext = ext_kind(original_name)?;
    let by_magic = magic_kind(bytes)?;
    if by_ext == by_magic {
        Some(by_ext.as_str())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Minimal synthetic magic-byte fixtures (R-TEST-004).
    const PDF: &[u8] = b"%PDF-1.7\n1 0 obj synthetic";
    const PNG: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01];
    const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46];
    // "RIFF" <4 size bytes> "WEBP" ... (bytes 0..4 == RIFF, 8..12 == WEBP).
    const WEBP: &[u8] = &[
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
    ];

    #[test]
    fn pat009_pdf_bytes_with_pdf_ext_detected_as_application_pdf() {
        assert_eq!(
            detect_report_mime("report.pdf", PDF),
            Some("application/pdf")
        );
    }

    #[test]
    fn pat009_png_bytes_with_png_ext_detected_as_image_png() {
        assert_eq!(detect_report_mime("scan.PNG", PNG), Some("image/png"));
    }

    #[test]
    fn pat009_jpeg_bytes_with_jpg_ext_detected_as_image_jpeg() {
        assert_eq!(detect_report_mime("ct.jpg", JPEG), Some("image/jpeg"));
        assert_eq!(detect_report_mime("ct.jpeg", JPEG), Some("image/jpeg"));
    }

    #[test]
    fn pat009_webp_bytes_with_webp_ext_detected_as_image_webp() {
        assert_eq!(
            detect_report_mime("ultrasound.webp", WEBP),
            Some("image/webp")
        );
    }

    #[test]
    fn pat009_txt_file_is_rejected() {
        assert_eq!(detect_report_mime("notes.txt", b"hello synthetic"), None);
    }

    #[test]
    fn pat009_pdf_magic_with_png_ext_is_rejected() {
        // Extension and magic must AGREE on one type (spoofed extension).
        assert_eq!(detect_report_mime("report.png", PDF), None);
    }

    #[test]
    fn pat009_png_ext_with_no_magic_is_rejected() {
        // A truncated / non-matching body is rejected even with a valid ext.
        assert_eq!(detect_report_mime("scan.png", b"not really a png"), None);
    }
}
