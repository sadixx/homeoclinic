#![forbid(unsafe_code)]
//! `hc-app` — use-case services and the typed Tauri commands for HomeoClinic.
//!
//! This crate is the only API surface the UI can call (R-ARCH-005). It fans in
//! on every domain-side crate (`hc-domain`, `hc-storage`, `hc-search`,
//! `hc-repertory`, `hc-licence`, `hc-docs`) and is mounted by
//! `apps/desktop/src-tauri`. Commands are collected into a single
//! [`tauri_specta::Builder`] so the Tauri shell and the bindings-export test
//! share one source of truth for the command list.

pub mod attachment;
pub mod auth;
pub mod backup;
pub mod clock;
pub mod commands;
pub mod data_folder;
pub mod error;
pub mod licence;
pub mod logging;
pub mod patient;
pub mod settings;
pub mod setup;
pub mod state;
pub mod visit;

use tauri_specta::{collect_commands, Builder};

/// Build the typed command surface for the desktop app.
///
/// `apps/desktop/src-tauri` mounts the returned builder; the bindings-export
/// test exports it to `apps/desktop/src/bindings.ts` (R-ARCH-004). Every new
/// command is registered here and nowhere else, keeping one source of truth
/// for the command collection.
pub fn specta_builder() -> Builder<tauri::Wry> {
    // The shared (always-registered) command list is emitted once by this local
    // macro so the release and E2E builds stay a single source of truth; the
    // only difference is the DEV/E2E-only `patient_import_fixture`, appended
    // under `e2e-test-keys`. `collect_commands!` cannot take a `#[cfg]` on a
    // list entry, so the two builds select the whole list through `cfg`.
    macro_rules! base_commands {
        () => {
            collect_commands![
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
                // Typed async .hcbak file picker for S17 restore Step 1
                // (BAK-003, b23-n1-d1); same non-blocking pattern as
                // visit_pick_report_file.
                commands::backup::backup_pick_restore_file,
                commands::backup::backup_now,
                commands::backup::restore_preview,
                commands::backup::restore_apply,
                commands::backup::verify_backup,
                // BAK-005/HC-MVP1-035 "move to new computer" is DEFERRED (P1):
                // registered for a stable binding contract but feature-flagged
                // OFF (S17 button disabled, no dead end).
                commands::backup::start_move_to_new_computer,
                // Licence status read (Feature 1 + LIC-005, HC-MVP1-M1a).
                commands::licence::get_licence_status,
                // Patient use-case commands (HC-MVP1-036..043, S06/S07).
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
                commands::patient::patient_export_json,
                // Patient search / list use-case commands (HC-MVP1-050/052).
                commands::patient::patient_search,
                commands::patient::patient_recent,
                commands::patient::patient_touch_recent,
                commands::patient::patient_list_query,
                commands::patient::patient_list_export_csv,
                // Case-template + visit + Today use-case commands (HC-MVP1-058/
                // 061/062/063/064/068..072, S08/S09/S03).
                commands::visit::case_template_get_default,
                commands::visit::case_template_list,
                // Per-doctor hide-sections persistence (CASE-002, S08).
                commands::visit::case_template_set_visibility,
                commands::visit::case_visit_open_or_create,
                commands::visit::case_visit_autosave,
                commands::visit::case_summary_render,
                commands::visit::visit_create_followup,
                commands::visit::visit_autosave,
                commands::visit::visit_set_next_followup,
                commands::visit::visit_has_saved_first_case,
                commands::visit::today_get_overview,
                // Send-to-repertory STUB (CASE-006, R7) — flagged unavailable,
                // registered for a stable binding (no dead end, R-DEL-002).
                commands::visit::rubric_search_prefill,
                // Visit lab-report attachments (PAT-009, HC-MVP1-M3ux3, S08
                // Investigations). Reuse the M1-024 encrypted AttachmentStore;
                // typed file-open + encrypted store + one txn/one audit row.
                commands::attachment::visit_attach_report,
                commands::attachment::visit_list_attachments,
                commands::attachment::patient_list_attachments,
                commands::attachment::visit_open_attachment,
                commands::attachment::visit_delete_attachment,
                commands::attachment::visit_pick_report_file,
                // S18 Settings (MS, SET-002..007).
                commands::settings::settings_get,
                commands::settings::settings_save_general,
                commands::settings::settings_pick_data_folder,
                commands::settings::settings_move_data_folder,
                commands::settings::settings_recheck_data_folder,
                commands::settings::settings_forget_data_folder
            ]
        };
        (with_e2e) => {
            collect_commands![
                commands::app_info::app_info,
                commands::health::health_check,
                commands::setup::setup_get_state,
                commands::setup::setup_save_doctor_profile,
                commands::setup::setup_save_clinic_profile,
                commands::setup::setup_set_pin,
                commands::setup::setup_set_data_dir,
                commands::setup::setup_set_font_size,
                commands::setup::setup_start_trial,
                commands::setup::setup_complete,
                commands::auth::auth_get_lock_state,
                commands::auth::auth_unlock,
                commands::auth::auth_lock,
                commands::auth::auth_recover_with_code,
                commands::backup::get_backup_status,
                commands::backup::set_auto_backup,
                commands::backup::list_removable_drives,
                // Typed async .hcbak file picker for S17 restore Step 1
                // (BAK-003, b23-n1-d1); same non-blocking pattern as
                // visit_pick_report_file.
                commands::backup::backup_pick_restore_file,
                commands::backup::backup_now,
                commands::backup::restore_preview,
                commands::backup::restore_apply,
                commands::backup::verify_backup,
                commands::backup::start_move_to_new_computer,
                commands::licence::get_licence_status,
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
                commands::patient::patient_export_json,
                commands::patient::patient_search,
                commands::patient::patient_recent,
                commands::patient::patient_touch_recent,
                commands::patient::patient_list_query,
                commands::patient::patient_list_export_csv,
                // Case-template + visit + Today use-case commands (M3-A).
                commands::visit::case_template_get_default,
                commands::visit::case_template_list,
                // Per-doctor hide-sections persistence (CASE-002, S08).
                commands::visit::case_template_set_visibility,
                commands::visit::case_visit_open_or_create,
                commands::visit::case_visit_autosave,
                commands::visit::case_summary_render,
                commands::visit::visit_create_followup,
                commands::visit::visit_autosave,
                commands::visit::visit_set_next_followup,
                commands::visit::visit_has_saved_first_case,
                commands::visit::today_get_overview,
                commands::visit::rubric_search_prefill,
                // Visit lab-report attachments (PAT-009, M3ux3).
                commands::attachment::visit_attach_report,
                commands::attachment::visit_list_attachments,
                commands::attachment::patient_list_attachments,
                commands::attachment::visit_open_attachment,
                commands::attachment::visit_delete_attachment,
                commands::attachment::visit_pick_report_file,
                // S18 Settings (MS, SET-002..007).
                commands::settings::settings_get,
                commands::settings::settings_save_general,
                commands::settings::settings_pick_data_folder,
                commands::settings::settings_move_data_folder,
                commands::settings::settings_recheck_data_folder,
                commands::settings::settings_forget_data_folder,
                // DEV/E2E ONLY (feature e2e-test-keys): synthetic fixture
                // import through the real create path (OPTION A seeding).
                commands::patient::patient_import_fixture
            ]
        };
    }

    #[cfg(feature = "e2e-test-keys")]
    let commands = base_commands!(with_e2e);
    #[cfg(not(feature = "e2e-test-keys"))]
    let commands = base_commands!();

    Builder::<tauri::Wry>::new().commands(commands)
}
