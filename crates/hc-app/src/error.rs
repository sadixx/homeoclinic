//! The command-boundary error contract (HC-MVP1-018, design §018, NFR-033,
//! R-ARCH-006, R-UI-008).
//!
//! Internal errors are mapped to [`UserFacingError`] here and nowhere else
//! (R-ARCH-006). No raw error, `Debug` string, SQL or stack trace crosses to
//! the UI: [`map_error`] reads only the [`AppError`] *variant*, never its
//! `Display`/`Debug` text. The UI resolves [`UserFacingError::code`] via `t()`
//! for a localised string and shows `message` + `suggested_action` only
//! (R-UI-007, R-UI-008).

use serde::{Deserialize, Serialize};
use specta::Type;

/// Stable machine code for a mapped error.
///
/// Serialises as a `snake_case` string (e.g. `"db_busy"`); the UI uses it as
/// the `t()` key (R-UI-007). Changing a variant name is a contract change the
/// UI must follow, so the set is deliberately small and stable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    /// A required value was invalid (domain validation failed).
    Validation,
    /// The database was busy / locked; the doctor should retry.
    DbBusy,
    /// A record was not found.
    NotFound,
    /// A conflicting edit (optimistic concurrency / `row_version`).
    Conflict,
    /// The PIN did not unlock the database (SET-004, SUX-007). Distinct so the
    /// lock UI shows a precise inline message; NEVER restricts the app
    /// (SUX-005).
    WrongPin,
    /// The recovery code did not unlock the database (SET-004).
    WrongRecoveryCode,
    /// The backup password did not decrypt the chosen archive (S17 restore
    /// step 1 inline error; HC-MVP1-033, BAK-003). Distinct from
    /// [`ErrorCode::BadBackup`] so the restore UI shows "try again" on the
    /// password field, not a corrupt-file message (S17 AC4).
    WrongBackupPassword,
    /// The chosen `.hcbak` file is not a valid or is a damaged archive
    /// (HC-MVP1-030). Plain-language; the UI offers a Details support code
    /// (NFR-033).
    BadBackup,
    /// The archive was written by a newer app version than this build supports
    /// (forward-only; HC-MVP1-030).
    BackupTooNew,
    /// The chosen backup destination (folder / USB) is not available, e.g. a
    /// removed USB drive (OQ-S17-5; HC-MVP1-032).
    BackupDestinationUnavailable,
    /// The backup destination ran out of space mid-write; the previous good
    /// backup is kept intact (OQ-S17-5; HC-MVP1-032).
    BackupOutOfSpace,
    /// A boot-time command read (`setup_get_state` / `auth_get_lock_state`)
    /// failed at the IPC transport/serialisation layer rather than returning a
    /// mapped `UserFacingError` (SET-001, SET-004; handoff 46). Produced by the
    /// UI command adapter (`shared/command.ts` `run()`), never by
    /// [`map_error`], so the boot-gate can tell a genuine transport failure
    /// apart from a `locked` state and never strand a fresh, PIN-less install
    /// on the lock screen. Carried in the frozen contract so the code is a real
    /// `t()` key (R-UI-007) with one source of truth (R-ARCH-006).
    BootReadFailed,
    /// Anything not otherwise classified. The message stays generic.
    Unexpected,
}

/// The ONLY error shape the UI ever receives.
///
/// Contains no raw error text, no SQL, no file path and no stack trace — only
/// a code, a plain-language message and a suggested action (NFR-033,
/// R-UI-008). Serialises with camelCase keys (`code`, `message`,
/// `suggestedAction`) and crosses to TypeScript via `specta` (R-ARCH-004).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UserFacingError {
    /// Machine code; also the i18n key the UI resolves with `t()`.
    pub code: ErrorCode,
    /// Plain-language, patient-data-free message (safe default / fallback).
    pub message: String,
    /// One concrete next step, e.g. `"Try again"` / `"Check the details"`.
    pub suggested_action: String,
}

/// Internal application error (`thiserror`; R-RUST-001).
///
/// Wraps domain and infrastructure errors. NEVER serialised to the UI; only
/// [`map_error`] may read it. The `Storage` payload is boxed so the `Result`
/// stays small (R-RUST-006).
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// Domain validation failed.
    #[error("validation failed")]
    Validation(#[from] hc_domain::error::DomainError),
    /// A lower layer (storage/search/licence) failed. Boxed and opaque; its
    /// text is never read by the mapper.
    #[error("storage error")]
    Storage(#[source] Box<dyn std::error::Error + Send + Sync>),
    /// The requested record was not found.
    #[error("not found")]
    NotFound,
    /// A conflicting edit was detected.
    #[error("conflict")]
    Conflict,
    /// The PIN did not unlock the database (from
    /// `StorageError::WrongPin`). Kept as a distinct variant (NOT boxed into
    /// `Storage`) so [`map_error`] can surface a precise code (SUX-007).
    #[error("wrong pin")]
    WrongPin,
    /// The recovery code did not unlock the database (SET-004).
    #[error("wrong recovery code")]
    WrongRecoveryCode,
    /// The backup password did not decrypt the archive body (from
    /// `StorageError::WrongBackupPassword`). Distinct so [`map_error`] surfaces
    /// the `wrong_backup_password` code for the S17 inline retry (BAK-003).
    #[error("wrong backup password")]
    WrongBackupPassword,
    /// The `.hcbak` archive is damaged or not valid (from
    /// `StorageError::BadArchive` / `BackupVerifyFailed`). Kept distinct so the
    /// UI shows a plain corrupt-file message with a Details code (NFR-033).
    #[error("bad backup archive")]
    BadBackup,
    /// The archive was written by a newer app version (from
    /// `StorageError::BackupTooNew`); forward-only.
    #[error("backup too new")]
    BackupTooNew,
    /// The backup destination is unavailable (from
    /// `StorageError::DestinationUnavailable`); e.g. a removed USB (OQ-S17-5).
    #[error("backup destination unavailable")]
    BackupDestinationUnavailable,
    /// The backup destination ran out of space (from
    /// `StorageError::OutOfSpace`); the previous good backup is kept (OQ-S17-5).
    #[error("backup out of space")]
    BackupOutOfSpace,
}

/// Map any internal error to the UI-facing value.
///
/// The single mapping layer (R-ARCH-006). It reads only the error *variant*
/// (never its `Display` or `Debug` text) to pick a code + message + action, so
/// no internal string, SQL fragment or stack can leak (NFR-033, R-UI-008). The
/// returned `message` is a safe English fallback; the UI prefers `t(code)`.
pub fn map_error(err: &AppError) -> UserFacingError {
    match err {
        AppError::Validation(_) => UserFacingError {
            code: ErrorCode::Validation,
            message: "Some details are missing or invalid.".to_string(),
            suggested_action: "Check the highlighted fields and try again.".to_string(),
        },
        AppError::NotFound => UserFacingError {
            code: ErrorCode::NotFound,
            message: "That record could not be found.".to_string(),
            suggested_action: "Refresh the list and try again.".to_string(),
        },
        AppError::Conflict => UserFacingError {
            code: ErrorCode::Conflict,
            message: "This was changed somewhere else since you opened it.".to_string(),
            suggested_action: "Reopen the record and reapply your change.".to_string(),
        },
        AppError::Storage(_) => UserFacingError {
            code: ErrorCode::Unexpected,
            message: "Something went wrong while saving.".to_string(),
            suggested_action: "Please try again. If it keeps happening, restart the app."
                .to_string(),
        },
        AppError::WrongPin => UserFacingError {
            code: ErrorCode::WrongPin,
            message: "That PIN is not correct.".to_string(),
            suggested_action: "Check the PIN and try again.".to_string(),
        },
        AppError::WrongRecoveryCode => UserFacingError {
            code: ErrorCode::WrongRecoveryCode,
            message: "That recovery code is not correct.".to_string(),
            suggested_action: "Check the code from your setup printout and try again.".to_string(),
        },
        AppError::WrongBackupPassword => UserFacingError {
            code: ErrorCode::WrongBackupPassword,
            message: "That backup password is not correct.".to_string(),
            suggested_action: "Check the password and try again.".to_string(),
        },
        AppError::BadBackup => UserFacingError {
            code: ErrorCode::BadBackup,
            message: "This backup file is not valid or is damaged.".to_string(),
            suggested_action: "Choose a different backup file.".to_string(),
        },
        AppError::BackupTooNew => UserFacingError {
            code: ErrorCode::BackupTooNew,
            message: "This backup was made by a newer version of the app.".to_string(),
            suggested_action: "Update the app, then restore again.".to_string(),
        },
        AppError::BackupDestinationUnavailable => UserFacingError {
            code: ErrorCode::BackupDestinationUnavailable,
            message: "The backup location is not available.".to_string(),
            suggested_action: "Reconnect the drive or choose another folder, then try again."
                .to_string(),
        },
        AppError::BackupOutOfSpace => UserFacingError {
            code: ErrorCode::BackupOutOfSpace,
            message: "There is not enough space at the backup location.".to_string(),
            suggested_action: "Free up space or choose another location, then try again."
                .to_string(),
        },
    }
}

/// Convenience for commands: turn an internal `Result` into the boundary
/// `Result`, mapping the error through [`map_error`].
pub fn to_user_result<T>(r: Result<T, AppError>) -> Result<T, UserFacingError> {
    r.map_err(|e| map_error(&e))
}

/// Map a storage-layer error to the app error, PRESERVING the wrong-PIN /
/// wrong-recovery-code variants so [`map_error`] can surface a precise code
/// (SUX-007); every other storage error is boxed opaquely into
/// [`AppError::Storage`] (its text is never read — R-PRIV-001, R-UI-008).
impl From<hc_storage::StorageError> for AppError {
    fn from(err: hc_storage::StorageError) -> Self {
        match err {
            hc_storage::StorageError::WrongPin => AppError::WrongPin,
            hc_storage::StorageError::WrongRecoveryCode => AppError::WrongRecoveryCode,
            hc_storage::StorageError::WrongBackupPassword => AppError::WrongBackupPassword,
            // A damaged archive and a post-write verify failure are both "this
            // archive is not usable" to the doctor (plain message + Details
            // code, NFR-033); they share the BadBackup code.
            hc_storage::StorageError::BadArchive | hc_storage::StorageError::BackupVerifyFailed => {
                AppError::BadBackup
            }
            hc_storage::StorageError::BackupTooNew { .. } => AppError::BackupTooNew,
            hc_storage::StorageError::DestinationUnavailable => {
                AppError::BackupDestinationUnavailable
            }
            hc_storage::StorageError::OutOfSpace => AppError::BackupOutOfSpace,
            other => AppError::Storage(Box::new(other)),
        }
    }
}
