//! Data-folder location pointer + live relocation (MS, SET-006, ADR 0020;
//! design §3.4).
//!
//! The OS app data dir is the fixed *home*: it keeps `logs/` and the small,
//! non-secret pointer `data-location.json` (`{"version":1,"dataDir":".."}`).
//! No pointer = the data lives in home (every install before MS, R-DEL-004).
//! A move copies + verifies the data into `<parent>/HomeoClinic`, commits by
//! atomically writing the pointer, switches the running app to the new folder
//! and only then turns the old data into a `moved-out-<stamp>` safety copy.
//!
//! No path is ever logged (R-PRIV-001). No network, no shell.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use hc_storage::key::DekKeyProvider;
use hc_storage::{relocate, Pool, StorageError};

use crate::clock::Clock;
use crate::error::AppError;
use crate::settings::{DataFolderCheck, MoveDataFolderResponse};
use crate::state::{AppState, LockFlag};

/// Pointer file in the fixed home: `{"version":1,"dataDir":".."}`.
pub const LOCATION_FILE: &str = "data-location.json";
/// Temp name used for the atomic pointer write.
const LOCATION_TMP: &str = "data-location.json.tmp";
/// Pointer format version.
const LOCATION_VERSION: u32 = 1;

/// On-disk pointer format.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocationFile {
    version: u32,
    data_dir: String,
}

/// Where the data lives, resolved from the pointer in the home dir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DataDirResolution {
    /// No pointer: the data lives in the home dir.
    Default(PathBuf),
    /// A valid pointer to a present folder.
    Custom(PathBuf),
    /// A pointer to a folder that is not present (e.g. unplugged drive).
    Missing(PathBuf),
}

/// Resolve the data dir from `<home>/data-location.json`.
///
/// No pointer → `Default(home)`. A pointer naming home → `Default(home)`. A
/// pointer naming a present folder → `Custom`, an absent one → `Missing` (the
/// caller never creates anything there). A pointer with no readable absolute
/// path falls back to `Default(home)` with a warning that carries no path.
pub fn resolve_data_dir(home: &Path) -> DataDirResolution {
    let raw = match std::fs::read(home.join(LOCATION_FILE)) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return DataDirResolution::Default(home.to_path_buf());
        }
        Err(_) => {
            tracing::warn!("data-location pointer unreadable; using the default data folder");
            return DataDirResolution::Default(home.to_path_buf());
        }
    };
    let path = serde_json::from_slice::<LocationFile>(&raw)
        .ok()
        .map(|f| PathBuf::from(f.data_dir))
        .filter(|p| p.is_absolute());
    match path {
        None => {
            tracing::warn!("data-location pointer invalid; using the default data folder");
            DataDirResolution::Default(home.to_path_buf())
        }
        Some(p) if p == home => DataDirResolution::Default(home.to_path_buf()),
        Some(p) if p.is_dir() => DataDirResolution::Custom(p),
        Some(p) => DataDirResolution::Missing(p),
    }
}

/// Atomically write the pointer (`.tmp`, fsync, rename); writing `home` itself
/// removes it.
pub fn write_location(home: &Path, data_dir: &Path) -> Result<(), AppError> {
    if data_dir == home {
        return clear_location(home);
    }
    let data_dir = data_dir
        .to_str()
        .ok_or(AppError::DataFolderInvalid)?
        .to_string();
    let body = serde_json::to_vec(&LocationFile {
        version: LOCATION_VERSION,
        data_dir,
    })
    .map_err(|e| AppError::from(StorageError::from(e)))?;
    let tmp = home.join(LOCATION_TMP);
    let io = |e: std::io::Error| AppError::from(StorageError::Io(e));
    {
        let mut file = std::fs::File::create(&tmp).map_err(io)?;
        file.write_all(&body).map_err(io)?;
        file.sync_all().map_err(io)?;
    }
    std::fs::rename(&tmp, home.join(LOCATION_FILE)).map_err(io)?;
    Ok(())
}

/// Remove the pointer (back to the default location). Absent is fine.
pub fn clear_location(home: &Path) -> Result<(), AppError> {
    match std::fs::remove_file(home.join(LOCATION_FILE)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::from(StorageError::Io(e))),
    }
}

/// Open + migrate the DB in `dir` with the retained DEK.
fn open_pool(dir: &Path, key: &DekKeyProvider) -> Result<Pool, StorageError> {
    let pool = Pool::open(&dir.join("clinic.db"), key)?;
    hc_storage::migrate::run(&pool)?;
    Ok(pool)
}

/// Seal the app: no pool, no key (the DEK is zeroized on drop, R-SEC-006).
fn seal(lock: &mut LockFlag) {
    lock.pool = None;
    lock.key = None;
    lock.locked = true;
}

/// Reopen the untouched old folder after a failed move and return `err`; if
/// even that reopen fails, seal and report [`AppError::DataFolderReopenFailed`].
fn reopen_old(
    lock: &mut LockFlag,
    current: &Path,
    key: &DekKeyProvider,
    err: AppError,
) -> AppError {
    match open_pool(current, key) {
        Ok(pool) => {
            lock.pool = Some(pool);
            lock.locked = false;
            err
        }
        Err(_) => {
            seal(lock);
            AppError::DataFolderReopenFailed
        }
    }
}

/// `20261104T154718Z` from `2026-11-04T15:47:18Z` (safety-copy folder stamp).
fn stamp_from(now_rfc3339: &str) -> String {
    now_rfc3339
        .chars()
        .filter(|c| *c != '-' && *c != ':')
        .collect()
}

/// `settings_move_data_folder` body (design §3.4 steps 1–10).
///
/// Holds `state.lock` for the whole operation so no other command can use the
/// pool mid-move. Requires the app to be unlocked (open pool + retained DEK),
/// else [`AppError::NotFound`] and nothing is touched. An unusable target →
/// [`AppError::DataFolderInvalid`] with the pool untouched. A copy, verify or
/// pointer failure → the old folder is reopened and
/// [`AppError::DataFolderMoveFailed`]. A failed reopen on the new folder after
/// the pointer was written (or a switch failure whose pointer undo also
/// failed) → sealed + [`AppError::DataFolderReopenFailed`] (PIN unlock then
/// opens the current folder).
pub fn move_data_folder_in_state(
    state: &AppState,
    clock: &dyn Clock,
    parent: &str,
) -> Result<MoveDataFolderResponse, AppError> {
    let mut lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    if lock.locked || lock.pool.is_none() {
        return Err(AppError::NotFound);
    }
    let key = lock.key.clone().ok_or(AppError::NotFound)?;
    let current = state.data_dir();
    let target = relocate::plan_target(&current, Path::new(parent))?;

    // Close every connection (WAL checkpointed) before copying the files.
    drop(lock.pool.take());

    if relocate::copy_verified(&current, &target, key.as_ref()).is_err() {
        return Err(reopen_old(
            &mut lock,
            &current,
            &key,
            AppError::DataFolderMoveFailed,
        ));
    }

    // Commit point: the pointer names the verified copy.
    if write_location(&state.home_dir, &target).is_err() {
        let _ = std::fs::remove_dir_all(&target);
        return Err(reopen_old(
            &mut lock,
            &current,
            &key,
            AppError::DataFolderMoveFailed,
        ));
    }
    if state.switch_location(target.clone()).is_err() {
        // The keystore at the copy cannot be opened: undo the pointer and stay
        // on the old folder.
        let undone = write_location(&state.home_dir, &current).is_ok();
        if !undone {
            // The pointer still names the NEW copy: reopening the old folder
            // would let edits land where the next launch no longer looks.
            // Seal instead (ms-review-4).
            seal(&mut lock);
            return Err(AppError::DataFolderReopenFailed);
        }
        let _ = std::fs::remove_dir_all(&target);
        return Err(reopen_old(
            &mut lock,
            &current,
            &key,
            AppError::DataFolderMoveFailed,
        ));
    }

    let pool = match open_pool(&target, &key) {
        Ok(pool) => pool,
        Err(_) => {
            seal(&mut lock);
            return Err(AppError::DataFolderReopenFailed);
        }
    };

    // One transaction, one audit row on the NEW database (R-DATA-001).
    let now = clock.now_rfc3339();
    let target_display = target.display().to_string();
    let value = serde_json::to_string(&target_display).map_err(StorageError::from)?;
    let audited = pool.with_writer(|c| {
        let tx = c.transaction()?;
        hc_storage::profile::put_setting(&tx, "data_dir", &value, &now)?;
        tx.commit()?;
        Ok(())
    });
    if audited.is_err() {
        // The move itself is committed (pointer + switch); the setting row is
        // informational only.
        tracing::warn!("data folder moved; recording the new location in settings failed");
    }
    lock.autolock_minutes = crate::auth::persisted_autolock(&pool);
    lock.pool = Some(pool);
    lock.locked = false;

    // Safety copy of the old data (never deleted). Non-fatal on failure.
    let stamp = stamp_from(&now);
    let safety = match relocate::retire_old(&current, &stamp) {
        Ok(dir) => dir,
        Err(_) => {
            tracing::warn!("data folder moved; the old data could not be set aside");
            // Some entries may already sit in the safety folder: point the
            // doctor there whenever it was created (ms-review-6).
            let partial = relocate::safety_dir(&current, &stamp);
            if partial.is_dir() {
                partial
            } else {
                current.clone()
            }
        }
    };
    tracing::info!("data folder moved");

    Ok(MoveDataFolderResponse {
        data_folder: target_display,
        safety_copy_folder: safety.display().to_string(),
    })
}

/// Fail-safe after the move worker panicked (ms-review-7): the pointer may or
/// may not be written and the pool may be gone, so seal the session (no pool,
/// no key, locked). PIN unlock then reopens whatever folder is current.
pub fn seal_after_failed_move(state: &AppState) {
    let mut lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    seal(&mut lock);
}

/// `settings_recheck_data_folder` body: when the pointed folder is back, switch
/// to it and clear the missing flag.
pub fn recheck_in_state(state: &AppState) -> Result<DataFolderCheck, AppError> {
    let _lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    let mut missing = state
        .data_folder_missing
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    let Some(path) = missing.clone() else {
        return Ok(DataFolderCheck {
            available: true,
            data_folder: state.data_dir().display().to_string(),
        });
    };
    if !path.is_dir() {
        return Ok(DataFolderCheck {
            available: false,
            data_folder: path.display().to_string(),
        });
    }
    state.switch_location(path.clone())?;
    *missing = None;
    Ok(DataFolderCheck {
        available: true,
        data_folder: path.display().to_string(),
    })
}

/// `settings_forget_data_folder` body: remove the pointer and continue on the
/// default folder (the data on the missing drive is not touched).
pub fn forget_in_state(state: &AppState) -> Result<(), AppError> {
    let _lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    let mut missing = state
        .data_folder_missing
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    clear_location(&state.home_dir)?;
    if state.data_dir() != state.home_dir {
        state.switch_location(state.home_dir.clone())?;
    }
    *missing = None;
    Ok(())
}
