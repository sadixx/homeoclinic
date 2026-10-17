//! Typed PIN lock/unlock commands (HC-MVP1-027, SET-004, SUX-003, SUX-005).
//!
//! The lock FLAG is backend-owned in [`AppState`]: `auth_unlock` opens the
//! encrypted DB and stashes the pool (unlocked); `auth_lock` drops the pool,
//! sealing the DB and zeroizing the DEK (R-SEC-006); `auth_get_lock_state`
//! reports the flag. A wrong PIN returns an error, never a soft lockout
//! (SUX-005). The idle auto-lock timer lives in the UI shell (design §3.4);
//! these commands only enforce the seal/unseal.

use tauri::State;

use crate::auth::{
    AuthService, LockState, RecoverRequest, RecoverResponse, UnlockRequest, UnlockResponse,
};
use crate::error::{to_user_result, UserFacingError};
use crate::state::AppState;

/// Build an [`AuthService`] over the managed state's keystore + data dir.
fn service(state: &AppState) -> AuthService<'_> {
    AuthService::new(state.keystore.as_ref(), &state.data_dir)
}

/// Report the current lock state (`auth_get_lock_state`).
#[tauri::command]
#[specta::specta]
pub fn auth_get_lock_state(state: State<'_, AppState>) -> Result<LockState, UserFacingError> {
    let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    Ok(LockState {
        locked: lock.locked,
        autolock_minutes: lock.autolock_minutes,
    })
}

/// Unlock by PIN (SUX-003): open the encrypted DB and stash it unlocked. A
/// wrong PIN maps to a `wrong_pin` error and leaves the app locked, never
/// restricting the next attempt (SUX-005).
#[tauri::command]
#[specta::specta]
pub fn auth_unlock(
    state: State<'_, AppState>,
    req: UnlockRequest,
) -> Result<UnlockResponse, UserFacingError> {
    let pool = to_user_result(service(&state).unlock(&req.pin))?;
    let mut lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    lock.locked = false;
    lock.pool = Some(pool);
    Ok(UnlockResponse {
        ok: true,
        // Advisory only; there is no hard lockout (SUX-005).
        attempts_remaining: 0,
    })
}

/// Lock the app (`auth_lock`): drop the open pool, sealing the DB and zeroizing
/// the DEK (R-SEC-006). Idempotent.
#[tauri::command]
#[specta::specta]
pub fn auth_lock(state: State<'_, AppState>) -> Result<(), UserFacingError> {
    let mut lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    lock.locked = true;
    lock.pool = None; // drops the pool → DEK zeroized on drop.
    Ok(())
}

/// Forgot-PIN recovery (SET-004): reset the PIN via the recovery code. A wrong
/// code maps to `wrong_recovery_code`. Leaves the app locked; the user then
/// unlocks with the new PIN.
#[tauri::command]
#[specta::specta]
pub fn auth_recover_with_code(
    state: State<'_, AppState>,
    req: RecoverRequest,
) -> Result<RecoverResponse, UserFacingError> {
    to_user_result(service(&state).recover(&req.recovery_code, &req.new_pin, &req.confirm_pin))?;
    Ok(RecoverResponse { ok: true })
}
