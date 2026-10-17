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
}
