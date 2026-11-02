//! Visit lab-report attachment use-case service (PAT-009, HC-MVP1-M3ux3).
//!
//! Over the existing encrypted [`hc_storage::attachment::AttachmentStore`]
//! (AES-256-GCM, HKDF attachment subkey of the DEK, opaque `<uuid>.bin` names —
//! R-PRIV-007, NFR-021) plus the migration-0010 `attachment` metadata table via
//! [`hc_storage::attachment_repo`]. NO new crypto. Every write runs in ONE
//! transaction with exactly ONE audit row (R-DATA-001). The file is validated
//! as a PDF or a common image by extension + magic through the pure
//! [`hc_domain::attachment::detect_report_mime`] before it is stored
//! (non-PDF/non-image rejected). No patient free text (original_name / caption)
//! is written to the audit diff or logged (R-PRIV-001).
//!
//! The `AttachmentStore` is opened per call from the shell `data_dir` + the
//! install [`hc_storage::key::DekKeyProvider`] the command reads out of the
//! lock flag (the same pair `get_licence_status` / `restore_apply` use).

use std::path::Path;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use specta::Type;

use hc_storage::attachment::AttachmentStore;
use hc_storage::attachment_repo::{self, AttachmentRow};
use hc_storage::audit::{write_audit, AuditAction, AuditEntry};
use hc_storage::key::DekKeyProvider;
use hc_storage::visit::get_visit;
use hc_storage::Pool;

use hc_domain::attachment::detect_report_mime;

use crate::clock::Clock;
use crate::error::AppError;

/// Bounded cap for a visit's attachment list (R-DATA-007). A visit never has
/// this many reports; the query stays bounded regardless.
const ATTACHMENT_LIST_LIMIT: i64 = 500;

// ---------------------------------------------------------------------------
// visit_attach_report (PAT-009).
// ---------------------------------------------------------------------------

/// `visit_attach_report` request. `source_path` is the absolute path the OS
/// file-open dialog returned (via `visit_pick_report_file`); the UI never
/// constructs it (architecture rule).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AttachReportRequest {
    /// The visit the report is attached to.
    pub visit_id: String,
    /// Absolute path of the chosen file (from the typed file-open command).
    pub source_path: String,
    /// Optional doctor caption.
    pub caption: Option<String>,
    /// Optional display-ONLY label (M3-RWv4 §5.5). When `Some`, the stored
    /// `original_name` becomes this label (sanitised: path separators / control
    /// chars stripped) instead of the raw file base name; when `None`, today's
    /// behaviour (the file base name) is kept. Display label ONLY — the on-disk
    /// blob + `blob_id` are unchanged (R-PRIV-007) and the label is NEVER
    /// logged / never in the audit diff (R-PRIV-001).
    pub display_label: Option<String>,
}

/// `visit_attach_report` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AttachReportResponse {
    /// The new attachment-row id (UUIDv7).
    pub attachment_id: String,
    /// Canonical mime of the stored report.
    pub mime: String,
    /// SHA-256 of the plaintext, lowercase hex.
    pub sha256: String,
    /// The chosen file's base name (display).
    pub original_name: String,
    /// Plaintext byte length.
    #[specta(type = specta_typescript::Number)]
    pub byte_size: i64,
}

// ---------------------------------------------------------------------------
// visit_list_attachments (PAT-009).
// ---------------------------------------------------------------------------

/// `visit_list_attachments` request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ListAttachmentsRequest {
    /// The visit whose attachments are listed.
    pub visit_id: String,
}

/// One attachment summary row for the Investigations list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentSummary {
    /// Attachment-row id.
    pub attachment_id: String,
    /// Owning patient id (M3-RWv4 §9: lets the patient-level list key/group).
    pub patient_id: String,
    /// Owning visit id, or `None` for a patient-level attachment (M3-RWv4 §9).
    pub visit_id: Option<String>,
    /// Canonical mime (drives the type badge).
    pub mime: String,
    /// Optional doctor caption.
    pub caption: Option<String>,
    /// The chosen file's base name (display).
    pub original_name: Option<String>,
    /// Plaintext byte length.
    #[specta(type = specta_typescript::Number)]
    pub byte_size: i64,
    /// RFC3339 creation instant.
    pub created_at: String,
}

/// `visit_list_attachments` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ListAttachmentsResponse {
    /// The visit's attachments, oldest first.
    pub attachments: Vec<AttachmentSummary>,
}

/// `patient_list_attachments` request (M3-RWv4 §5.4 / §9). Lists ALL of a
/// patient's attachments across visits — the shared two-way store behind the
/// Lab reports & Scans panel and the Submitted pick-existing list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PatientListAttachmentsRequest {
    /// The patient whose attachments (across visits) are listed.
    pub patient_id: String,
}

// ---------------------------------------------------------------------------
// visit_open_attachment (PAT-009) — in-app preview, returns bytes (ADR 0017).
// ---------------------------------------------------------------------------

/// `visit_open_attachment` request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenAttachmentRequest {
    /// The attachment to open.
    pub attachment_id: String,
}

/// `visit_open_attachment` response — decrypted bytes for in-app preview. The
/// UI renders an image via a `data:<mime>;base64,...` URL (CSP allows
/// `img-src data:`) and offers a save/open affordance for PDFs. No plaintext
/// temp file is written to disk (ADR 0017).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenAttachmentResponse {
    /// Canonical mime of the decrypted report.
    pub mime: String,
    /// The chosen file's base name (display).
    pub original_name: Option<String>,
    /// Base64-encoded decrypted bytes for in-app preview.
    pub data_base64: String,
}

// ---------------------------------------------------------------------------
// visit_delete_attachment (PAT-009).
// ---------------------------------------------------------------------------

/// `visit_delete_attachment` request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAttachmentRequest {
    /// The attachment to delete (row + encrypted blob).
    pub attachment_id: String,
}

/// `visit_delete_attachment` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAttachmentResponse {
    /// Whether the delete succeeded.
    pub ok: bool,
}

// ---------------------------------------------------------------------------
// visit_pick_report_file (PAT-009) — typed OS file-open with PDF/image filter.
// ---------------------------------------------------------------------------

/// `visit_pick_report_file` response — the chosen absolute path, or `None` if
/// the user cancelled. Lets the UI obtain a `source_path` without ever
/// constructing a filesystem path (architecture rule). The dialog only returns
/// a path; it grants no filesystem read (the backend reads the bytes).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PickReportFileResponse {
    /// The chosen absolute path, or `None` on cancel.
    pub source_path: Option<String>,
}

// ---------------------------------------------------------------------------
// Service.
// ---------------------------------------------------------------------------

/// Visit lab-report attachment use-case service. Holds the injected [`Clock`];
/// the open [`Pool`], the install [`DekKeyProvider`] and the data directory are
/// passed per call.
pub struct AttachmentService<'a> {
    clock: &'a dyn Clock,
}

impl<'a> AttachmentService<'a> {
    /// Build the service over the injected clock.
    pub fn new(clock: &'a dyn Clock) -> Self {
        AttachmentService { clock }
    }

    /// Attach a PDF/image report to a visit: read `source_path`, validate it is
    /// a supported report by extension + magic, encrypt-store the bytes, and
    /// insert the row + one audit row in one txn (PAT-009, R-DATA-001).
    ///
    /// The encrypted blob is written to the [`AttachmentStore`] (filesystem)
    /// BEFORE the DB txn; if the txn then fails, the just-written blob is
    /// best-effort deleted so no orphan ciphertext is left (design §6a). No
    /// patient free text (the file name, caption or path) is ever logged or
    /// written to the audit diff (R-PRIV-001).
    pub fn attach_report(
        &self,
        pool: &Pool,
        provider: &DekKeyProvider,
        data_dir: &Path,
        req: AttachReportRequest,
    ) -> Result<AttachReportResponse, AppError> {
        // 1. Resolve the visit → its patient; an unknown visit is NotFound and
        //    has no side effects (no blob, no row).
        let visit = pool
            .with_reader(|c| get_visit(c, &req.visit_id))?
            .ok_or(AppError::NotFound)?;
        let patient_id = visit.patient_id;

        // 2. Read the chosen file and derive its display base name. The path is
        //    used only to read + derive the name; it is NEVER logged (R-PRIV-001).
        let source = Path::new(&req.source_path);
        let file_base_name = source
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        // The extension signal for mime detection always comes from the real
        // file name (the display label carries no extension).
        let file_base_name_for_mime = file_base_name.clone();
        // M3-RWv4 §5.5: when a display label is supplied, it REPLACES the file
        // base name as the stored display `original_name` (sanitised: path
        // separators + control chars stripped; display label ONLY, never a path
        // — R-PRIV-007). Otherwise today's behaviour (the file base name) holds.
        // The label / name is NEVER logged (R-PRIV-001).
        let original_name = match &req.display_label {
            Some(label) => sanitize_display_label(label),
            None => file_base_name,
        };
        let bytes = std::fs::read(source)
            .map_err(|e| AppError::Storage(Box::new(hc_storage::StorageError::Io(e))))?;

        // 3. Validate PDF/image by extension + magic; reject everything else as
        //    Validation (no blob, no row). The EXTENSION must come from the real
        //    file base name (the display label carries no extension), while the
        //    stored display `original_name` may be the composed label (§5.5).
        let mime = detect_report_mime(&file_base_name_for_mime, &bytes)
            .ok_or_else(|| AppError::from(hc_storage::StorageError::UnsupportedAttachmentType))?;

        // 4. Encrypt-store the bytes (opaque <uuid>.bin, AES-256-GCM — reuse the
        //    existing store, no new crypto). Done BEFORE the DB txn.
        let store = AttachmentStore::open(data_dir, provider)?;
        let meta = store.put(&bytes)?;

        // 5. ONE DB txn: insert the row + exactly ONE audit row (R-DATA-001).
        //    On any txn error, compensate by deleting the just-written blob so
        //    no orphan ciphertext survives.
        let now = self.clock.now_rfc3339();
        let attachment_id = uuid::Uuid::now_v7().to_string();
        let row = AttachmentRow {
            id: attachment_id.clone(),
            patient_id,
            visit_id: Some(req.visit_id.clone()),
            blob_id: meta.id.clone(),
            mime: mime.to_string(),
            sha256: meta.sha256.clone(),
            byte_size: meta.size as i64,
            original_name: Some(original_name.clone()),
            caption: req.caption.clone(),
            created_at: now.clone(),
        };

        let write = pool.with_writer(|c| {
            let tx = c.transaction()?;
            attachment_repo::insert_attachment(&tx, &row, &now)?;
            // Diff carries only non-patient metadata (mime/sha256/byte_size),
            // never the file name or caption (R-PRIV-001).
            write_audit(
                &tx,
                &AuditEntry {
                    user_id: None,
                    entity: "attachment",
                    entity_id: &attachment_id,
                    action: AuditAction::Create,
                    diff: serde_json::json!({
                        "mime": { "new": row.mime },
                        "sha256": { "new": row.sha256 },
                        "byte_size": { "new": row.byte_size },
                    }),
                },
                &now,
            )?;
            tx.commit()?;
            Ok(())
        });

        if let Err(e) = write {
            // Compensate: remove the orphan blob (best-effort, idempotent).
            let _ = store.delete(&meta.id);
            return Err(AppError::from(e));
        }

        Ok(AttachReportResponse {
            attachment_id,
            mime: mime.to_string(),
            sha256: meta.sha256,
            original_name,
            byte_size: meta.size as i64,
        })
    }

    /// List a visit's attachments (PAT-009). Bounded (R-DATA-007).
    pub fn list_attachments(
        &self,
        pool: &Pool,
        req: ListAttachmentsRequest,
    ) -> Result<ListAttachmentsResponse, AppError> {
        let rows = pool.with_reader(|c| {
            attachment_repo::list_attachments_for_visit(c, &req.visit_id, ATTACHMENT_LIST_LIMIT)
        })?;
        let attachments = rows.into_iter().map(summary_from_row).collect();
        Ok(ListAttachmentsResponse { attachments })
    }

    /// List ALL of a patient's attachments across visits — the shared two-way
    /// store behind the Lab reports & Scans panel + the Submitted pick-existing
    /// list (M3-RWv4 §5.4). Read-only; bounded (R-DATA-007). Each summary
    /// carries its owning `patient_id` + `visit_id` so the UI can key/group.
    pub fn list_attachments_for_patient(
        &self,
        pool: &Pool,
        req: PatientListAttachmentsRequest,
    ) -> Result<ListAttachmentsResponse, AppError> {
        let rows = pool.with_reader(|c| {
            attachment_repo::list_attachments_for_patient(c, &req.patient_id, ATTACHMENT_LIST_LIMIT)
        })?;
        let attachments = rows.into_iter().map(summary_from_row).collect();
        Ok(ListAttachmentsResponse { attachments })
    }

    /// Open (decrypt) an attachment for in-app preview (PAT-009, ADR 0017).
    /// Returns the decrypted bytes base64-encoded; no plaintext temp file is
    /// written to disk.
    pub fn open_attachment(
        &self,
        pool: &Pool,
        provider: &DekKeyProvider,
        data_dir: &Path,
        req: OpenAttachmentRequest,
    ) -> Result<OpenAttachmentResponse, AppError> {
        let row = pool
            .with_reader(|c| attachment_repo::get_attachment(c, &req.attachment_id))?
            .ok_or(AppError::NotFound)?;

        let store = AttachmentStore::open(data_dir, provider)?;
        let bytes = store.get(&row.blob_id)?;
        let data_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

        Ok(OpenAttachmentResponse {
            mime: row.mime,
            original_name: row.original_name,
            data_base64,
        })
    }

    /// Delete an attachment row + its encrypted blob in one txn + one audit row
    /// (PAT-009, R-DATA-001). The row delete + audit row commit first; the blob
    /// is removed after commit so a crash between them leaves at worst an
    /// orphan (opaque) ciphertext, never a row pointing at a missing blob
    /// (ADR 0017).
    pub fn delete_attachment(
        &self,
        pool: &Pool,
        provider: &DekKeyProvider,
        data_dir: &Path,
        req: DeleteAttachmentRequest,
    ) -> Result<DeleteAttachmentResponse, AppError> {
        let row = pool
            .with_reader(|c| attachment_repo::get_attachment(c, &req.attachment_id))?
            .ok_or(AppError::NotFound)?;

        let now = self.clock.now_rfc3339();
        let removed = pool.with_writer(|c| {
            let tx = c.transaction()?;
            let removed = attachment_repo::delete_attachment(&tx, &req.attachment_id)?;
            if !removed {
                // Raced with another delete between the read and the write:
                // roll back (tx drops without commit) and signal "not removed"
                // so the caller returns NotFound. No audit row is written.
                return Ok(false);
            }
            // Diff carries only the sha256 (no patient text, R-PRIV-001).
            write_audit(
                &tx,
                &AuditEntry {
                    user_id: None,
                    entity: "attachment",
                    entity_id: &req.attachment_id,
                    action: AuditAction::Delete,
                    diff: serde_json::json!({ "sha256": { "old": row.sha256 } }),
                },
                &now,
            )?;
            tx.commit()?;
            Ok(true)
        })?;

        if !removed {
            return Err(AppError::NotFound);
        }

        // Row + audit committed; now remove the ciphertext (idempotent).
        let store = AttachmentStore::open(data_dir, provider)?;
        store.delete(&row.blob_id)?;

        Ok(DeleteAttachmentResponse { ok: true })
    }
}

/// Project a stored [`AttachmentRow`] into the typed [`AttachmentSummary`],
/// carrying the owning `patient_id` + `visit_id` (M3-RWv4 §9).
fn summary_from_row(r: AttachmentRow) -> AttachmentSummary {
    AttachmentSummary {
        attachment_id: r.id,
        patient_id: r.patient_id,
        visit_id: r.visit_id,
        mime: r.mime,
        caption: r.caption,
        original_name: r.original_name,
        byte_size: r.byte_size,
        created_at: r.created_at,
    }
}

/// Maximum length of a stored display label (defence against an unbounded one).
const DISPLAY_LABEL_MAX: usize = 255;

/// Sanitise a display-ONLY label (M3-RWv4 §5.5). Strips path separators
/// (`/`, `\`) and control characters, trims a leading dot so the label never
/// looks like a hidden file, and caps the length. This is a display string for
/// the `original_name`/`caption` column ONLY — NOT a filename, NOT a path (the
/// on-disk blob stays the opaque encrypted UUID, R-PRIV-007) — and it is NEVER
/// logged (R-PRIV-001). Pure (no IO).
fn sanitize_display_label(label: &str) -> String {
    let cleaned: String = label
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    // Collapse internal whitespace, trim, drop a leading dot.
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim_start_matches('.').to_string();
    trimmed.chars().take(DISPLAY_LABEL_MAX).collect()
}
