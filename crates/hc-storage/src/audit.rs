//! Audit-log writer used by every write command (HC-MVP1-025, ADM-002,
//! R-DATA-001).
//!
//! [`write_audit`] runs *inside* the caller's open transaction so the row
//! change and exactly one `audit_log` row commit atomically. It never opens or
//! commits its own transaction.

use crate::error::StorageError;
use serde_json::{Map, Value};
use uuid::Uuid;

/// The kind of change an audited write performed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditAction {
    /// A new row was created.
    Create,
    /// An existing row was updated.
    Update,
    /// A row was (soft-)deleted.
    Delete,
}

impl AuditAction {
    /// The `action` column value stored in `audit_log`.
    pub fn as_str(self) -> &'static str {
        match self {
            AuditAction::Create => "create",
            AuditAction::Update => "update",
            AuditAction::Delete => "delete",
        }
    }
}

/// A single audited write to record.
///
/// `diff` is the JSON change description: create → `{field:{"new":..}}`,
/// update → `{field:{"old":..,"new":..}}` for changed fields only,
/// delete → `{field:{"old":..}}` snapshot.
pub struct AuditEntry<'a> {
    /// Acting user id, or `None` for a system write.
    pub user_id: Option<&'a str>,
    /// Entity name, e.g. `"setting"`, `"patient"`.
    pub entity: &'a str,
    /// Affected row id / key.
    pub entity_id: &'a str,
    /// What kind of change this was.
    pub action: AuditAction,
    /// The JSON diff for this change.
    pub diff: Value,
}

/// Insert exactly one `audit_log` row within the caller's open transaction
/// (R-DATA-001).
///
/// Generates a UUIDv7 id (R-DATA-005), stamps `at`/`created_at`/`updated_at`
/// from `now_rfc3339`, and binds every value as a parameter (R-SEC-001).
/// Returns the new audit row id. MUST be called inside the same transaction
/// that performs the row change; it does not commit.
pub fn write_audit(
    tx: &rusqlite::Transaction<'_>,
    entry: &AuditEntry<'_>,
    now_rfc3339: &str,
) -> Result<String, StorageError> {
    let id = Uuid::now_v7().to_string();
    let diff_json = serde_json::to_string(&entry.diff)?;

    // Fully parameterised insert (R-SEC-001). The row carries the standard
    // audit columns (R-DATA-005); `created_by`/`updated_by` mirror `user_id`.
    tx.execute(
        "INSERT INTO audit_log (\
            id, at, user_id, entity, entity_id, action, diff_json, \
            created_at, updated_at, deleted_at, created_by, updated_by, row_version\
        ) VALUES (\
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11, 0\
        )",
        rusqlite::params![
            id,
            now_rfc3339,
            entry.user_id,
            entry.entity,
            entry.entity_id,
            entry.action.as_str(),
            diff_json,
            now_rfc3339,
            now_rfc3339,
            entry.user_id,
            entry.user_id,
        ],
    )?;

    Ok(id)
}

/// Build an update diff from old/new JSON objects: only changed keys, as
/// `{key:{"old":..,"new":..}}`.
///
/// Non-object inputs yield an empty object. A key present on only one side is
/// treated as changed (old or new is `null`).
pub fn diff_objects(old: &Value, new: &Value) -> Value {
    let empty = Map::new();
    let old_map = old.as_object().unwrap_or(&empty);
    let new_map = new.as_object().unwrap_or(&empty);

    let mut diff = Map::new();
    // Union of keys from both objects.
    let keys = old_map.keys().chain(new_map.keys());
    let mut seen: Vec<&String> = Vec::new();
    for key in keys {
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);

        let old_val = old_map.get(key).cloned().unwrap_or(Value::Null);
        let new_val = new_map.get(key).cloned().unwrap_or(Value::Null);
        if old_val != new_val {
            let mut change = Map::new();
            change.insert("old".to_string(), old_val);
            change.insert("new".to_string(), new_val);
            diff.insert(key.clone(), Value::Object(change));
        }
    }

    Value::Object(diff)
}
