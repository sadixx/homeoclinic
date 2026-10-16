//! A sample fallible use case proving the typed friendly-error contract
//! crosses the command boundary (HC-MVP1-018, design §018, R-ARCH-006).
//!
//! `health_check` is the first command that returns
//! `Result<T, UserFacingError>`. It exists so the error contract is exercised
//! end to end (Rust `AppError` → [`crate::error::map_error`] →
//! `UserFacingError` → `tauri-specta` → `bindings.ts`). Internal errors are
//! mapped with [`crate::error::to_user_result`]; no raw error text crosses the
//! boundary (NFR-033, R-UI-008).

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{to_user_result, AppError, UserFacingError};

/// Read-only health summary returned by [`health_check`].
///
/// Carries only safe, patient-data-free status (R-PRIV-001): whether logging
/// is initialised. Serialises with camelCase keys to match the TS binding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HealthStatus {
    /// Whether structured logging has been initialised this session.
    pub logging_ready: bool,
}

/// Pure use-case core: assemble the health status from injected facts.
///
/// Fallible by signature so the error contract is real; at M0 it always
/// succeeds. No IO, no clock, no patient data (R-ARCH-002).
pub fn run_health_check(logging_ready: bool) -> Result<HealthStatus, AppError> {
    Ok(HealthStatus { logging_ready })
}

/// Return a patient-data-free health summary for the support screen.
///
/// The one M0 command that returns `Result<_, UserFacingError>`, proving the
/// friendly-error contract crosses the boundary (R-ARCH-006, NFR-033). Any
/// internal `AppError` is mapped to [`UserFacingError`] before it reaches the
/// UI; a raw error, SQL or stack trace never crosses (R-UI-008).
#[tauri::command]
#[specta::specta]
pub fn health_check() -> Result<HealthStatus, UserFacingError> {
    to_user_result(run_health_check(true))
}
