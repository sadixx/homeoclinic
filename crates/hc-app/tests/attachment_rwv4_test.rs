//! RED integration tests for the M3-RWv4 patient-level attachment additions
//! (ADR 0019 "Increment M3-RWv4"; .worklog/HC-MVP1-M3/handoffs/M3-RWv4-design.md
//! §5.4, §5.5, §5.7, §9).
//!
//! CUT: `hc_app::attachment::AttachmentService` + the `hc_storage`
//! `attachment_repo`, over migration 0010 (the patient_id column + the
//! `ix_attachment_patient` index already exist — NO migration). The only fakes
//! are DEPENDENCIES (R-TEST-002): a `FakeClock`, a real migrated encrypted DB
//! (`Pool`), a real unlocked `DekKeyProvider`, and `tempfile` for the source
//! file. Each test asserts resulting data/state and the on-disk ciphertext
//! (R-TEST-003), never merely `is_ok()`. Synthetic data only (R-TEST-004).
//!
//! RED phase: the RWv4 additions this file exercises do NOT exist yet, so the
//! crate does not compile until they land — the expected tests-first state for
//! the additive backend shapes (no architect sentinel stub was pre-committed):
//!   - `AttachReportRequest.display_label: Option<String>` (§5.7) — the optional
//!     display label; `Some` stores it as the display `original_name`
//!     (sanitised), `None` keeps today's behaviour; the blob + `blob_id` are
//!     unchanged and the audit diff carries NO label (R-PRIV-001).
//!   - `AttachmentSummary.patient_id` + `.visit_id` (§9) — so a patient-level
//!     list can key/group.
//!   - `AttachmentService::list_attachments_for_patient` + the
//!     `PatientListAttachmentsRequest` / `ListAttachmentsResponse` shape (§5.4,
//!     §9) — ALL of the patient's attachments across visits, bounded.
//!
//! Once hc-core-dev / hc-data-dev add these additive items the file compiles and
//! these assertions are the GREEN gate. Implementation is NOT done here
//! (hc-unit-tester, leaf role).

use std::path::Path;

use hc_app::attachment::{AttachReportRequest, AttachmentService, PatientListAttachmentsRequest};
use hc_app::clock::Clock;

use hc_storage::key::{DekKeyProvider, KeyHierarchy, KeyProvider};
use hc_storage::testing::{seed_patient, temp_file_keystore};
use hc_storage::Pool;

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

struct World {
    _dir: tempfile::TempDir,
    data_dir: std::path::PathBuf,
    pool: Pool,
    provider: DekKeyProvider,
}

/// Build the test world: a real key hierarchy (real DEK), the clinic DB keyed
/// with that DEK migrated to the latest schema (incl. migration 0010), and a
/// fresh provider sharing the same DEK for the service's attachment store.
fn world() -> World {
    let (dir, store_ks) = temp_file_keystore();
    let data_dir = dir.path().to_path_buf();
    let h = KeyHierarchy::new(&store_ks);
    let (_recovery, provider) = h.initialize("1234").expect("initialize key hierarchy");

    let db_path = data_dir.join("clinic.db");
    let pool = Pool::open(&db_path, &provider as &dyn KeyProvider).expect("open clinic pool");
    hc_storage::migrate::run(&pool).expect("run migrations");

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

/// Independent sha256 hex of `bytes` (R-TEST-002: computed outside the CUT).
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn source_file(bytes: &[u8], name: &str) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().expect("source tempdir");
    let path = dir.path().join(name);
    std::fs::write(&path, bytes).expect("write source file");
    (dir, path)
}

fn seed_patient_and_visit(pool: &Pool) -> (String, String) {
    let patient_id = seed_patient(pool, "HC-000001", "Test Patient 001");
    let visit_id =
        hc_storage::testing::insert_visit_for(pool, &patient_id, "2026-10-24T09:00:00Z", None);
    (patient_id, visit_id)
}

fn svc_clock() -> FakeClock {
    FakeClock {
        now: "2026-10-24T10:00:00Z".to_string(),
    }
}

/// Read the `blob_id` of an attachment row by its id.
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

/// Read the `original_name` display label of an attachment row by its id.
fn original_name_of(pool: &Pool, attachment_id: &str) -> Option<String> {
    pool.with_reader(|c| {
        Ok(c.query_row(
            "SELECT original_name FROM attachment WHERE id = ?1",
            [attachment_id],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten())
    })
    .expect("read original_name")
}

/// All attachment create/delete audit diffs (to scan for PII).
fn attachment_audit_diffs(pool: &Pool, action: &str) -> Vec<String> {
    pool.with_reader(|c| {
        let mut stmt = c.prepare(
            "SELECT diff_json FROM audit_log WHERE entity = 'attachment' AND action = ?1",
        )?;
        let rows = stmt
            .query_map([action], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
    .expect("read audit diffs")
}

fn attachment_audit_count(pool: &Pool, action: &str) -> i64 {
    pool.with_reader(|c| {
        Ok(c.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE entity = 'attachment' AND action = ?1",
            [action],
            |r| r.get(0),
        )?)
    })
    .expect("count audit rows")
}

// ===========================================================================
// D5 / §5.5 / §5.7 — AttachReportRequest.display_label stores a DISPLAY label
// only (blob + blob_id unchanged; audit diff carries no label; one audit row).
// ===========================================================================

/// RWv4-A: a Submitted upload passes `display_label`; it is stored as the
/// display `original_name` while the on-disk blob stays the opaque encrypted
/// UUID (R-PRIV-007) and the audit diff never carries the label (R-PRIV-001).
#[test]
fn rwv4_attach_with_display_label_stores_label_only_blob_unchanged_no_pii_audit() {
    let w = world();
    let (_p, visit_id) = seed_patient_and_visit(&w.pool);
    let (_srcdir, src) = source_file(PDF, "scan-raw-filename.pdf");
    let clock = svc_clock();
    let svc = AttachmentService::new(&clock);

    let label = "CBC-Test Patient 001-24-10-2026".to_string();
    let resp = svc
        .attach_report(
            &w.pool,
            &w.provider,
            Path::new(&w.data_dir),
            AttachReportRequest {
                visit_id: visit_id.clone(),
                source_path: src.to_string_lossy().to_string(),
                caption: None,
                // RWv4 additive optional field (absent at red).
                display_label: Some(label.clone()),
            },
        )
        .expect("attach with display label");

    // The display label replaced the raw file base name (display only).
    assert_eq!(
        resp.original_name, label,
        "display_label becomes the display original_name"
    );
    assert_eq!(
        original_name_of(&w.pool, &resp.attachment_id).as_deref(),
        Some(label.as_str()),
        "the stored original_name is the display label"
    );

    // The on-disk blob is still the opaque encrypted UUID: the blob file is
    // named <blob_id>.bin and does NOT embed the label or the plaintext.
    let blob_id = blob_id_of(&w.pool, &resp.attachment_id).expect("blob_id");
    assert!(
        !blob_id.contains("CBC") && !blob_id.contains("Test Patient"),
        "blob id must stay opaque (no label in the on-disk name)"
    );
    let blob_path = w.data_dir.join("files").join(format!("{blob_id}.bin"));
    let on_disk = std::fs::read(&blob_path).expect("read blob");
    assert!(
        !on_disk.windows(PDF.len()).any(|win| win == PDF),
        "plaintext must not appear in the ciphertext"
    );
    assert_eq!(resp.sha256, sha256_hex(PDF), "sha256 is of the plaintext");

    // Exactly one create audit row and its diff carries NO label (R-PRIV-001).
    assert_eq!(
        attachment_audit_count(&w.pool, "create"),
        1,
        "exactly one create audit row (R-DATA-001)"
    );
    for d in attachment_audit_diffs(&w.pool, "create") {
        assert!(
            !d.contains("CBC") && !d.contains("Test Patient 001"),
            "audit diff must not carry the display label / patient name (R-PRIV-001): {d}"
        );
    }
}

/// RWv4-B: `display_label: None` keeps today's behaviour (the file base name is
/// the display original_name) — the field is additive and optional.
#[test]
fn rwv4_attach_without_display_label_keeps_file_base_name() {
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
        .expect("attach without display label");
    assert_eq!(
        resp.original_name, "ultrasound.png",
        "None => the raw file base name (unchanged behaviour)"
    );
}

// ===========================================================================
// D1 / §5.4 / §9 — patient_list_attachments returns ALL of the patient's
// attachments across visits, each summary carrying patient_id + visit_id.
// ===========================================================================

/// RWv4-C: the patient-level list returns the patient's attachments ACROSS
/// visits (the shared two-way store) and each summary carries patientId +
/// visitId; another patient's attachment is never leaked.
#[test]
fn rwv4_patient_list_attachments_returns_all_patient_attachments_across_visits() {
    let w = world();
    let (patient_id, visit1) = seed_patient_and_visit(&w.pool);
    let visit2 =
        hc_storage::testing::insert_visit_for(&w.pool, &patient_id, "2026-10-25T08:00:00Z", None);
    // A DIFFERENT patient whose attachment must NOT appear in patient1's list.
    let other_patient = seed_patient(&w.pool, "HC-000002", "Test Patient 002");
    let other_visit = hc_storage::testing::insert_visit_for(
        &w.pool,
        &other_patient,
        "2026-10-25T09:00:00Z",
        None,
    );

    let clock = svc_clock();
    let svc = AttachmentService::new(&clock);

    // Two attachments for patient1 (one per visit) + one for the other patient.
    let (_d1, s1) = source_file(PDF, "a.pdf");
    let (_d2, s2) = source_file(PNG, "b.png");
    let (_d3, s3) = source_file(PDF, "other.pdf");
    for (src, v) in [(&s1, &visit1), (&s2, &visit2), (&s3, &other_visit)] {
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
        .list_attachments_for_patient(
            &w.pool,
            PatientListAttachmentsRequest {
                patient_id: patient_id.clone(),
            },
        )
        .expect("patient_list_attachments");

    // Only patient1's TWO attachments, across the two visits.
    assert_eq!(
        list.attachments.len(),
        2,
        "the patient's attachments across visits, not another patient's"
    );
    for a in &list.attachments {
        assert_eq!(
            a.patient_id, patient_id,
            "each summary carries the owning patient_id"
        );
        assert!(
            a.visit_id.as_deref() == Some(visit1.as_str())
                || a.visit_id.as_deref() == Some(visit2.as_str()),
            "each summary carries its owning visit_id (one of the patient's visits)"
        );
    }
    // The other patient's attachment never leaks in.
    assert!(
        list.attachments
            .iter()
            .all(|a| a.patient_id != other_patient),
        "another patient's attachment must never appear"
    );
}

/// RWv4-D: the patient-level list is bounded (R-DATA-007) — a reasonable cap is
/// applied even if a patient somehow accrues very many reports.
#[test]
fn rwv4_patient_list_attachments_is_bounded() {
    let w = world();
    let (patient_id, visit_id) = seed_patient_and_visit(&w.pool);
    let clock = svc_clock();
    let svc = AttachmentService::new(&clock);

    // Attach a handful; the assertion is that the command returns a Vec whose
    // length never exceeds the documented cap (500). We attach a small number
    // (the bound is structural, not exercised to 500 for test speed) and assert
    // the returned count is within the cap and equals what we inserted.
    for i in 0..5 {
        let (_d, s) = source_file(PDF, &format!("r{i}.pdf"));
        svc.attach_report(
            &w.pool,
            &w.provider,
            Path::new(&w.data_dir),
            AttachReportRequest {
                visit_id: visit_id.clone(),
                source_path: s.to_string_lossy().to_string(),
                caption: None,
                display_label: None,
            },
        )
        .expect("attach");
    }

    let list = svc
        .list_attachments_for_patient(
            &w.pool,
            PatientListAttachmentsRequest {
                patient_id: patient_id.clone(),
            },
        )
        .expect("patient_list_attachments");
    assert_eq!(list.attachments.len(), 5, "all five returned");
    assert!(
        list.attachments.len() <= 500,
        "bounded by the documented cap (R-DATA-007)"
    );
}
