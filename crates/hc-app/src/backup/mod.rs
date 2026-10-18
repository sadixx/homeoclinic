//! Backup / restore use-case service (HC-MVP1-030..034, BAK-001..004,
//! SUX-011).
//!
//! The service layer between the typed Tauri commands (`crate::commands::
//! backup`) and the storage [`BackupEngine`]. It owns the use-case policy the
//! engine deliberately leaves out:
//!
//! - the minimum backup-password rule (OQ-S17-2: required, ≥ 8 characters);
//! - the `auto_enabled` toggle persisted as one audited `app_setting` write
//!   (R-DATA-001);
//! - the removable-drive enumeration for the USB picker (a typed command, NOT
//!   a broad FS scope or the shell plugin — R-SEC-002/003);
//! - shaping the engine results into the S17 response structs.
//!
//! Dependencies are injected (R-ARCH-002): the open [`Pool`], the data-dir
//! root, a storage [`Clock`], and — for restore — the target install's own
//! [`KeyProvider`] so the restored DB opens under THIS install's keystore
//! (design §5 / ADR 0014). No network, no patient data in logs (NFR-022,
//! R-PRIV-001). The backup password is a request-only secret: it is passed to
//! the engine and never persisted or logged (remembering it on this PC is a
//! keystore concern — SUX-011).

use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use hc_storage::backup::{BackupEngine, BackupStatus as EngineStatus};
use hc_storage::clock::Clock;
use hc_storage::key::KeyProvider;
use hc_storage::Pool;

use crate::error::AppError;

/// `app_setting` key recording whether the automatic daily backup is on
/// (BAK-001). Config value, never patient data (R-PRIV-001).
const SETTING_AUTO_ENABLED: &str = "backup.auto_enabled";

/// Minimum backup password length (OQ-S17-2: required, ≥ 8 characters).
const MIN_BACKUP_PASSWORD_LEN: usize = 8;

/// Whether the deferred "Move to a new computer" guided flow (BAK-005 /
/// HC-MVP1-035) ships at R1. It is DEFERRED (P1, OQ-S17-4): the S17 button is
/// feature-flagged OFF and the command returns [`AppError::NotFound`] so no
/// dead-end UI calls a half-built flow. Flip to `true` only when BAK-005 is
/// actually implemented in a later milestone.
pub const MOVE_TO_NEW_COMPUTER_ENABLED: bool = false;

// ---------------------------------------------------------------------------
// S17 response shapes (the command contract). camelCase to match bindings.ts.
// ---------------------------------------------------------------------------

/// Retention counts for the S17 retention line (BAK-001).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Retention {
    /// Daily copies kept (14).
    pub daily: u32,
    /// Weekly copies kept (8).
    pub weekly: u32,
    /// Monthly copies kept (12).
    pub monthly: u32,
}

/// Backup health for S17 `get_backup_status` + the status-bar chip (BAK-004).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    /// RFC3339 UTC of the last good (verified) backup, or `None` if never.
    pub last_backup_at: Option<String>,
    /// Whether the last recorded backup was verified good. `false` when there
    /// is no backup yet (empty state).
    pub last_backup_ok: bool,
    /// Whole days since the last good backup, or `None` if never.
    pub days_since_good: Option<u32>,
    /// Whether the automatic daily backup is enabled (BAK-001).
    pub auto_enabled: bool,
    /// Retention counts (14/8/12).
    pub retention: Retention,
    /// `true` when there is no good backup or the last one is > 7 days old
    /// (drives the warning banner + status-bar colour — BAK-004).
    pub stale: bool,
}

/// Result of `set_auto_backup`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetAutoBackupResponse {
    /// Whether the toggle was applied.
    pub ok: bool,
}

/// One removable drive for the USB picker (BAK-002). `free_bytes` is best
/// effort; `None` when the platform does not report it here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemovableDrive {
    /// Mount path to back up into (e.g. `/run/media/<user>/USB`, `E:\\`).
    pub path: String,
    /// Human label for the drive, or the path when no label is known.
    pub label: String,
    /// Free space in bytes, if known.
    #[specta(type = Option<specta_typescript::Number>)]
    pub free_bytes: Option<u64>,
}

/// Result of `list_removable_drives`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RemovableDrives {
    /// The mounted removable drives found, newest-first order not guaranteed.
    pub drives: Vec<RemovableDrive>,
}

/// Result of `backup_now` (BAK-002/004, SUX-011). On success `ok` is true and
/// the path/size/verified are set; the error path is mapped to a
/// `UserFacingError` at the command boundary, so this struct carries no error
/// member (R-ARCH-006).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupNowResponse {
    /// Whether the backup + verify succeeded.
    pub ok: bool,
    /// Absolute path of the written `.hcbak`.
    pub file_path: String,
    /// Size in bytes of the written archive. Exported as a TS `number` via the
    /// `Number` override (well within JS safe-integer range for a clinic DB).
    #[specta(type = specta_typescript::Number)]
    pub size_bytes: u64,
    /// Whether the post-backup integrity check passed (BAK-004).
    pub verified: bool,
}

/// The restore preview counts/dates shown on S17 step 2 BEFORE any change
/// (BAK-003). Read from the plaintext header without the password; no patient
/// data (R-PRIV-001).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    /// Patient row count in the archive (0 in M1).
    #[specta(type = specta_typescript::Number)]
    pub patient_count: u64,
    /// Visit row count in the archive (0 in M1).
    #[specta(type = specta_typescript::Number)]
    pub visit_count: u64,
    /// Last visit date (RFC3339 date) or `None`.
    pub last_visit_date: Option<String>,
    /// RFC3339 UTC time the backup was made (S17 "Backup made").
    pub created_at: String,
    /// App version that wrote the archive (S17 "App version").
    pub app_version: String,
}

/// Result of `restore_apply` (BAK-003).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RestoreApplyResponse {
    /// Whether the restore + atomic swap succeeded.
    pub ok: bool,
    /// Path of the pre-restore safety copy of the previous data (BAK-003).
    pub pre_restore_backup_path: String,
}

/// Result of `verify_backup` (BAK-004).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VerifyBackupResponse {
    /// Whether both the checksum and the decrypt-test passed.
    pub ok: bool,
    /// The body bytes matched the recorded checksum.
    pub checksum_ok: bool,
    /// The first chunk decrypted under the given password.
    pub decrypt_ok: bool,
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/// Backup/restore use-case service over the open DB + data dir + clock.
///
/// Thin over [`BackupEngine`]; adds the password policy, the `auto_enabled`
/// toggle, and the response shaping. Holds only borrows (R-ARCH-002); never
/// stores the backup password (SUX-011).
pub struct BackupService<'a> {
    pool: &'a Pool,
    data_dir: &'a Path,
    clock: &'a dyn Clock,
}

impl<'a> BackupService<'a> {
    /// Bind to the open pool, data-dir root and clock.
    pub fn new(pool: &'a Pool, data_dir: &'a Path, clock: &'a dyn Clock) -> Self {
        BackupService {
            pool,
            data_dir,
            clock,
        }
    }

    /// The bound storage engine.
    fn engine(&self) -> BackupEngine<'_> {
        BackupEngine::new(self.pool, self.data_dir, self.clock)
    }

    /// (`get_backup_status`) Backup health + the `auto_enabled` toggle
    /// (BAK-001/004). Reads the engine status and the persisted toggle.
    pub fn status(&self) -> Result<BackupStatus, AppError> {
        let EngineStatus {
            last_good_at,
            days_since_good,
            stale,
            retention,
        } = self.engine().status()?;
        let auto_enabled = self.read_auto_enabled()?;
        Ok(BackupStatus {
            last_backup_ok: last_good_at.is_some(),
            last_backup_at: last_good_at,
            days_since_good,
            auto_enabled,
            retention: Retention {
                daily: retention.daily,
                weekly: retention.weekly,
                monthly: retention.monthly,
            },
            stale,
        })
    }

    /// (`set_auto_backup`) Persist the automatic-daily-backup toggle as one
    /// audited `app_setting` write (BAK-001, R-DATA-001).
    pub fn set_auto_backup(&self, enabled: bool) -> Result<SetAutoBackupResponse, AppError> {
        let now = self.clock.now_rfc3339();
        // A bool always serialises; keep a literal fallback so no `?` conversion
        // of serde_json::Error is needed at this boundary.
        let value_json = if enabled { "true" } else { "false" };
        self.pool.with_writer(|c| {
            let tx = c.transaction()?;
            hc_storage::profile::put_setting(&tx, SETTING_AUTO_ENABLED, value_json, &now)?;
            tx.commit()?;
            Ok(())
        })?;
        Ok(SetAutoBackupResponse { ok: true })
    }

    /// (`backup_now`) Manual backup to a chosen folder or USB (BAK-002). The
    /// password is required and must be ≥ 8 chars (OQ-S17-2); the engine writes
    /// atomically, verifies, and records the last-good time (BAK-004).
    pub fn backup_now(&self, out_dir: &str, password: &str) -> Result<BackupNowResponse, AppError> {
        validate_backup_password(password)?;
        let outcome = self.engine().backup_to(Path::new(out_dir), password)?;
        Ok(BackupNowResponse {
            ok: true,
            file_path: outcome.file_path.to_string_lossy().into_owned(),
            size_bytes: outcome.size_bytes,
            verified: outcome.verified,
        })
    }

    /// (scheduled trigger) Run the automatic daily backup + 14/8/12 rotation
    /// (BAK-001). Silent: the remembered password is passed in, never prompted
    /// (SUX-011). Not a Tauri command — the shell calls it on app close / first
    /// launch of the day (OQ-S17-1).
    pub fn run_scheduled_backup(&self, password: &str) -> Result<BackupNowResponse, AppError> {
        validate_backup_password(password)?;
        let outcome = self.engine().run_scheduled_backup(password)?;
        Ok(BackupNowResponse {
            ok: true,
            file_path: outcome.file_path.to_string_lossy().into_owned(),
            size_bytes: outcome.size_bytes,
            verified: outcome.verified,
        })
    }

    /// (`restore_preview`) Read the header counts/dates WITHOUT the password and
    /// WITHOUT touching live data (BAK-003, S17 step 2 / AC4).
    pub fn restore_preview(&self, file_path: &str) -> Result<RestorePreview, AppError> {
        let header = self.engine().restore_preview(Path::new(file_path))?;
        Ok(RestorePreview {
            patient_count: header.preview.patient_count,
            visit_count: header.preview.visit_count,
            last_visit_date: header.preview.last_visit_date,
            created_at: header.created_at,
            app_version: header.app_version,
        })
    }

    /// (`restore_apply`) Apply a restore (BAK-003): safety copy → atomic swap →
    /// re-key under `target_key` (THIS install's DEK) → migrate-if-older. A
    /// wrong password is refused before anything live is touched (AC4).
    pub fn restore_apply(
        &self,
        file_path: &str,
        password: &str,
        target_key: &dyn KeyProvider,
    ) -> Result<RestoreApplyResponse, AppError> {
        let outcome = self
            .engine()
            .restore_apply(Path::new(file_path), password, target_key)?;
        Ok(RestoreApplyResponse {
            ok: true,
            pre_restore_backup_path: outcome
                .pre_restore_backup_path
                .to_string_lossy()
                .into_owned(),
        })
    }

    /// (`verify_backup`) Checksum + decrypt-test an existing archive (BAK-004).
    pub fn verify_backup(
        &self,
        file_path: &str,
        password: &str,
    ) -> Result<VerifyBackupResponse, AppError> {
        let v = self.engine().verify(Path::new(file_path), password)?;
        Ok(VerifyBackupResponse {
            ok: v.checksum_ok && v.decrypt_ok,
            checksum_ok: v.checksum_ok,
            decrypt_ok: v.decrypt_ok,
        })
    }

    /// Read the persisted `auto_enabled` toggle; defaults to `true` (automatic
    /// daily backup on by default — BAK-001) when unset.
    fn read_auto_enabled(&self) -> Result<bool, AppError> {
        let raw = self
            .pool
            .with_reader(|c| hc_storage::profile::get_setting(c, SETTING_AUTO_ENABLED))?;
        match raw {
            Some(j) => Ok(serde_json::from_str::<bool>(&j).unwrap_or(true)),
            None => Ok(true),
        }
    }
}

/// Validate the backup password policy (OQ-S17-2: required, ≥ 8 characters). A
/// too-short/empty password is a plain validation error (R-UI-008); the
/// message carries no secret (R-PRIV-001).
pub fn validate_backup_password(password: &str) -> Result<(), AppError> {
    if password.chars().count() < MIN_BACKUP_PASSWORD_LEN {
        return Err(AppError::Validation(hc_domain::error::DomainError::Invalid));
    }
    Ok(())
}

/// Enumerate mounted removable drives for the USB picker (BAK-002). A typed
/// command returning chosen mount paths — NOT a broad FS scope or the shell
/// plugin (R-SEC-002/003). Best effort and platform-specific; an empty list is
/// a valid result (the doctor can still type / choose a folder).
pub fn list_removable_drives() -> Result<RemovableDrives, AppError> {
    Ok(RemovableDrives {
        drives: platform_removable_drives(),
    })
}

/// Linux removable-drive enumeration: the conventional auto-mount roots where
/// desktops mount USB media (`/run/media/<user>/*`, `/media/<user>/*`,
/// `/media/*`). Reads directory entries only — no `df`, no shell, no mount
/// syscalls (R-SEC-002/003). UNVERIFIED on this headless box (no real USB); the
/// enumeration is pure directory reads so it degrades to an empty list safely.
#[cfg(target_os = "linux")]
fn platform_removable_drives() -> Vec<RemovableDrive> {
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(user) = std::env::var("USER") {
        roots.push(std::path::PathBuf::from(format!("/run/media/{user}")));
        roots.push(std::path::PathBuf::from(format!("/media/{user}")));
    }
    roots.push(std::path::PathBuf::from("/media"));

    let mut drives = Vec::new();
    for root in roots {
        let entries = match std::fs::read_dir(&root) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let path = entry.path();
                let label = entry.file_name().to_string_lossy().into_owned();
                drives.push(RemovableDrive {
                    path: path.to_string_lossy().into_owned(),
                    label,
                    free_bytes: None,
                });
            }
        }
    }
    drives
}

/// Windows removable-drive enumeration. cfg-compiled only; UNVERIFIED on this
/// headless Linux box (no Windows target installed). Enumerates drive-letter
/// roots `A:\\`..`Z:\\` that exist; a fuller `GetDriveType == DRIVE_REMOVABLE`
/// filter is a later hardening. Pure path existence checks — no shell, no FS
/// scope widening (R-SEC-002/003).
#[cfg(target_os = "windows")]
fn platform_removable_drives() -> Vec<RemovableDrive> {
    let mut drives = Vec::new();
    for letter in b'A'..=b'Z' {
        let root = format!("{}:\\", letter as char);
        if std::path::Path::new(&root).exists() {
            drives.push(RemovableDrive {
                path: root.clone(),
                label: root,
                free_bytes: None,
            });
        }
    }
    drives
}

/// Fallback for any other target: no removable-drive enumeration.
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn platform_removable_drives() -> Vec<RemovableDrive> {
    Vec::new()
}
