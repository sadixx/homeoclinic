#![forbid(unsafe_code)]
//! `hc-app` — use-case services and the typed Tauri commands for HomeoClinic.
//!
//! This crate is the only API surface the UI can call (R-ARCH-005). It fans in
//! on every domain-side crate (`hc-domain`, `hc-storage`, `hc-search`,
//! `hc-repertory`, `hc-licence`, `hc-docs`) and is mounted by
//! `apps/desktop/src-tauri`. Commands are collected into a single
//! [`tauri_specta::Builder`] so the Tauri shell and the bindings-export test
//! share one source of truth for the command list.

pub mod commands;
pub mod error;
pub mod logging;

use tauri_specta::{collect_commands, Builder};

/// Build the typed command surface for the desktop app.
///
/// `apps/desktop/src-tauri` mounts the returned builder; the bindings-export
/// test exports it to `apps/desktop/src/bindings.ts` (R-ARCH-004). Every new
/// command is registered here and nowhere else, keeping one source of truth
/// for the command collection.
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::app_info::app_info,
        commands::health::health_check
    ])
}
