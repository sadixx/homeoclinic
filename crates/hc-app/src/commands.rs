//! Typed Tauri commands — the HomeoClinic use-case API surface.
//!
//! One command per use case (R-ARCH-005). At M0 only the sample `app_info`
//! command exists; it proves the typed IPC path (Rust use-case command →
//! `tauri-specta` → `bindings.ts` → UI wrapper) end to end.

pub mod app_info;
pub mod auth;
pub mod backup;
pub mod health;
pub mod licence;
pub mod patient;
pub mod setup;
