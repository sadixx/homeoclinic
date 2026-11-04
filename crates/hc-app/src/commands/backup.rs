//! Typed backup / restore commands (HC-MVP1-030..034, BAK-001..004, SUX-011,
//! S17 "Commands used").
//!
//! One thin `#[tauri::command] #[specta::specta]` wrapper per use case
//! (R-ARCH-005). Each reads the shell-managed [`AppState`], builds a
//! [`BackupService`] over the OPEN pool + data dir + a storage [`SystemClock`],
//! performs the use case, and returns `Result<Resp, UserFacingError>` via
//! [`to_user_result`] so no raw internal error crosses the boundary
//! (R-ARCH-006, R-UI-008).
//!
//! Operations that read or write the DB require the app to be UNLOCKED (the
//! pool is open). When sealed they return a generic error rather than touching
//! anything. The folder/USB picker is a typed command returning chosen paths —
//! never a broad FS scope or the shell plugin (R-SEC-002/003). No network, no
//! patient data in logs (NFR-022, R-PRIV-001).

use tauri::State;

use hc_storage::clock::SystemClock;

use crate::backup::{
    list_removable_drives as enumerate_drives, restore_apply_in_state, BackupNowResponse,
    BackupService, BackupStatus, PickRestoreFileResponse, RemovableDrives, RestoreApplyResponse,
    RestorePreview, SetAutoBackupResponse, VerifyBackupResponse, MOVE_TO_NEW_COMPUTER_ENABLED,
};
use crate::error::{map_error, to_user_result, AppError, UserFacingError};
use crate::state::AppState;

/// Run `f` with a [`BackupService`] bound to the OPEN pool + data dir + a
/// storage system clock. Returns a generic error if the app is sealed (no open
/// pool), so a locked app never silently no-ops a backup/restore.
fn with_service<T>(
    state: &AppState,
    f: impl FnOnce(&BackupService<'_>) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    let pool = lock.pool.as_ref().ok_or(AppError::NotFound)?;
    let clock = SystemClock;
    let svc = BackupService::new(pool, &state.data_dir, &clock);
    f(&svc)
}

/// (`get_backup_status`) Backup health + the auto toggle for S17 and the
/// status-bar chip (BAK-001/004).
#[tauri::command]
#[specta::specta]
pub fn get_backup_status(state: State<'_, AppState>) -> Result<BackupStatus, UserFacingError> {
    to_user_result(with_service(&state, |svc| svc.status()))
}

/// (`set_auto_backup`) Toggle the automatic daily backup (BAK-001). One audited
/// `app_setting` write (R-DATA-001).
#[tauri::command]
#[specta::specta]
pub fn set_auto_backup(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<SetAutoBackupResponse, UserFacingError> {
    to_user_result(with_service(&state, |svc| svc.set_auto_backup(enabled)))
}

/// (`list_removable_drives`) Enumerate mounted removable drives for the USB
/// picker (BAK-002). A typed command returning chosen mount paths — NOT a broad
/// FS scope or the shell plugin (R-SEC-002/003). No DB access required.
#[tauri::command]
#[specta::specta]
pub fn list_removable_drives() -> Result<RemovableDrives, UserFacingError> {
    to_user_result(enumerate_drives())
}

/// (`backup_pick_restore_file`) Open the OS file-open dialog filtered to
/// `.hcbak` and return the chosen archive path for S17 restore Step 1
/// (BAK-003, b23-n1-d1). Lets the UI obtain a `file_path` for
/// `restore_preview` / `restore_apply` without constructing a filesystem path
/// (architecture rule). Gated by the `dialog:allow-open` capability only (no
/// fs/shell/opener scope); the dialog grants no filesystem read. When a
/// removable drive is mounted the dialog starts there (backups usually live on
/// a USB stick); otherwise it uses the OS default. No DB access, so it works
/// whether or not the app is unlocked. The chosen path is never logged
/// (R-PRIV-001). Interactive, so E2E-tested (real-picker smoke), not
/// cargo-tested.
///
/// Determinism seam (DEV/E2E ONLY, feature `e2e-test-keys`, ADR 0017): the
/// native GTK chooser cannot be driven by webdriver, so under the E2E-only
/// build feature this command FIRST consults `HC_E2E_RESTORE_FILE`; if it
/// names a path that exists, that path is returned and the dialog is skipped.
/// Same pattern as `HC_E2E_REPORT_FILE` in `visit_pick_report_file`. Compiled
/// OUT of the release/public build, which always opens the native picker.
///
/// Threading (M3-RWv5): this MUST be an async command. A sync command runs
/// inline on the GTK main thread, where a blocking dialog wait deadlocks the
/// main loop. The non-blocking `pick_file(callback)` is bridged through a
/// tokio oneshot and awaited on the async runtime instead; the drive lookup
/// (directory reads) runs on the blocking pool.
#[tauri::command]
#[specta::specta]
pub async fn backup_pick_restore_file(
    app: tauri::AppHandle,
) -> Result<PickRestoreFileResponse, UserFacingError> {
    use tauri_plugin_dialog::DialogExt as _;

    // DEV/E2E ONLY (feature e2e-test-keys): deterministic headless seam.
    // Compiled out of release (ADR 0017); the path is never logged.
    #[cfg(feature = "e2e-test-keys")]
    {
        if let Some(path) = std::env::var_os("HC_E2E_RESTORE_FILE") {
            let path = std::path::PathBuf::from(path);
            if path.exists() {
                return Ok(PickRestoreFileResponse {
                    source_path: Some(path.to_string_lossy().to_string()),
                });
            }
        }
    }

    // USB convenience: start in the first mounted removable drive, if any.
    // Directory reads run on the blocking pool, never on the async worker; a
    // failed lookup just falls back to the OS default folder.
    let start_dir = tauri::async_runtime::spawn_blocking(enumerate_drives)
        .await
        .ok()
        .and_then(|r| r.ok())
        .and_then(|d| d.drives.into_iter().next())
        .map(|d| std::path::PathBuf::from(d.path));

    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("HomeoClinic backup", &["hcbak"]);
    if let Some(dir) = start_dir {
        dialog = dialog.set_directory(dir);
    }
    dialog.pick_file(move |picked| {
        // A dropped receiver only means the command future went away.
        let _ = tx.send(picked);
    });
    // A dropped sender (dialog torn down without a callback) == cancelled.
    let chosen = rx.await.ok().flatten();

    let source_path =
        chosen.and_then(|p| p.into_path().ok().map(|p| p.to_string_lossy().to_string()));
    Ok(PickRestoreFileResponse { source_path })
}

/// (`backup_now`) Manual backup to a chosen folder or USB with a password
/// (BAK-002/004, SUX-011). The password is required and ≥ 8 chars (OQ-S17-2).
/// `remember_password` is accepted for the S17 contract; persisting it to the
/// remembered-credential keystore is wired by the shell/keystore path (SUX-011)
/// and not by this command, so the DEK-backed store stays the single owner.
#[tauri::command]
#[specta::specta]
pub fn backup_now(
    state: State<'_, AppState>,
    out_dir: String,
    password: String,
    #[allow(unused_variables)] remember_password: bool,
) -> Result<BackupNowResponse, UserFacingError> {
    to_user_result(with_service(&state, |svc| {
        svc.backup_now(&out_dir, &password)
    }))
}

/// (`restore_preview`) Read the archive counts/dates WITHOUT the password and
/// WITHOUT mutating anything (BAK-003, S17 step 2 / AC4).
#[tauri::command]
#[specta::specta]
pub fn restore_preview(
    state: State<'_, AppState>,
    file_path: String,
    #[allow(unused_variables)] password: String,
) -> Result<RestorePreview, UserFacingError> {
    // Preview reads only the plaintext header; the password is part of the S17
    // step-1 contract and is validated for real on restore_apply.
    to_user_result(with_service(&state, |svc| svc.restore_preview(&file_path)))
}

/// (`restore_apply`) Apply a restore (BAK-003): safety copy → atomic swap →
/// re-key under THIS install's DEK → migrate-if-older. Requires the app to be
/// unlocked so the retained target DEK is available (design §5 / ADR 0014); a
/// wrong backup password is refused before anything live changes (AC4).
///
/// The session continues on the restored data (b23-n1-d2): the old pool is
/// closed before the swap and a migrated pool on the restored `clinic.db` is
/// stored back in [`AppState`]. If the restored DB cannot be reopened, the app
/// is locked and `restore_reopen_failed` is returned so the UI routes to the
/// unlock screen. See [`restore_apply_in_state`].
#[tauri::command]
#[specta::specta]
pub fn restore_apply(
    state: State<'_, AppState>,
    file_path: String,
    password: String,
) -> Result<RestoreApplyResponse, UserFacingError> {
    to_user_result(restore_apply_in_state(
        &state,
        &SystemClock,
        &file_path,
        &password,
    ))
}

/// (`verify_backup`) Checksum + decrypt-test an existing archive (BAK-004).
#[tauri::command]
#[specta::specta]
pub fn verify_backup(
    state: State<'_, AppState>,
    file_path: String,
    password: String,
) -> Result<VerifyBackupResponse, UserFacingError> {
    to_user_result(with_service(&state, |svc| {
        svc.verify_backup(&file_path, &password)
    }))
}

/// (`start_move_to_new_computer`) DEFERRED (BAK-005 / HC-MVP1-035 is P1,
/// OQ-S17-4). The command exists so the S17 binding contract is stable, but the
/// real guided flow is feature-flagged OFF: it returns a generic error so the
/// UI keeps the button disabled with no dead end. The plain backup→restore path
/// already achieves the same result for R1 (S17 release-slices note). Flip
/// [`MOVE_TO_NEW_COMPUTER_ENABLED`] when BAK-005 is implemented.
#[tauri::command]
#[specta::specta]
pub fn start_move_to_new_computer(
    #[allow(unused_variables)] state: State<'_, AppState>,
    #[allow(unused_variables)] out_dir: String,
    #[allow(unused_variables)] password: String,
    #[allow(unused_variables)] remember_password: bool,
) -> Result<(), UserFacingError> {
    if !MOVE_TO_NEW_COMPUTER_ENABLED {
        // Deferred: never run a half-built flow (OQ-S17-4).
        return Err(map_error(&AppError::NotFound));
    }
    // Unreachable at R1; the real flow lands with BAK-005 in a later milestone.
    Err(map_error(&AppError::NotFound))
}
