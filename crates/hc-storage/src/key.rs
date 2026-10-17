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

// ---------------------------------------------------------------------------
// HC-MVP1-021 real key hierarchy (DEK/KEK, Argon2id, recovery code).
// ---------------------------------------------------------------------------

use crate::keystore::{DekWrap, Keystore, KeystoreRecord};

/// A one-time recovery code (SET-004), shown once at setup.
///
/// Grouped lowercase hex (~128 bits of entropy) for printing; wiped on drop
/// (R-SEC-006). `Debug` is redacted so it never lands in a log (R-PRIV-001);
/// the setup UI reads it exactly once via [`RecoveryCode::reveal`].
pub struct RecoveryCode {
    code: Zeroizing<String>,
}

impl RecoveryCode {
    /// Construct from already-generated grouped text. Crate-internal: only the
    /// hierarchy mints recovery codes.
    pub(crate) fn new(code: String) -> Self {
        RecoveryCode {
            code: Zeroizing::new(code),
        }
    }

    /// The grouped code for one-time display / printing (SET-004). The caller
    /// shows it once and must not persist it.
    pub fn reveal(&self) -> &str {
        &self.code
    }
}

impl std::fmt::Debug for RecoveryCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Redacted: never print the code (R-PRIV-001, R-SEC-005).
        f.write_str("RecoveryCode(<redacted>)")
    }
}

/// A real SQLCipher key provider backed by an unwrapped 32-byte DEK
/// (HC-MVP1-021).
///
/// Holds the DEK in a zeroizing buffer and returns it as the raw SQLCipher key.
/// Produced only by unlocking a [`KeyHierarchy`] with a PIN or recovery code —
/// there is no public constructor that takes raw key bytes, so the DEK never
/// leaks in via an untrusted path.
pub struct DekKeyProvider {
    dek: Zeroizing<[u8; 32]>,
}

impl DekKeyProvider {
    /// HKDF-SHA256 info string for the attachment subkey. Domain-separates the
    /// attachment GCM key from the raw SQLCipher key (NFR-021).
    const ATTACHMENT_INFO: &'static [u8] = b"hc-attachment-v1";

    /// Construct from a freshly unwrapped DEK. Crate-internal: only the
    /// hierarchy produces one.
    pub(crate) fn from_dek(dek: Zeroizing<[u8; 32]>) -> Self {
        DekKeyProvider { dek }
    }

    /// The HKDF-SHA256 attachment subkey (domain-separated from the SQLCipher
    /// key; info = `"hc-attachment-v1"`). Used by the attachment store
    /// (HC-MVP1-024); never returns the raw DEK.
    pub fn attachment_key(&self) -> Zeroizing<[u8; 32]> {
        use hkdf::Hkdf;
        use sha2::Sha256;
        // IKM = the DEK; no salt; info domain-separates from any other use.
        let hk = Hkdf::<Sha256>::new(None, self.dek.as_ref());
        let mut out = Zeroizing::new([0u8; 32]);
        // expand() only fails for an absurd output length (32 is fine); on the
        // impossible error path return a zero key, which cannot decrypt any
        // real blob (fail-closed) rather than panicking (R-RUST-002).
        if hk.expand(Self::ATTACHMENT_INFO, out.as_mut()).is_err() {
            return Zeroizing::new([0u8; 32]);
        }
        out
    }
}

impl KeyProvider for DekKeyProvider {
    fn key(&self) -> Result<Zeroizing<Vec<u8>>, StorageError> {
        Ok(Zeroizing::new(self.dek.to_vec()))
    }
}

/// The key hierarchy over one install's keystore (HC-MVP1-021, NFR-020,
/// SET-004): create at first run, unlock by PIN or recovery code, change PIN.
///
/// Stateless over a `&dyn Keystore`; all secrets live in zeroizing buffers
/// (R-SEC-006). The keystore stores the wrapped DEK and the per-install secret,
/// never the PIN.
pub struct KeyHierarchy<'a> {
    store: &'a dyn Keystore,
}

impl<'a> KeyHierarchy<'a> {
    /// Bind to a keystore backend.
    pub fn new(store: &'a dyn Keystore) -> Self {
        KeyHierarchy { store }
    }

    /// Build the Argon2id salt input for a wrap: the per-wrap salt bytes
    /// concatenated with the per-install secret (NFR-020 "per-install random
    /// secret" mixed into every derivation). Argon2id requires a salt of at
    /// least 8 bytes; both inputs are 16 bytes so the concatenation is 32.
    fn salt_input(salt: &[u8], per_install_secret: &[u8]) -> Vec<u8> {
        let mut v = Vec::with_capacity(salt.len() + per_install_secret.len());
        v.extend_from_slice(salt);
        v.extend_from_slice(per_install_secret);
        v
    }

    /// Wrap `dek` under a KEK derived from `secret` (PIN or recovery code
    /// bytes), minting a fresh 16-byte salt. Returns the serializable
    /// [`DekWrap`].
    fn make_wrap(
        dek: &[u8; 32],
        secret: &[u8],
        per_install_secret: &[u8],
    ) -> Result<DekWrap, StorageError> {
        use rand::RngCore;
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        let params = crate::wrap::Argon2Params::PRODUCTION;
        let salt_input = Self::salt_input(&salt, per_install_secret);
        let kek = crate::wrap::derive_kek(secret, &salt_input, params)?;
        let wrapped = crate::wrap::wrap_dek(dek, &kek)?;
        Ok(DekWrap {
            salt_hex: hex::encode(salt),
            wrapped_hex: hex::encode(wrapped),
            m_cost: params.m_cost,
            t_cost: params.t_cost,
            p_cost: params.p_cost,
        })
    }

    /// Unwrap the DEK from `wrap` using `secret` and the per-install secret.
    /// A failed GCM tag means the secret was wrong; the caller maps the
    /// returned `Crypto` to `WrongPin` / `WrongRecoveryCode` by context.
    fn open_wrap(
        wrap: &DekWrap,
        secret: &[u8],
        per_install_secret: &[u8],
    ) -> Result<Zeroizing<[u8; 32]>, StorageError> {
        let salt = hex::decode(&wrap.salt_hex).map_err(|_| StorageError::Crypto)?;
        let wrapped = hex::decode(&wrap.wrapped_hex).map_err(|_| StorageError::Crypto)?;
        let params = crate::wrap::Argon2Params {
            m_cost: wrap.m_cost,
            t_cost: wrap.t_cost,
            p_cost: wrap.p_cost,
        };
        let salt_input = Self::salt_input(&salt, per_install_secret);
        let kek = crate::wrap::derive_kek(secret, &salt_input, params)?;
        crate::wrap::unwrap_dek(&wrapped, &kek)
    }

    /// Generate a one-time recovery code: 16 random bytes (~128 bits) shown as
    /// four groups of lowercase hex, e.g. `0a1b2c3d-4e5f6071-...`. The code
    /// string's bytes are the Argon2id secret for the recovery wrap.
    fn mint_recovery_code() -> Zeroizing<String> {
        use rand::RngCore;
        // Hold the raw entropy and its hex encoding in zeroizing buffers so no
        // un-wiped plaintext copy of the ~128-bit recovery secret is left on
        // the heap after this function returns (R-SEC-006).
        let mut bytes = Zeroizing::new([0u8; 16]);
        rand::thread_rng().fill_bytes(bytes.as_mut());
        let hexed = Zeroizing::new(hex::encode(bytes.as_ref()));
        // Group into 4 blocks of 8 hex chars for legible printing (SET-004),
        // building the grouped string directly in one Zeroizing buffer.
        let mut grouped = Zeroizing::new(String::with_capacity(hexed.len() + 3));
        for (i, chunk) in hexed.as_bytes().chunks(8).enumerate() {
            if i > 0 {
                grouped.push('-');
            }
            // chunk is a slice of lowercase hex, always valid UTF-8.
            grouped.push_str(std::str::from_utf8(chunk).unwrap_or(""));
        }
        grouped
    }

    /// First run (SET-004): generate a random DEK + per-install secret, derive
    /// the PIN KEK (Argon2id) and a recovery KEK, wrap the DEK under both, and
    /// persist both wraps + the per-install secret. Returns the one-time
    /// recovery code (shown once) and an unlocked provider. Errors with
    /// `AlreadyInitialized` if the store already holds a record.
    pub fn initialize(&self, pin: &str) -> Result<(RecoveryCode, DekKeyProvider), StorageError> {
        use rand::RngCore;
        if self.store.load()?.is_some() {
            return Err(StorageError::AlreadyInitialized);
        }

        // Random 32-byte DEK (the raw SQLCipher key) and 16-byte per-install
        // secret, both from the OS CSPRNG (NFR-020).
        let mut dek = Zeroizing::new([0u8; 32]);
        rand::thread_rng().fill_bytes(dek.as_mut());
        let mut per_install_secret = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut per_install_secret);

        let recovery_code = Self::mint_recovery_code();

        let pin_wrap = Self::make_wrap(&dek, pin.as_bytes(), &per_install_secret)?;
        let recovery_wrap = Self::make_wrap(&dek, recovery_code.as_bytes(), &per_install_secret)?;

        let record = KeystoreRecord {
            version: 1,
            per_install_secret_hex: hex::encode(per_install_secret),
            pin_wrap,
            recovery_wrap,
        };
        self.store.store(&record)?;

        Ok((
            RecoveryCode::new(recovery_code.to_string()),
            DekKeyProvider::from_dek(dek),
        ))
    }

    /// Load the record or fail with `NotInitialized`, and decode the
    /// per-install secret.
    fn load_record(&self) -> Result<(KeystoreRecord, Vec<u8>), StorageError> {
        let record = self.store.load()?.ok_or(StorageError::NotInitialized)?;
        let secret =
            hex::decode(&record.per_install_secret_hex).map_err(|_| StorageError::Crypto)?;
        Ok((record, secret))
    }

    /// Unlock by PIN (SUX-003, one entry): derive the PIN KEK, unwrap the DEK.
    /// Wrong PIN → `WrongPin`.
    pub fn unlock_with_pin(&self, pin: &str) -> Result<DekKeyProvider, StorageError> {
        let (record, per_install_secret) = self.load_record()?;
        let dek = Self::open_wrap(&record.pin_wrap, pin.as_bytes(), &per_install_secret)
            .map_err(|_| StorageError::WrongPin)?;
        Ok(DekKeyProvider::from_dek(dek))
    }

    /// Forgot-PIN recovery (SET-004): unwrap the DEK with the recovery code.
    /// Wrong code → `WrongRecoveryCode`.
    pub fn unlock_with_recovery_code(&self, code: &str) -> Result<DekKeyProvider, StorageError> {
        let (record, per_install_secret) = self.load_record()?;
        let dek = Self::open_wrap(&record.recovery_wrap, code.as_bytes(), &per_install_secret)
            .map_err(|_| StorageError::WrongRecoveryCode)?;
        Ok(DekKeyProvider::from_dek(dek))
    }

    /// Change PIN: unwrap the DEK with the old PIN, re-wrap under a new KEK from
    /// the new PIN, persist. The DEK (and so the DB) is never re-encrypted.
    /// Wrong old PIN → `WrongPin`.
    pub fn change_pin(&self, old_pin: &str, new_pin: &str) -> Result<(), StorageError> {
        let (mut record, per_install_secret) = self.load_record()?;
        let dek = Self::open_wrap(&record.pin_wrap, old_pin.as_bytes(), &per_install_secret)
            .map_err(|_| StorageError::WrongPin)?;
        // Re-wrap the SAME DEK under a fresh KEK from the new PIN (new salt).
        record.pin_wrap = Self::make_wrap(&dek, new_pin.as_bytes(), &per_install_secret)?;
        self.store.store(&record)?;
        Ok(())
    }

    /// True if this install's keystore already holds a wrapped DEK.
    pub fn is_initialized(&self) -> Result<bool, StorageError> {
        Ok(self.store.load()?.is_some())
    }
}
