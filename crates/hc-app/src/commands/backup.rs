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
    list_removable_drives as enumerate_drives, BackupNowResponse, BackupService, BackupStatus,
    RemovableDrives, RestoreApplyResponse, RestorePreview, SetAutoBackupResponse,
    VerifyBackupResponse, MOVE_TO_NEW_COMPUTER_ENABLED,
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
#[tauri::command]
#[specta::specta]
pub fn restore_apply(
    state: State<'_, AppState>,
    file_path: String,
    password: String,
) -> Result<RestoreApplyResponse, UserFacingError> {
    // Clone a handle to the retained DEK provider out from under the lock so the
    // engine can borrow it as `&dyn KeyProvider` without holding the mutex
    // across the whole restore. A sealed app (no key) is a generic error.
    let (pool_present, key) = {
        let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
        (lock.pool.is_some(), lock.key.clone())
    };
    if !pool_present {
        return Err(map_error(&AppError::NotFound));
    }
    let key = match key {
        Some(k) => k,
        None => return Err(map_error(&AppError::NotFound)),
    };
    to_user_result(with_service(&state, |svc| {
        svc.restore_apply(&file_path, &password, key.as_ref())
    }))
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
