//! DEK wrapping primitives (HC-MVP1-021): Argon2id KEK derivation and
//! AES-256-GCM wrap/unwrap of the 32-byte DEK.
//!
//! Crate-internal. All key material is held in zeroizing buffers and wiped on
//! drop (R-SEC-006); failures carry no attacker-controlled detail (R-PRIV-001).

use crate::error::StorageError;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use zeroize::Zeroizing;

/// AES-256-GCM nonce length (bytes). GCM standard 96-bit nonce.
const NONCE_LEN: usize = 12;

/// Argon2id cost parameters (documented defaults, OWASP 2024 baseline tuned for
/// a low-end clinic PC — SUX-003 one-entry unlock budget).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Argon2Params {
    /// Memory cost in KiB.
    pub m_cost: u32,
    /// Time cost (iterations).
    pub t_cost: u32,
    /// Parallelism.
    pub p_cost: u32,
}

impl Argon2Params {
    /// Production defaults: 19 MiB memory, 2 iterations, 1 lane.
    pub const PRODUCTION: Argon2Params = Argon2Params {
        m_cost: 19_456,
        t_cost: 2,
        p_cost: 1,
    };
}

/// Derive a 32-byte KEK from `secret` (the PIN or recovery code) and `salt`
/// using Argon2id with `params`. `salt` is the per-wrap salt concatenated with
/// the per-install secret (the caller assembles it).
pub(crate) fn derive_kek(
    secret: &[u8],
    salt: &[u8],
    params: Argon2Params,
) -> Result<Zeroizing<[u8; 32]>, StorageError> {
    // Build the Argon2id context. A bad parameter combination is a programming
    // error here (fixed constants), but we still surface it as Crypto rather
    // than panicking (R-RUST-002) and never echo the detail (R-PRIV-001).
    let params = Params::new(params.m_cost, params.t_cost, params.p_cost, Some(32))
        .map_err(|_| StorageError::Crypto)?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut out = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(secret, salt, out.as_mut())
        .map_err(|_| StorageError::Crypto)?;
    Ok(out)
}

/// Wrap the 32-byte `dek` under `kek` with AES-256-GCM and a fresh random
/// nonce. Returns nonce ∥ ciphertext ∥ tag.
pub(crate) fn wrap_dek(dek: &[u8; 32], kek: &[u8; 32]) -> Result<Vec<u8>, StorageError> {
    let cipher = Aes256Gcm::new_from_slice(kek).map_err(|_| StorageError::Crypto)?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, dek.as_slice())
        .map_err(|_| StorageError::Crypto)?;

    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Unwrap `wrapped` (nonce ∥ ciphertext ∥ tag) under `kek`. A wrong KEK (wrong
/// PIN / recovery code) fails the GCM auth tag — the caller maps that to
/// `WrongPin` / `WrongRecoveryCode`; this returns `Crypto` and the caller
/// distinguishes by context.
pub(crate) fn unwrap_dek(
    wrapped: &[u8],
    kek: &[u8; 32],
) -> Result<Zeroizing<[u8; 32]>, StorageError> {
    if wrapped.len() < NONCE_LEN {
        return Err(StorageError::Crypto);
    }
    let (nonce_bytes, ciphertext) = wrapped.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(kek).map_err(|_| StorageError::Crypto)?;
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = Zeroizing::new(
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| StorageError::Crypto)?,
    );
    if plaintext.len() != 32 {
        return Err(StorageError::Crypto);
    }
    let mut dek = Zeroizing::new([0u8; 32]);
    dek.copy_from_slice(&plaintext);
    Ok(dek)
}

/// Wrap arbitrary-length `plaintext` under `key` with AES-256-GCM and a fresh
/// random nonce. Returns nonce ∥ ciphertext ∥ tag. Shared by the encrypted-file
/// keystore and the attachment store.
pub(crate) fn wrap_blob(plaintext: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, StorageError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| StorageError::Crypto)?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| StorageError::Crypto)?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Derive the 32-byte backup body key from the backup password and the
/// per-archive salt using Argon2id (HC-MVP1-030). Thin wrapper over
/// [`derive_kek`] so the `.hcbak` format reuses the SAME audited Argon2id code
/// as the DEK key hierarchy — no reinvented KDF. The salt is the per-archive
/// random salt recorded (plaintext) in the header; no per-install secret is
/// mixed in, because a backup must be restorable on a DIFFERENT install where
/// that secret does not exist (restore-on-clean-install, design §5).
pub(crate) fn derive_backup_key(
    password: &[u8],
    salt: &[u8],
    params: Argon2Params,
) -> Result<Zeroizing<[u8; 32]>, StorageError> {
    derive_kek(password, salt, params)
}

/// Unwrap a `nonce ∥ ciphertext ∥ tag` blob under `key`, mapping a failed GCM
/// tag to [`StorageError::WrongBackupPassword`] (HC-MVP1-030/033).
///
/// The backup body is sealed with [`wrap_blob`]; a wrong backup password fails
/// the FIRST chunk's GCM tag, which the restore UI must distinguish from a
/// damaged file (`BadArchive`) so it can show an inline "try again" (S17 AC4).
pub(crate) fn open_backup_chunk(blob: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, StorageError> {
    if blob.len() < NONCE_LEN + 16 {
        return Err(StorageError::BadArchive);
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| StorageError::Crypto)?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| StorageError::WrongBackupPassword)
}

/// so callers that read opaque blobs surface the right error; the keystore maps
/// it to `Crypto` by context. Returns the plaintext bytes.
pub(crate) fn unwrap_blob(blob: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, StorageError> {
    if blob.len() < NONCE_LEN + 16 {
        // Too short to hold a nonce + GCM tag → treat as tampered/truncated.
        return Err(StorageError::AttachmentTampered);
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| StorageError::Crypto)?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| StorageError::AttachmentTampered)
}
