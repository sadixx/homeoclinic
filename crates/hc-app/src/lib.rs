#![forbid(unsafe_code)]
//! `hc-app` — use-case services and the typed Tauri commands for HomeoClinic.
//!
//! This crate is the only API surface the UI can call (R-ARCH-005). It fans in
//! on every domain-side crate (`hc-domain`, `hc-storage`, `hc-search`,
//! `hc-repertory`, `hc-licence`, `hc-docs`) and is mounted by
//! `apps/desktop/src-tauri`. Commands are collected into a single
//! [`tauri_specta::Builder`] so the Tauri shell and the bindings-export test
//! share one source of truth for the command list.

pub mod auth;
pub mod backup;
pub mod clock;
pub mod commands;
pub mod error;
pub mod licence;
pub mod logging;
pub mod patient;
pub mod setup;
pub mod state;

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
        commands::health::health_check,
        // First-run setup (HC-MVP1-026).
        commands::setup::setup_get_state,
        commands::setup::setup_save_doctor_profile,
        commands::setup::setup_save_clinic_profile,
        commands::setup::setup_set_pin,
        commands::setup::setup_set_data_dir,
        commands::setup::setup_set_font_size,
        commands::setup::setup_start_trial,
        commands::setup::setup_complete,
        // PIN lock/unlock (HC-MVP1-027).
        commands::auth::auth_get_lock_state,
        commands::auth::auth_unlock,
        commands::auth::auth_lock,
        commands::auth::auth_recover_with_code,
        // Backup / restore (HC-MVP1-030..034, S17).
        commands::backup::get_backup_status,
        commands::backup::set_auto_backup,
        commands::backup::list_removable_drives,
        commands::backup::backup_now,
        commands::backup::restore_preview,
        commands::backup::restore_apply,
        commands::backup::verify_backup,
        // BAK-005/HC-MVP1-035 "move to new computer" is DEFERRED (P1): the
        // command is registered for a stable binding contract but is
        // feature-flagged OFF (S17 button disabled, no dead end).
        commands::backup::start_move_to_new_computer,
        // Licence status read (Feature 1 + LIC-005, HC-MVP1-M1a).
        commands::licence::get_licence_status,
        // Patient use-case commands (HC-MVP1-036..043, S06/S07). Register all
        // eleven here (one source of truth for the collection + bindings.ts).
        commands::patient::patient_next_code,
        commands::patient::patient_check_duplicate,
        commands::patient::patient_create,
        commands::patient::patient_update,
        commands::patient::patient_get_dashboard,
        commands::patient::patient_soft_delete,
        commands::patient::patient_restore,
        commands::patient::patient_permanent_delete,
        commands::patient::patient_link_family,
        commands::patient::patient_export_pdf,
        commands::patient::patient_export_json
    ])
}
