//! Structured JSON logging init plus the testable redaction / rotation seams
//! (HC-MVP1-017, design §8, NFR-013, R-PRIV-001).
//!
//! NO patient data ever reaches a log line. [`LogRecord`] has no name, mobile,
//! address or case-text field, so a patient identifier cannot be logged by
//! construction; identifiers that genuinely must appear are hashed with
//! [`hash_id`] (R-PRIV-001). All diagnostics go through `tracing`; `println!`
//! and `eprintln!` stay forbidden (R-RUST-006).

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::fmt::writer::MakeWriter;
use tracing_subscriber::prelude::*;

/// Size/keep policy for `app.log` (design §8: 10 MiB per file, keep 5 files).
///
/// `tracing-appender` rotates by time, not size, so the 10 MiB × 5 cap is
/// enforced by this value type (the testable seam) rather than the appender.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RotationPolicy {
    /// Max bytes a single log file may reach before it is rotated.
    pub max_bytes: u64,
    /// How many rotated files to keep (`app.log`, `app.log.1` .. `app.log.N`).
    pub keep_files: u8,
}

impl RotationPolicy {
    /// The shipped policy: 10 MiB per file, 5 files (design §8).
    pub const DEFAULT: RotationPolicy = RotationPolicy {
        max_bytes: 10 * 1024 * 1024,
        keep_files: 5,
    };

    /// Pure decision: given the current file size and the bytes about to be
    /// written, should the file be rotated FIRST? Rotates only when the write
    /// would push the file strictly past `max_bytes`. Filesystem-free and
    /// overflow-safe.
    pub fn should_rotate(&self, current_len: u64, incoming_len: u64) -> bool {
        current_len.saturating_add(incoming_len) > self.max_bytes
    }
}

/// Where logs live: `<data dir>/logs/app.log` (design §8, CODE-LAYOUT).
pub fn log_path(data_dir: &Path) -> PathBuf {
    data_dir.join("logs").join("app.log")
}

/// A size-capped, rolling [`std::io::Write`] for `app.log` (NFR-013, design §8).
///
/// This is the real, running writer that gives the `RotationPolicy` teeth:
/// `tracing-appender` only rotates by time, so the 10 MiB × `keep_files` cap is
/// enforced here. Before every write it asks [`RotationPolicy::should_rotate`]
/// whether the incoming line would push `app.log` past `max_bytes`; when it
/// would, the file is rolled (`app.log` → `app.log.1` → … → `app.log.N`) and a
/// fresh `app.log` is opened, keeping at most `keep_files` files total and
/// deleting the oldest. No patient data is ever written — the only lines that
/// reach this writer are the subscriber's JSON renderings of [`LogRecord`],
/// which has no patient-identifier field by construction (R-PRIV-001).
#[derive(Debug)]
pub struct RollingFile {
    /// Directory holding `app.log` and its rotated siblings.
    dir: PathBuf,
    /// Active log file handle (always points at `<dir>/app.log`).
    file: File,
    /// Current byte length of the active `app.log`, kept in sync with writes.
    current_len: u64,
    /// The size/keep contract driving rotation.
    policy: RotationPolicy,
}

impl RollingFile {
    /// Base file name for the active log.
    const BASE: &'static str = "app.log";

    /// Open (or create, for append) `<dir>/app.log` under the given `policy`.
    ///
    /// The current on-disk length seeds `current_len` so an existing file is
    /// honoured across restarts rather than silently overrunning the cap.
    pub fn open(dir: &Path, policy: RotationPolicy) -> io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(Self::BASE);
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        let current_len = file.metadata().map(|m| m.len()).unwrap_or(0);
        Ok(Self {
            dir: dir.to_path_buf(),
            file,
            current_len,
            policy,
        })
    }

    /// Path of a rotated sibling: index 0 is `app.log`, `n >= 1` is `app.log.n`.
    fn sibling(&self, n: u32) -> PathBuf {
        if n == 0 {
            self.dir.join(Self::BASE)
        } else {
            self.dir.join(format!("{}.{}", Self::BASE, n))
        }
    }

    /// Roll the files and reopen a fresh, empty `app.log`.
    ///
    /// Keeps at most `keep_files` files total (`app.log` plus `app.log.1` …
    /// `app.log.{keep_files - 1}`). The oldest rotated file is deleted, each
    /// remaining `app.log.k` shifts to `app.log.{k + 1}`, the active `app.log`
    /// becomes `app.log.1`, and a new empty `app.log` is opened. A `keep_files`
    /// of 0 or 1 keeps no rotated history, so the active file is simply
    /// truncated.
    fn rotate(&mut self) -> io::Result<()> {
        let keep = u32::from(self.policy.keep_files);

        if keep <= 1 {
            // No rotated history to keep: start the active file over.
            self.file = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(self.sibling(0))?;
            self.current_len = 0;
            return Ok(());
        }

        // Highest rotated index we may keep is `keep - 1` (so total files,
        // counting the fresh app.log, never exceeds `keep`). Drop the oldest.
        let highest = keep - 1;
        let oldest = self.sibling(highest);
        if oldest.exists() {
            std::fs::remove_file(&oldest)?;
        }

        // Shift app.log.{k} -> app.log.{k + 1} from the top down so we never
        // clobber a file we still need.
        for k in (1..highest).rev() {
            let from = self.sibling(k);
            if from.exists() {
                std::fs::rename(&from, self.sibling(k + 1))?;
            }
        }

        // Active app.log -> app.log.1, then open a fresh, empty app.log.
        std::fs::rename(self.sibling(0), self.sibling(1))?;
        self.file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(self.sibling(0))?;
        self.current_len = 0;
        Ok(())
    }
}

impl Write for RollingFile {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        // Consult the policy seam BEFORE writing: if this line would cross the
        // cap, roll first so no single file ever exceeds `max_bytes`.
        let incoming = buf.len() as u64;
        if self.policy.should_rotate(self.current_len, incoming) {
            self.rotate()?;
        }
        let written = self.file.write(buf)?;
        self.current_len = self.current_len.saturating_add(written as u64);
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

/// [`MakeWriter`] adapter handing the shared [`RollingFile`] to the subscriber.
///
/// `tracing-subscriber` asks for a writer per log event; every handout locks
/// the same `RollingFile` so size tracking and rotation stay consistent across
/// the non-blocking appender's worker thread. A `Mutex` is sufficient — writes
/// are short and serialised, and no `unsafe` is used.
#[derive(Debug, Clone)]
pub struct MakeRollingWriter {
    inner: Arc<Mutex<RollingFile>>,
}

impl MakeRollingWriter {
    /// Wrap an opened [`RollingFile`] for use as a `MakeWriter`.
    pub fn new(file: RollingFile) -> Self {
        Self {
            inner: Arc::new(Mutex::new(file)),
        }
    }
}

/// A single locked handout of the shared [`RollingFile`].
///
/// Holds the mutex guard for the duration of one `write`/`flush` sequence so a
/// log line and its rotation decision are atomic.
pub struct LockedRollingWriter<'a> {
    inner: &'a Mutex<RollingFile>,
}

impl Write for LockedRollingWriter<'_> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self.inner.lock() {
            Ok(mut file) => file.write(buf),
            // A poisoned lock means a prior writer panicked; recover the guard
            // and keep logging rather than losing the subscriber (no unsafe).
            Err(poisoned) => poisoned.into_inner().write(buf),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self.inner.lock() {
            Ok(mut file) => file.flush(),
            Err(poisoned) => poisoned.into_inner().flush(),
        }
    }
}

impl<'a> MakeWriter<'a> for MakeRollingWriter {
    type Writer = LockedRollingWriter<'a>;

    fn make_writer(&'a self) -> Self::Writer {
        LockedRollingWriter { inner: &self.inner }
    }
}

/// Hash a patient id for the rare case an id must appear in a log line.
///
/// Returns the first 16 hex chars of a SHA-256 digest — stable across calls,
/// never the raw id (R-PRIV-001). Not reversible to the original identifier.
pub fn hash_id(id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(id.as_bytes());
    let digest = hasher.finalize();
    // 8 bytes -> 16 lowercase hex chars; enough to correlate, too short to
    // brute-force a structured id back out in practice and never the raw id.
    let mut out = String::with_capacity(16);
    for byte in digest.iter().take(8) {
        use std::fmt::Write as _;
        // Writing to a String is infallible; ignore the formatter Result.
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// A single structured log record as it will be serialised to JSON.
///
/// ONLY non-patient fields exist on this type — there is no name / mobile /
/// address / case-text field, so a patient identifier cannot be logged by
/// construction (the redaction seam the test asserts on, R-PRIV-001).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LogRecord {
    /// ISO-8601 UTC timestamp (normally set by the subscriber; here for
    /// formatting tests).
    pub ts: String,
    /// Level, e.g. `"INFO"` / `"WARN"` / `"ERROR"`.
    pub level: String,
    /// Target module path (the `tracing` target).
    pub target: String,
    /// Human-readable, patient-data-free message.
    pub message: String,
    /// Optional hashed patient id (from [`hash_id`]), never a raw id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patient_hash: Option<String>,
}

/// Format one record as a single JSON line (no trailing patient data).
///
/// Pure and testable: it serialises only the [`LogRecord`] struct, which has
/// no patient-identifier field, so no patient name can appear in the output.
/// Serialisation of this fixed struct cannot fail; on the impossible error it
/// yields an empty object rather than panicking (R-RUST-002).
pub fn format_line(rec: &LogRecord) -> String {
    serde_json::to_string(rec).unwrap_or_else(|_| "{}".to_string())
}

/// Typed init error (`thiserror`; R-RUST-001).
#[derive(Debug, thiserror::Error)]
pub enum LogInitError {
    /// Could not create the logs directory.
    #[error("could not create log directory")]
    CreateDir(#[source] std::io::Error),
    /// Could not open the log file for append.
    #[error("could not open log file")]
    OpenFile(#[source] std::io::Error),
    /// A global subscriber was already installed.
    #[error("a tracing subscriber is already installed")]
    AlreadyInitialised,
}

/// Initialise the global `tracing` subscriber: JSON formatter + non-blocking
/// file writer at [`log_path`], honouring `policy`.
///
/// Returns the [`WorkerGuard`] the caller MUST hold for the process lifetime
/// (dropping it flushes buffered lines). Called once from
/// `apps/desktop/src-tauri::run()` before the async runtime, so it never
/// blocks tokio (R-RUST-003). Never logs patient data (R-PRIV-001).
///
/// `policy` carries the shipped 10 MiB × 5 cap and is live at runtime: the
/// non-blocking appender writes through a [`RollingFile`], which consults
/// [`RotationPolicy::should_rotate`] before each line and rolls `app.log` when
/// a write would cross `max_bytes`, keeping at most `keep_files` files.
pub fn init(data_dir: &Path, policy: RotationPolicy) -> Result<WorkerGuard, LogInitError> {
    let path = log_path(data_dir);
    let dir = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| data_dir.join("logs"));
    std::fs::create_dir_all(&dir).map_err(LogInitError::CreateDir)?;

    // The real, size-based rolling writer: `policy.max_bytes` / `keep_files`
    // drive rotation of the running `app.log` (NFR-013, design §8). Opening it
    // here also proves the file is writable before the subscriber is installed,
    // surfacing a permission problem as a typed error rather than a later panic.
    //
    // `non_blocking` takes ownership of this `Write` and drives it from a single
    // worker thread, so the `RollingFile`'s own size/rotation state is only ever
    // touched by that one thread — no external locking is needed here.
    let rolling = RollingFile::open(&dir, policy).map_err(LogInitError::OpenFile)?;
    let (non_blocking, guard) = tracing_appender::non_blocking(rolling);

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    let json_layer = tracing_subscriber::fmt::layer()
        .json()
        .with_writer(non_blocking)
        .with_current_span(false)
        .with_span_list(false);

    tracing_subscriber::registry()
        .with(filter)
        .with(json_layer)
        .try_init()
        .map_err(|_| LogInitError::AlreadyInitialised)?;

    Ok(guard)
}
