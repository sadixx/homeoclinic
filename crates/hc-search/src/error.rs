//! Search-layer error type (HC-MVP1-047..053, R-RUST-001).
//!
//! `thiserror` enum. Messages carry no patient data, SQL text or filesystem
//! path (R-PRIV-001). Wrapped by `hc_app::error::AppError` at the command
//! boundary in a later slice.

/// Errors from the patient-search engine.
#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    /// A storage-layer operation failed (pool / migration).
    #[error("storage operation failed")]
    Storage(#[from] hc_storage::StorageError),
    /// A SQLite / SQLCipher operation failed.
    #[error("database operation failed")]
    Db(#[from] rusqlite::Error),
}
