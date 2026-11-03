//! HC-MVP1-M3vis — next follow-up scheduled from the CASE screen reaches the
//! Today screen (VIS-004 / VIS-005, R-DATA-001).
//!
//! The existing `visit_service_test.rs` checks `set_next_followup` writes both
//! columns, and checks `today_overview` against rows SEEDED by a test helper.
//! Neither proves the real end-to-end path the doctor now uses from the case
//! header: open a visit through the use case -> `set_next_followup` -> Today
//! lists the patient (due today / overdue) -> Clear removes them, with exactly
//! one audit row per write. These tests drive only the public `VisitService`.
//!
//! CUT: `hc_app::visit::VisitService`. Fakes (dependencies only, R-TEST-002):
//! a local `FakeClock` and the `hc_storage::testing` temp DB + synthetic
//! patient seed. Synthetic names only (R-TEST-004).

use hc_app::clock::Clock;
use hc_app::visit::{
    CaseAutosaveRequest, OpenOrCreateRequest, SetNextFollowupRequest, TodayOverviewRequest,
    VisitService,
};
use hc_storage::testing::{seed_patient, temp_db};
use hc_storage::Pool;

/// Deterministic clock (dependency fake, R-TEST-006).
struct FakeClock {
    now: String,
}
impl Clock for FakeClock {
    fn now_rfc3339(&self) -> String {
        self.now.clone()
    }
}

const NOW: &str = "2026-11-03T09:00:00Z";
const TODAY: &str = "2026-11-03";
const YESTERDAY: &str = "2026-11-02";

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

fn patient_next_followup(pool: &Pool, patient_id: &str) -> Option<String> {
    pool.with_reader(|c| {
        Ok(c.query_row(
            "SELECT next_followup_on FROM patient WHERE id = ?1",
            [patient_id],
            |r| r.get(0),
        )?)
    })
    .expect("read patient.next_followup_on")
}

fn open(svc: &VisitService<'_>, pool: &Pool, patient_id: &str, visit_type: &str) -> String {
    svc.open_or_create(
        pool,
        OpenOrCreateRequest {
            patient_id: patient_id.to_string(),
            visit_type: visit_type.to_string(),
        },
    )
    .expect("open_or_create")
    .visit_id
}

fn set(svc: &VisitService<'_>, pool: &Pool, visit_id: &str, on: Option<&str>) {
    svc.set_next_followup(
        pool,
        SetNextFollowupRequest {
            visit_id: visit_id.to_string(),
            next_followup_on: on.map(str::to_string),
        },
    )
    .expect("set_next_followup");
}

fn ids(rows: &[hc_app::visit::TodayPatientRow]) -> Vec<String> {
    rows.iter().map(|r| r.patient_id.clone()).collect()
}

/// Bug caught: the case-header "7 days / custom" control writes a date that
/// never reaches Today (patient column not updated, or due/overdue mis-bucketed)
/// so the doctor's scheduled patient silently vanishes from the Due list.
#[test]
fn case_screen_followup_date_lists_patient_due_today_then_overdue_then_cleared() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000901", "Test Patient 901");
    let clock = FakeClock {
        now: NOW.to_string(),
    };
    let svc = VisitService::new(&clock);
    let visit_id = open(&svc, &pool, &patient_id, "first");
    let today_req = || TodayOverviewRequest {
        today: TODAY.to_string(),
    };

    // Due today.
    let before = audit_rows_for(&pool, &visit_id);
    set(&svc, &pool, &visit_id, Some(TODAY));
    assert_eq!(
        audit_rows_for(&pool, &visit_id) - before,
        1,
        "exactly one audit row per set_next_followup"
    );
    assert_eq!(
        patient_next_followup(&pool, &patient_id).as_deref(),
        Some(TODAY)
    );
    let ov = svc.today_overview(&pool, today_req()).expect("overview");
    assert_eq!(ids(&ov.due_today), vec![patient_id.clone()], "due today");
    assert!(ids(&ov.overdue).is_empty(), "not overdue when due today");

    // Overdue (date in the past relative to the test clock's today).
    set(&svc, &pool, &visit_id, Some(YESTERDAY));
    let ov = svc.today_overview(&pool, today_req()).expect("overview");
    assert!(ids(&ov.due_today).is_empty(), "no longer due today");
    assert_eq!(ids(&ov.overdue), vec![patient_id.clone()], "overdue");

    // Clear (null) removes the patient from both lists and NULLs the column.
    let before = audit_rows_for(&pool, &visit_id);
    set(&svc, &pool, &visit_id, None);
    assert_eq!(
        audit_rows_for(&pool, &visit_id) - before,
        1,
        "clear = one audit row"
    );
    assert_eq!(patient_next_followup(&pool, &patient_id), None);
    let ov = svc.today_overview(&pool, today_req()).expect("overview");
    assert!(ids(&ov.due_today).is_empty() && ids(&ov.overdue).is_empty());
}

/// Bug caught: scheduling from a FOLLOW-UP visit's case header (the common
/// path after the first consultation) writes only the follow-up visit row and
/// not the patient, so Today never shows the patient.
#[test]
fn followup_visit_header_date_reaches_today_due_list() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000902", "Test Patient 902");
    let clock = FakeClock {
        now: NOW.to_string(),
    };
    let svc = VisitService::new(&clock);
    let first = open(&svc, &pool, &patient_id, "first");
    svc.case_autosave(
        &pool,
        CaseAutosaveRequest {
            visit_id: first,
            data_json: "{}".to_string(),
            vitals_json: "{}".to_string(),
        },
    )
    .expect("save first case");
    let fu = open(&svc, &pool, &patient_id, "follow_up");

    let before = audit_rows_for(&pool, &fu);
    set(&svc, &pool, &fu, Some(TODAY));
    assert_eq!(audit_rows_for(&pool, &fu) - before, 1);

    let ov = svc
        .today_overview(
            &pool,
            TodayOverviewRequest {
                today: TODAY.to_string(),
            },
        )
        .expect("overview");
    assert_eq!(ids(&ov.due_today), vec![patient_id]);
}
