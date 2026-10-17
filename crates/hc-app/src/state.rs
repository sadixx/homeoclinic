//! Shell-managed application state (HC-MVP1-026/027, design §4).
//!
//! Holds the injected dependencies the typed commands read: the resolved data
//! directory, the keystore backend (OS store or the encrypted-file fallback —
//! NFR-020), the runtime [`Clock`], the backend-owned lock flag, and the
//! pre-DB setup staging buffer. The lock flag owns the open encrypted [`Pool`]
//! and the DEK it carries: `auth_lock` drops the pool (sealing the DB,
//! zeroizing the DEK — R-SEC-006), `auth_unlock` opens and stashes it. The idle
//! auto-lock TIMER lives in the UI shell (it observes webview activity); this
//! state only enforces the seal/unseal (design §3.4).
//!
//! All fields are behind a [`Mutex`] so the single managed state is shared
//! across command invocations safely. No field is ever logged (R-PRIV-001).

use std::path::PathBuf;
use std::sync::Mutex;

use hc_storage::keystore::Keystore;
use hc_storage::Pool;

use crate::clock::Clock;
use crate::setup::SaveClinicProfileRequest;
use crate::setup::SaveDoctorProfileRequest;

/// The backend-owned lock flag plus the open DB it guards.
///
/// `locked == true` means the DB is sealed: `pool` is `None` and no data is
/// reachable until a correct PIN (or recovery) reopens it.
#[derive(Default)]
pub struct LockFlag {
    /// Whether the app is currently locked (DB sealed).
    pub locked: bool,
    /// The open encrypted pool while unlocked; dropped on lock (R-SEC-006).
    pub pool: Option<Pool>,
    /// The configured idle auto-lock timeout in minutes (the UI runs the timer).
    pub autolock_minutes: u16,
}

/// Validated-but-not-yet-persisted wizard input, flushed into the DB by
/// `setup_set_pin` once the DEK exists (design §3.2). Stored as the original
/// requests so `setup_set_pin` can run the same service validation + write path
/// as the service tests.
#[derive(Default)]
pub struct CommandStaging {
    /// The staged doctor profile request, if the doctor step has run.
    pub doctor: Option<SaveDoctorProfileRequest>,
    /// The staged clinic profile request, if the clinic step has run.
    pub clinic: Option<SaveClinicProfileRequest>,
}

/// Shell-managed application state (Tauri `.manage`d).
pub struct AppState {
    /// The resolved per-user data directory (DB + keystore live under it).
    pub data_dir: PathBuf,
    /// The keystore backend resolved by the shell (OS store or file fallback).
    pub keystore: Box<dyn Keystore>,
    /// The runtime clock (RFC3339 UTC timestamps).
    pub clock: Box<dyn Clock>,
    /// The backend-owned lock flag + open pool.
    pub lock: Mutex<LockFlag>,
    /// The pre-DB setup staging buffer.
    pub staging: Mutex<CommandStaging>,
}

impl AppState {
    /// Build the managed state from the shell-resolved dependencies.
    pub fn new(data_dir: PathBuf, keystore: Box<dyn Keystore>, clock: Box<dyn Clock>) -> Self {
        AppState {
            data_dir,
            keystore,
            clock,
            lock: Mutex::new(LockFlag {
                // Fresh process starts locked until setup completes or the user
                // unlocks; the shell routes to /setup or /lock accordingly.
                locked: true,
                pool: None,
                autolock_minutes: 15,
            }),
            staging: Mutex::new(CommandStaging::default()),
        }
    }

    /// Build the managed state for the desktop shell using the always-present
    /// encrypted-file fallback keystore rooted at `data_dir` (NFR-020) and the
    /// runtime [`crate::clock::SystemClock`].
    ///
    /// This keeps the Tauri shell dependent only on `hc-app` (it never names
    /// `hc-storage` directly). On headless Linux / E2E this is the correct,
    /// operational backend; no network and no socket are opened.
    pub fn with_file_keystore(data_dir: PathBuf) -> Result<Self, hc_storage::StorageError> {
        let keystore: Box<dyn Keystore> =
            Box::new(hc_storage::keystore::FileKeystore::open(&data_dir)?);
        let clock: Box<dyn Clock> = Box::new(crate::clock::SystemClock);
        Ok(Self::new(data_dir, keystore, clock))
    }
}
