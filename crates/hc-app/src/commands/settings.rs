//! S18 Settings typed commands (MS; design §1.2).
//!
//! One thin `#[tauri::command] #[specta::specta]` wrapper per use case
//! (R-ARCH-005), returning `Result<T, UserFacingError>` via [`to_user_result`]
//! (R-ARCH-006, R-UI-008). The folder picker is async and non-blocking (never
//! a `blocking_pick_*` on the GTK main thread); the move runs on the blocking
//! pool. No path is ever logged (R-PRIV-001). No network.

use tauri::{Manager, State};

use crate::data_folder;
use crate::error::{map_error, to_user_result, AppError, UserFacingError};
use crate::settings::{
    DataFolderCheck, LicenceIdentityLock, MoveDataFolderRequest, MoveDataFolderResponse,
    PickDataFolderResponse, SaveGeneralSettingsRequest, SaveGeneralSettingsResponse,
    SettingsService, SettingsView,
};
use crate::state::AppState;

/// Read the S18 General values (`settings_get`).
#[tauri::command]
#[specta::specta]
pub fn settings_get(state: State<'_, AppState>) -> Result<SettingsView, UserFacingError> {
    let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    let pool = to_user_result(lock.pool.as_ref().ok_or(AppError::NotFound))?;
    let identity = LicenceIdentityLock;
    to_user_result(
        SettingsService::new(state.clock.as_ref(), &identity).get(pool, &state.data_dir()),
    )
}

/// Save the whole S18 General form: one transaction, one audit row
/// (`settings_save_general`).
#[tauri::command]
#[specta::specta]
pub fn settings_save_general(
    state: State<'_, AppState>,
    req: SaveGeneralSettingsRequest,
) -> Result<SaveGeneralSettingsResponse, UserFacingError> {
    let mut lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    let pool = to_user_result(lock.pool.clone().ok_or(AppError::NotFound))?;
    let identity = LicenceIdentityLock;
    let resp = to_user_result(
        SettingsService::new(state.clock.as_ref(), &identity).save_general(
            &pool,
            &state.data_dir(),
            req,
        ),
    )?;
    // A new idle timeout applies at once (auth_get_lock_state reports it).
    lock.autolock_minutes = resp.settings.app.autolock_minutes;
    Ok(resp)
}

/// Open the OS folder picker for a new data-folder parent
/// (`settings_pick_data_folder`). `None` = cancelled.
#[tauri::command]
#[specta::specta]
pub async fn settings_pick_data_folder(
    app: tauri::AppHandle,
) -> Result<PickDataFolderResponse, UserFacingError> {
    use tauri_plugin_dialog::DialogExt as _;

    // DEV/E2E ONLY (feature e2e-test-keys): deterministic headless seam, same
    // pattern as HC_E2E_RESTORE_FILE. Compiled out of release (ADR 0017); the
    // path is never logged.
    #[cfg(feature = "e2e-test-keys")]
    {
        if let Some(path) = std::env::var_os("HC_E2E_DATA_FOLDER") {
            let path = std::path::PathBuf::from(path);
            if path.is_dir() {
                return Ok(PickDataFolderResponse {
                    parent_path: Some(path.to_string_lossy().to_string()),
                });
            }
        }
    }

    // Non-blocking picker bridged through a oneshot (a blocking wait on the
    // GTK main thread deadlocks the main loop; M3-RWv5).
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |picked| {
        // A dropped receiver only means the command future went away.
        let _ = tx.send(picked);
    });
    // A dropped sender (dialog torn down without a callback) == cancelled.
    let chosen = rx.await.ok().flatten();
    let parent_path =
        chosen.and_then(|p| p.into_path().ok().map(|p| p.to_string_lossy().to_string()));
    Ok(PickDataFolderResponse { parent_path })
}

/// Move the data folder to `<parent>/HomeoClinic` (`settings_move_data_folder`).
#[tauri::command]
#[specta::specta]
pub async fn settings_move_data_folder(
    app: tauri::AppHandle,
    req: MoveDataFolderRequest,
) -> Result<MoveDataFolderResponse, UserFacingError> {
    // Copying + hashing the data can take seconds to minutes: run it on the
    // blocking pool, never on the async worker (R-RUST-003).
    let app_for_panic = app.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        data_folder::move_data_folder_in_state(&state, state.clock.as_ref(), &req.parent_path)
    })
    .await;
    match joined {
        Ok(result) => to_user_result(result),
        // A panicked worker: the pointer may already be written and the pool
        // may be gone. Seal and route to /lock (ms-review-7).
        Err(_) => {
            data_folder::seal_after_failed_move(&app_for_panic.state::<AppState>());
            Err(map_error(&AppError::DataFolderReopenFailed))
        }
    }
}

/// Check again whether the pointed data folder is present
/// (`settings_recheck_data_folder`).
#[tauri::command]
#[specta::specta]
pub fn settings_recheck_data_folder(
    state: State<'_, AppState>,
) -> Result<DataFolderCheck, UserFacingError> {
    to_user_result(data_folder::recheck_in_state(&state))
}

/// Forget the missing pointed folder and use the default location
/// (`settings_forget_data_folder`).
#[tauri::command]
#[specta::specta]
pub fn settings_forget_data_folder(state: State<'_, AppState>) -> Result<(), UserFacingError> {
    to_user_result(data_folder::forget_in_state(&state))
}
