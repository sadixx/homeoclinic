//! SQLCipher connection pool: 1 writer + 4 readers, WAL, FK, tuned pragmas
//! (HC-MVP1-020, NFR-010, R-DATA-010).
//!
//! The writer is serialized behind a mutex (single-writer invariant, avoids
//! `database is locked`); readers run concurrently under WAL. All connections
//! are keyed via a [`KeyProvider`] and configured with identical pragmas.

use crate::error::StorageError;
use crate::key::KeyProvider;
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use zeroize::Zeroizing;

/// Number of reader connections (data model section 3: 1 writer + 4 readers).
pub const READER_COUNT: usize = 4;

/// Busy timeout applied to every connection so a transient lock (e.g. a WAL
/// checkpoint) retries rather than failing immediately (R-DATA-010).
const BUSY_TIMEOUT_MS: u64 = 5_000;

/// Shared pool state behind an `Arc`.
struct Inner {
    /// The database file path (used for migration backups).
    path: PathBuf,
    /// SQLCipher raw key as lowercase hex, retained so the migration runner can
    /// produce a same-key encrypted backup via `sqlcipher_export`. Held in a
    /// zeroizing buffer and never logged (R-SEC-006, R-PRIV-001).
    key_hex: Zeroizing<String>,
    /// The single writer connection, serialized behind a mutex.
    writer: Mutex<Connection>,
    /// Reader connections, each independently leasable. A reader is held for
    /// the duration of a `with_reader` call; `READER_COUNT` run concurrently.
    readers: Vec<Mutex<Connection>>,
}

/// Open SQLCipher connection pool for one database file.
///
/// Holds exactly one writer connection and [`READER_COUNT`] reader connections,
/// all keyed, WAL, `foreign_keys=ON`, `synchronous=NORMAL`, `page_size=4096`,
/// `cache_size=-65536` (64 MB), `mmap_size=268435456` (256 MB),
/// `temp_store=MEMORY` (HC-MVP1-020, NFR-010). Cheaply cloneable (Arc inside).
#[derive(Clone)]
pub struct Pool {
    inner: Arc<Inner>,
}

impl Pool {
    /// Open (creating if absent) the keyed database at `path` and configure all
    /// connections. Does NOT run migrations (see [`crate::migrate::run`]).
    pub fn open(path: &Path, key: &dyn KeyProvider) -> Result<Pool, StorageError> {
        let key_bytes = key.key()?;
        let key_hex = Zeroizing::new(to_hex(&key_bytes));

        // The writer may create the file; readers open the same file read/write
        // (SQLCipher needs read/write to replay the WAL) but only ever run
        // read statements by convention (the `with_reader` API hands out
        // `&Connection`, not `&mut`).
        let writer = open_connection(path, &key_hex, true)?;

        let mut readers = Vec::with_capacity(READER_COUNT);
        for _ in 0..READER_COUNT {
            readers.push(Mutex::new(open_connection(path, &key_hex, false)?));
        }

        Ok(Pool {
            inner: Arc::new(Inner {
                path: path.to_path_buf(),
                key_hex,
                writer: Mutex::new(writer),
                readers,
            }),
        })
    }

    /// The database file path. Used by the migration runner to place a
    /// pre-migration backup next to the live file.
    pub(crate) fn db_path(&self) -> &Path {
        &self.inner.path
    }

    /// The SQLCipher key hex, for the migration runner's same-key backup.
    /// Crate-internal; never exposed publicly and never logged.
    pub(crate) fn key_hex(&self) -> &str {
        &self.inner.key_hex
    }

    /// Run `f` with the single writer connection, serialized against all other
    /// writers. Blocking; async callers use `spawn_blocking` (R-RUST-003).
    pub fn with_writer<T>(
        &self,
        f: impl FnOnce(&mut Connection) -> Result<T, StorageError>,
    ) -> Result<T, StorageError> {
        let mut guard = self
            .inner
            .writer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&mut guard)
    }

    /// Lease a reader connection and run `f`. Up to [`READER_COUNT`] readers run
    /// concurrently; reads do not block the writer under WAL (NFR-010).
    ///
    /// Each reader connection is handed to at most one caller at a time. A free
    /// connection is selected by trying each reader's lock in turn; this keeps
    /// concurrent readers on distinct connections so a long reader never blocks
    /// the writer and vice versa.
    pub fn with_reader<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, StorageError>,
    ) -> Result<T, StorageError> {
        // Try to lease a currently-free reader without blocking.
        for reader in &self.inner.readers {
            if let Ok(guard) = reader.try_lock() {
                return f(&guard);
            }
        }
        // All readers busy: wait on the first one (bounded by callers, not the
        // writer). Recover from a poisoned lock rather than panicking.
        let guard = self.inner.readers[0]
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        f(&guard)
    }

    /// Number of reader connections configured ([`READER_COUNT`]).
    pub fn reader_count(&self) -> usize {
        self.inner.readers.len()
    }
}

/// Open one SQLCipher connection, key it, and apply the crash-safe / tuned
/// pragmas (R-DATA-010, data model section 3). `create` allows file creation
/// for the writer; readers require the file to already exist.
fn open_connection(path: &Path, key_hex: &str, create: bool) -> Result<Connection, StorageError> {
    let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    if create {
        flags |= OpenFlags::SQLITE_OPEN_CREATE;
    }
    let conn = Connection::open_with_flags(path, flags)?;
    apply_key_and_pragmas(&conn, key_hex)?;
    Ok(conn)
}

/// Apply the SQLCipher key and the crash-safe / tuned pragmas to `conn`.
///
/// `PRAGMA key` cannot be parameter-bound; SQLCipher requires the key inline.
/// We use the raw-key hex form `x'<hex>'` assembled ONLY from key material
/// supplied by the KeyProvider (never user/DB/file input). Documented exception
/// to R-SEC-001 (parameterised SQL); key bytes are never logged (R-PRIV-001,
/// R-SEC-006).
pub(crate) fn apply_key_and_pragmas(conn: &Connection, key_hex: &str) -> Result<(), StorageError> {
    conn.execute_batch(&format!("PRAGMA key = \"x'{key_hex}'\";"))?;

    // page_size must be set before the first write / WAL activation to take
    // effect on a fresh database.
    conn.execute_batch("PRAGMA page_size = 4096;")?;
    // WAL is persistent in the file header; setting it on every connection is
    // harmless and guarantees the mode even on a pre-existing file.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // cache_size negative = KiB of memory; -65536 = 64 MB (data model §3).
    conn.pragma_update(None, "cache_size", -65_536_i64)?;
    // mmap_size 256 MB.
    conn.pragma_update(None, "mmap_size", 268_435_456_i64)?;
    // temp_store MEMORY (2).
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    conn.busy_timeout(std::time::Duration::from_millis(BUSY_TIMEOUT_MS))?;

    Ok(())
}

/// Lowercase hex encoding of key bytes. Local, no external crate; used only to
/// assemble the SQLCipher raw-key PRAGMA from key material.
fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}
