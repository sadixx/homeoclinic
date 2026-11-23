//! Data-folder relocation file engine (MS, SET-006, ADR 0020; design §2.3).
//!
//! Copy, verify, then switch — never move in place. [`plan_target`] validates
//! the chosen parent; [`copy_verified`] copies the clinic's own entries
//! ([`CLINIC_ENTRIES`], an allowlist) into a
//! sibling `*.partial-<uuid>` folder, verifies each file by SHA-256 against
//! its source, opens the copied `clinic.db` with the install key
//! (`PRAGMA quick_check`), requires the copied keystore record to load, and
//! only then renames the partial folder into place. Any failure removes the
//! partial folder and leaves the source untouched. [`retire_old`] turns the
//! old data into a same-volume safety copy after the caller switched.
//!
//! No path is ever logged (R-PRIV-001). No network, no shell.

use crate::error::StorageError;
use crate::key::KeyProvider;
use crate::keystore::{FileKeystore, Keystore};
use crate::pool::Pool;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Component, Path, PathBuf, Prefix};

/// Name of the folder created inside the chosen parent.
pub const DATA_DIR_NAME: &str = "HomeoClinic";
/// Prefix of earlier safety copies (never moved).
pub const MOVED_OUT_PREFIX: &str = "moved-out-";

/// Top-level entries HomeoClinic itself writes into a data folder and that
/// move with the data (ADR 0020, ms-review-1). An ALLOWLIST, never a
/// denylist: on Linux the default data folder is also the WebKitGTK data
/// folder (`CacheStorage/`, `WebKitCache/`, `storage/`, `mediakeys/`,
/// `hsts-storage.sqlite`, ...). Those belong to the running webview and must
/// be neither copied nor retired. `logs/` and the pointer stay in the fixed
/// home; transient work folders (`.hc-restore-staging`, `.hc-snapshot-tmp`)
/// are never data.
///
/// - `clinic.db` + its SQLite sidecars (pool / backup engine);
/// - `files/` encrypted attachment blobs ([`crate::attachment`]);
/// - `licence/` keystore record + wrapped keys ([`crate::keystore`]);
/// - `backups/` automatic backup tiers ([`crate::backup`]);
/// - `exports/` patient-list / patient exports (hc-app).
pub const CLINIC_ENTRIES: &[&str] = &[
    "clinic.db",
    "clinic.db-wal",
    "clinic.db-shm",
    "clinic.db-journal",
    "files",
    "licence",
    "backups",
    "exports",
];
/// Prefix of the pre-restore safety folders (`pre-restore-<stamp>/`,
/// [`crate::backup`]).
pub const PRE_RESTORE_PREFIX: &str = "pre-restore-";
/// Prefix + suffix of the pre-migration DB copies
/// (`clinic.db.pre-migration.v<N>.bak`, [`crate::migrate::backup_path_for`]).
const PRE_MIGRATION_PREFIX: &str = "clinic.db.pre-migration.v";
const PRE_MIGRATION_SUFFIX: &str = ".bak";

/// The encrypted database file inside a data folder.
const DB_FILE: &str = "clinic.db";

/// Why a chosen target folder was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetProblem {
    /// The parent path is relative.
    NotAbsolute,
    /// The parent path is not a directory.
    NotADirectory,
    /// A network (UNC) path.
    NetworkPath,
    /// `<parent>/HomeoClinic` exists and is not empty.
    NotEmpty,
    /// The target is the current data folder.
    SameAsCurrent,
    /// The target is inside the current data folder.
    InsideCurrent,
    /// The target contains the current data folder.
    ContainsCurrent,
    /// The parent cannot be written.
    NotWritable,
}

fn refuse(problem: TargetProblem) -> StorageError {
    StorageError::RelocateTarget(problem)
}

/// True for a Windows UNC / verbatim-UNC path (never on Unix).
fn is_network_path(path: &Path) -> bool {
    matches!(
        path.components().next(),
        Some(Component::Prefix(p)) if matches!(p.kind(), Prefix::UNC(..) | Prefix::VerbatimUNC(..))
    )
}

/// Whether a top-level entry of a data folder is one of HomeoClinic's own data
/// entries (moves). Everything else (webview files, logs, the pointer, earlier
/// safety copies, files the doctor dropped there) stays put.
pub fn is_clinic_entry(name: &str) -> bool {
    CLINIC_ENTRIES.contains(&name)
        || (name.starts_with(PRE_RESTORE_PREFIX) && name.len() > PRE_RESTORE_PREFIX.len())
        || (name.starts_with(PRE_MIGRATION_PREFIX)
            && name.ends_with(PRE_MIGRATION_SUFFIX)
            && name.len() > PRE_MIGRATION_PREFIX.len() + PRE_MIGRATION_SUFFIX.len())
}

/// Validate `parent` and return `<parent>/HomeoClinic`.
///
/// Checks, in order: absolute, not a network path, an existing directory, the
/// target is not the current folder / inside it / containing it (canonical
/// comparisons), the target is absent or an empty directory, and the parent is
/// writable (a probe file is created and removed). Creates nothing else.
pub fn plan_target(current: &Path, parent: &Path) -> Result<PathBuf, StorageError> {
    if !parent.is_absolute() {
        return Err(refuse(TargetProblem::NotAbsolute));
    }
    if is_network_path(parent) {
        return Err(refuse(TargetProblem::NetworkPath));
    }
    if !parent.is_dir() {
        return Err(refuse(TargetProblem::NotADirectory));
    }
    let target = parent.join(DATA_DIR_NAME);

    let parent_c = parent
        .canonicalize()
        .map_err(|_| refuse(TargetProblem::NotADirectory))?;
    let target_c = target
        .canonicalize()
        .unwrap_or_else(|_| parent_c.join(DATA_DIR_NAME));
    let current_c = current
        .canonicalize()
        .unwrap_or_else(|_| current.to_path_buf());
    if target_c == current_c {
        return Err(refuse(TargetProblem::SameAsCurrent));
    }
    if target_c.starts_with(&current_c) {
        return Err(refuse(TargetProblem::InsideCurrent));
    }
    if current_c.starts_with(&target_c) {
        return Err(refuse(TargetProblem::ContainsCurrent));
    }

    if target.exists() {
        let empty_dir = target.is_dir()
            && std::fs::read_dir(&target)
                .map(|mut it| it.next().is_none())
                .unwrap_or(false);
        if !empty_dir {
            return Err(refuse(TargetProblem::NotEmpty));
        }
    }

    let probe = parent.join(format!(".hc-write-probe-{}", uuid::Uuid::now_v7()));
    match std::fs::File::create(&probe) {
        Ok(file) => {
            drop(file);
            let _ = std::fs::remove_file(&probe);
        }
        Err(_) => return Err(refuse(TargetProblem::NotWritable)),
    }
    Ok(target)
}

/// Counts of what [`copy_verified`] copied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CopyReport {
    /// Files copied and verified.
    pub files: u64,
    /// Bytes copied.
    pub bytes: u64,
}

/// Copy + verify the data of `current` into `target` (design §2.3).
///
/// PRE: every pool on `current/clinic.db` is dropped (caller duty). On ANY
/// error the partial folder is removed and [`StorageError::RelocateCopyFailed`]
/// is returned; `current` is never modified.
pub fn copy_verified(
    current: &Path,
    target: &Path,
    key: &dyn KeyProvider,
) -> Result<CopyReport, StorageError> {
    copy_verified_inner(current, target, key, &|_| {})
}

/// Test seam: [`copy_verified`] with a hook run on the partial directory after
/// the copy and BEFORE verification (lets a test corrupt one copied file).
#[cfg(any(test, feature = "testing"))]
pub fn copy_verified_with(
    current: &Path,
    target: &Path,
    key: &dyn KeyProvider,
    before_verify: impl Fn(&Path),
) -> Result<CopyReport, StorageError> {
    copy_verified_inner(current, target, key, &before_verify)
}

fn copy_verified_inner(
    current: &Path,
    target: &Path,
    key: &dyn KeyProvider,
    before_verify: &dyn Fn(&Path),
) -> Result<CopyReport, StorageError> {
    let name = target
        .file_name()
        .ok_or(StorageError::RelocateCopyFailed)?
        .to_string_lossy()
        .into_owned();
    let partial = target.with_file_name(format!("{name}.partial-{}", uuid::Uuid::now_v7()));

    let outcome = (|| -> Result<CopyReport, StorageError> {
        std::fs::create_dir(&partial)?;
        let mut copied: Vec<PathBuf> = Vec::new();
        let mut bytes = 0u64;
        for entry in std::fs::read_dir(current)? {
            let entry = entry?;
            let entry_name = entry.file_name();
            if !is_clinic_entry(&entry_name.to_string_lossy()) {
                continue;
            }
            copy_tree(
                current,
                &partial,
                Path::new(&entry_name),
                &mut copied,
                &mut bytes,
            )?;
        }

        before_verify(&partial);

        for rel in &copied {
            if sha256_file(&current.join(rel))? != sha256_file(&partial.join(rel))? {
                return Err(StorageError::RelocateCopyFailed);
            }
        }
        verify_database(&partial.join(DB_FILE), key)?;
        if current.join("licence").join("state.bin").is_file()
            && FileKeystore::open(&partial)?.load()?.is_none()
        {
            return Err(StorageError::RelocateCopyFailed);
        }

        // An empty target folder (allowed by plan_target) is replaced.
        if target.is_dir() {
            std::fs::remove_dir(target)?;
        }
        std::fs::rename(&partial, target)?;
        Ok(CopyReport {
            files: copied.len() as u64,
            bytes,
        })
    })();

    match outcome {
        Ok(report) => Ok(report),
        Err(_) => {
            let _ = std::fs::remove_dir_all(&partial);
            Err(StorageError::RelocateCopyFailed)
        }
    }
}

/// Recursively copy `src_root/rel` to `dst_root/rel`, recording every copied
/// file (relative path) and the byte total.
fn copy_tree(
    src_root: &Path,
    dst_root: &Path,
    rel: &Path,
    copied: &mut Vec<PathBuf>,
    bytes: &mut u64,
) -> Result<(), StorageError> {
    let src = src_root.join(rel);
    let dst = dst_root.join(rel);
    if std::fs::metadata(&src)?.is_dir() {
        std::fs::create_dir_all(&dst)?;
        for entry in std::fs::read_dir(&src)? {
            let entry = entry?;
            copy_tree(
                src_root,
                dst_root,
                &rel.join(entry.file_name()),
                copied,
                bytes,
            )?;
        }
    } else {
        *bytes += std::fs::copy(&src, &dst)?;
        copied.push(rel.to_path_buf());
    }
    Ok(())
}

/// Streaming SHA-256 of one file.
fn sha256_file(path: &Path) -> Result<[u8; 32], StorageError> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().into())
}

/// Open the copied DB with the install key and require `quick_check = ok` and
/// a readable schema version.
fn verify_database(db: &Path, key: &dyn KeyProvider) -> Result<(), StorageError> {
    if !db.is_file() {
        return Err(StorageError::RelocateCopyFailed);
    }
    let pool = Pool::open(db, key)?;
    let (check, version): (String, u32) = pool.with_reader(|c| {
        let check: String = c.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        let version: u32 = c.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        Ok((check, version))
    })?;
    drop(pool);
    if check != "ok" || version == 0 {
        return Err(StorageError::RelocateCopyFailed);
    }
    Ok(())
}

/// The safety folder [`retire_old`] uses for `stamp`:
/// `current/moved-out-<stamp>`.
pub fn safety_dir(current: &Path, stamp: &str) -> PathBuf {
    current.join(format!("{MOVED_OUT_PREFIX}{stamp}"))
}

/// Move every clinic entry ([`is_clinic_entry`]) of `current` into
/// `current/moved-out-<stamp>/` (same volume, a rename). Everything else
/// (webview files, `logs/`, the pointer, earlier safety copies) stays where it
/// is. Returns the safety folder.
pub fn retire_old(current: &Path, stamp: &str) -> Result<PathBuf, StorageError> {
    let safety = safety_dir(current, stamp);
    std::fs::create_dir(&safety)?;
    for entry in std::fs::read_dir(current)? {
        let entry = entry?;
        let name = entry.file_name();
        if !is_clinic_entry(&name.to_string_lossy()) {
            continue;
        }
        std::fs::rename(entry.path(), safety.join(&name))?;
    }
    Ok(safety)
}
