#![forbid(unsafe_code)]
//! `hc-search` — patient search engine for HomeoClinic (PSR-001..013).
//!
//! Engine + schema only: a ranked, keyset-paginated UNION query over the
//! `patient` table and its FTS5 prefix + trigram indexes, an Indian-name
//! phonetic key, normalisation helpers, and an index rebuild routine. No Tauri
//! command and no UI live here (those are later M2 slices).
//!
//! Depends on `hc-domain` and `hc-storage` only (CODE-LAYOUT crate edge). All
//! SQL is parameterised (R-SEC-001); search runs on a reader connection and the
//! FTS indexes stay in sync in the write transaction via triggers (PSR-012,
//! R-DATA-006).

pub mod error;
pub mod normalize;
pub mod phonetic;
pub mod query;
pub mod rebuild;

#[cfg(any(test, feature = "testing"))]
pub mod testing;

pub use error::SearchError;
pub use phonetic::phonetic_key;
pub use query::{search, PageCursor, SearchHit, SearchPage, PAGE_LIMIT};
pub use rebuild::{rebuild_indexes, RebuildProgress};
