#![forbid(unsafe_code)]
//! `hc-storage` — SQLCipher pool, migrations, repositories, audit rows, FTS
//! triggers, backup/restore and the key hierarchy for HomeoClinic.
//!
//! Owns all SQL and filesystem paths for patient and clinic data
//! (R-ARCH-009). Depends only on `hc-domain`.
//!
//! Slice A (HC-MVP1-020/022/023/025) lands: the [`pool`] (1 writer + 4
//! readers, WAL, FK, tuned pragmas), the forward-only [`migrate`] runner with
//! `user_version` + automatic pre-migration backup, and the [`audit`] writer
//! (one transaction + one audit row with a diff). The [`key`] module is the
//! `KeyProvider` seam; the real DEK/KEK hierarchy (HC-MVP1-021) wires in later.

pub mod attachment;
pub mod audit;
pub mod backup;
pub mod clock;
pub mod error;
pub mod key;
pub mod keystore;
pub mod licence;
pub mod migrate;
pub mod pool;
pub mod profile;
pub(crate) mod wrap;

#[cfg(any(test, feature = "testing"))]
pub mod testing;

pub use error::StorageError;
pub use pool::{Pool, READER_COUNT};
