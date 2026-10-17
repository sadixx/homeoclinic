//! Backup / restore engine (HC-MVP1-030..034).
//!
//! Owns the `.hcbak` archive format (readable plaintext header + AES-256-GCM
//! chunked body), the 14/8/12 rotation keeper, manual backup to any folder/USB,
//! the preview-then-apply restore (safety copy + atomic swap + re-key under the
//! target install's DEK), and the post-backup integrity check + 7-day
//! staleness. Reuses the Slice B Argon2id + AES-256-GCM helpers in
//! [`crate::wrap`] — no reinvented crypto (design §1, §2, §5).
//!
//! ## `.hcbak` on-disk format (format version 1)
//!
//! ```text
//! MAGIC          8  bytes   b"HCBAK\x00\x01\x00"
//! HEADER_LEN     4  bytes   u32 LE, byte length of HEADER_JSON
//! HEADER_JSON    N  bytes   serde_json of `BackupHeader` (no key material)
//! HEADER_CRC     4  bytes   u32 LE CRC-32 of HEADER_JSON (header self-check)
//! BODY                      one or more chunks, each:
//!   CHUNK_LEN    4  bytes   u32 LE, byte length of the sealed chunk
//!   CHUNK        M  bytes   AES-256-GCM(nonce ∥ ciphertext ∥ tag) of a slice
//!                           of the plaintext body (DB snapshot + attachments,
//!                           serialized as one length-prefixed blob stream)
//! CHUNK_LEN=0    4  bytes   u32 LE zero marks end of chunk stream
//! BODY_SHA256   32  bytes   SHA-256 over every sealed CHUNK's bytes (integrity)
//! ```
//!
//! The header is plaintext so a restore can preview counts/dates WITHOUT the
//! password (S17 step 2 / AC4); it carries NO key material and NO patient data
//! (only aggregate counts — R-PRIV-001). The body key is
//! `Argon2id(backup_password, salt)` where `salt` is the plaintext header salt;
//! a wrong password fails the first chunk's GCM tag → [`StorageError::
//! WrongBackupPassword`] (distinct from a damaged file → [`StorageError::
//! BadArchive`]).
//!
//! ## Key re-establishment on a clean install (design §5, ADR 0003)
//!
//! The body carries a PORTABLE plaintext DB snapshot (produced by SQLCipher
//! `sqlcipher_export` into an attached unencrypted database), sealed under the
//! backup password. On restore the engine decrypts the snapshot and re-imports
//! it into a NEW database keyed with the TARGET install's own DEK
//! ([`KeyProvider`]), so the fresh install opens the restored `clinic.db` under
//! its own keystore — the backup password and the install DEK stay independent.
//! Attachments travel as opaque re-encrypted blobs and are restored under
//! `files/`.

use crate::clock::Clock;
use crate::error::StorageError;
use crate::key::KeyProvider;
use crate::pool::Pool;
use crate::wrap::{derive_backup_key, open_backup_chunk, wrap_blob, Argon2Params};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

/// Archive magic: "HCBAK" + NUL + format version (0x0001) little-endian tag.
const MAGIC: &[u8; 8] = b"HCBAK\x00\x01\x00";
/// The format version this build writes and is the highest it can read.
const FORMAT_VERSION: u16 = 1;
/// The `.hcbak` body is sealed as one chunk in R1 (small clinic DB); the format
/// supports a multi-chunk stream for large data in a later milestone.
const CHUNK_PLAINTEXT_LEN: usize = 1 << 20; // 1 MiB plaintext per chunk.
/// Days after which a last-good backup is considered stale (BAK-004).
const STALE_DAYS: i64 = 7;
/// Seconds in one day.
const SECS_PER_DAY: i64 = 86_400;
/// `app_setting` key recording the RFC3339 time of the last verified backup.
const LAST_GOOD_KEY: &str = "backup.last_good_at";

/// The plaintext, password-free header of a `.hcbak` archive (HC-MVP1-030).
///
/// Readable WITHOUT the backup password so a restore can preview counts and
/// dates before the doctor types anything (S17 restore step 2). Contains NO key
/// material and NO plaintext patient data — only aggregate counts and dates the
/// preview panel shows (R-PRIV-001).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupHeader {
    /// Archive format version (1 for R1). A reader refuses a newer major format
    /// with [`StorageError::BackupTooNew`] (forward-only, mirrors R-DATA-002).
    pub format_version: u16,
    /// RFC3339 UTC time the backup was made (S17 "Backup made").
    pub created_at: String,
    /// App version that wrote the archive, e.g. "1.0.3" (S17 "App version").
    pub app_version: String,
    /// Schema `user_version` of the DB snapshot inside, so restore can decide
    /// whether to run migrations (NFR-011).
    pub schema_version: u32,
    /// Cipher identifier; "AES-256-GCM" for R1 (self-describing).
    pub cipher: String,
    /// Argon2id parameters used to derive the body key from the password.
    pub kdf: BackupKdf,
    /// Aggregate preview counts (no patient data — R-PRIV-001).
    pub preview: BackupPreview,
}

/// Argon2id key-derivation parameters recorded in the header so a reader can
/// re-derive the body key from the password alone (HC-MVP1-030).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupKdf {
    /// Algorithm tag; "argon2id" for R1.
    pub algorithm: String,
    /// 16-byte random salt, lowercase hex (not secret).
    pub salt_hex: String,
    /// Argon2id memory cost (KiB).
    pub m_cost: u32,
    /// Argon2id time cost (iterations).
    pub t_cost: u32,
    /// Argon2id parallelism.
    pub p_cost: u32,
}

/// Aggregate preview the restore wizard shows before any change (S17 step 2).
/// Counts only; never a name or any patient data (R-PRIV-001).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupPreview {
    /// Patient row count at backup time (0 in M1 — no patient table yet).
    pub patient_count: u64,
    /// Visit row count at backup time (0 in M1).
    pub visit_count: u64,
    /// Last visit date (RFC3339 date) or None if no visits.
    pub last_visit_date: Option<String>,
    /// Number of attachment files included.
    pub attachment_count: u64,
}

/// Result of a backup (manual or scheduled) — HC-MVP1-030/032/034.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupOutcome {
    /// Absolute path of the written `.hcbak`.
    pub file_path: PathBuf,
    /// Size in bytes of the written archive.
    pub size_bytes: u64,
    /// True once the post-backup checksum + decrypt-test passed (HC-MVP1-034).
    pub verified: bool,
}

/// Result of a restore — HC-MVP1-033.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoreOutcome {
    /// Path of the pre-restore safety copy of the previous data dir.
    pub pre_restore_backup_path: PathBuf,
    /// Schema version after restore (post-migration), for the caller's log.
    pub schema_version: u32,
}

/// Result of verify — HC-MVP1-034.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VerifyOutcome {
    /// Body bytes matched the recorded `BODY_SHA256` trailer.
    pub checksum_ok: bool,
    /// The first body chunk decrypted under the given password.
    pub decrypt_ok: bool,
}

/// The rotation policy — HC-MVP1-031 (fixed 14/8/12).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionPolicy {
    /// Daily copies to keep (14).
    pub daily: u32,
    /// Weekly copies to keep (8).
    pub weekly: u32,
    /// Monthly copies to keep (12).
    pub monthly: u32,
}

impl RetentionPolicy {
    /// The R1 default: 14 daily, 8 weekly, 12 monthly (BAK-001).
    pub const DEFAULT: RetentionPolicy = RetentionPolicy {
        daily: 14,
        weekly: 8,
        monthly: 12,
    };
}

/// Backup health for S17 + the status-bar chip — HC-MVP1-034.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupStatus {
    /// RFC3339 UTC of the last good (verified) backup, or None if never.
    pub last_good_at: Option<String>,
    /// Whole days since the last good backup (per the clock), or None.
    pub days_since_good: Option<u32>,
    /// True when there is no good backup, or the last good one is > 7 days old.
    pub stale: bool,
    /// Retention policy constants (14/8/12) for the S17 retention line.
    pub retention: RetentionPolicy,
}

/// How many on-disk archives are kept in each rotation tier. Returned by
/// [`BackupEngine::rotation_counts`] so the simulated-400-days test can assert
/// the exact 14/8/12 keep without reaching into private state (R-TEST-009).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RotationCounts {
    /// Number of `.hcbak` files currently in `backups/daily/`.
    pub daily: u32,
    /// Number of `.hcbak` files currently in `backups/weekly/`.
    pub weekly: u32,
    /// Number of `.hcbak` files currently in `backups/monthly/`.
    pub monthly: u32,
}

// ---------------------------------------------------------------------------
// CRC-32 (IEEE 802.3), dependency-free, for the self-checking header.
// ---------------------------------------------------------------------------

/// CRC-32 (IEEE polynomial `0xEDB88320`) of `data`. Used only to self-check the
/// plaintext header so a truncated/corrupt header is rejected as
/// [`StorageError::BadArchive`] without touching the body (R-SEC-008: no new
/// dep for a trivial checksum).
fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

/// Read ONLY the plaintext header of a `.hcbak` at `file`, WITHOUT the password
/// and WITHOUT opening the body (HC-MVP1-030, S17 preview / AC4). A bad magic or
/// a failed header CRC → [`StorageError::BadArchive`]; a newer format →
/// [`StorageError::BackupTooNew`].
pub fn read_header(file: &Path) -> Result<BackupHeader, StorageError> {
    let bytes = std::fs::read(file)?;
    parse_header(&bytes).map(|(h, _consumed)| h)
}

/// Parse the header from the front of `bytes`, returning it and the byte offset
/// where the body begins. Any shortfall or a failed CRC is a clean
/// [`StorageError::BadArchive`] (no panic — a truncated file must not index out
/// of bounds).
fn parse_header(bytes: &[u8]) -> Result<(BackupHeader, usize), StorageError> {
    // MAGIC (8) + HEADER_LEN (4) must be present.
    if bytes.len() < MAGIC.len() + 4 {
        return Err(StorageError::BadArchive);
    }
    if &bytes[..MAGIC.len()] != MAGIC {
        return Err(StorageError::BadArchive);
    }
    let mut off = MAGIC.len();
    let header_len = read_u32(bytes, &mut off)? as usize;

    // HEADER_JSON + HEADER_CRC must fit.
    let json_start = off;
    let json_end = json_start
        .checked_add(header_len)
        .ok_or(StorageError::BadArchive)?;
    let crc_end = json_end.checked_add(4).ok_or(StorageError::BadArchive)?;
    if bytes.len() < crc_end {
        return Err(StorageError::BadArchive);
    }
    let json = &bytes[json_start..json_end];
    let mut crc_off = json_end;
    let stored_crc = read_u32(bytes, &mut crc_off)?;
    if crc32(json) != stored_crc {
        return Err(StorageError::BadArchive);
    }

    let header: BackupHeader =
        serde_json::from_slice(json).map_err(|_| StorageError::BadArchive)?;

    // Forward-only: refuse a format newer than this build (mirrors R-DATA-002).
    if header.format_version > FORMAT_VERSION {
        return Err(StorageError::BackupTooNew {
            found: header.format_version,
            supported: FORMAT_VERSION,
        });
    }

    Ok((header, crc_end))
}

/// Read a little-endian `u32` at `*off`, advancing `off`. Out of range →
/// [`StorageError::BadArchive`] (truncated archive).
fn read_u32(bytes: &[u8], off: &mut usize) -> Result<u32, StorageError> {
    let end = off.checked_add(4).ok_or(StorageError::BadArchive)?;
    if bytes.len() < end {
        return Err(StorageError::BadArchive);
    }
    let v = u32::from_le_bytes([
        bytes[*off],
        bytes[*off + 1],
        bytes[*off + 2],
        bytes[*off + 3],
    ]);
    *off = end;
    Ok(v)
}

/// One attachment carried in the body: opaque file stem + its on-disk bytes
/// (already AES-256-GCM-sealed by the attachment store). Travels inside the
/// password-sealed body, so the backup password protects it in transit, and the
/// bytes stay opaque on disk (R-PRIV-007).
#[derive(Debug, Serialize, Deserialize)]
struct BodyAttachment {
    /// On-disk file name under `files/`, e.g. `<uuid>.bin` (opaque).
    name: String,
    /// The raw sealed blob bytes copied verbatim from `files/<uuid>.bin`.
    /// `serde_json` encodes `Vec<u8>` as a JSON number array; the payload is
    /// sealed so the on-wire encoding is never exposed (R-SEC-008: no new dep).
    blob: Vec<u8>,
}

/// The decrypted body payload: the portable plaintext DB snapshot plus every
/// attachment blob. Serialized with `serde_json` then sealed under the backup
/// password. Never written to disk in the clear (it only ever exists decrypted
/// in memory during backup/restore — R-PRIV-002).
#[derive(Debug, Serialize, Deserialize)]
struct BodyPayload {
    /// The portable, UNENCRYPTED SQLite snapshot of `clinic.db` (produced via
    /// `sqlcipher_export` into an attached plaintext DB). Re-imported under the
    /// target DEK on restore (design §5).
    db_snapshot: Vec<u8>,
    /// Every attachment file under `files/`, opaque bytes.
    attachments: Vec<BodyAttachment>,
}

/// Backup/restore engine over one install's data dir (HC-MVP1-030..034).
///
/// Stateless over injected dependencies: the live [`Pool`] (for the online
/// snapshot), the data-dir root (for attachments + `backups/`), and a [`Clock`]
/// (so rotation + staleness are deterministic in tests — R-TEST-006). Does NOT
/// own the backup password: callers pass it per operation; "remember on this
/// PC" is a keystore concern in hc-core-dev (SUX-011, design §0).
pub struct BackupEngine<'a> {
    pool: &'a Pool,
    data_dir: &'a Path,
    clock: &'a dyn Clock,
}

impl<'a> BackupEngine<'a> {
    /// Bind to the live pool, data-dir root and clock.
    pub fn new(pool: &'a Pool, data_dir: &'a Path, clock: &'a dyn Clock) -> Self {
        BackupEngine {
            pool,
            data_dir,
            clock,
        }
    }

    /// (HC-MVP1-030/032) Write one `.hcbak` to `out_dir` (folder or USB),
    /// encrypted under a key derived from `password` (Argon2id). Snapshots the
    /// DB online + copies attachments, seals the chunked body, writes to a temp
    /// sibling in `out_dir` then atomically renames (fail-safe on removed USB /
    /// no space — OQ-S17-5). Runs the integrity check (HC-MVP1-034) and records
    /// the last-good time on success.
    pub fn backup_to(&self, out_dir: &Path, password: &str) -> Result<BackupOutcome, StorageError> {
        // The destination must exist and be writable; a missing/removed USB
        // mount is DestinationUnavailable (OQ-S17-5), not a generic IO error.
        if !out_dir.is_dir() {
            return Err(StorageError::DestinationUnavailable);
        }
        let stamp = self.clock.now_rfc3339();
        let file_name = format!("homeoclinic-{}.hcbak", stamp_to_file_token(&stamp));
        let final_path = out_dir.join(file_name);
        self.write_archive(&final_path, out_dir, password, &stamp)?;

        // Post-write integrity check (HC-MVP1-034): CRC header + body sha +
        // decrypt first chunk. Discard a self-inconsistent archive.
        let v = self.verify(&final_path, password)?;
        if !(v.checksum_ok && v.decrypt_ok) {
            let _ = std::fs::remove_file(&final_path);
            return Err(StorageError::BackupVerifyFailed);
        }

        let size_bytes = std::fs::metadata(&final_path)?.len();
        self.record_last_good(&stamp)?;
        Ok(BackupOutcome {
            file_path: final_path,
            size_bytes,
            verified: true,
        })
    }

    /// (HC-MVP1-031) Run the automatic daily backup into
    /// `data_dir/backups/daily/`, then apply the 14/8/12 rotation across
    /// daily/weekly/monthly, pruning older copies. Clock-driven; silent — the
    /// remembered `password` is passed in, never prompted (SUX-011).
    pub fn run_scheduled_backup(&self, password: &str) -> Result<BackupOutcome, StorageError> {
        let daily = self.tier_dir("daily");
        std::fs::create_dir_all(&daily)?;
        let outcome = self.backup_to(&daily, password)?;
        self.rotate()?;
        Ok(outcome)
    }

    /// (HC-MVP1-031) Current count of archives in each rotation tier, for the
    /// rotation test (R-TEST-009). Reads `backups/{daily,weekly,monthly}/`.
    pub fn rotation_counts(&self) -> Result<RotationCounts, StorageError> {
        Ok(RotationCounts {
            daily: count_archives(&self.tier_dir("daily"))?,
            weekly: count_archives(&self.tier_dir("weekly"))?,
            monthly: count_archives(&self.tier_dir("monthly"))?,
        })
    }

    /// (HC-MVP1-033) Read the header + preview counts from `file` WITHOUT the
    /// password and WITHOUT mutating anything (S17 restore step 2 / AC4).
    pub fn restore_preview(&self, file: &Path) -> Result<BackupHeader, StorageError> {
        read_header(file)
    }

    /// (HC-MVP1-033) Apply a restore from `file` using `password`. Verifies the
    /// header and opens the body (a wrong password →
    /// [`StorageError::WrongBackupPassword`]), takes a safety copy of the
    /// current data dir, re-keys the plaintext snapshot under `target_key`
    /// (design §5), migrates if the archive is older (NFR-011), then atomically
    /// swaps. Nothing live is touched on a pre-swap failure.
    pub fn restore_apply(
        &self,
        file: &Path,
        password: &str,
        target_key: &dyn KeyProvider,
    ) -> Result<RestoreOutcome, StorageError> {
        // 1. Read header (rejects bad/too-new archives) and decrypt the body
        //    (rejects a wrong password) BEFORE touching any live data.
        let header = read_header(file)?;
        let payload = self.open_body(file, password, &header)?;

        // 2. Build the restored artifacts in a staging dir so nothing live is
        //    mutated until the atomic swap. If any step fails, the live data
        //    dir is untouched.
        let staging = self.data_dir.join(".hc-restore-staging");
        if staging.exists() {
            std::fs::remove_dir_all(&staging)?;
        }
        std::fs::create_dir_all(&staging)?;
        let staged_db = staging.join("clinic.db");
        let staged_files = staging.join("files");
        std::fs::create_dir_all(&staged_files)?;

        // Re-key the portable plaintext snapshot under the TARGET install's DEK
        // so the restored DB opens under the new install's own keystore (§5).
        reimport_snapshot_under_key(&payload.db_snapshot, &staged_db, target_key)?;

        // Restore attachment blobs verbatim (opaque, already sealed).
        for att in &payload.attachments {
            std::fs::write(staged_files.join(&att.name), &att.blob)?;
        }

        // 3. Pre-restore safety copy of the CURRENT data (BAK-003): the live DB
        //    + files are moved aside before the swap, so a failure is
        //    recoverable and the swap itself is a rename. The DB's WAL/SHM
        //    sidecars move WITH it; leaving a stale `-wal`/`-shm` behind would
        //    make SQLCipher replay the old WAL against the restored file and
        //    fail page decryption, so they are relocated too.
        let safety = self.data_dir.join(format!(
            "pre-restore-{}",
            stamp_to_file_token(&self.clock.now_rfc3339())
        ));
        std::fs::create_dir_all(&safety)?;
        let live_db = self.data_dir.join("clinic.db");
        move_db_with_sidecars(&live_db, &safety.join("clinic.db"))?;
        let live_files = self.data_dir.join("files");
        if live_files.exists() {
            std::fs::rename(&live_files, safety.join("files"))?;
        }

        // 4. Atomic swap: move the staged artifacts into place. The DB file is a
        //    single rename within the same dir (atomic on both OSes); the
        //    restored file is fresh and carries no WAL sidecar.
        std::fs::rename(&staged_db, &live_db)?;
        std::fs::rename(&staged_files, &live_files)?;
        let _ = std::fs::remove_dir_all(&staging);

        // 5. Migrate-if-older: open under the target key and run forward-only
        //    migrations so an older snapshot reaches this build's schema
        //    (NFR-011). The restored DB is a fresh file, so this also stamps
        //    user_version.
        let restored_pool = Pool::open(&live_db, target_key)?;
        let schema_version = crate::migrate::run(&restored_pool)?;

        Ok(RestoreOutcome {
            pre_restore_backup_path: safety,
            schema_version,
        })
    }

    /// (HC-MVP1-034) Verify an existing archive: re-CRC the header, re-hash the
    /// body (checksum_ok), and decrypt the first chunk with `password`
    /// (decrypt_ok). Mutates nothing.
    pub fn verify(&self, file: &Path, password: &str) -> Result<VerifyOutcome, StorageError> {
        let bytes = std::fs::read(file)?;
        let (header, body_start) = parse_header(&bytes)?;

        // Walk the chunk stream, hashing each sealed chunk, to the trailer.
        let (sealed_chunks, stored_body_sha) = match split_body(&bytes, body_start) {
            Ok(v) => v,
            Err(_) => {
                return Ok(VerifyOutcome {
                    checksum_ok: false,
                    decrypt_ok: false,
                })
            }
        };
        let mut hasher = Sha256::new();
        for chunk in &sealed_chunks {
            hasher.update(chunk);
        }
        let computed: [u8; 32] = hasher.finalize().into();
        let checksum_ok = computed == stored_body_sha;

        // Decrypt the FIRST chunk under the password (proves the body is
        // readable). A wrong password fails the GCM tag → decrypt_ok = false.
        let decrypt_ok = match sealed_chunks.first() {
            Some(first) => {
                let key = self.body_key(password, &header.kdf)?;
                open_backup_chunk(first, &key).is_ok()
            }
            None => false,
        };

        Ok(VerifyOutcome {
            checksum_ok,
            decrypt_ok,
        })
    }

    /// (HC-MVP1-034) Recorded status: last good backup time, days since, and
    /// `stale` = last_good is None or older than 7 days per the injected clock.
    pub fn status(&self) -> Result<BackupStatus, StorageError> {
        let last_good_at = self.read_last_good()?;
        let now = self.clock.now_unix();
        let (days_since_good, stale) = match &last_good_at {
            Some(stamp) => match parse_rfc3339_to_unix(stamp) {
                Some(then) => {
                    let days = ((now - then).max(0)) / SECS_PER_DAY;
                    (Some(days as u32), days > STALE_DAYS)
                }
                // An unparseable stamp is treated as "no good backup" → stale.
                None => (None, true),
            },
            None => (None, true),
        };
        Ok(BackupStatus {
            last_good_at,
            days_since_good,
            stale,
            retention: RetentionPolicy::DEFAULT,
        })
    }

    // -- internals ----------------------------------------------------------

    /// `data_dir/backups/<tier>/`.
    fn tier_dir(&self, tier: &str) -> PathBuf {
        self.data_dir.join("backups").join(tier)
    }

    /// Derive the AES-256-GCM body key from the password + header KDF params.
    fn body_key(
        &self,
        password: &str,
        kdf: &BackupKdf,
    ) -> Result<Zeroizing<[u8; 32]>, StorageError> {
        let salt = hex::decode(&kdf.salt_hex).map_err(|_| StorageError::BadArchive)?;
        let params = Argon2Params {
            m_cost: kdf.m_cost,
            t_cost: kdf.t_cost,
            p_cost: kdf.p_cost,
        };
        derive_backup_key(password.as_bytes(), &salt, params)
    }

    /// Build the body payload, seal it, and write a complete `.hcbak` to
    /// `final_path` atomically (temp sibling in `out_dir` then rename).
    fn write_archive(
        &self,
        final_path: &Path,
        out_dir: &Path,
        password: &str,
        stamp: &str,
    ) -> Result<(), StorageError> {
        // 1. Portable plaintext DB snapshot via SQLCipher online export.
        let db_snapshot = self.export_portable_snapshot()?;
        let schema_version = self.schema_version()?;

        // 2. Collect attachment blobs (opaque, already sealed on disk).
        let attachments = self.collect_attachments()?;
        let attachment_count = attachments.len() as u64;

        // 3. Serialize + seal the body under an Argon2id key from the password.
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        let kdf = BackupKdf {
            algorithm: "argon2id".to_string(),
            salt_hex: hex::encode(salt),
            m_cost: Argon2Params::PRODUCTION.m_cost,
            t_cost: Argon2Params::PRODUCTION.t_cost,
            p_cost: Argon2Params::PRODUCTION.p_cost,
        };
        let key = self.body_key(password, &kdf)?;

        let payload = BodyPayload {
            db_snapshot,
            attachments,
        };
        // Keep the serialized plaintext body in a zeroizing buffer: it holds a
        // decrypted DB snapshot and must not linger in the clear (R-PRIV-002).
        let plaintext = Zeroizing::new(serde_json::to_vec(&payload)?);

        // Seal into GCM chunks (one per CHUNK_PLAINTEXT_LEN slice).
        let mut sealed_chunks: Vec<Vec<u8>> = Vec::new();
        for slice in plaintext.chunks(CHUNK_PLAINTEXT_LEN) {
            sealed_chunks.push(wrap_blob(slice, &key)?);
        }
        if sealed_chunks.is_empty() {
            // An empty body still gets one sealed (empty) chunk so decrypt-test
            // has something to open.
            sealed_chunks.push(wrap_blob(&[], &key)?);
        }

        // 4. Build the header.
        let header = BackupHeader {
            format_version: FORMAT_VERSION,
            created_at: stamp.to_string(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            schema_version,
            cipher: "AES-256-GCM".to_string(),
            kdf,
            preview: BackupPreview {
                patient_count: 0,
                visit_count: 0,
                last_visit_date: None,
                attachment_count,
            },
        };
        let header_json = serde_json::to_vec(&header)?;
        let header_crc = crc32(&header_json);

        // 5. Assemble the archive bytes: MAGIC | HEADER_LEN | JSON | CRC |
        //    (CHUNK_LEN | CHUNK)* | 0 | BODY_SHA256.
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&(header_json.len() as u32).to_le_bytes());
        out.extend_from_slice(&header_json);
        out.extend_from_slice(&header_crc.to_le_bytes());

        let mut body_hasher = Sha256::new();
        for chunk in &sealed_chunks {
            out.extend_from_slice(&(chunk.len() as u32).to_le_bytes());
            out.extend_from_slice(chunk);
            body_hasher.update(chunk);
        }
        out.extend_from_slice(&0u32.to_le_bytes()); // end-of-stream marker
        let body_sha: [u8; 32] = body_hasher.finalize().into();
        out.extend_from_slice(&body_sha);

        // 6. Atomic write: temp sibling in the SAME dir then rename. On no
        //    space / removed USB mid-write, the previous good backup is intact
        //    (OQ-S17-5) and we surface the right error.
        let tmp = out_dir.join(format!(".{}.hcbak.tmp", stamp_to_file_token(stamp)));
        if let Err(e) = std::fs::write(&tmp, &out) {
            let _ = std::fs::remove_file(&tmp);
            return Err(map_write_error(e));
        }
        if let Err(e) = std::fs::rename(&tmp, final_path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(map_write_error(e));
        }
        Ok(())
    }

    /// Decrypt + deserialize the full body payload from `file` under `password`.
    fn open_body(
        &self,
        file: &Path,
        password: &str,
        header: &BackupHeader,
    ) -> Result<BodyPayload, StorageError> {
        let bytes = std::fs::read(file)?;
        let (_h, body_start) = parse_header(&bytes)?;
        let (sealed_chunks, _sha) = split_body(&bytes, body_start)?;
        let key = self.body_key(password, &header.kdf)?;

        // Decrypt each chunk; a wrong password fails the FIRST chunk's GCM tag
        // → WrongBackupPassword (mapped by open_backup_chunk).
        let mut plaintext = Zeroizing::new(Vec::new());
        for chunk in &sealed_chunks {
            let part = open_backup_chunk(chunk, &key)?;
            plaintext.extend_from_slice(&part);
        }
        let payload: BodyPayload =
            serde_json::from_slice(&plaintext).map_err(|_| StorageError::BadArchive)?;
        Ok(payload)
    }

    /// Export the live DB as a portable, UNENCRYPTED SQLite snapshot using
    /// SQLCipher's `sqlcipher_export` into an attached plaintext database. This
    /// is the online, live-safe path (it reads a consistent view through the
    /// writer connection) and yields a DB the restore can re-key under any
    /// target DEK (design §5). The snapshot is read back into memory and the
    /// temp plaintext file is removed.
    fn export_portable_snapshot(&self) -> Result<Vec<u8>, StorageError> {
        let tmp_dir = self.data_dir.join(".hc-snapshot-tmp");
        std::fs::create_dir_all(&tmp_dir)?;
        let snap_path = tmp_dir.join("snapshot.db");
        if snap_path.exists() {
            std::fs::remove_file(&snap_path)?;
        }
        let snap_str = snap_path
            .to_str()
            .ok_or_else(|| {
                StorageError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "snapshot path is not valid UTF-8",
                ))
            })?
            .replace('\'', "''");

        // Attach a PLAINTEXT destination (KEY '') and export into it. The path
        // is engine-constructed (never external input); the same documented
        // R-SEC-001 exception as PRAGMA key / the migration backup.
        self.pool.with_writer(|conn| {
            conn.execute_batch(&format!("ATTACH DATABASE '{snap_str}' AS hc_snap KEY '';"))?;
            let export = (|| -> Result<(), StorageError> {
                conn.query_row("SELECT sqlcipher_export('hc_snap')", [], |_| Ok(()))?;
                // Carry the schema version onto the plaintext snapshot.
                let v = crate::migrate::current_version(conn)?;
                conn.execute_batch(&format!("PRAGMA hc_snap.user_version = {v};"))?;
                Ok(())
            })();
            let detach = conn.execute_batch("DETACH DATABASE hc_snap;");
            export?;
            detach?;
            Ok(())
        })?;

        let snapshot = std::fs::read(&snap_path)?;
        let _ = std::fs::remove_dir_all(&tmp_dir);
        Ok(snapshot)
    }

    /// The current schema `user_version` of the live DB.
    fn schema_version(&self) -> Result<u32, StorageError> {
        self.pool.with_reader(crate::migrate::current_version)
    }

    /// Read every `files/<uuid>.bin` into the body (opaque bytes). Missing dir →
    /// no attachments.
    fn collect_attachments(&self) -> Result<Vec<BodyAttachment>, StorageError> {
        let files_dir = self.data_dir.join("files");
        let mut out = Vec::new();
        let entries = match std::fs::read_dir(&files_dir) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(StorageError::Io(e)),
        };
        for entry in entries {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            // Only carry the opaque *.bin blobs, not temp siblings.
            if !name.ends_with(".bin") {
                continue;
            }
            let blob = std::fs::read(entry.path())?;
            out.push(BodyAttachment { name, blob });
        }
        Ok(out)
    }

    /// Record the last-good backup time in `app_setting` (HC-MVP1-034). One
    /// transaction + one audit row (R-DATA-001). The value is the RFC3339 stamp
    /// as a JSON string.
    fn record_last_good(&self, stamp: &str) -> Result<(), StorageError> {
        let value_json = serde_json::to_string(stamp)?;
        self.pool.with_writer(|conn| {
            let tx = conn.transaction()?;
            crate::profile::put_setting(&tx, LAST_GOOD_KEY, &value_json, stamp)?;
            tx.commit()?;
            Ok(())
        })
    }

    /// Read the last-good backup time from `app_setting`, or `None`.
    fn read_last_good(&self) -> Result<Option<String>, StorageError> {
        let value_json = self
            .pool
            .with_reader(|conn| crate::profile::get_setting(conn, LAST_GOOD_KEY))?;
        match value_json {
            Some(j) => Ok(Some(serde_json::from_str::<String>(&j)?)),
            None => Ok(None),
        }
    }

    /// Apply the 14/8/12 rotation (HC-MVP1-031).
    ///
    /// Promotion is clock-driven and idempotent: for each archive currently in
    /// `daily/`, derive its ISO week and month buckets from the file stamp; keep
    /// at most one per bucket in `weekly/` and `monthly/` by copying the newest
    /// daily of a new bucket up, then prune each tier to its keep-count newest.
    fn rotate(&self) -> Result<(), StorageError> {
        let daily = self.tier_dir("daily");
        let weekly = self.tier_dir("weekly");
        let monthly = self.tier_dir("monthly");
        std::fs::create_dir_all(&weekly)?;
        std::fs::create_dir_all(&monthly)?;

        // Newest daily archive (by sorted file token = chronological) is the
        // promotion candidate for this run.
        let mut dailies = list_archives(&daily)?;
        dailies.sort(); // tokens are zero-padded, so lexical == chronological
        if let Some(newest_daily) = dailies.last().cloned() {
            let token = file_token_of(&newest_daily);
            // Promote to weekly if no weekly yet covers this archive's week.
            promote_if_new_bucket(&newest_daily, &weekly, &week_bucket(&token))?;
            // Promote to monthly if no monthly yet covers this archive's month.
            promote_if_new_bucket(&newest_daily, &monthly, &month_bucket(&token))?;
        }

        prune_tier(&daily, RetentionPolicy::DEFAULT.daily)?;
        prune_tier(&weekly, RetentionPolicy::DEFAULT.weekly)?;
        prune_tier(&monthly, RetentionPolicy::DEFAULT.monthly)?;
        Ok(())
    }
}

/// Split the chunk stream + trailer out of `bytes` starting at `body_start`.
/// Returns the sealed chunks and the stored 32-byte body SHA. Any shortfall is
/// [`StorageError::BadArchive`].
fn split_body(bytes: &[u8], body_start: usize) -> Result<(Vec<Vec<u8>>, [u8; 32]), StorageError> {
    let mut off = body_start;
    let mut chunks = Vec::new();
    loop {
        let len = read_u32(bytes, &mut off)? as usize;
        if len == 0 {
            break; // end-of-stream marker
        }
        let end = off.checked_add(len).ok_or(StorageError::BadArchive)?;
        if bytes.len() < end {
            return Err(StorageError::BadArchive);
        }
        chunks.push(bytes[off..end].to_vec());
        off = end;
    }
    // Trailer: 32-byte body SHA.
    let sha_end = off.checked_add(32).ok_or(StorageError::BadArchive)?;
    if bytes.len() < sha_end {
        return Err(StorageError::BadArchive);
    }
    let mut sha = [0u8; 32];
    sha.copy_from_slice(&bytes[off..sha_end]);
    Ok((chunks, sha))
}

/// Re-import a portable PLAINTEXT SQLite snapshot into a NEW database at
/// `dest_db` keyed with `target_key`'s SQLCipher key (design §5). The snapshot
/// is written to a temp plaintext file, attached as a KEYED destination, and
/// `sqlcipher_export`ed into it so the result opens under the target DEK.
fn reimport_snapshot_under_key(
    snapshot: &[u8],
    dest_db: &Path,
    target_key: &dyn KeyProvider,
) -> Result<(), StorageError> {
    let parent = dest_db.parent().ok_or_else(|| {
        StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "destination has no parent dir",
        ))
    })?;
    std::fs::create_dir_all(parent)?;

    // Write the plaintext snapshot to a temp file and open it UNENCRYPTED.
    let plain_path = parent.join(".hc-reimport-plain.db");
    if plain_path.exists() {
        std::fs::remove_file(&plain_path)?;
    }
    std::fs::write(&plain_path, snapshot)?;

    // The target SQLCipher key as hex (key material only — same R-SEC-001
    // documented exception as PRAGMA key).
    let key_bytes = target_key.key()?;
    let key_hex = Zeroizing::new(to_hex(&key_bytes));

    let dest_str = dest_db
        .to_str()
        .ok_or_else(|| {
            StorageError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "dest db path is not valid UTF-8",
            ))
        })?
        .replace('\'', "''");

    // Open the plaintext snapshot (no key), attach the keyed destination, and
    // export plaintext → encrypted so the result opens under target_key.
    let conn = rusqlite::Connection::open(&plain_path)?;
    let result = (|| -> Result<(), StorageError> {
        // Capture the snapshot's schema version to carry onto the dest.
        let snap_version = crate::migrate::current_version(&conn)?;
        conn.execute_batch(&format!(
            "ATTACH DATABASE '{dest_str}' AS hc_dest KEY \"x'{}'\";",
            key_hex.as_str()
        ))?;
        conn.query_row("SELECT sqlcipher_export('hc_dest')", [], |_| Ok(()))?;
        conn.execute_batch(&format!("PRAGMA hc_dest.user_version = {snap_version};"))?;
        conn.execute_batch("DETACH DATABASE hc_dest;")?;
        Ok(())
    })();
    drop(conn);
    let _ = std::fs::remove_file(&plain_path);
    result
}

/// Move a SQLite DB file `from` to `to`, carrying its `-wal` and `-shm`
/// sidecars with the same base-name suffixes. A stale `-wal`/`-shm` left next to
/// a replaced DB would make SQLCipher replay the old WAL against the new file
/// and fail page decryption, so the whole file set moves together. A missing
/// `from` (fresh install with no live DB yet) is a no-op.
fn move_db_with_sidecars(from: &Path, to: &Path) -> Result<(), StorageError> {
    if from.exists() {
        std::fs::rename(from, to)?;
    }
    for suffix in ["-wal", "-shm"] {
        let side_from = sidecar_path(from, suffix);
        if side_from.exists() {
            std::fs::rename(&side_from, sidecar_path(to, suffix))?;
        }
    }
    Ok(())
}

/// Append a sidecar `suffix` (e.g. `-wal`) to a DB path's file name:
/// `clinic.db` → `clinic.db-wal`.
fn sidecar_path(db: &Path, suffix: &str) -> PathBuf {
    let mut name = db.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    db.with_file_name(name)
}

/// Lowercase hex of key bytes (local; used only to assemble the SQLCipher
/// raw-key clause from key material, never external input).
fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

/// Count `.hcbak` files directly under `dir` (0 if the dir is absent).
fn count_archives(dir: &Path) -> Result<u32, StorageError> {
    Ok(list_archives(dir)?.len() as u32)
}

/// List `.hcbak` file paths directly under `dir` (empty if the dir is absent).
fn list_archives(dir: &Path) -> Result<Vec<PathBuf>, StorageError> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(StorageError::Io(e)),
    };
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("hcbak") {
            out.push(path);
        }
    }
    Ok(out)
}

/// Keep the `keep` newest `.hcbak` files in `dir`, deleting the rest. Newest is
/// by file name (zero-padded stamp token → lexical == chronological).
fn prune_tier(dir: &Path, keep: u32) -> Result<(), StorageError> {
    let mut files = list_archives(dir)?;
    files.sort(); // oldest → newest
    let keep = keep as usize;
    if files.len() <= keep {
        return Ok(());
    }
    let remove_count = files.len() - keep;
    for path in files.into_iter().take(remove_count) {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

/// Copy `source` into `tier` as `<bucket>.hcbak` if that bucket is not already
/// present (one archive per week / month). Idempotent across days in the same
/// bucket.
fn promote_if_new_bucket(source: &Path, tier: &Path, bucket: &str) -> Result<(), StorageError> {
    let dest = tier.join(format!("{bucket}.hcbak"));
    if dest.exists() {
        return Ok(());
    }
    std::fs::copy(source, &dest)?;
    Ok(())
}

/// The stamp token embedded in an archive file name
/// (`homeoclinic-<token>.hcbak`).
fn file_token_of(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .and_then(|s| s.strip_prefix("homeoclinic-"))
        .unwrap_or("")
        .to_string()
}

/// Week bucket key from a `YYYYMMDDTHHMMSSZ` token: `YYYY-Www` using the day's
/// ordinal week-of-year (7-day blocks from Jan 1). Deterministic and
/// test-stable; exact ISO-week numbering is not required for rotation (only one
/// archive per 7-day block is kept — BAK-001).
fn week_bucket(token: &str) -> String {
    let (y, doy) = year_and_day_of_year(token);
    let week = doy / 7; // 7-day block index within the year
    format!("{y:04}-W{week:02}")
}

/// Month bucket key from a token: `YYYY-MM`.
fn month_bucket(token: &str) -> String {
    // token = YYYYMMDD...
    let year = token.get(0..4).unwrap_or("0000");
    let month = token.get(4..6).unwrap_or("00");
    format!("{year}-{month}")
}

/// Parse `(year, day_of_year)` (0-based) from a `YYYYMMDD...` token. Falls back
/// to `(0, 0)` on a malformed token (then every malformed archive shares a
/// bucket, which still prunes safely).
fn year_and_day_of_year(token: &str) -> (i64, i64) {
    let y: i64 = token.get(0..4).and_then(|s| s.parse().ok()).unwrap_or(0);
    let m: i64 = token.get(4..6).and_then(|s| s.parse().ok()).unwrap_or(1);
    let d: i64 = token.get(6..8).and_then(|s| s.parse().ok()).unwrap_or(1);
    // days before month m in a (possibly leap) year
    let leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
    const CUM: [i64; 12] = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let mut doy = CUM[((m - 1).clamp(0, 11)) as usize] + (d - 1);
    if leap && m > 2 {
        doy += 1;
    }
    (y, doy)
}

/// Turn an RFC3339 stamp `YYYY-MM-DDTHH:MM:SSZ` into a filename-safe token
/// `YYYYMMDDTHHMMSSZ` (zero-padded so lexical order is chronological).
fn stamp_to_file_token(stamp: &str) -> String {
    stamp
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

/// Parse an RFC3339 UTC stamp `YYYY-MM-DDTHH:MM:SSZ` to Unix seconds. Returns
/// `None` on a malformed stamp (treated as "no good backup" → stale).
fn parse_rfc3339_to_unix(stamp: &str) -> Option<i64> {
    // Expect exactly `YYYY-MM-DDTHH:MM:SSZ`.
    let b = stamp.as_bytes();
    if b.len() < 20 {
        return None;
    }
    let year: i64 = stamp.get(0..4)?.parse().ok()?;
    let month: i64 = stamp.get(5..7)?.parse().ok()?;
    let day: i64 = stamp.get(8..10)?.parse().ok()?;
    let hour: i64 = stamp.get(11..13)?.parse().ok()?;
    let minute: i64 = stamp.get(14..16)?.parse().ok()?;
    let second: i64 = stamp.get(17..19)?.parse().ok()?;

    // days_from_civil (Howard Hinnant), inverse of civil_from_days in clock.rs.
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * SECS_PER_DAY + hour * 3_600 + minute * 60 + second)
}

/// Map a write IO error to the user-facing destination failure (OQ-S17-5): no
/// space → [`StorageError::OutOfSpace`]; a vanished destination →
/// [`StorageError::DestinationUnavailable`]; anything else is a generic IO
/// error. The previous good backup is left untouched (atomic temp-then-rename).
fn map_write_error(e: std::io::Error) -> StorageError {
    use std::io::ErrorKind;
    match e.kind() {
        ErrorKind::StorageFull => StorageError::OutOfSpace,
        ErrorKind::NotFound => StorageError::DestinationUnavailable,
        _ => StorageError::Io(e),
    }
}
