//! HC-MVP1-025 audit-log writer tests (ADM-002, R-DATA-001). Red before green.
//!
//! Every write is one transaction + exactly one `audit_log` row with a diff.
//! Each test uses its own temp-file DB with migrations applied (R-TEST-006).

use hc_storage::audit::{diff_objects, write_audit, AuditAction, AuditEntry};
use hc_storage::pool::Pool;
use hc_storage::testing::temp_db;
use serde_json::json;

const FIXED_NOW: &str = "2026-10-17T09:00:00Z";

fn audit_rows(pool: &Pool, entity_id: &str) -> Vec<(String, String)> {
    pool.with_reader(|c| {
        let mut stmt =
            c.prepare("SELECT action, diff_json FROM audit_log WHERE entity_id = ?1 ORDER BY at")?;
        let rows = stmt
            .query_map(rusqlite::params![entity_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
    .expect("read audit rows")
}

/// Creating a row writes exactly one audit row (action=create) with a diff
/// carrying the new value, atomically in the same transaction (R-DATA-001).
#[test]
fn admin002_create_writes_one_audit_row_with_diff() {
    let (_dir, pool) = temp_db();

    let audit_id = pool
        .with_writer(|c| {
            let tx = c.transaction()?;
            tx.execute(
                "INSERT INTO setting(key, value_json) VALUES (?1, ?2)",
                rusqlite::params!["clinic_name", "\"Test Clinic 001\""],
            )?;
            let id = write_audit(
                &tx,
                &AuditEntry {
                    user_id: Some("user-1"),
                    entity: "setting",
                    entity_id: "clinic_name",
                    action: AuditAction::Create,
                    diff: json!({"value_json": {"new": "Test Clinic 001"}}),
                },
                FIXED_NOW,
            )?;
            tx.commit()?;
            Ok(id)
        })
        .expect("create + audit in one txn");

    // UUIDv7-shaped id (R-DATA-005): 36 chars, version nibble '7'.
    assert_eq!(audit_id.len(), 36, "audit id is a UUID string");
    assert_eq!(
        audit_id.as_bytes()[14],
        b'7',
        "audit id must be UUIDv7 (version nibble)"
    );

    let rows = audit_rows(&pool, "clinic_name");
    assert_eq!(rows.len(), 1, "exactly one audit row for the create");
    assert_eq!(rows[0].0, "create");
    let diff: serde_json::Value = serde_json::from_str(&rows[0].1).expect("diff json");
    assert_eq!(diff["value_json"]["new"], "Test Clinic 001");
}

/// Updating a row writes exactly one audit row (action=update) whose diff has
/// {old,new} for the changed field only.
#[test]
fn admin002_update_writes_one_audit_row_with_diff() {
    let (_dir, pool) = temp_db();

    // seed
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO setting(key, value_json) VALUES (?1, ?2)",
            rusqlite::params!["fee_first", "100"],
        )?;
        write_audit(
            &tx,
            &AuditEntry {
                user_id: None,
                entity: "setting",
                entity_id: "fee_first",
                action: AuditAction::Create,
                diff: json!({"value_json": {"new": 100}}),
            },
            FIXED_NOW,
        )?;
        tx.commit()?;
        Ok(())
    })
    .expect("seed");

    // update
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "UPDATE setting SET value_json = ?2 WHERE key = ?1",
            rusqlite::params!["fee_first", "150"],
        )?;
        write_audit(
            &tx,
            &AuditEntry {
                user_id: None,
                entity: "setting",
                entity_id: "fee_first",
                action: AuditAction::Update,
                diff: diff_objects(&json!({"value_json": 100}), &json!({"value_json": 150})),
            },
            "2026-10-17T10:00:00Z",
        )?;
        tx.commit()?;
        Ok(())
    })
    .expect("update");

    let rows = audit_rows(&pool, "fee_first");
    assert_eq!(rows.len(), 2, "create + update audit rows");
    assert_eq!(rows[1].0, "update");
    let diff: serde_json::Value = serde_json::from_str(&rows[1].1).expect("diff json");
    assert_eq!(diff["value_json"]["old"], 100);
    assert_eq!(diff["value_json"]["new"], 150);
}

/// Deleting a row writes exactly one audit row (action=delete) with the old
/// snapshot in the diff.
#[test]
fn admin002_delete_writes_one_audit_row_with_diff() {
    let (_dir, pool) = temp_db();

    pool.with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO setting(key, value_json) VALUES (?1, ?2)",
            rusqlite::params!["tmp", "\"x\""],
        )?;
        write_audit(
            &tx,
            &AuditEntry {
                user_id: None,
                entity: "setting",
                entity_id: "tmp",
                action: AuditAction::Create,
                diff: json!({"value_json": {"new": "x"}}),
            },
            FIXED_NOW,
        )?;
        tx.commit()?;
        Ok(())
    })
    .expect("seed");

    pool.with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "DELETE FROM setting WHERE key = ?1",
            rusqlite::params!["tmp"],
        )?;
        write_audit(
            &tx,
            &AuditEntry {
                user_id: None,
                entity: "setting",
                entity_id: "tmp",
                action: AuditAction::Delete,
                diff: json!({"value_json": {"old": "x"}}),
            },
            "2026-10-17T11:00:00Z",
        )?;
        tx.commit()?;
        Ok(())
    })
    .expect("delete");

    let rows = audit_rows(&pool, "tmp");
    assert_eq!(rows.len(), 2, "create + delete audit rows");
    assert_eq!(rows[1].0, "delete");
    let diff: serde_json::Value = serde_json::from_str(&rows[1].1).expect("diff json");
    assert_eq!(diff["value_json"]["old"], "x");
}

/// If the transaction is rolled back, neither the row change nor the audit row
/// persists — a partial write is impossible (R-DATA-001).
#[test]
fn admin002_audit_and_row_commit_atomically() {
    let (_dir, pool) = temp_db();

    let _ = pool.with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "INSERT INTO setting(key, value_json) VALUES (?1, ?2)",
            rusqlite::params!["rolled_back", "\"nope\""],
        )?;
        write_audit(
            &tx,
            &AuditEntry {
                user_id: None,
                entity: "setting",
                entity_id: "rolled_back",
                action: AuditAction::Create,
                diff: json!({"value_json": {"new": "nope"}}),
            },
            FIXED_NOW,
        )?;
        tx.rollback()?;
        Ok(())
    });

    let setting_count: i64 = pool
        .with_reader(|c| {
            Ok(c.query_row(
                "SELECT COUNT(*) FROM setting WHERE key = ?1",
                rusqlite::params!["rolled_back"],
                |r| r.get(0),
            )?)
        })
        .expect("count setting");
    assert_eq!(setting_count, 0, "rolled-back row must not persist");

    let audit = audit_rows(&pool, "rolled_back");
    assert_eq!(audit.len(), 0, "rolled-back audit row must not persist");
}

/// `diff_objects` reports only the changed keys as {old,new}.
#[test]
fn admin002_diff_objects_reports_only_changed_keys() {
    let old = json!({"a": 1, "b": "same", "c": true});
    let new = json!({"a": 2, "b": "same", "c": false});
    let diff = diff_objects(&old, &new);

    assert_eq!(diff["a"]["old"], 1);
    assert_eq!(diff["a"]["new"], 2);
    assert_eq!(diff["c"]["old"], true);
    assert_eq!(diff["c"]["new"], false);
    assert!(
        diff.get("b").is_none(),
        "unchanged key must be absent from the diff"
    );
}
