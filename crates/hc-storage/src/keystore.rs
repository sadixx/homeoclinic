//! Keystore backends for the key hierarchy (HC-MVP1-021, NFR-020).
//!
//! The keystore persists the install's [`KeystoreRecord`] — the per-install
//! random secret and the DEK wrapped under the PIN KEK and under the recovery
//! KEK — NEVER the PIN or the plaintext DEK. Three backends: Windows DPAPI
//! (`cfg(windows)`), Linux Secret Service (`cfg(target_os = "linux")`) and an
//! always-available encrypted-file fallback (NFR-020 explicitly allows it).

use crate::error::StorageError;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// One wrap of the DEK: an Argon2id salt + the AES-256-GCM wrapped-DEK bytes
/// (nonce ∥ ciphertext ∥ tag) + the Argon2id cost parameters used.
///
/// Stored, never secret on its own: unwrapping still needs the PIN (or recovery
/// code) to re-derive the KEK (R-SEC-006; the plaintext DEK is never stored).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DekWrap {
    /// 16-byte random per-wrap salt, lowercase hex. Not secret.
    pub salt_hex: String,
    /// Wrapped DEK = nonce ∥ ciphertext ∥ GCM tag, lowercase hex.
    pub wrapped_hex: String,
    /// Argon2id memory cost (KiB).
    pub m_cost: u32,
    /// Argon2id time cost (iterations).
    pub t_cost: u32,
    /// Argon2id parallelism.
    pub p_cost: u32,
}

/// What the keystore persists for one install (HC-MVP1-021, NFR-020).
///
/// Contains the per-install random secret and the DEK wrapped under the PIN KEK
/// and the recovery KEK. Never the PIN, never the plaintext DEK. The record is
/// additionally protected at rest by the backend (DPAPI / Secret Service /
/// file-fallback AES) for defense in depth.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeystoreRecord {
    /// Record schema version (AAD + forward compat).
    pub version: u8,
    /// 16-byte per-install random secret, lowercase hex. Mixed into every KEK
    /// salt (NFR-020 "per-install random secret"); not the PIN.
    pub per_install_secret_hex: String,
    /// DEK wrapped under the PIN-derived KEK.
    pub pin_wrap: DekWrap,
    /// DEK wrapped under the recovery-code-derived KEK (SET-004).
    pub recovery_wrap: DekWrap,
}

/// Persists and retrieves one install's [`KeystoreRecord`].
///
/// The chosen backend is a runtime decision by the app shell: prefer the OS
/// store, fall back to the encrypted file (NFR-020). The DEK inside the record
/// is already PIN-wrapped, so even an unprotected record never exposes it
/// without the PIN or recovery code.
pub trait Keystore: Send + Sync {
    /// Load the record, or `Ok(None)` if this install has none yet.
    fn load(&self) -> Result<Option<KeystoreRecord>, StorageError>;
    /// Persist (create or overwrite) the record.
    fn store(&self, record: &KeystoreRecord) -> Result<(), StorageError>;
    /// A short backend name for diagnostics (no secrets).
    fn backend_name(&self) -> &'static str;
}

/// Encrypted-file fallback keystore (NFR-020 "fallback to encrypted file").
///
/// ALWAYS available on every platform; fully functional and unit-tested on
/// headless Linux. Stores the serialized [`KeystoreRecord`] at
/// `<root>/licence/state.bin`, AES-256-GCM-encrypted under a key derived
/// (HKDF-SHA256) from a machine-local random file secret persisted at
/// `<root>/licence/state.key`.
///
/// Note on threat model: on a machine with no OS secure store, the file secret
/// and the ciphertext live on the same disk, so this layer is defense-in-depth,
/// not a root of trust — the DEK inside the record is still PIN-wrapped, so the
/// plaintext DEK is never recoverable without the PIN or recovery code
/// (NFR-020). On Windows / Linux desktop the DPAPI / Secret Service backends
/// provide the OS-bound protection.
pub struct FileKeystore {
    root: std::path::PathBuf,
}

impl FileKeystore {
    /// HKDF info string: domain-separates the at-rest file key from every other
    /// key derived in this crate.
    const FILE_KEY_INFO: &'static [u8] = b"hc-keystore-file-v1";

    /// Bind to the data dir `<root>`; the record lives at
    /// `<root>/licence/state.bin`.
    pub fn open(root: &Path) -> Result<FileKeystore, StorageError> {
        let dir = root.join("licence");
        std::fs::create_dir_all(&dir)?;
        Ok(FileKeystore {
            root: root.to_path_buf(),
        })
    }

    /// Path of the encrypted record blob.
    fn blob_path(&self) -> std::path::PathBuf {
        self.root.join("licence").join("state.bin")
    }

    /// Path of the machine-local file secret.
    fn secret_path(&self) -> std::path::PathBuf {
        self.root.join("licence").join("state.key")
    }

    /// Load (or create on first use) the 32-byte machine-local file secret.
    fn file_secret(&self) -> Result<zeroize::Zeroizing<[u8; 32]>, StorageError> {
        use rand::RngCore;
        let path = self.secret_path();
        if path.exists() {
            let hex = std::fs::read_to_string(&path)?;
            let bytes = hex::decode(hex.trim()).map_err(|_| StorageError::Crypto)?;
            if bytes.len() != 32 {
                return Err(StorageError::Crypto);
            }
            let mut secret = zeroize::Zeroizing::new([0u8; 32]);
            secret.copy_from_slice(&bytes);
            Ok(secret)
        } else {
            let mut secret = zeroize::Zeroizing::new([0u8; 32]);
            rand::thread_rng().fill_bytes(secret.as_mut());
            std::fs::write(&path, hex::encode(secret.as_ref()))?;
            Ok(secret)
        }
    }

    /// Derive the AES-256-GCM at-rest key from the file secret via HKDF-SHA256.
    fn at_rest_key(&self) -> Result<zeroize::Zeroizing<[u8; 32]>, StorageError> {
        use hkdf::Hkdf;
        use sha2::Sha256;
        let secret = self.file_secret()?;
        let hk = Hkdf::<Sha256>::new(None, secret.as_ref());
        let mut key = zeroize::Zeroizing::new([0u8; 32]);
        hk.expand(Self::FILE_KEY_INFO, key.as_mut())
            .map_err(|_| StorageError::Crypto)?;
        Ok(key)
    }
}

impl Keystore for FileKeystore {
    fn load(&self) -> Result<Option<KeystoreRecord>, StorageError> {
        let path = self.blob_path();
        if !path.exists() {
            return Ok(None);
        }
        let blob = std::fs::read(&path)?;
        let key = self.at_rest_key()?;
        // nonce ∥ ciphertext ∥ tag.
        let plaintext = crate::wrap::unwrap_blob(&blob, &key).map_err(|_| StorageError::Crypto)?;
        let record: KeystoreRecord =
            serde_json::from_slice(&plaintext).map_err(|_| StorageError::Crypto)?;
        Ok(Some(record))
    }

    fn store(&self, record: &KeystoreRecord) -> Result<(), StorageError> {
        let json = serde_json::to_vec(record)?;
        let key = self.at_rest_key()?;
        let blob = crate::wrap::wrap_blob(&json, &key)?;
        // Write to a temp file then rename for atomicity on the same dir.
        let tmp = self.blob_path().with_extension("bin.tmp");
        std::fs::write(&tmp, &blob)?;
        std::fs::rename(&tmp, self.blob_path())?;
        Ok(())
    }

    fn backend_name(&self) -> &'static str {
        "file"
    }
}

/// Windows DPAPI keystore (CryptProtectData / CryptUnprotectData, user scope).
///
/// COMPILES on Windows only; UNVERIFIED in the headless sandbox (no Windows
/// target). Round-trip tests are `#[cfg(windows)]` + `#[ignore]` with a reason.
#[cfg(windows)]
pub struct DpapiKeystore {
    root: std::path::PathBuf,
}

#[cfg(windows)]
impl DpapiKeystore {
    /// Bind to the data dir `<root>`; the DPAPI-protected blob lives under it.
    pub fn open(root: &Path) -> Result<DpapiKeystore, StorageError> {
        std::fs::create_dir_all(root.join("licence"))?;
        Ok(DpapiKeystore {
            root: root.to_path_buf(),
        })
    }

    /// Path of the DPAPI-protected record blob.
    fn blob_path(&self) -> std::path::PathBuf {
        self.root.join("licence").join("state.dpapi")
    }
}

// NOTE (HC-MVP1-021, UNVERIFIED backend): the real DPAPI binding calls
// `CryptProtectData` / `CryptUnprotectData` from `windows-sys`. Those are
// `unsafe` FFI, and this crate declares `#![forbid(unsafe_code)]` (R-RUST-004):
// wiring the FFI requires a small reviewed `unsafe` block justified by an ADR,
// to be added when a Windows target is available at R1-close. Until then this
// backend COMPILES and surfaces its on-disk location, but `load` on an absent
// store is `None` and `store` reports `NotInitialized` so no caller can mistake
// it for a working at-rest protection. The encrypted-file fallback
// ([`FileKeystore`], NFR-020) is the operational backend everywhere today.
#[cfg(windows)]
impl Keystore for DpapiKeystore {
    fn load(&self) -> Result<Option<KeystoreRecord>, StorageError> {
        if !self.blob_path().exists() {
            return Ok(None);
        }
        // UNVERIFIED: DPAPI unprotect not yet wired (needs reviewed FFI + ADR).
        Err(StorageError::NotInitialized)
    }
    fn store(&self, _record: &KeystoreRecord) -> Result<(), StorageError> {
        // UNVERIFIED: DPAPI protect not yet wired (needs reviewed FFI + ADR).
        Err(StorageError::NotInitialized)
    }
    fn backend_name(&self) -> &'static str {
        "dpapi"
    }
}

/// Linux Secret Service keystore (org.freedesktop.secrets via D-Bus).
///
/// COMPILES under `cfg(target_os = "linux")`; UNVERIFIED here (no D-Bus/keyring
/// in the headless sandbox). Round-trip tests are `#[ignore]` with a reason.
///
/// Stores the serialized record as one Secret Service item keyed by a fixed
/// attribute set; the collection itself is encrypted by the user's login
/// keyring. Uses the synchronous blocking API so it fits the blocking DB-worker
/// model (R-RUST-003 applies at the command boundary, not here).
#[cfg(target_os = "linux")]
pub struct SecretServiceKeystore {
    label: String,
}

#[cfg(target_os = "linux")]
impl SecretServiceKeystore {
    /// Attribute that uniquely identifies HomeoClinic's keystore item.
    const ATTR_APP: (&'static str, &'static str) = ("application", "homeoclinic");

    /// Bind to the user's default Secret Service collection.
    pub fn open() -> Result<SecretServiceKeystore, StorageError> {
        Ok(SecretServiceKeystore {
            label: "HomeoClinic".to_string(),
        })
    }
}

#[cfg(target_os = "linux")]
impl Keystore for SecretServiceKeystore {
    fn load(&self) -> Result<Option<KeystoreRecord>, StorageError> {
        use secret_service::blocking::SecretService;
        use secret_service::EncryptionType;

        let ss = SecretService::connect(EncryptionType::Dh).map_err(|_| StorageError::Crypto)?;
        let collection = ss
            .get_default_collection()
            .map_err(|_| StorageError::Crypto)?;
        let items = collection
            .search_items(std::collections::HashMap::from([Self::ATTR_APP]))
            .map_err(|_| StorageError::Crypto)?;
        let Some(item) = items.into_iter().next() else {
            return Ok(None);
        };
        let secret = item.get_secret().map_err(|_| StorageError::Crypto)?;
        let record: KeystoreRecord =
            serde_json::from_slice(&secret).map_err(|_| StorageError::Crypto)?;
        Ok(Some(record))
    }

    fn store(&self, record: &KeystoreRecord) -> Result<(), StorageError> {
        use secret_service::blocking::SecretService;
        use secret_service::EncryptionType;

        let json = serde_json::to_vec(record)?;
        let ss = SecretService::connect(EncryptionType::Dh).map_err(|_| StorageError::Crypto)?;
        let collection = ss
            .get_default_collection()
            .map_err(|_| StorageError::Crypto)?;
        collection
            .create_item(
                &self.label,
                std::collections::HashMap::from([Self::ATTR_APP]),
                &json,
                true, // replace an existing item with the same attributes
                "application/octet-stream",
            )
            .map_err(|_| StorageError::Crypto)?;
        Ok(())
    }

    fn backend_name(&self) -> &'static str {
        "secret-service"
    }
}
