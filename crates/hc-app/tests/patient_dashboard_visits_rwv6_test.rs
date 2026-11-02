//! M3-RWv6 item 9: the patient dashboard shows saved visits and the last
//! prescription (PAT-005).
//!
//! Today `PatientService::get_dashboard` returns the R2 stub: `visits` is
//! ALWAYS empty and `last_prescription` is ALWAYS `None`, so a case or
//! follow-up the doctor just saved never appears under VISITS (NEWEST FIRST)
//! and LAST PRESCRIPTION stays "No prescription yet".
//!
//! Contract under test (CUT: the real `VisitService` writes + the real
//! `PatientService::get_dashboard` read, over a real migrated encrypted DB):
//! - `visits` lists the patient's visits NEWEST FIRST with `visit_at` and the
//!   raw visit type in `kind` (`first` | `follow_up`).
//! - `patient.last_visit_at` (list column) is the newest visit instant.
//! - `last_prescription` is built from the prescription table rows (header
//!   excluded) of the NEWEST visit that has one; within that visit's
//!   `case-rich` v3 document the LAST prescription table in document order is
//!   the latest. `items_preview` carries medicine, potency and dosage. `None`
//!   when no visit has a prescription.
//!
//! `data_json` stays opaque to storage (additive read only). Fakes are
//! dependencies only (a step clock, temp file keystore, temp encrypted DB).
//! Synthetic data only.

use std::sync::Mutex;

use hc_app::clock::Clock;
use hc_app::patient::{GetDashboardRequest, PatientDashboard, PatientService};
use hc_app::visit::{CaseAutosaveRequest, OpenOrCreateRequest, VisitService};
use hc_storage::key::KeyHierarchy;
use hc_storage::keystore::FileKeystore;
use hc_storage::testing::seed_patient;
use hc_storage::Pool;
use serde_json::{json, Value};

/// A settable clock (dependency fake): each step of the scenario moves it.
struct StepClock(Mutex<String>);
impl StepClock {
    fn new(at: &str) -> Self {
        Self(Mutex::new(at.to_string()))
    }
    fn set(&self, at: &str) {
        *self.0.lock().expect("clock lock") = at.to_string();
    }
}
impl Clock for StepClock {
    fn now_rfc3339(&self) -> String {
        self.0.lock().expect("clock lock").clone()
    }
}

const TEST_PIN: &str = "2468";
const DAY1: &str = "2026-10-24T09:00:00Z";
const DAY2: &str = "2026-10-30T10:00:00Z";

struct Env {
    _ks: tempfile::TempDir,
    data_dir: tempfile::TempDir,
    keystore: FileKeystore,
    pool: Pool,
    patient_id: String,
}

fn env() -> Env {
    let ks_dir = tempfile::tempdir().expect("keystore dir");
    let data_dir = tempfile::tempdir().expect("data dir");
    let keystore = FileKeystore::open(ks_dir.path()).expect("open file keystore");
    let (_recovery, dek) = KeyHierarchy::new(&keystore)
        .initialize(TEST_PIN)
        .expect("mint DEK");
    let pool = Pool::open(&data_dir.path().join("clinic.db"), &dek).expect("open encrypted DB");
    hc_storage::migrate::run(&pool).expect("run migrations");
    let patient_id = seed_patient(&pool, "HC-000901", "Test Patient 901");
    Env {
        _ks: ks_dir,
        data_dir,
        keystore,
        pool,
        patient_id,
    }
}

// ---- case-rich v3 builders (what the UI serialises into data_json) ---------

fn para(s: &str) -> Value {
    json!({ "type": "paragraph", "content": [{ "type": "text", "text": s }] })
}

fn row(kind: &str, cells: &[&str]) -> Value {
    let cells: Vec<Value> = cells
        .iter()
        .map(|c| json!({ "type": kind, "content": [para(c)] }))
        .collect();
    json!({ "type": "tableRow", "content": cells })
}

fn entry(date: &str, kind: &str) -> Value {
    json!({
        "type": "heading",
        "attrs": { "level": 2, "hcKind": "entry", "hcEntryKind": kind,
                   "hcComplaintName": "Headache", "hcDate": date, "hcVisitId": "v" },
        "content": [{ "type": "text", "text": format!("Headache - {date}") }]
    })
}

/// `[hr, section heading, prescription table]` with the R4 placeholder flag.
fn rx_section(rows: &[[&str; 4]]) -> Vec<Value> {
    let mut content = vec![row(
        "tableHeader",
        &["Medicine", "Potency", "Dosage", "Instructions"],
    )];
    for r in rows {
        content.push(row("tableCell", r));
    }
    vec![
        json!({ "type": "horizontalRule" }),
        json!({
            "type": "heading",
            "attrs": { "level": 3, "hcKind": "section", "hcSectionNo": 1,
                       "hcSectionType": "prescription" },
            "content": [{ "type": "text", "text": "\u{2022} Prescription" }]
        }),
        json!({
            "type": "table",
            "attrs": { "hcTableType": "prescription", "hcRxPlaceholder": true },
            "content": content
        }),
    ]
}

fn case_rich(content: Vec<Value>) -> String {
    json!({
        "schema": "case-rich",
        "version": 3,
        "next_section_no": 2,
        "sections": null,
        "complaints": [
            { "id": "cc1", "title": "Headache", "next_section_no": 2,
              "doc": { "type": "doc", "content": content } }
        ],
        "text": "Headache"
    })
    .to_string()
}

fn rx_doc(date: &str, kind: &str, rows: &[[&str; 4]]) -> String {
    let mut content = vec![entry(date, kind), para("Seen today.")];
    content.extend(rx_section(rows));
    case_rich(content)
}

fn no_rx_doc(date: &str, kind: &str) -> String {
    case_rich(vec![entry(date, kind), para("Seen today, no medicine.")])
}

// ---- scenario steps ----------------------------------------------------------

/// Open (create) a visit of `visit_type` at `at` and autosave `data_json`.
fn save_visit(e: &Env, clock: &StepClock, at: &str, visit_type: &str, data_json: String) -> String {
    clock.set(at);
    let svc = VisitService::new(clock);
    let opened = svc
        .open_or_create(
            &e.pool,
            OpenOrCreateRequest {
                patient_id: e.patient_id.clone(),
                visit_type: visit_type.to_string(),
            },
        )
        .expect("open_or_create");
    svc.case_autosave(
        &e.pool,
        CaseAutosaveRequest {
            visit_id: opened.visit_id.clone(),
            data_json,
            vitals_json: "{}".to_string(),
        },
    )
    .expect("case_autosave");
    opened.visit_id
}

fn dashboard(e: &Env, clock: &StepClock) -> PatientDashboard {
    PatientService::new(&e.keystore, clock, e.data_dir.path())
        .get_dashboard(
            &e.pool,
            GetDashboardRequest {
                patient_id: e.patient_id.clone(),
            },
        )
        .expect("get_dashboard")
}

// ---- tests -------------------------------------------------------------------

/// Real bug: the doctor saves a first case and a follow-up, opens the
/// dashboard, and VISITS still says "No visits yet".
#[test]
fn pat005_dashboard_lists_saved_visits_newest_first_with_date_and_type() {
    let e = env();
    let clock = StepClock::new(DAY1);
    let first = save_visit(&e, &clock, DAY1, "first", no_rx_doc("2026-10-24", "first"));
    let follow = save_visit(
        &e,
        &clock,
        DAY2,
        "follow_up",
        no_rx_doc("2026-10-30", "follow_up"),
    );

    let dash = dashboard(&e, &clock);
    let got: Vec<(&str, &str, &str)> = dash
        .visits
        .iter()
        .map(|v| (v.visit_id.as_str(), v.visit_at.as_str(), v.kind.as_str()))
        .collect();
    assert_eq!(
        got,
        vec![
            (follow.as_str(), DAY2, "follow_up"),
            (first.as_str(), DAY1, "first"),
        ],
        "dashboard visits must be the saved visits, newest first"
    );
}

/// Real bug: the patient list "Last visit" column does not move to the
/// newest saved visit.
#[test]
fn pat005_last_visit_at_is_the_newest_saved_visit() {
    let e = env();
    let clock = StepClock::new(DAY1);
    save_visit(&e, &clock, DAY1, "first", no_rx_doc("2026-10-24", "first"));
    save_visit(
        &e,
        &clock,
        DAY2,
        "follow_up",
        no_rx_doc("2026-10-30", "follow_up"),
    );
    let row = e
        .pool
        .with_reader(|c| hc_storage::patient::get_list_row(c, &e.patient_id))
        .expect("list row read")
        .expect("patient row");
    assert_eq!(row.last_visit_at.as_deref(), Some(DAY2));
}

/// Real bug: LAST PRESCRIPTION stays empty although the newest visit
/// recorded one; or it shows an older visit's medicine.
#[test]
fn pat005_last_prescription_comes_from_the_newest_visit_with_one() {
    let e = env();
    let clock = StepClock::new(DAY1);
    save_visit(
        &e,
        &clock,
        DAY1,
        "first",
        rx_doc(
            "2026-10-24",
            "first",
            &[[
                "Arnica montana",
                "30C",
                "3 pills thrice a day",
                "before food",
            ]],
        ),
    );
    save_visit(
        &e,
        &clock,
        DAY2,
        "follow_up",
        rx_doc(
            "2026-10-30",
            "follow_up",
            &[["Bryonia alba", "200C", "4 pills twice a day", "after food"]],
        ),
    );

    let rx = dashboard(&e, &clock)
        .last_prescription
        .expect("the newest visit has a prescription, so last_prescription must be Some");
    for part in ["Bryonia alba", "200C", "4 pills twice a day"] {
        assert!(
            rx.items_preview.contains(part),
            "items_preview must carry {part:?}; got {:?}",
            rx.items_preview
        );
    }
    assert!(
        !rx.items_preview.contains("Arnica"),
        "an older visit's medicine must not show; got {:?}",
        rx.items_preview
    );
    assert!(
        !rx.items_preview.contains("Medicine"),
        "the header row is not a prescription; got {:?}",
        rx.items_preview
    );
}

/// Real bug: a follow-up WITHOUT a new prescription blanks the card although
/// the earlier visit recorded one.
#[test]
fn pat005_last_prescription_skips_a_newer_visit_without_one() {
    let e = env();
    let clock = StepClock::new(DAY1);
    save_visit(
        &e,
        &clock,
        DAY1,
        "first",
        rx_doc(
            "2026-10-24",
            "first",
            &[["Arnica montana", "30C", "3 pills thrice a day", ""]],
        ),
    );
    save_visit(
        &e,
        &clock,
        DAY2,
        "follow_up",
        no_rx_doc("2026-10-30", "follow_up"),
    );
    let rx = dashboard(&e, &clock)
        .last_prescription
        .expect("the first visit's prescription is the latest recorded one");
    for part in ["Arnica montana", "30C", "3 pills thrice a day"] {
        assert!(
            rx.items_preview.contains(part),
            "items_preview must carry {part:?}; got {:?}",
            rx.items_preview
        );
    }
}

/// Real bug: a follow-up document carries the earlier entries forward, so it
/// holds two prescription tables. The latest (last in document order) wins.
#[test]
fn pat005_last_prescription_is_the_last_table_in_the_newest_document() {
    let e = env();
    let clock = StepClock::new(DAY2);
    let mut content = vec![entry("2026-10-24", "first"), para("First visit.")];
    content.extend(rx_section(&[[
        "Arnica montana",
        "30C",
        "3 pills thrice a day",
        "",
    ]]));
    content.push(entry("2026-10-30", "follow_up"));
    content.push(para("Better."));
    content.extend(rx_section(&[[
        "Bryonia alba",
        "200C",
        "4 pills twice a day",
        "",
    ]]));
    save_visit(&e, &clock, DAY2, "first", case_rich(content));

    let rx = dashboard(&e, &clock)
        .last_prescription
        .expect("a prescription is recorded");
    assert!(
        rx.items_preview.contains("Bryonia alba"),
        "latest table wins; got {:?}",
        rx.items_preview
    );
    assert!(
        !rx.items_preview.contains("Arnica"),
        "earlier entry's prescription must not show; got {:?}",
        rx.items_preview
    );
}

/// Real bug: a fabricated card. No prescription anywhere means `None`.
#[test]
fn pat005_last_prescription_is_none_when_no_visit_has_one() {
    let e = env();
    let clock = StepClock::new(DAY1);
    save_visit(&e, &clock, DAY1, "first", no_rx_doc("2026-10-24", "first"));
    save_visit(&e, &clock, DAY2, "follow_up", "{}".to_string());
    let dash = dashboard(&e, &clock);
    assert_eq!(dash.last_prescription, None);
    assert_eq!(dash.visits.len(), 2, "both visits still listed");
}
