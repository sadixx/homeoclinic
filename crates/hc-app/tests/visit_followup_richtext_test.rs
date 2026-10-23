//! RED integration tests for the M3-RWv2 follow-up copy-forward of a v3
//! `case-rich` document (ADR 0019 #10; .worklog/HC-MVP1-M3/handoffs/
//! M3-RWv2-serialization-v3.md §9). CUT: `hc_app::visit::VisitService` and its
//! private `seed_followup_data_json`, reached through the PUBLIC
//! `open_or_create { visit_type: "follow_up" }` seam (the exact path
//! production uses) — never a private call.
//!
//! Red-first: today `seed_followup_data_json` only handles the v2
//! `case-journal` prior (it emits `schema:"case-journal",version:2` and knows
//! nothing of `case-rich`), so a v3 prior is NOT copied forward — these tests
//! FAIL on the assertions (the emitted `schema`/`version` are wrong and the
//! prior `doc` is dropped). After hc-core-dev adds the v3 branch they pass.
//!
//! The B7 guarantee under test: a follow-up on a v3 first case must carry the
//! WHOLE prior ProseMirror document forward (prior prose + numbered sections
//! INCLUDING family history) and APPEND a new dated entry — the reported
//! follow-up data-loss fix. One UPDATE visit + exactly ONE audit row per create
//! (R-DATA-001). Fakes are DEPENDENCIES only: `FakeClock` (R-TEST-006) + the
//! `hc_storage::testing` migrated DB. Synthetic data only (R-TEST-004).

use hc_app::clock::Clock;
use hc_app::visit::{CaseAutosaveRequest, OpenOrCreateRequest, VisitService};

use hc_storage::testing::{seed_patient, temp_db};
use hc_storage::Pool;
use serde_json::Value;

/// Deterministic clock (dependency fake, R-TEST-006).
struct FakeClock {
    now: String,
}
impl Clock for FakeClock {
    fn now_rfc3339(&self) -> String {
        self.now.clone()
    }
}

/// Count `audit_log` rows for a visit entity id.
fn audit_rows_for(pool: &Pool, entity_id: &str) -> i64 {
    pool.with_reader(|c| {
        Ok(c.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE entity = 'visit' AND entity_id = ?1",
            [entity_id],
            |r| r.get(0),
        )?)
    })
    .expect("count audit rows")
}

/// A v3 `case-rich` prior document: one complaint whose doc has a dated entry,
/// prose, and a family-history table (the section that previously got lost).
fn v3_prior_doc(visit_id: &str) -> String {
    serde_json::json!({
        "schema": "case-rich",
        "version": 3,
        "next_section_no": 2,
        "sections": Value::Null,
        "complaints": [{
            "id": "cc1",
            "title": "Headache",
            "next_section_no": 2,
            "doc": {
                "type": "doc",
                "content": [
                    { "type": "heading",
                      "attrs": { "level": 2, "hcKind": "entry", "hcDate": "2026-10-02", "hcVisitId": visit_id },
                      "content": [ { "type": "text", "text": "02-10-2026" } ] },
                    { "type": "paragraph",
                      "content": [ { "type": "text", "text": "Throbbing right temple, 3 yrs." } ] },
                    { "type": "horizontalRule" },
                    { "type": "heading",
                      "attrs": { "level": 3, "hcKind": "section", "hcSectionNo": 1, "hcSectionType": "family_history" },
                      "content": [ { "type": "text", "text": "1. Family history" } ] },
                    { "type": "table",
                      "attrs": { "hcTableType": "family_history" },
                      "content": [
                        { "type": "tableRow", "content": [
                          { "type": "tableHeader", "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Maternal" } ] } ] },
                          { "type": "tableHeader", "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Paternal" } ] } ] }
                        ] },
                        { "type": "tableRow", "content": [
                          { "type": "tableCell", "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Diabetes" } ] } ] },
                          { "type": "tableCell", "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "Hypertension" } ] } ] }
                        ] }
                      ] }
                ]
            }
        }],
        "text": "Headache\n02-10-2026\nThrobbing right temple, 3 yrs.\n1. Family history\nMaternal Paternal Diabetes Hypertension"
    })
    .to_string()
}

/// Create a saved v3 first case and then open a follow-up, returning the
/// follow-up visit's seeded `data_json` plus its visit id and the parsed value.
fn first_case_then_followup(now: &str) -> (Pool, String, Value, tempfile::TempDir) {
    let (dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000001", "Test Patient 001");
    let clock = FakeClock {
        now: now.to_string(),
    };
    let svc = VisitService::new(&clock);

    let first = svc
        .open_or_create(
            &pool,
            OpenOrCreateRequest {
                patient_id: patient_id.clone(),
                visit_type: "first".to_string(),
            },
        )
        .expect("open first");

    // Autosave a v3 case-rich document onto the first visit.
    svc.case_autosave(
        &pool,
        CaseAutosaveRequest {
            visit_id: first.visit_id.clone(),
            data_json: v3_prior_doc(&first.visit_id),
            vitals_json: "{}".to_string(),
        },
    )
    .expect("autosave first");

    let followup = svc
        .open_or_create(
            &pool,
            OpenOrCreateRequest {
                patient_id,
                visit_type: "follow_up".to_string(),
            },
        )
        .expect("open follow-up");

    let parsed: Value =
        serde_json::from_str(&followup.data_json).expect("follow-up data_json is valid JSON");
    (pool, followup.visit_id, parsed, dir)
}

/// R1: a follow-up on a v3 prior copies the prior complaint `doc` forward
/// verbatim — prior prose AND the family-history table survive — and the
/// result is a `case-rich` v3 document (the B7 follow-up data-loss fix).
#[test]
fn followup_on_v3_prior_copies_doc_forward_including_family_history() {
    let (_pool, _vid, parsed, _dir) = first_case_then_followup("2026-10-16T09:00:00Z");

    assert_eq!(
        parsed.get("schema").and_then(Value::as_str),
        Some("case-rich"),
        "follow-up on a v3 prior must stay case-rich (not downgrade to case-journal)"
    );
    assert_eq!(
        parsed.get("version").and_then(Value::as_i64),
        Some(3),
        "follow-up on a v3 prior must be version 3"
    );

    // The prior complaint doc is carried forward verbatim: its prose and the
    // family-history table cells must be present somewhere in the new document.
    let as_text = parsed.to_string();
    assert!(
        as_text.contains("Throbbing right temple"),
        "prior prose must be carried forward"
    );
    assert!(
        as_text.contains("Diabetes") && as_text.contains("Hypertension"),
        "prior family-history table (B7) must be carried forward, not dropped"
    );
    assert!(
        as_text.contains("family_history"),
        "the family-history table node must survive the copy-forward"
    );
}

/// R2: a NEW dated-entry heading (today, this follow-up's visit id) is appended
/// to each complaint's `doc.content` so the follow-up APPENDS, never replaces.
#[test]
fn followup_on_v3_prior_appends_a_new_dated_entry() {
    let (_pool, vid, parsed, _dir) = first_case_then_followup("2026-10-16T09:00:00Z");

    let complaints = parsed
        .get("complaints")
        .and_then(Value::as_array)
        .expect("complaints[] present");
    let first = complaints.first().expect("one complaint");
    let content = first
        .get("doc")
        .and_then(|d| d.get("content"))
        .and_then(Value::as_array)
        .expect("doc.content[] present");

    // Collect every entry-heading hcDate in document order.
    let entry_dates: Vec<&str> = content
        .iter()
        .filter(|n| {
            n.get("type").and_then(Value::as_str) == Some("heading")
                && n.get("attrs")
                    .and_then(|a| a.get("hcKind"))
                    .and_then(Value::as_str)
                    == Some("entry")
        })
        .filter_map(|n| {
            n.get("attrs")
                .and_then(|a| a.get("hcDate"))
                .and_then(Value::as_str)
        })
        .collect();

    assert!(
        entry_dates.contains(&"2026-10-02"),
        "the prior dated entry must still be present"
    );
    assert!(
        entry_dates.contains(&"2026-10-16"),
        "a NEW dated entry for today must be appended"
    );
    assert_eq!(
        entry_dates.last(),
        Some(&"2026-10-16"),
        "the new dated entry must be appended LAST (append, not replace)"
    );

    // The appended entry heading must carry THIS follow-up's visit id.
    let appended_visit_id = content
        .iter()
        .filter(|n| {
            n.get("attrs")
                .and_then(|a| a.get("hcKind"))
                .and_then(Value::as_str)
                == Some("entry")
        })
        .filter_map(|n| {
            n.get("attrs")
                .and_then(|a| a.get("hcVisitId"))
                .and_then(Value::as_str)
        })
        .any(|id| id == vid);
    assert!(
        appended_visit_id,
        "appended dated entry must carry this follow-up's visit id"
    );
}

/// R3: the per-complaint `next_section_no` counter is carried forward so
/// numbering continues across visits (never reset, which would reuse numbers).
#[test]
fn followup_on_v3_prior_carries_next_section_no_forward() {
    let (_pool, _vid, parsed, _dir) = first_case_then_followup("2026-10-16T09:00:00Z");

    let first = parsed
        .get("complaints")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
        .expect("one complaint");
    assert_eq!(
        first.get("next_section_no").and_then(Value::as_i64),
        Some(2),
        "prior complaint.next_section_no (2) must be carried forward, not reset to 1"
    );
}

/// R4: creating the follow-up is one write with exactly ONE audit row
/// (R-DATA-001). The follow-up visit id has a single `visit` Create audit row.
#[test]
fn followup_create_writes_exactly_one_audit_row() {
    let (pool, vid, _parsed, _dir) = first_case_then_followup("2026-10-16T09:00:00Z");
    assert_eq!(
        audit_rows_for(&pool, &vid),
        1,
        "exactly one audit row for the follow-up visit create (one-txn-one-audit)"
    );
}
