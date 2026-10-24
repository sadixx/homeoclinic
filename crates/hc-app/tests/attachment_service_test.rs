//! Integration tests for the visit lab-report attachment use-case service
//! (PAT-009, HC-MVP1-M3ux3).
//!
//! CUT: `hc_app::attachment::AttachmentService` + the `hc_storage`
//! `attachment_repo` + the existing encrypted `AttachmentStore` + the pure
//! `hc_domain::attachment::detect_report_mime` it drives, over migration 0010.
//! The only fakes are DEPENDENCIES (R-TEST-002): a local `FakeClock`
//! (R-TEST-006), a real migrated encrypted DB (`Pool`), a real unlocked
//! `DekKeyProvider`, and `tempfile` for the file the OS dialog would return.
//! Each test asserts the resulting data/state and the on-disk ciphertext
//! (R-TEST-003), never merely `is_ok()`. Synthetic data only (R-TEST-004).
//!
//! RED phase: these assert against the architect's sentinel stubs and MUST fail
//! on assertions until hc-data-dev / hc-core-dev implement the repo + service.

use std::path::Path;

use hc_app::attachment::{
    AttachReportRequest, AttachmentService, DeleteAttachmentRequest, ListAttachmentsRequest,
    OpenAttachmentRequest,
};
use hc_app::clock::Clock;

use hc_storage::key::{DekKeyProvider, KeyHierarchy, KeyProvider};
use hc_storage::testing::{seed_patient, temp_file_keystore};
use hc_storage::Pool;

use base64::Engine as _;

/// Synthetic magic-byte payloads (R-TEST-004).
const PDF: &[u8] = b"%PDF-1.7\nsynthetic lab report body for Test Patient 001";
const PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x11, 0x22, 0x33, 0x44, 0x55,
];

/// Deterministic clock (dependency fake, R-TEST-006).
struct FakeClock {
    now: String,
}
impl Clock for FakeClock {
    fn now_rfc3339(&self) -> String {
        self.now.clone()
    }
}

/// A test world: a temp data dir that holds BOTH the migrated encrypted
/// `clinic.db` and the attachment store's `files/` dir (the service opens the
/// store at this same `data_dir`), plus a real unlocked `DekKeyProvider`.
struct World {
    _dir: tempfile::TempDir,
    data_dir: std::path::PathBuf,
    pool: Pool,
    provider: DekKeyProvider,
}

/// Build the test world: initialise a real key hierarchy (real DEK), open the
/// clinic DB keyed with that DEK at `data_dir/clinic.db`, run all migrations
/// (incl. 0010), and return the pieces. The attachment store the service opens
/// at `data_dir` shares the dir but uses the DEK's HKDF attachment subkey — the
/// real crypto path, no new crypto (R-TEST-002).
fn world() -> World {
    let (dir, store_ks) = temp_file_keystore();
    let data_dir = dir.path().to_path_buf();
    let h = KeyHierarchy::new(&store_ks);
    let (_recovery, provider) = h.initialize("1234").expect("initialize key hierarchy");

    // Open the clinic DB keyed with the DEK provider (it implements KeyProvider)
    // and migrate it to the latest schema (adds the attachment table).
    let db_path = data_dir.join("clinic.db");
    let pool = Pool::open(&db_path, &provider as &dyn KeyProvider).expect("open clinic pool");
    hc_storage::migrate::run(&pool).expect("run migrations");

    // The provider was moved into Pool::open by reference only; re-derive a
    // fresh provider for the service from the SAME keystore so both share the
    // DEK. (A second unlock yields the same DEK.)
    let provider = KeyHierarchy::new(&store_ks)
        .unlock_with_pin("1234")
        .expect("unlock DEK for service");
    World {
        _dir: dir,
        data_dir,
        pool,
        provider,
    }
}

/// Count `audit_log` rows for the attachment entity (optionally one id).
fn attachment_audit_rows(pool: &Pool, action: &str) -> i64 {
    pool.with_reader(|c| {
        Ok(c.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE entity = 'attachment' AND action = ?1",
            [action],
            |r| r.get(0),
        )?)
    })
    .expect("count attachment audit rows")
}

/// Read the `blob_id` of an attachment row by its id (to find the on-disk blob).
fn blob_id_of(pool: &Pool, attachment_id: &str) -> Option<String> {
    pool.with_reader(|c| {
        Ok(c.query_row(
            "SELECT blob_id FROM attachment WHERE id = ?1",
            [attachment_id],
            |r| r.get::<_, String>(0),
        )
        .ok())
    })
    .expect("read blob_id")
}

/// Count attachment rows (non-deleted) for a visit.
fn attachment_row_count(pool: &Pool, visit_id: &str) -> i64 {
    pool.with_reader(|c| {
        Ok(c.query_row(
            "SELECT COUNT(*) FROM attachment WHERE visit_id = ?1 AND deleted_at IS NULL",
            [visit_id],
            |r| r.get(0),
        )?)
    })
    .expect("count attachment rows")
}

/// Independent sha256 hex of `bytes` (R-TEST-002: computed outside the CUT).
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Write `bytes` to a temp file named `name` and return its path + the owning
/// TempDir (kept alive). This is the file the OS dialog would have returned.
fn source_file(bytes: &[u8], name: &str) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().expect("source tempdir");
    let path = dir.path().join(name);
    std::fs::write(&path, bytes).expect("write source file");
    (dir, path)
}

/// Seed one patient + one visit, returning (patient_id, visit_id).
fn seed_patient_and_visit(pool: &Pool) -> (String, String) {
    let patient_id = seed_patient(pool, "HC-000001", "Test Patient 001");
    let visit_id =
        hc_storage::testing::insert_visit_for(pool, &patient_id, "2026-10-21T09:00:00Z", None);
    (patient_id, visit_id)
}

fn svc_clock() -> FakeClock {
    FakeClock {
        now: "2026-10-22T10:00:00Z".to_string(),
    }
}

/// A1: attaching a PDF stores it ENCRYPTED on disk and inserts the metadata row.
#[test]
fn pat009_attach_pdf_stores_encrypted_and_inserts_row_with_metadata() {
    let w = world();
    let (_p, visit_id) = seed_patient_and_visit(&w.pool);
    let (_srcdir, src) = source_file(PDF, "lab-report.pdf");
    let clock = svc_clock();
    let svc = AttachmentService::new(&clock);

    let resp = svc
        .attach_report(
            &w.pool,
            &w.provider,
            Path::new(&w.data_dir),
            AttachReportRequest {
                visit_id: visit_id.clone(),
                source_path: src.to_string_lossy().to_string(),
                caption: Some("CBC 21 Oct".to_string()),
                display_label: None,
            },
        )
        .expect("attach pdf");

    assert_eq!(resp.mime, "application/pdf", "mime detected");
    assert_eq!(resp.sha256, sha256_hex(PDF), "sha256 of the plaintext");
    assert_eq!(resp.original_name, "lab-report.pdf", "original name kept");
    assert_eq!(
        resp.byte_size,
        PDF.len() as i64,
        "byte size = plaintext len"
    );

    // The DB row exists for the visit.
    assert_eq!(
        attachment_row_count(&w.pool, &visit_id),
        1,
        "one row inserted"
    );

    // The on-disk blob is encrypted (NFR-021): find files/<blob_id>.bin and
    // assert it is NOT the plaintext and does not contain it.
    let blob_id = blob_id_of(&w.pool, &resp.attachment_id).expect("blob_id row");
    let blob_path = w.data_dir.join("files").join(format!("{blob_id}.bin"));
    let on_disk = std::fs::read(&blob_path).expect("read blob file");
    assert_ne!(
        on_disk.as_slice(),
        PDF,
        "blob on disk must not be plaintext"
    );
    assert!(
        !on_disk.windows(PDF.len()).any(|win| win == PDF),
        "plaintext must not appear in the on-disk ciphertext"
    );
}

/// A2: attaching a PNG stores it encrypted and inserts a row with image/png.
#[test]
fn pat009_attach_png_stores_encrypted_and_inserts_row() {
    let w = world();
    let (_p, visit_id) = seed_patient_and_visit(&w.pool);
    let (_srcdir, src) = source_file(PNG, "ultrasound.png");
    let clock = svc_clock();
    let svc = AttachmentService::new(&clock);

    let resp = svc
        .attach_report(
            &w.pool,
            &w.provider,
            Path::new(&w.data_dir),
            AttachReportRequest {
                visit_id,
                source_path: src.to_string_lossy().to_string(),
                caption: None,
                display_label: None,
            },
        )
        .expect("attach png");

    assert_eq!(resp.mime, "image/png");
    assert_eq!(resp.sha256, sha256_hex(PNG));
    assert_eq!(resp.byte_size, PNG.len() as i64);
}

/// A3: one attach writes EXACTLY ONE audit row and the diff carries no patient
/// free text (R-DATA-001, R-PRIV-001).
#[test]
fn pat009_attach_writes_exactly_one_audit_row_without_patient_text() {
    let w = world();
    let (_p, visit_id) = seed_patient_and_visit(&w.pool);
    let (_srcdir, src) = source_file(PDF, "very-secret-patient-report.pdf");
    let clock = svc_clock();
    let svc = AttachmentService::new(&clock);

    svc.attach_report(
        &w.pool,
        &w.provider,
        Path::new(&w.data_dir),
        AttachReportRequest {
            visit_id,
            source_path: src.to_string_lossy().to_string(),
            caption: Some("sensitive caption".to_string()),
            display_label: None,
        },
    )
    .expect("attach");

    assert_eq!(
        attachment_audit_rows(&w.pool, "create"),
        1,
        "exactly one create audit row (R-DATA-001)"
    );

    // The audit diff must not contain the original file name or the caption
    // (R-PRIV-001): scan every attachment create audit diff.
    let diffs: Vec<String> = w
        .pool
        .with_reader(|c| {
            let mut stmt = c.prepare(
                "SELECT diff_json FROM audit_log WHERE entity = 'attachment' AND action = 'create'",
            )?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
        .expect("read audit diffs");
    for d in &diffs {
        assert!(
            !d.contains("very-secret-patient-report") && !d.contains("sensitive caption"),
            "audit diff must not carry the file name or caption (R-PRIV-001): {d}"
        );
    }
}

/// A4: a non-PDF/non-image source is rejected as Validation with NO side
/// effects (no blob, no row).
#[test]
fn pat009_attach_non_pdf_non_image_is_rejected_validation() {
    let w = world();
    let (_p, visit_id) = seed_patient_and_visit(&w.pool);
    let (_srcdir, src) = source_file(b"just some synthetic text", "notes.txt");
    let clock = svc_clock();
    let svc = AttachmentService::new(&clock);

    let err = svc
        .attach_report(
            &w.pool,
            &w.provider,
            Path::new(&w.data_dir),
            AttachReportRequest {
                visit_id: visit_id.clone(),
                source_path: src.to_string_lossy().to_string(),
                caption: None,
                display_label: None,
            },
        )
        .expect_err("non-report must be rejected");
    assert!(
        matches!(err, hc_app::error::AppError::Validation(_)),
        "unsupported type maps to Validation, got {err:?}"
    );

    // No row inserted, no blob written.
    assert_eq!(
        attachment_row_count(&w.pool, &visit_id),
        0,
        "no row for a rejected file"
    );
    let files_dir = w.data_dir.join("files");
    let blob_count = std::fs::read_dir(&files_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).count())
        .unwrap_or(0);
    assert_eq!(blob_count, 0, "no blob written for a rejected file");
}

/// A5: list returns only the given visit's attachments, oldest first.
#[test]
fn pat009_list_returns_attachments_for_the_visit_only() {
    let w = world();
    let (patient_id, visit1) = seed_patient_and_visit(&w.pool);
    let visit2 =
        hc_storage::testing::insert_visit_for(&w.pool, &patient_id, "2026-10-22T08:00:00Z", None);
    let clock = svc_clock();
    let svc = AttachmentService::new(&clock);

    // Two on visit1, one on visit2.
    let (_d1, s1) = source_file(PDF, "a.pdf");
    let (_d2, s2) = source_file(PNG, "b.png");
    let (_d3, s3) = source_file(PDF, "c.pdf");
    for (src, v) in [(&s1, &visit1), (&s2, &visit1), (&s3, &visit2)] {
        svc.attach_report(
            &w.pool,
            &w.provider,
            Path::new(&w.data_dir),
            AttachReportRequest {
                visit_id: v.clone(),
                source_path: src.to_string_lossy().to_string(),
                caption: None,
                display_label: None,
            },
        )
        .expect("attach");
    }

    let list = svc
        .list_attachments(&w.pool, ListAttachmentsRequest { visit_id: visit1 })
        .expect("list visit1");
    assert_eq!(list.attachments.len(), 2, "only visit1's two attachments");
    let names: Vec<_> = list
        .attachments
        .iter()
        .map(|a| a.original_name.clone().unwrap_or_default())
        .collect();
    assert_eq!(names, vec!["a.pdf".to_string(), "b.png".to_string()]);
    assert_eq!(list.attachments[0].mime, "application/pdf");
    assert_eq!(list.attachments[1].mime, "image/png");
}

/// A6: open returns the decrypted bytes (base64) + mime (ADR 0017).
#[test]
fn pat009_open_returns_decrypted_bytes_and_mime() {
    let w = world();
    let (_p, visit_id) = seed_patient_and_visit(&w.pool);
    let (_srcdir, src) = source_file(PDF, "report.pdf");
    let clock = svc_clock();
    let svc = AttachmentService::new(&clock);

    let attached = svc
        .attach_report(
            &w.pool,
            &w.provider,
            Path::new(&w.data_dir),
            AttachReportRequest {
                visit_id,
                source_path: src.to_string_lossy().to_string(),
                caption: None,
                display_label: None,
            },
        )
        .expect("attach");

    let opened = svc
        .open_attachment(
            &w.pool,
            &w.provider,
            Path::new(&w.data_dir),
            OpenAttachmentRequest {
                attachment_id: attached.attachment_id,
            },
        )
        .expect("open");
    assert_eq!(opened.mime, "application/pdf");
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(opened.data_base64.as_bytes())
        .expect("data_base64 must be valid base64");
    assert_eq!(decoded, PDF, "decoded preview bytes == original plaintext");
}

/// A7: delete removes the row AND the blob and writes exactly one audit row.
#[test]
fn pat009_delete_removes_row_and_blob_and_writes_one_audit_row() {
    let w = world();
    let (_p, visit_id) = seed_patient_and_visit(&w.pool);
    let (_srcdir, src) = source_file(PNG, "scan.png");
    let clock = svc_clock();
    let svc = AttachmentService::new(&clock);

    let attached = svc
        .attach_report(
            &w.pool,
            &w.provider,
            Path::new(&w.data_dir),
            AttachReportRequest {
                visit_id: visit_id.clone(),
                source_path: src.to_string_lossy().to_string(),
                caption: None,
                display_label: None,
            },
        )
        .expect("attach");
    let blob_id = blob_id_of(&w.pool, &attached.attachment_id).expect("blob_id");
    let blob_path = w.data_dir.join("files").join(format!("{blob_id}.bin"));
    assert!(blob_path.exists(), "blob exists after attach");

    let resp = svc
        .delete_attachment(
            &w.pool,
            &w.provider,
            Path::new(&w.data_dir),
            DeleteAttachmentRequest {
                attachment_id: attached.attachment_id.clone(),
            },
        )
        .expect("delete");
    assert!(resp.ok, "delete ok");

    assert_eq!(
        attachment_row_count(&w.pool, &visit_id),
        0,
        "row gone after delete"
    );
    assert!(!blob_path.exists(), "blob file removed after delete");
    assert_eq!(
        attachment_audit_rows(&w.pool, "delete"),
        1,
        "exactly one delete audit row (R-DATA-001)"
    );

    // Opening the deleted attachment is NotFound.
    let err = svc
        .open_attachment(
            &w.pool,
            &w.provider,
            Path::new(&w.data_dir),
            OpenAttachmentRequest {
                attachment_id: attached.attachment_id,
            },
        )
        .expect_err("open after delete must fail");
    assert!(
        matches!(err, hc_app::error::AppError::NotFound),
        "got {err:?}"
    );
}

/// A8: attaching to an unknown visit is NotFound (no blob, no row).
#[test]
fn pat009_attach_to_missing_visit_is_not_found() {
    let w = world();
    let (_srcdir, src) = source_file(PDF, "report.pdf");
    let clock = svc_clock();
    let svc = AttachmentService::new(&clock);

    let err = svc
        .attach_report(
            &w.pool,
            &w.provider,
            Path::new(&w.data_dir),
            AttachReportRequest {
                visit_id: "0192f0c0-0000-7000-8000-000000000000".to_string(),
                source_path: src.to_string_lossy().to_string(),
                caption: None,
                display_label: None,
            },
        )
        .expect_err("unknown visit must be NotFound");
    assert!(
        matches!(err, hc_app::error::AppError::NotFound),
        "got {err:?}"
    );

    let files_dir = w.data_dir.join("files");
    let blob_count = std::fs::read_dir(&files_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).count())
        .unwrap_or(0);
    assert_eq!(blob_count, 0, "no blob for an unknown visit");
}
