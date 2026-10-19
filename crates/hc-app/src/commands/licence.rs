//! Typed licence-status command (Feature 1 + LIC-005, HC-MVP1-M1a).
//!
//! One thin `#[tauri::command] #[specta::specta]` wrapper (R-ARCH-005). Reads
//! the open encrypted pool + the install DEK provider from the shell-managed
//! lock flag, builds a [`LicenceService`] over the injected clock, and returns
//! the current [`LicenceStatus`] via [`to_user_result`] so no raw internal
//! error crosses the boundary (R-ARCH-006, R-UI-008). A sealed DB (no pool /
//! no DEK) is `NotFound`; the status bar falls back to a dash.

use tauri::State;

use crate::error::{map_error, to_user_result, AppError, UserFacingError};
use crate::licence::{LicenceService, LicenceStatus};
use crate::state::AppState;

/// Read the current licence status (`get_licence_status`).
#[tauri::command]
#[specta::specta]
pub fn get_licence_status(state: State<'_, AppState>) -> Result<LicenceStatus, UserFacingError> {
    let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    match (lock.pool.as_ref(), lock.key.as_ref()) {
        (Some(pool), Some(key)) => {
            let svc = LicenceService::new(state.clock.as_ref(), key.as_ref());
            to_user_result(svc.get_licence_status(pool))
        }
        _ => Err(map_error(&AppError::NotFound)),
    }
}
