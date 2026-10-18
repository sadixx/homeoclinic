//! PIN lock/unlock use-case service (HC-MVP1-027, SET-004, SUX-003, SUX-005).
//!
//! Over the Slice B `KeyHierarchy`: `unlock` derives the DEK from the PIN and
//! actually opens the encrypted [`Pool`] (a wrong PIN can never yield a usable
//! pool — this IS the correctness proof); `recover` unwraps with the recovery
//! code then changes the PIN. The lock FLAG itself lives in the shell's managed
//! `AppState` (see `crate::state`); this service performs the crypto.
//! Dependencies are injected (R-ARCH-002, R-TEST-006).
//!
//! No hard lockout (SUX-005): a wrong PIN returns a mapped `WrongPin` error and
//! never restricts a later correct attempt.
//!
//! STUB STATE (Slice C red): returns `Err`/defaults so tests fail on
//! assertions. `hc-core-dev` implements to green.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use specta::Type;

use hc_storage::key::KeyHierarchy;
use hc_storage::keystore::Keystore;
use hc_storage::Pool;

use crate::error::AppError;

/// Lock-screen state (`auth_get_lock_state`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LockState {
    /// Whether the app is currently locked.
    pub locked: bool,
    /// Idle auto-lock timeout in minutes (the UI runs the idle timer).
    pub autolock_minutes: u16,
}

/// Unlock input (`auth_unlock`). `pin` is a request-only secret.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UnlockRequest {
    /// The entered PIN.
    pub pin: String,
}

/// Unlock result. `attempts_remaining` is a soft, non-restricting hint
/// (SUX-005 forbids false lockouts); a wrong PIN returns an error, not
/// `ok:false`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UnlockResponse {
    /// Whether the unlock succeeded.
    pub ok: bool,
    /// Advisory remaining-attempts hint; never gates access.
    pub attempts_remaining: u8,
}

/// Forgot-PIN recovery input (`auth_recover_with_code`, SET-004).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecoverRequest {
    /// The recovery code shown once at setup.
    pub recovery_code: String,
    /// The new PIN to set.
    pub new_pin: String,
    /// Confirmation; must equal `new_pin`.
    pub confirm_pin: String,
}

/// Recovery result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecoverResponse {
    /// Whether the recovery + PIN reset succeeded.
    pub ok: bool,
}

/// Auth/lock use-case service. Injected `Keystore` + data dir.
pub struct AuthService<'a> {
    #[allow(dead_code)]
    keystore: &'a dyn Keystore,
    #[allow(dead_code)]
    data_dir: &'a Path,
}

impl<'a> AuthService<'a> {
    /// Bind the service to its dependencies.
    pub fn new(keystore: &'a dyn Keystore, data_dir: &'a Path) -> Self {
        AuthService { keystore, data_dir }
    }

    /// Unlock by PIN: unwrap the DEK and open the encrypted [`Pool`]. A wrong
    /// PIN maps to [`AppError::WrongPin`] and yields no pool (SUX-005: the next
    /// correct attempt still works).
    pub fn unlock(&self, pin: &str) -> Result<Pool, AppError> {
        let dek = KeyHierarchy::new(self.keystore).unlock_with_pin(pin)?;
        let pool = Pool::open(&self.db_path(), &dek)?;
        Ok(pool)
    }

    /// Reset the PIN via the recovery code (unwrap with code, then change PIN).
    /// A wrong code maps to [`AppError::WrongRecoveryCode`]; a mismatched
    /// confirmation or a PIN that breaks policy is a validation error.
    pub fn recover(
        &self,
        recovery_code: &str,
        new_pin: &str,
        confirm_pin: &str,
    ) -> Result<(), AppError> {
        // New PIN must satisfy the same policy as setup (A3).
        let len_ok = (4..=6).contains(&new_pin.chars().count());
        let digits_ok = !new_pin.is_empty() && new_pin.chars().all(|c| c.is_ascii_digit());
        if !len_ok || !digits_ok || new_pin != confirm_pin {
            return Err(AppError::Validation(hc_domain::error::DomainError::Invalid));
        }

        let hierarchy = KeyHierarchy::new(self.keystore);
        // Re-wrap the DEK under the new PIN, authorised by the recovery code.
        // A wrong code maps to WrongRecoveryCode and changes nothing; on
        // success the new PIN unlocks and the old PIN no longer does.
        hierarchy.reset_pin_with_recovery_code(recovery_code, new_pin)?;
        Ok(())
    }

    /// The encrypted database file path within the data dir.
    fn db_path(&self) -> PathBuf {
        self.data_dir.join("clinic.db")
    }
}
