//! Storage-layer error type (HC-MVP1-020/022/025, R-RUST-001).
//!
//! `thiserror` enum. Messages carry no patient data, SQL text or filesystem
//! paths (R-PRIV-001). Boxed into `hc_app::error::AppError::Storage` at the
//! command boundary; `StorageError: Send + Sync + 'static`.

/// Errors from the storage layer: pool open/use, migrations and the audit
/// writer. Generic, patient-data-free messages by design (R-PRIV-001).
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    /// A SQLite / SQLCipher operation failed.
    #[error("database operation failed")]
    Db(#[from] rusqlite::Error),
    /// A database file (or backup file) access failed.
    #[error("database file access failed")]
    Io(#[from] std::io::Error),
    /// The on-disk schema version is newer than this build supports
    /// (forward-only; downgrade refused — R-DATA-002).
    #[error("schema version is newer than this build supports")]
    SchemaTooNew {
        /// Version found on disk.
        found: u32,
        /// Highest version this build knows.
        supported: u32,
    },
    /// The SQLCipher key could not be produced by the `KeyProvider`.
    #[error("key is unavailable")]
    Key,
    /// JSON (de)serialization of a diff or value failed.
    #[error("data serialization failed")]
    Serde(#[from] serde_json::Error),
    /// The PIN did not unwrap the DEK (GCM auth failed). HC-MVP1-021.
    /// Distinct from a corrupt-store signal so the unlock UI can say "try
    /// again" (SUX-007). Carries no key material (R-PRIV-001).
    #[error("incorrect PIN")]
    WrongPin,
    /// The recovery code did not unwrap the DEK (SET-004).
    #[error("incorrect recovery code")]
    WrongRecoveryCode,
    /// An unlock/change was attempted before the keystore was initialized.
    #[error("keystore is not initialized")]
    NotInitialized,
    /// `initialize` was called on an already-initialized keystore.
    #[error("keystore is already initialized")]
    AlreadyInitialized,
    /// A cryptographic operation (key derivation / wrap) failed unexpectedly.
    /// Generic by design: never reflects attacker-controlled detail
    /// (R-PRIV-001).
    #[error("cryptographic operation failed")]
    Crypto,
    /// An attachment blob failed its AES-256-GCM authentication tag
    /// (tampered or truncated). HC-MVP1-024, NFR-021.
    #[error("attachment failed integrity check")]
    AttachmentTampered,
    /// An attachment blob was not found on disk.
    #[error("attachment not found")]
    AttachmentMissing,
    /// A `.hcbak` archive is not valid or is damaged: bad magic, a failed
    /// header CRC, a failed body checksum, or a truncated chunk. HC-MVP1-030.
    /// Generic by design — no path, SQL or key material (R-PRIV-001).
    #[error("backup file is not valid or is damaged")]
    BadArchive,
    /// The backup password did not decrypt the archive body (first-chunk GCM
    /// auth failed). Distinct from [`StorageError::BadArchive`] so the restore
    /// UI shows an inline "try again" on step 1 (S17 AC4). HC-MVP1-030/033.
    #[error("incorrect backup password")]
    WrongBackupPassword,
    /// The post-write integrity check (checksum + decrypt-test) failed, so the
    /// just-written archive is not trusted and the write is discarded.
    /// HC-MVP1-034.
    #[error("backup could not be verified after writing")]
    BackupVerifyFailed,
    /// The archive's format version is newer than this build supports
    /// (forward-only; mirrors [`StorageError::SchemaTooNew`]). HC-MVP1-030.
    #[error("backup was made by a newer version of this app")]
    BackupTooNew {
        /// Format version found in the header.
        found: u16,
        /// Highest format version this build knows.
        supported: u16,
    },
    /// The chosen backup destination (folder or USB) is not available, e.g. a
    /// USB drive removed mid-backup (OQ-S17-5). HC-MVP1-032.
    #[error("the backup destination is not available")]
    DestinationUnavailable,
    /// The backup destination ran out of space mid-write (OQ-S17-5). The
    /// previous good backup is kept intact. HC-MVP1-032.
    #[error("not enough space on the backup destination")]
    OutOfSpace,
}
