#![forbid(unsafe_code)]
//! `hc-storage` — SQLCipher pool, migrations, repositories, audit rows, FTS
//! triggers, backup/restore and the key hierarchy for HomeoClinic.
//!
//! Owns all SQL and filesystem paths for patient and clinic data
//! (R-ARCH-009). Depends only on `hc-domain`. Empty shell at M0.
