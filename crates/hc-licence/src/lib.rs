#![forbid(unsafe_code)]
//! `hc-licence` — licence parse/verify, identity lock, clock guard,
//! entitlements, offline UPI and WhatsApp QR, and offer codes for HomeoClinic.
//!
//! Stays desktop- and server-agnostic: depends only on `hc-domain`, with no
//! Tauri, UI or desktop-only code, so it is reusable by the Vendor Licence
//! Tool and the MVP2 server (R-ARCH-008). Empty shell at M0.
