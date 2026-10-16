#![forbid(unsafe_code)]
//! `hc-domain` — entities, value types and validation for HomeoClinic.
//!
//! This crate holds pure domain types only: no database, filesystem, network,
//! wall-clock or Tauri dependency (R-ARCH-002). Invariants live in the value
//! types defined here (R-RUST-007). It depends on no other workspace crate.

pub mod app_info;
