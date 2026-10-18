//! HC-MVP1-024 encrypted attachment store tests (NFR-021, R-PRIV-007).
//!
//! All tests run on headless Linux via the encrypted-file fallback keystore and
//! a real unlocked DEK. RED phase (Slice B): these assert against the
//! architect's sentinel stubs and MUST fail until hc-data-dev implements the
//! store.

use hc_storage::attachment::AttachmentStore;
use hc_storage::error::StorageError;
use hc_storage::key::{DekKeyProvider, KeyHierarchy, KeyProvider};
use hc_storage::testing::temp_file_keystore;
use std::io::{Read, Seek, SeekFrom, Write};

/// Synthetic attachment payload (R-TEST-004: no real patient data).
const PLAINTEXT: &[u8] = b"Test Patient 001 prescription scan - synthetic bytes";

/// Build a store rooted in a fresh temp dir with a real unlocked DEK. Returns
/// the owning TempDir (kept alive), the store, and the provider (for key tests).
fn make_store() -> (tempfile::TempDir, AttachmentStore, DekKeyProvider) {
    let (dir, store_ks) = temp_file_keystore();
    let h = KeyHierarchy::new(&store_ks);
    let (_recovery, provider) = h.initialize("1234").expect("initialize hierarchy");
    let att = AttachmentStore::open(dir.path(), &provider).expect("open attachment store");
    (dir, att, provider)
}

/// Lowercase hex SHA-256 of `bytes`, computed independently of the CUT
/// (R-TEST-002/003) via the sha2 crate.
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn hc024_attachment_round_trip_returns_identical_plaintext() {
    let (_dir, att, _p) = make_store();

    let meta = att.put(PLAINTEXT).expect("put attachment");
    assert_eq!(
        meta.size,
        PLAINTEXT.len() as u64,
        "size must be plaintext len"
    );
    assert_eq!(
        meta.sha256,
        sha256_hex(PLAINTEXT),
        "sha256 must be of the plaintext"
    );

    let got = att.get(&meta.id).expect("get attachment");
    assert_eq!(got, PLAINTEXT, "round trip must return identical bytes");
}

#[test]
fn nfr021_file_on_disk_is_not_plaintext() {
    let (_dir, att, _p) = make_store();
    let meta = att.put(PLAINTEXT).expect("put attachment");

    let path = att.blob_path(&meta.id);
    let on_disk = std::fs::read(&path).expect("read blob file");

    assert_ne!(
        on_disk.as_slice(),
        PLAINTEXT,
        "blob on disk must not equal the plaintext (NFR-021)"
    );
    // The plaintext must not appear as a substring anywhere in the ciphertext.
    assert!(
        !on_disk.windows(PLAINTEXT.len()).any(|w| w == PLAINTEXT),
        "plaintext must not be present in the on-disk blob"
    );
    // nonce(12) + at least a 16-byte GCM tag means the file is strictly larger
    // than an empty payload and never zero-length.
    assert!(on_disk.len() >= 12 + 16, "blob must carry nonce + GCM tag");
}

#[test]
fn nfr021_tampering_a_blob_is_detected_on_read() {
    let (_dir, att, _p) = make_store();
    let meta = att.put(PLAINTEXT).expect("put attachment");
    let path = att.blob_path(&meta.id);

    // Flip one byte in the ciphertext region (past the 12-byte nonce).
    {
        let mut f = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .expect("open blob for tamper");
        f.seek(SeekFrom::Start(13)).expect("seek into ciphertext");
        let mut b = [0u8; 1];
        f.read_exact(&mut b).expect("read byte");
        b[0] ^= 0xff;
        f.seek(SeekFrom::Start(13)).expect("seek back");
        f.write_all(&b).expect("write tampered byte");
    }

    let err = att
        .get(&meta.id)
        .expect_err("tampered blob must fail to decrypt");
    assert!(
        matches!(err, StorageError::AttachmentTampered),
        "tamper must be AttachmentTampered (GCM auth fail), got {err:?}"
    );
}

#[test]
fn hc024_get_missing_attachment_is_attachmentmissing() {
    let (_dir, att, _p) = make_store();
    let err = att
        .get("0192f0c0-0000-7000-8000-000000000000")
        .expect_err("missing id must error");
    assert!(
        matches!(err, StorageError::AttachmentMissing),
        "missing attachment must be AttachmentMissing, got {err:?}"
    );
}

#[test]
fn hc024_delete_is_idempotent_and_removes_the_file() {
    let (_dir, att, _p) = make_store();
    let meta = att.put(PLAINTEXT).expect("put attachment");
    let path = att.blob_path(&meta.id);
    assert!(path.exists(), "blob file must exist after put");

    att.delete(&meta.id).expect("delete attachment");
    assert!(!path.exists(), "blob file must be gone after delete");
    assert!(
        matches!(att.get(&meta.id), Err(StorageError::AttachmentMissing)),
        "get after delete must be AttachmentMissing"
    );

    // Idempotent: deleting again is Ok.
    att.delete(&meta.id).expect("second delete must be Ok");
}

#[test]
fn rpriv007_blob_filename_is_opaque_uuid_bin() {
    let (_dir, att, _p) = make_store();
    let meta = att.put(PLAINTEXT).expect("put attachment");

    // id is a uuid (hyphenated, 36 chars), not a patient name.
    assert_eq!(meta.id.len(), 36, "id should be a hyphenated uuid");
    assert!(
        meta.id.chars().all(|c| c.is_ascii_hexdigit() || c == '-'),
        "id must be an opaque uuid, got {}",
        meta.id
    );

    let path = att.blob_path(&meta.id);
    let name = path.file_name().unwrap().to_string_lossy();
    assert_eq!(
        name,
        format!("{}.bin", meta.id),
        "file must be files/<uuid>.bin (R-PRIV-007)"
    );
    assert!(
        path.parent().unwrap().ends_with("files"),
        "blobs live under files/"
    );
}

#[test]
fn nfr021_attachment_key_is_not_the_raw_sqlcipher_key() {
    let (_dir, _att, provider) = make_store();

    let sqlcipher_key = provider.key().expect("sqlcipher key");
    let att_key = provider.attachment_key();

    assert_ne!(
        att_key.as_slice(),
        sqlcipher_key.as_slice(),
        "attachment key must be HKDF-derived, not the raw SQLCipher key (domain separation)"
    );
}
