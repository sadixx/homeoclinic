//! Encrypted attachment store (HC-MVP1-024, NFR-021, R-PRIV-007).
//!
//! Stores blobs as `<root>/files/<uuid>.bin`, AES-256-GCM, a unique random
//! 12-byte nonce per blob, opaque uuid filenames. The GCM key is the HKDF
//! attachment subkey of the DEK (domain-separated from the raw SQLCipher key),
//! obtained from [`crate::key::DekKeyProvider::attachment_key`].
//!
//! On-disk blob layout: `[0..12] = nonce`, `[12..] = ciphertext ∥ 16-byte tag`.
//! No plaintext, sha or length is stored in the file — the file is opaque bytes
//! (R-PRIV-007); the sha256/size live in the DB row the caller writes.

use crate::error::StorageError;
use crate::key::DekKeyProvider;
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

/// Metadata describing one stored attachment (HC-MVP1-024).
///
/// Returned by [`AttachmentStore::put`]; the caller persists these columns in
/// its own transaction (R-DATA-001). No patient data — only opaque ids + hashes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentMeta {
    /// Opaque uuid (v7) — also the on-disk file stem `files/<id>.bin`
    /// (R-PRIV-007).
    pub id: String,
    /// SHA-256 of the *plaintext*, lowercase hex (integrity + dedup).
    pub sha256: String,
    /// Plaintext byte length.
    pub size: u64,
}

/// Encrypted attachment store rooted at a data directory (HC-MVP1-024).
///
/// Writes/reads `<root>/files/<uuid>.bin`, AES-256-GCM, unique random nonce per
/// blob, opaque filenames (R-PRIV-007). The GCM key is the HKDF attachment
/// subkey of the DEK; the store never sees the PIN or the raw SQLCipher key.
pub struct AttachmentStore {
    root: PathBuf,
    /// The AES-256-GCM key for every blob: the HKDF attachment subkey of the
    /// DEK (domain-separated from the raw SQLCipher key). Zeroized on drop.
    key: Zeroizing<[u8; 32]>,
}

impl AttachmentStore {
    /// Bind to `<root>` (the data dir) using the unlocked provider's attachment
    /// subkey. Creates `<root>/files/` if absent.
    pub fn open(root: &Path, provider: &DekKeyProvider) -> Result<AttachmentStore, StorageError> {
        std::fs::create_dir_all(root.join("files"))?;
        Ok(AttachmentStore {
            root: root.to_path_buf(),
            key: provider.attachment_key(),
        })
    }

    /// Lowercase hex SHA-256 of `bytes`.
    fn sha256_hex(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(bytes);
        hex::encode(h.finalize())
    }

    /// Encrypt `plaintext` under a fresh random nonce, write `files/<uuid>.bin`
    /// (nonce ∥ ciphertext ∥ tag), and return its metadata. The uuid is
    /// generated internally (opaque, R-PRIV-007); sha256 is of the plaintext.
    pub fn put(&self, plaintext: &[u8]) -> Result<AttachmentMeta, StorageError> {
        let id = uuid::Uuid::now_v7().to_string();
        let blob = crate::wrap::wrap_blob(plaintext, &self.key)?;

        let path = self.blob_path(&id);
        // Write to a temp sibling then rename so a crash never leaves a
        // half-written blob at the final name.
        let tmp = path.with_extension("bin.tmp");
        std::fs::write(&tmp, &blob)?;
        std::fs::rename(&tmp, &path)?;

        Ok(AttachmentMeta {
            id,
            sha256: Self::sha256_hex(plaintext),
            size: plaintext.len() as u64,
        })
    }

    /// Read and decrypt `files/<id>.bin`; verifies the GCM auth tag. A tampered
    /// or truncated file → `AttachmentTampered`. Missing → `AttachmentMissing`.
    pub fn get(&self, id: &str) -> Result<Vec<u8>, StorageError> {
        let path = self.blob_path(id);
        let blob = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(StorageError::AttachmentMissing)
            }
            Err(e) => return Err(StorageError::Io(e)),
        };
        // A failed GCM tag (tamper / truncation) surfaces as AttachmentTampered.
        crate::wrap::unwrap_blob(&blob, &self.key)
    }

    /// Delete `files/<id>.bin`. Idempotent: deleting an absent id is `Ok(())`.
    pub fn delete(&self, id: &str) -> Result<(), StorageError> {
        let path = self.blob_path(id);
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(StorageError::Io(e)),
        }
    }

    /// The on-disk path for an id (`<root>/files/<id>.bin`). `pub` so the
    /// "file-on-disk unreadable" test can read the raw bytes through a public
    /// API (R-TEST-009) rather than reaching into private state.
    pub fn blob_path(&self, id: &str) -> PathBuf {
        self.root.join("files").join(format!("{id}.bin"))
    }
}
