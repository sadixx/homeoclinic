//! Shell-managed application state (HC-MVP1-026/027, design §4; MS ADR 0020).
//!
//! Holds the injected dependencies the typed commands read: the fixed home
//! dir, the CURRENT data folder and its keystore (switchable at runtime by a
//! data-folder move, ADR 0020), the runtime [`Clock`], the backend-owned lock
//! flag, and the pre-DB setup staging buffer. The lock flag owns the open
//! encrypted [`Pool`] and the DEK it carries: `auth_lock` drops the pool
//! (sealing the DB, zeroizing the DEK — R-SEC-006), `auth_unlock` opens and
//! stashes it. The idle auto-lock TIMER lives in the UI shell (it observes
//! webview activity); this state only enforces the seal/unseal (design §3.4).
//!
//! Lock order: [`AppState::lock`] then the internal location lock. No field is
//! ever logged (R-PRIV-001).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use hc_storage::key::DekKeyProvider;
use hc_storage::keystore::{Keystore, KeystoreRecord};
use hc_storage::{Pool, StorageError};

use crate::clock::Clock;
use crate::data_folder::{resolve_data_dir, DataDirResolution};
use crate::error::AppError;
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
    /// The target install's own DEK provider while unlocked, retained so a
    /// restore can re-key the restored `clinic.db` under THIS install's DEK
    /// without a second PIN prompt (design §5 / ADR 0014, SUX-011). Wrapped in
    /// an [`Arc`] so a command can clone a handle out from under the lock and
    /// pass `&dyn KeyProvider` to the engine. Dropped on lock with the pool so
    /// the DEK is zeroized when sealed (R-SEC-006). Never logged (R-PRIV-001).
    pub key: Option<Arc<DekKeyProvider>>,
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

/// Opens the keystore that lives in a data folder (ADR 0020: the file keystore
/// moves with the data).
pub type KeystoreFactory = fn(&Path) -> Result<Box<dyn Keystore>, StorageError>;

/// The production factory: the encrypted-file keystore at `<dir>/licence/`.
fn file_keystore_factory(dir: &Path) -> Result<Box<dyn Keystore>, StorageError> {
    Ok(Box::new(hc_storage::keystore::FileKeystore::open(dir)?))
}

/// The current data folder and the keystore bound to it.
struct DataLocation {
    dir: PathBuf,
    keystore: Arc<dyn Keystore>,
}

/// A [`Keystore`] that always delegates to the CURRENT location's keystore, so
/// `state.keystore` stays correct after a data-folder switch.
struct LiveKeystore(Arc<RwLock<DataLocation>>);

impl LiveKeystore {
    fn current(&self) -> Arc<dyn Keystore> {
        let loc = self.0.read().unwrap_or_else(|p| p.into_inner());
        Arc::clone(&loc.keystore)
    }
}

impl Keystore for LiveKeystore {
    fn load(&self) -> Result<Option<KeystoreRecord>, StorageError> {
        self.current().load()
    }
    fn store(&self, record: &KeystoreRecord) -> Result<(), StorageError> {
        self.current().store(record)
    }
    fn backend_name(&self) -> &'static str {
        self.current().backend_name()
    }
}

/// Shell-managed application state (Tauri `.manage`d).
pub struct AppState {
    /// The keystore of the CURRENT data folder (follows a data-folder switch).
    pub keystore: Box<dyn Keystore>,
    /// The runtime clock (RFC3339 UTC timestamps).
    pub clock: Box<dyn Clock>,
    /// The backend-owned lock flag + open pool.
    pub lock: Mutex<LockFlag>,
    /// The pre-DB setup staging buffer.
    pub staging: Mutex<CommandStaging>,
    /// MS (ADR 0020): the fixed home dir (logs + `data-location.json`).
    pub home_dir: PathBuf,
    /// MS (ADR 0020): the pointed data folder when it is not present at boot.
    pub data_folder_missing: Mutex<Option<PathBuf>>,
    location: Arc<RwLock<DataLocation>>,
    keystore_factory: KeystoreFactory,
}

impl AppState {
    /// Build the managed state from the shell-resolved dependencies. The home
    /// dir equals `data_dir` and no pointer is consulted (tests).
    pub fn new(data_dir: PathBuf, keystore: Box<dyn Keystore>, clock: Box<dyn Clock>) -> Self {
        Self::build(data_dir.clone(), data_dir, keystore, clock, None)
    }

    fn build(
        home_dir: PathBuf,
        data_dir: PathBuf,
        keystore: Box<dyn Keystore>,
        clock: Box<dyn Clock>,
        missing: Option<PathBuf>,
    ) -> Self {
        let location = Arc::new(RwLock::new(DataLocation {
            dir: data_dir,
            keystore: Arc::from(keystore),
        }));
        AppState {
            home_dir,
            data_folder_missing: Mutex::new(missing),
            keystore: Box::new(LiveKeystore(Arc::clone(&location))),
            clock,
            lock: Mutex::new(LockFlag {
                // Fresh process starts locked until setup completes or the user
                // unlocks; the shell routes to /setup or /lock accordingly.
                locked: true,
                pool: None,
                key: None,
                autolock_minutes: 15,
            }),
            staging: Mutex::new(CommandStaging::default()),
            location,
            keystore_factory: file_keystore_factory,
        }
    }

    /// Build the managed state for the desktop shell from the fixed `home`
    /// dir: resolve `<home>/data-location.json` (ADR 0020), then open the
    /// encrypted-file fallback keystore (NFR-020) at the resolved data folder
    /// and use the runtime [`crate::clock::SystemClock`].
    ///
    /// A pointer to a folder that is not present never creates anything
    /// there: the state starts on `home` with [`AppState::data_folder_missing`]
    /// set, and the UI shows the "data folder not available" screen. No
    /// network and no socket are opened.
    pub fn with_file_keystore(home: PathBuf) -> Result<Self, StorageError> {
        let (data_dir, missing) = match resolve_data_dir(&home) {
            DataDirResolution::Default(dir) | DataDirResolution::Custom(dir) => (dir, None),
            DataDirResolution::Missing(dir) => (home.clone(), Some(dir)),
        };
        let keystore = file_keystore_factory(&data_dir)?;
        let clock: Box<dyn Clock> = Box::new(crate::clock::SystemClock);
        Ok(Self::build(home, data_dir, keystore, clock, missing))
    }

    /// The CURRENT data folder (clone under the read lock).
    pub fn data_dir(&self) -> PathBuf {
        let loc = self.location.read().unwrap_or_else(|p| p.into_inner());
        loc.dir.clone()
    }

    /// Swap the data folder + keystore (ADR 0020). The keystore is opened
    /// first; on error nothing changes. Callers performing a move hold
    /// [`AppState::lock`] (lock order: `lock` then location).
    pub fn switch_location(&self, dir: PathBuf) -> Result<(), AppError> {
        let keystore = (self.keystore_factory)(&dir)?;
        let mut loc = self.location.write().unwrap_or_else(|p| p.into_inner());
        loc.dir = dir;
        loc.keystore = Arc::from(keystore);
        Ok(())
    }
}
