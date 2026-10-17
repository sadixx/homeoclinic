//! SQLCipher key seam (HC-MVP1-021 deferred; this slice ships a dev key only).
//!
//! The real DEK/KEK hierarchy (Argon2id + OS secure store) implements
//! [`KeyProvider`] in Slice B. Key bytes are returned in a zeroizing buffer and
//! never logged (R-SEC-006, R-PRIV-001).

use crate::error::StorageError;
use zeroize::Zeroizing;

/// Supplies the raw SQLCipher key for a database file.
///
/// Implemented by the real key hierarchy in Slice B. The returned bytes are the
/// raw key passed to SQLCipher's `PRAGMA key`; they are wiped on drop
/// (R-SEC-006) and never written to a log (R-PRIV-001).
pub trait KeyProvider: Send + Sync {
    /// The raw SQLCipher key bytes, in a zeroizing buffer.
    fn key(&self) -> Result<Zeroizing<Vec<u8>>, StorageError>;
}

/// Development / test key provider.
///
/// NOT for production: the key is a fixed, non-secret constant, not derived
/// from a PIN. Replaced by the real provider in Slice B (HC-MVP1-021).
#[cfg(any(test, feature = "testing"))]
pub struct DevKeyProvider {
    key: Zeroizing<Vec<u8>>,
}

#[cfg(any(test, feature = "testing"))]
impl DevKeyProvider {
    /// A `DevKeyProvider` holding a fixed 32-byte test key.
    pub fn new_test() -> Self {
        // STUB: fixed bytes so tests can open the DB; real key is Slice B.
        DevKeyProvider {
            key: Zeroizing::new(vec![0x11; 32]),
        }
    }
}

#[cfg(any(test, feature = "testing"))]
impl KeyProvider for DevKeyProvider {
    fn key(&self) -> Result<Zeroizing<Vec<u8>>, StorageError> {
        Ok(self.key.clone())
    }
}
