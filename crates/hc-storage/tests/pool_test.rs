//! HC-MVP1-020 SQLCipher pool tests (NFR-010, R-DATA-010). Red before green.
//!
//! Exercises the public API via the `testing` feature (R-TEST-009). Each test
//! uses its own temp-file DB (R-TEST-006).

use hc_storage::pool::{Pool, READER_COUNT};
use hc_storage::testing::temp_db;

/// The pool opens with WAL, foreign keys on, synchronous>=NORMAL and the tuned
/// pragmas from the data model (page_size 4096, temp_store MEMORY).
#[test]
fn nfr010_pool_opens_with_wal_fk_and_tuned_pragmas() {
    let (_dir, pool) = temp_db();

    let journal: String = pool
        .with_writer(|c| Ok(c.query_row("PRAGMA journal_mode", [], |r| r.get(0))?))
        .expect("read journal_mode");
    assert_eq!(
        journal.to_lowercase(),
        "wal",
        "WAL must be enabled (R-DATA-010)"
    );

    let fk: i64 = pool
        .with_writer(|c| Ok(c.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?))
        .expect("read foreign_keys");
    assert_eq!(fk, 1, "foreign_keys must be ON (R-DATA-010)");

    let sync: i64 = pool
        .with_writer(|c| Ok(c.query_row("PRAGMA synchronous", [], |r| r.get(0))?))
        .expect("read synchronous");
    assert!(sync >= 1, "synchronous must be >= NORMAL (1) (R-DATA-010)");

    // SQLCipher returns `PRAGMA page_size` as a TEXT column on a keyed
    // connection (the codec reports `cipher_page_size`), so read it as a
    // String and compare. The value (4096) and the requirement are unchanged;
    // only the SQLite column *type* differs from stock SQLite. Other pragmas
    // (synchronous, temp_store, foreign_keys) are Integer and read as i64.
    let page: String = pool
        .with_writer(|c| Ok(c.query_row("PRAGMA page_size", [], |r| r.get(0))?))
        .expect("read page_size");
    assert_eq!(
        page, "4096",
        "page_size must be 4096 (data model section 3)"
    );

    let temp_store: i64 = pool
        .with_writer(|c| Ok(c.query_row("PRAGMA temp_store", [], |r| r.get(0))?))
        .expect("read temp_store");
    assert_eq!(temp_store, 2, "temp_store must be MEMORY (2)");
}

/// The pool has exactly one writer and four readers.
#[test]
fn nfr010_pool_has_one_writer_and_four_readers() {
    let (_dir, pool) = temp_db();
    assert_eq!(READER_COUNT, 4, "data model: 1 writer + 4 readers");
    assert_eq!(
        pool.reader_count(),
        4,
        "pool must expose 4 reader connections"
    );
}

/// A reader sees committed data concurrently with an open (uncommitted) writer
/// transaction, and never observes the uncommitted row — WAL allows reads
/// during writes (NFR-010, DoD for HC-MVP1-020). No `database is locked`.
#[test]
fn nfr010_concurrent_read_during_write_sees_committed_data() {
    let (_dir, pool) = temp_db();

    // Commit a known row.
    pool.with_writer(|c| {
        c.execute(
            "INSERT INTO setting(key, value_json) VALUES (?1, ?2)",
            rusqlite::params!["committed", "\"A\""],
        )?;
        Ok(())
    })
    .expect("seed committed row");

    // Open a long writer transaction that inserts an UNcommitted row, then,
    // while it is still open, read from a reader connection.
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO setting(key, value_json) VALUES (?1, ?2)",
            rusqlite::params!["uncommitted", "\"B\""],
        )?;

        // Concurrent read on a reader connection while the writer txn is open.
        let seen_committed: i64 = pool
            .with_reader(|r| {
                Ok(r.query_row(
                    "SELECT COUNT(*) FROM setting WHERE key = ?1",
                    rusqlite::params!["committed"],
                    |row| row.get(0),
                )?)
            })
            .expect("reader must not be blocked by open writer txn (WAL)");
        assert_eq!(
            seen_committed, 1,
            "reader must see committed data during a write"
        );

        let seen_uncommitted: i64 = pool
            .with_reader(|r| {
                Ok(r.query_row(
                    "SELECT COUNT(*) FROM setting WHERE key = ?1",
                    rusqlite::params!["uncommitted"],
                    |row| row.get(0),
                )?)
            })
            .expect("reader query");
        assert_eq!(
            seen_uncommitted, 0,
            "reader must NOT see the writer's uncommitted row"
        );

        tx.rollback()?;
        Ok(())
    })
    .expect("writer txn");

    // Sanity: pool is a cheap clone (Arc inside).
    let _clone: Pool = pool.clone();
}
