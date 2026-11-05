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
    ///
    /// After a successful open the schema is brought up to this build's
    /// latest version with [`hc_storage::migrate::run`] BEFORE the pool is
    /// returned, so an install upgraded from an older release is migrated on
    /// its first unlock (b21-d1, NFR-011, R-DEL-004). `migrate::run` keeps its
    /// guarantees: a pre-migration backup of a non-empty DB, forward-only
    /// steps, and a refused downgrade (`SchemaTooNew`). An already-latest DB
    /// is a no-op (no backup), so the setup and restore paths, which migrate
    /// themselves, are not migrated twice. A wrong PIN fails before the DB is
    /// opened and therefore never migrates. On a migration failure the pool is
    /// dropped and the error returned, so the caller stays locked.
    pub fn unlock(&self, pin: &str) -> Result<Pool, AppError> {
        let dek = KeyHierarchy::new(self.keystore).unlock_with_pin(pin)?;
        let pool = Pool::open(&self.db_path(), &dek)?;
        hc_storage::migrate::run(&pool)?;
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

/// The idle auto-lock minutes used when none was ever saved.
pub const DEFAULT_AUTOLOCK_MINUTES: u16 = 15;

/// MS (F5): the persisted `autolock_minutes` of the open DB, or
/// [`DEFAULT_AUTOLOCK_MINUTES`] when unset or unreadable (a read error never
/// fails the caller's unlock / restore / move).
pub fn persisted_autolock(pool: &Pool) -> u16 {
    pool.with_reader(hc_storage::settings::read_autolock_minutes)
        .ok()
        .flatten()
        .unwrap_or(DEFAULT_AUTOLOCK_MINUTES)
}

/// MS (design §3.2, F5): the `auth_unlock` command body over the managed
/// state — open + migrate the DB at the CURRENT data folder, retain the DEK,
/// and restore the persisted `autolock_minutes` into the lock flag (15 when
/// unset or unreadable). A wrong PIN leaves the app locked (SUX-005: no
/// lockout, the next correct attempt works).
pub fn unlock_in_state(
    state: &crate::state::AppState,
    pin: &str,
) -> Result<UnlockResponse, AppError> {
    let data_dir = state.data_dir();
    let pool = AuthService::new(state.keystore.as_ref(), &data_dir).unlock(pin)?;
    // Re-derive the DEK provider from the keystore so a later restore or
    // data-folder move can re-key / verify under THIS install's own DEK
    // without a second PIN prompt (design §5 / ADR 0014, SUX-011). This is the
    // unlock path (not the hot path), so one extra Argon2id unwrap is
    // acceptable; the DEK never leaves the process and is never logged
    // (R-SEC-006, R-PRIV-001). A key that cannot be re-derived leaves
    // `key = None`; restore / move then report a generic error rather than
    // failing unlock.
    let key = KeyHierarchy::new(state.keystore.as_ref())
        .unlock_with_pin(pin)
        .ok()
        .map(std::sync::Arc::new);
    let autolock = persisted_autolock(&pool);
    let mut lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    lock.locked = false;
    lock.pool = Some(pool);
    lock.key = key;
    lock.autolock_minutes = autolock;
    Ok(UnlockResponse {
        ok: true,
        // Advisory only; there is no hard lockout (SUX-005).
        attempts_remaining: 0,
    })
}
