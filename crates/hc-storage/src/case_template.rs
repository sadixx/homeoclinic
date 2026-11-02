//! Case-template repository (HC-MVP1-058, CASE-001/002/003/004).
//!
//! Read-only access to the `case_template` rows seeded by migration 0008. The
//! three default templates have fixed UUIDv7 ids (exported below) so commands
//! and tests reference them deterministically (D3). All queries are bounded
//! (R-DATA-007) and parameterised (R-SEC-001). Templates are reference data;
//! this slice does not write them, so there is no audit row here.

use crate::audit::{write_audit, AuditAction, AuditEntry};
use crate::error::StorageError;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Map, Value};

/// Fixed UUIDv7 id of the "Chronic detailed" default template (is_default = 1).
/// Matches the seed row in migration 0008.
pub const CHRONIC_DETAILED_ID: &str = "01920000-0008-7000-8000-000000000001";
/// Fixed UUIDv7 id of the "Acute quick" default template. Matches 0008.
pub const ACUTE_QUICK_ID: &str = "01920000-0008-7000-8000-000000000002";
/// Fixed UUIDv7 id of the "Child" default template. Matches 0008.
pub const CHILD_ID: &str = "01920000-0008-7000-8000-000000000003";

/// Bounded list cap for templates (R-DATA-007); only a handful ship in MVP1.
const TEMPLATE_LIMIT: usize = 100;

/// A persisted case template (read projection).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaseTemplateRow {
    /// UUIDv7 id.
    pub id: String,
    /// Display name (e.g. `Chronic detailed`).
    pub name: String,
    /// The JSON schema (sections[] -> fields[]).
    pub schema_json: String,
    /// Whether this is the default template (exactly one row is).
    pub is_default: bool,
    /// Presentation order.
    pub sort_order: i64,
}

/// Column list shared by the template read helpers (keeps the SELECTs aligned).
const TEMPLATE_COLUMNS: &str = "id, name, schema_json, is_default, sort_order";

/// Map a row selected with [`TEMPLATE_COLUMNS`] into a [`CaseTemplateRow`].
fn map_template_row(r: &rusqlite::Row<'_>) -> Result<CaseTemplateRow, rusqlite::Error> {
    Ok(CaseTemplateRow {
        id: r.get(0)?,
        name: r.get(1)?,
        schema_json: r.get(2)?,
        is_default: r.get::<_, i64>(3)? != 0,
        sort_order: r.get(4)?,
    })
}

/// Read the single default (is_default = 1) non-deleted template (CASE-004).
/// Errors with [`StorageError::Db`] no-rows if none is seeded (never, after
/// migration 0008).
pub fn get_default_template(conn: &Connection) -> Result<CaseTemplateRow, StorageError> {
    let sql = format!(
        "SELECT {TEMPLATE_COLUMNS} FROM case_template \
         WHERE is_default = 1 AND deleted_at IS NULL LIMIT 1"
    );
    let row = conn
        .query_row(&sql, [], map_template_row)
        .optional()?
        .ok_or(StorageError::Db(rusqlite::Error::QueryReturnedNoRows))?;
    Ok(row)
}

/// Read one template by id (non-deleted), or `None`.
pub fn get_template(conn: &Connection, id: &str) -> Result<Option<CaseTemplateRow>, StorageError> {
    let sql = format!(
        "SELECT {TEMPLATE_COLUMNS} FROM case_template WHERE id = ?1 AND deleted_at IS NULL"
    );
    let row = conn
        .query_row(&sql, params![id], map_template_row)
        .optional()?;
    Ok(row)
}

/// List all non-deleted templates in presentation order (CASE-004). Bounded
/// (R-DATA-007).
pub fn list_templates(conn: &Connection) -> Result<Vec<CaseTemplateRow>, StorageError> {
    let sql = format!(
        "SELECT {TEMPLATE_COLUMNS} FROM case_template WHERE deleted_at IS NULL \
         ORDER BY sort_order ASC, name ASC LIMIT {TEMPLATE_LIMIT}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], map_template_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ---------------------------------------------------------------------------
// Per-doctor section visibility (CASE-002).
// ---------------------------------------------------------------------------
//
// The doctor can hide sections they never use and the choice persists as their
// template (CASE-002). MVP1 has one logical doctor per clinic DB, so the
// visibility map is stored as a single `app_setting` JSON object keyed by
// section key -> hidden bool. This reuses the configuration-table precedent
// (`app_setting`, migration 0002) rather than adding a clinical table, so no
// new migration is needed and the value never holds patient data (R-PRIV-001).

/// The `app_setting` key holding the per-doctor hidden-sections JSON map
/// (`{ "<sectionKey>": true, ... }`). Only keys explicitly hidden are stored.
pub const HIDDEN_SECTIONS_SETTING_KEY: &str = "case_template_hidden_sections";

/// Read the per-doctor hidden-sections map: section key -> `true` when hidden
/// (CASE-002). Absent/invalid settings read as an empty map (nothing hidden).
/// Only keys the doctor explicitly hid appear; all others are visible.
pub fn get_hidden_sections(
    conn: &Connection,
) -> Result<std::collections::BTreeMap<String, bool>, StorageError> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value_json FROM app_setting WHERE key = ?1",
            params![HIDDEN_SECTIONS_SETTING_KEY],
            |r| r.get(0),
        )
        .optional()?;
    let mut out = std::collections::BTreeMap::new();
    if let Some(s) = raw {
        if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(&s) {
            for (k, v) in map {
                if let Some(b) = v.as_bool() {
                    out.insert(k, b);
                }
            }
        }
    }
    Ok(out)
}

/// Set one section's visibility for the doctor and write exactly one audit row
/// in the caller's transaction (CASE-002, R-DATA-001).
///
/// Reads the current hidden-sections map, sets `section_key` to `hidden` (a
/// `false` toggle removes the key so the stored object stays minimal), and
/// writes it back to the single `app_setting` row. Fully parameterised
/// (R-SEC-001); the audit diff records only the section key + flag, never
/// patient data (R-PRIV-001).
pub fn set_section_visibility(
    tx: &Transaction<'_>,
    section_key: &str,
    hidden: bool,
    now: &str,
) -> Result<(), StorageError> {
    // Load current map (empty if unset / malformed).
    let raw: Option<String> = tx
        .query_row(
            "SELECT value_json FROM app_setting WHERE key = ?1",
            params![HIDDEN_SECTIONS_SETTING_KEY],
            |r| r.get(0),
        )
        .optional()?;
    let mut map: Map<String, Value> = match raw.as_deref() {
        Some(s) => match serde_json::from_str::<Value>(s) {
            Ok(Value::Object(m)) => m,
            _ => Map::new(),
        },
        None => Map::new(),
    };

    if hidden {
        map.insert(section_key.to_string(), Value::Bool(true));
    } else {
        // A visible section is the default; drop the key to keep the map minimal.
        map.remove(section_key);
    }

    let value_json = serde_json::to_string(&Value::Object(map))?;
    tx.execute(
        "INSERT OR REPLACE INTO app_setting (key, value_json) VALUES (?1, ?2)",
        params![HIDDEN_SECTIONS_SETTING_KEY, value_json],
    )?;

    write_audit(
        tx,
        &AuditEntry {
            user_id: None,
            entity: "app_setting",
            entity_id: HIDDEN_SECTIONS_SETTING_KEY,
            action: AuditAction::Update,
            diff: json!({ "section": {"key": section_key, "hidden": hidden} }),
        },
        now,
    )?;
    Ok(())
}
