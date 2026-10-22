//! Attachment metadata repository (PAT-009, HC-MVP1-M3ux3).
//!
//! Row CRUD over the migration-0010 `attachment` table. Parameterised SQL only
//! (R-SEC-001); SQL + paths stay in this layer (R-ARCH-009). Writes take a
//! `&Transaction` so the `hc-app` service commits the row and exactly ONE
//! `audit_log` row atomically (R-DATA-001). The encrypted blob bytes go through
//! [`crate::attachment::AttachmentStore`], NOT here — this module only persists
//! the opaque `blob_id` + metadata. UUIDv7 ids + standard audit columns
//! (R-DATA-005). List queries are bounded (R-DATA-007) and use the `visit_id`
//! index (R-DATA-008). No patient free text is logged (R-PRIV-001).

use crate::error::StorageError;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

/// One persisted attachment row (read + write projection).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AttachmentRow {
    /// UUIDv7 attachment-row id.
    pub id: String,
    /// Owning patient id (FK `patient`).
    pub patient_id: String,
    /// Owning visit id (FK `visit`), or `None` for a patient-level attachment.
    pub visit_id: Option<String>,
    /// AttachmentStore blob id → `files/<blob_id>.bin` (opaque, R-PRIV-007).
    pub blob_id: String,
    /// Canonical mime (application/pdf | image/png | image/jpeg | image/webp).
    pub mime: String,
    /// SHA-256 of the plaintext (from `AttachmentMeta`), lowercase hex.
    pub sha256: String,
    /// Plaintext byte length.
    pub byte_size: i64,
    /// The chosen file's base name (display only; NEVER logged — R-PRIV-001).
    pub original_name: Option<String>,
    /// Optional doctor caption.
    pub caption: Option<String>,
    /// RFC3339 creation instant.
    pub created_at: String,
}

/// Column list shared by the attachment read helpers (keeps the SELECTs aligned).
const ATTACHMENT_COLUMNS: &str =
    "id, patient_id, visit_id, blob_id, mime, sha256, byte_size, original_name, caption, created_at";

/// Map a row selected with [`ATTACHMENT_COLUMNS`] into an [`AttachmentRow`].
fn map_attachment_row(r: &rusqlite::Row<'_>) -> Result<AttachmentRow, rusqlite::Error> {
    Ok(AttachmentRow {
        id: r.get(0)?,
        patient_id: r.get(1)?,
        visit_id: r.get(2)?,
        blob_id: r.get(3)?,
        mime: r.get(4)?,
        sha256: r.get(5)?,
        byte_size: r.get(6)?,
        original_name: r.get(7)?,
        caption: r.get(8)?,
        created_at: r.get(9)?,
    })
}

/// Insert one attachment row (the service writes the single audit row). Runs in
/// the caller's transaction (R-DATA-001). Parameterised SQL (R-SEC-001).
pub fn insert_attachment(
    tx: &Transaction<'_>,
    a: &AttachmentRow,
    now: &str,
) -> Result<(), StorageError> {
    tx.execute(
        "INSERT INTO attachment (\
            id, patient_id, visit_id, blob_id, mime, sha256, byte_size, \
            original_name, caption, \
            created_at, updated_at, deleted_at, created_by, updated_by, row_version\
        ) VALUES (\
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, NULL, NULL, NULL, 0\
        )",
        params![
            a.id,
            a.patient_id,
            a.visit_id,
            a.blob_id,
            a.mime,
            a.sha256,
            a.byte_size,
            a.original_name,
            a.caption,
            now,
        ],
    )?;
    Ok(())
}

/// List a visit's non-deleted attachments, bounded by `limit` (R-DATA-007),
/// ordered `created_at ASC, id ASC`. Uses the `(visit_id, created_at)` index
/// (R-DATA-008).
pub fn list_attachments_for_visit(
    conn: &Connection,
    visit_id: &str,
    limit: i64,
) -> Result<Vec<AttachmentRow>, StorageError> {
    let sql = format!(
        "SELECT {ATTACHMENT_COLUMNS} FROM attachment \
         WHERE visit_id = ?1 AND deleted_at IS NULL \
         ORDER BY created_at ASC, id ASC LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![visit_id, limit], map_attachment_row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Read one non-deleted attachment row by id, or `None`.
pub fn get_attachment(conn: &Connection, id: &str) -> Result<Option<AttachmentRow>, StorageError> {
    let sql =
        format!("SELECT {ATTACHMENT_COLUMNS} FROM attachment WHERE id = ?1 AND deleted_at IS NULL");
    let row = conn
        .query_row(&sql, params![id], map_attachment_row)
        .optional()?;
    Ok(row)
}

/// Delete one attachment row, returning `true` if a row was removed. Runs in
/// the caller's transaction; the service deletes the blob after commit. A HARD
/// delete (the row is physically removed so no orphan metadata survives the
/// blob delete — ADR 0017).
pub fn delete_attachment(tx: &Transaction<'_>, id: &str) -> Result<bool, StorageError> {
    let changed = tx.execute(
        "DELETE FROM attachment WHERE id = ?1 AND deleted_at IS NULL",
        params![id],
    )?;
    Ok(changed > 0)
}
