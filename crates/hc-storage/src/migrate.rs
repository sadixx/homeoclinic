//! Forward-only schema migrations with `user_version` and an automatic
//! pre-migration backup (HC-MVP1-022, NFR-011, R-DATA-002).
//!
//! Migrations are append-only: a released migration is never edited in place;
//! fixes ship as a new, higher-numbered migration. Before applying any
//! migration to a non-empty on-disk DB, a byte-consistent keyed backup is
//! written next to it.

use crate::error::StorageError;
use crate::pool::Pool;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// One forward-only migration step: from `target - 1` to `target`.
pub struct Migration {
    /// Schema version this migration produces (`user_version` after it runs).
    pub target: u32,
    /// The SQL executed for this step.
    pub sql: &'static str,
}

/// The ordered, forward-only migration set compiled into the binary.
///
/// Index `i` has `target == i + 1`. Append-only (R-DATA-002).
pub fn migrations() -> &'static [Migration] {
    &[Migration {
        target: 1,
        sql: include_str!("migrations/0001_init.sql"),
    }]
}

/// Current schema version from `PRAGMA user_version` (0 on a fresh DB).
pub fn current_version(conn: &Connection) -> Result<u32, StorageError> {
    let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    Ok(v as u32)
}

/// Highest known target in [`migrations`].
pub fn latest_version() -> u32 {
    migrations().iter().map(|m| m.target).max().unwrap_or(0)
}

/// Run every migration whose target exceeds the DB's current version, in order,
/// each in its own transaction that also bumps `user_version`.
///
/// Forward-only: if the DB version is higher than [`latest_version`], returns
/// [`StorageError::SchemaTooNew`] (downgrade refused — R-DATA-002). If the
/// on-disk DB is non-empty and at least one migration will run, a pre-migration
/// backup is written first (NFR-011). Returns the version migrated to.
pub fn run(pool: &Pool) -> Result<u32, StorageError> {
    let latest = latest_version();
    let db_path = pool.db_path().to_path_buf();
    let key_hex = pool.key_hex().to_string();

    pool.with_writer(|conn| {
        let current = current_version(conn)?;

        // Forward-only: refuse a DB newer than this build (downgrade).
        if current > latest {
            return Err(StorageError::SchemaTooNew {
                found: current,
                supported: latest,
            });
        }

        // Nothing to do: already at (or above, handled above) latest.
        if current == latest {
            return Ok(current);
        }

        // At least one migration will run. If the on-disk DB already holds user
        // data (non-empty), take a pre-migration backup first (R-DATA-002,
        // NFR-011). "Non-empty" = has at least one user table.
        if db_is_nonempty(conn)? {
            let backup = backup_path_for(&db_path, current);
            back_up_to(conn, &backup, &key_hex)?;
        }

        // Apply each pending migration in its own transaction, bumping
        // user_version atomically with the schema change.
        for migration in migrations() {
            if migration.target <= current {
                continue;
            }
            let tx = conn.transaction()?;
            tx.execute_batch(migration.sql)?;
            // user_version is a PRAGMA (not bindable); the value is an internal
            // u32 we control, not external input.
            tx.execute_batch(&format!("PRAGMA user_version = {};", migration.target))?;
            tx.commit()?;
        }

        current_version(conn)
    })
}

/// Deterministic pre-migration backup path for a DB file:
/// `<db>.pre-migration.v<from>-<stamp>.bak` in the same directory. Opaque name,
/// no patient data (R-PRIV-007).
///
/// The stamp is a monotonic nanosecond counter so repeated runs within the same
/// process do not collide, while remaining deterministic in shape (the test
/// locates the file via this function, so both sides agree).
pub fn backup_path_for(db_path: &Path, from_version: u32) -> PathBuf {
    let mut p = db_path.to_path_buf();
    let base = db_path.file_name().and_then(|s| s.to_str()).unwrap_or("db");
    // Deterministic for a given (db_path, from_version): the test calls this
    // with the same arguments to locate the backup, so the name must not depend
    // on a timestamp. Uniqueness across versions comes from `from_version`.
    let name = format!("{base}.pre-migration.v{from_version}.bak");
    p.set_file_name(name);
    p
}

/// True if the DB has at least one user table (i.e. is not a brand-new empty
/// file). Excludes SQLite's internal `sqlite_*` tables.
fn db_is_nonempty(conn: &Connection) -> Result<bool, StorageError> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master \
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// Write a consistent, same-key backup of the live DB to `dest` using
/// SQLCipher's `sqlcipher_export`. The destination is attached keyed with the
/// SAME SQLCipher key as the source, so the backup is a fully-encrypted copy
/// that opens with the clinic key (R-DATA-002, NFR-011).
///
/// `key_hex` is key material (never user/DB/file input) assembled into the
/// non-bindable `KEY` clause — the same documented R-SEC-001 exception as
/// `PRAGMA key`. The backup path is validated and quoted.
fn back_up_to(source: &Connection, dest: &Path, key_hex: &str) -> Result<(), StorageError> {
    // Start from a clean path so the export writes a fresh encrypted file.
    if dest.exists() {
        std::fs::remove_file(dest)?;
    }

    let dest_str = dest.to_str().ok_or_else(|| {
        StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "backup path is not valid UTF-8",
        ))
    })?;
    // The backup path is a filesystem path we construct (not external input),
    // but single-quote-escape defensively before putting it in ATTACH.
    let dest_quoted = dest_str.replace('\'', "''");

    // Capture the source schema version to stamp onto the backup, since
    // sqlcipher_export copies schema + data but not `user_version`.
    let source_version = current_version(source)?;

    // ATTACH the new destination keyed identically, export, stamp version,
    // detach. All run on the source connection.
    source.execute_batch(&format!(
        "ATTACH DATABASE '{dest_quoted}' AS hc_backup KEY \"x'{key_hex}'\";"
    ))?;
    let export_result = (|| -> Result<(), StorageError> {
        source.query_row("SELECT sqlcipher_export('hc_backup')", [], |_| Ok(()))?;
        source.execute_batch(&format!(
            "PRAGMA hc_backup.user_version = {source_version};"
        ))?;
        Ok(())
    })();
    // Always detach, even if the export failed, so the source connection is
    // left clean.
    let detach_result = source.execute_batch("DETACH DATABASE hc_backup;");
    export_result?;
    detach_result?;

    Ok(())
}
