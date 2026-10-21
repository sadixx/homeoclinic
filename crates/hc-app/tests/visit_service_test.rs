//! Integration tests for the visit + case-template use-case service
//! (HC-MVP1-058/061/062/063/064/068..072, CASE-001/005/009, VIS-001..005).
//!
//! CUT: `hc_app::visit::VisitService` + the `hc_storage` case_template/visit
//! repositories + migrations 0008/0009 it drives. The only fakes are
//! DEPENDENCIES (R-TEST-002): a local `FakeClock` (R-TEST-006) and the
//! `hc_storage::testing` seams (real migrated encrypted DB, synthetic patient/
//! visit seed). Each test asserts the resulting data/state (R-TEST-003), never
//! merely `is_ok()`. Synthetic data only (R-TEST-004); names carry the req id.

use hc_app::clock::Clock;
use hc_app::visit::{
    CaseAutosaveRequest, CreateFollowupRequest, OpenOrCreateRequest, RubricSearchPrefillRequest,
    SetNextFollowupRequest, SetVisibilityRequest, SummaryRenderRequest, TodayOverviewRequest,
    VisitService,
};

use hc_storage::testing::{insert_visit_for, seed_patient, temp_db};
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

/// Count `audit_log` rows for a given entity id.
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

/// `case_visit_open_or_create` returns a visit whose templateId is the default
/// template id (test 4, VIS-001/CASE-001).
#[test]
fn open_or_create_returns_visit_with_default_template() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000001", "Test Patient 001");
    let clock = FakeClock {
        now: "2026-10-21T09:00:00Z".to_string(),
    };
    let svc = VisitService::new(&clock);

    let resp = svc
        .open_or_create(
            &pool,
            OpenOrCreateRequest {
                patient_id: patient_id.clone(),
                visit_type: "first".to_string(),
            },
        )
        .expect("open_or_create");

    assert_eq!(
        resp.template_id,
        hc_storage::case_template::CHRONIC_DETAILED_ID
    );
    assert_eq!(resp.visit_at, "2026-10-21T09:00:00Z");
    assert!(!resp.visit_id.is_empty());
}

/// `case_visit_autosave` persists data_json + vitals_json (test 5, CASE-005).
#[test]
fn case_visit_autosave_persists_data_and_vitals() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000001", "Test Patient 001");
    let clock = FakeClock {
        now: "2026-10-21T09:00:00Z".to_string(),
    };
    let svc = VisitService::new(&clock);
    let created = svc
        .open_or_create(
            &pool,
            OpenOrCreateRequest {
                patient_id,
                visit_type: "first".to_string(),
            },
        )
        .unwrap();

    let saved = svc
        .case_autosave(
            &pool,
            CaseAutosaveRequest {
                visit_id: created.visit_id.clone(),
                data_json: r#"{"provisional_diagnosis":{"dx":"Migraine"}}"#.to_string(),
                vitals_json: r#"{"weightKg":70.0,"heightCm":170.0}"#.to_string(),
            },
        )
        .expect("autosave");
    assert_eq!(saved.saved_at, "2026-10-21T09:00:00Z");

    let v = pool
        .with_reader(|c| hc_storage::visit::get_visit(c, &created.visit_id))
        .unwrap()
        .expect("visit present");
    assert!(v.data_json.unwrap().contains("Migraine"));
    // BMI recomputed into vitals_json via hc_domain::vitals::bmi (D4).
    assert!(v.vitals_json.unwrap().contains("24.2"));
}

/// `case_visit_autosave` writes exactly one audit row per autosave (test 7,
/// R-DATA-001).
#[test]
fn case_visit_autosave_writes_exactly_one_audit_row() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000001", "Test Patient 001");
    let clock = FakeClock {
        now: "2026-10-21T09:00:00Z".to_string(),
    };
    let svc = VisitService::new(&clock);
    let created = svc
        .open_or_create(
            &pool,
            OpenOrCreateRequest {
                patient_id,
                visit_type: "first".to_string(),
            },
        )
        .unwrap();
    // open_or_create wrote exactly one (create) row.
    assert_eq!(audit_rows_for(&pool, &created.visit_id), 1);

    svc.case_autosave(
        &pool,
        CaseAutosaveRequest {
            visit_id: created.visit_id.clone(),
            data_json: "{}".to_string(),
            vitals_json: "{}".to_string(),
        },
    )
    .unwrap();
    // One create + one autosave = exactly two rows for this visit.
    assert_eq!(audit_rows_for(&pool, &created.visit_id), 2);
}

/// `case_visit_autosave` refreshes `patient.last_visit_at` (test 8, D5).
#[test]
fn case_visit_autosave_updates_patient_last_visit_at() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000001", "Test Patient 001");
    let clock = FakeClock {
        now: "2026-10-21T09:00:00Z".to_string(),
    };
    let svc = VisitService::new(&clock);
    let created = svc
        .open_or_create(
            &pool,
            OpenOrCreateRequest {
                patient_id: patient_id.clone(),
                visit_type: "first".to_string(),
            },
        )
        .unwrap();
    svc.case_autosave(
        &pool,
        CaseAutosaveRequest {
            visit_id: created.visit_id,
            data_json: "{}".to_string(),
            vitals_json: "{}".to_string(),
        },
    )
    .unwrap();

    let last_visit: Option<String> = pool
        .with_reader(|c| {
            Ok(c.query_row(
                "SELECT last_visit_at FROM patient WHERE id = ?1",
                [&patient_id],
                |r| r.get(0),
            )?)
        })
        .unwrap();
    assert_eq!(last_visit.as_deref(), Some("2026-10-21T09:00:00Z"));
}

/// `visit_create_followup` pre-loads the previous visit's chief complaints
/// (test 10, VIS-002).
#[test]
fn followup_preloads_previous_complaints() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000001", "Test Patient 001");
    let clock = FakeClock {
        now: "2026-10-21T09:00:00Z".to_string(),
    };
    let svc = VisitService::new(&clock);
    let prev = svc
        .open_or_create(
            &pool,
            OpenOrCreateRequest {
                patient_id: patient_id.clone(),
                visit_type: "first".to_string(),
            },
        )
        .unwrap();
    svc.case_autosave(
        &pool,
        CaseAutosaveRequest {
            visit_id: prev.visit_id.clone(),
            data_json: r#"{"chief_complaints":[{"key":"cc1","sensation":"Throbbing headache","location":"Temporal"}]}"#.to_string(),
            vitals_json: "{}".to_string(),
        },
    )
    .unwrap();

    let followup = svc
        .create_followup(
            &pool,
            CreateFollowupRequest {
                patient_id,
                prev_visit_id: prev.visit_id,
            },
        )
        .expect("create followup");
    assert_eq!(followup.prev_complaints.len(), 1);
    let c = &followup.prev_complaints[0];
    assert_eq!(c.key, "cc1");
    assert_eq!(c.text, "Throbbing headache");
    assert_eq!(c.location, "Temporal");
}

/// `visit_set_next_followup` sets BOTH `visit.next_followup_on` AND
/// `patient.next_followup_on` in one txn (test 11, VIS-004 / D6).
#[test]
fn visit_set_next_followup_sets_next_followup_on() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000001", "Test Patient 001");
    let clock = FakeClock {
        now: "2026-10-21T09:00:00Z".to_string(),
    };
    let svc = VisitService::new(&clock);
    let created = svc
        .open_or_create(
            &pool,
            OpenOrCreateRequest {
                patient_id: patient_id.clone(),
                visit_type: "first".to_string(),
            },
        )
        .unwrap();

    svc.set_next_followup(
        &pool,
        SetNextFollowupRequest {
            visit_id: created.visit_id.clone(),
            next_followup_on: Some("2026-11-05".to_string()),
        },
    )
    .expect("set next followup");

    let visit_nf: Option<String> = pool
        .with_reader(|c| {
            Ok(c.query_row(
                "SELECT next_followup_on FROM visit WHERE id = ?1",
                [&created.visit_id],
                |r| r.get(0),
            )?)
        })
        .unwrap();
    let patient_nf: Option<String> = pool
        .with_reader(|c| {
            Ok(c.query_row(
                "SELECT next_followup_on FROM patient WHERE id = ?1",
                [&patient_id],
                |r| r.get(0),
            )?)
        })
        .unwrap();
    assert_eq!(visit_nf.as_deref(), Some("2026-11-05"));
    assert_eq!(patient_nf.as_deref(), Some("2026-11-05"));
}

/// `today_get_overview` classifies due-today vs overdue vs registered-today
/// against a fake clock (test 12, VIS-005).
#[test]
fn today_get_overview_due_today_vs_overdue_against_fake_clock() {
    let (_dir, pool) = temp_db();
    let today = "2026-10-21";

    // Patient A: follow-up due today.
    let a = seed_patient(&pool, "HC-000001", "Due Today");
    insert_visit_for(&pool, &a, "2026-10-01T09:00:00Z", Some(today));
    // Patient B: follow-up overdue (yesterday).
    let b = seed_patient(&pool, "HC-000002", "Overdue");
    insert_visit_for(&pool, &b, "2026-10-01T09:00:00Z", Some("2026-10-20"));
    // Patient C: a visit registered today, no follow-up set.
    let c = seed_patient(&pool, "HC-000003", "Registered Today");
    insert_visit_for(&pool, &c, "2026-10-21T10:00:00Z", None);

    let clock = FakeClock {
        now: "2026-10-21T12:00:00Z".to_string(),
    };
    let svc = VisitService::new(&clock);
    let overview = svc
        .today_overview(
            &pool,
            TodayOverviewRequest {
                today: today.to_string(),
            },
        )
        .expect("today overview");

    assert_eq!(overview.due_today.len(), 1, "one due-today");
    assert_eq!(overview.due_today[0].patient_id, a);
    assert_eq!(overview.overdue.len(), 1, "one overdue");
    assert_eq!(overview.overdue[0].patient_id, b);
    assert!(
        overview.registered_today.iter().any(|v| v.patient_id == c),
        "patient C's visit is registered today"
    );
    // dues honest at R3 (billing not built, R-DEL-002).
    assert_eq!(overview.due_today[0].dues_paise, 0);
}

/// `case_summary_render` returns non-empty HTML containing the case field
/// values from data_json (test 13, CASE-009).
#[test]
fn case_summary_render_returns_nonempty_html_with_case_fields() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000001", "Test Patient 001");
    let clock = FakeClock {
        now: "2026-10-21T09:00:00Z".to_string(),
    };
    let svc = VisitService::new(&clock);
    let created = svc
        .open_or_create(
            &pool,
            OpenOrCreateRequest {
                patient_id,
                visit_type: "first".to_string(),
            },
        )
        .unwrap();
    svc.case_autosave(
        &pool,
        CaseAutosaveRequest {
            visit_id: created.visit_id.clone(),
            data_json: r#"{"provisional_diagnosis":{"dx":"Psoriasis"}}"#.to_string(),
            vitals_json: "{}".to_string(),
        },
    )
    .unwrap();

    let rendered = svc
        .summary_render(
            &pool,
            SummaryRenderRequest {
                visit_id: created.visit_id,
            },
        )
        .expect("render summary");
    assert!(!rendered.html.is_empty(), "summary HTML is non-empty");
    assert!(
        rendered.html.contains("Psoriasis"),
        "summary contains the case field value from data_json (CASE-009)"
    );
}

/// `rubric_search_prefill` is flagged unavailable this slice (test 15,
/// CASE-006/R7 stub, no dead end — R-DEL-002).
#[test]
fn rubric_search_prefill_is_flagged_unavailable() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000001", "Test Patient 001");
    let clock = FakeClock {
        now: "2026-10-21T09:00:00Z".to_string(),
    };
    let svc = VisitService::new(&clock);
    let created = svc
        .open_or_create(
            &pool,
            OpenOrCreateRequest {
                patient_id,
                visit_type: "first".to_string(),
            },
        )
        .unwrap();

    let resp = svc
        .rubric_search_prefill(
            &pool,
            RubricSearchPrefillRequest {
                visit_id: created.visit_id,
                source_text: "throbbing headache worse morning".to_string(),
            },
        )
        .expect("stub returns Ok");
    assert!(
        !resp.available,
        "repertory prefill is not available until R7"
    );
}

/// `case_template_set_visibility` persists a hidden section for the doctor and
/// a visibility read reflects it; hiding then showing clears it (CASE-002).
/// Also asserts exactly one audit row per toggle (R-DATA-001). Asserts the
/// resulting stored state, not merely `is_ok()` (R-TEST-003).
#[test]
fn case_template_set_visibility_persists_hidden_section() {
    let (_dir, pool) = temp_db();
    let clock = FakeClock {
        now: "2026-10-21T09:00:00Z".to_string(),
    };
    let svc = VisitService::new(&clock);

    // Nothing hidden to start with: the read map is empty.
    let before = pool
        .with_reader(hc_storage::case_template::get_hidden_sections)
        .expect("read hidden sections");
    assert!(
        before.is_empty(),
        "no section is hidden before any toggle (CASE-002 default)"
    );

    // Hide the mental_generals section.
    let resp = svc
        .template_set_visibility(
            &pool,
            SetVisibilityRequest {
                section_key: "mental_generals".to_string(),
                hidden: true,
            },
        )
        .expect("set visibility (hide)");
    assert!(resp.ok, "set_visibility returns ok");

    // A visibility read reflects it.
    let after_hide = pool
        .with_reader(hc_storage::case_template::get_hidden_sections)
        .expect("read hidden sections after hide");
    assert_eq!(
        after_hide.get("mental_generals"),
        Some(&true),
        "mental_generals is persisted as hidden for the doctor (CASE-002)"
    );

    // Exactly one audit row was written for the setting toggle (R-DATA-001).
    let audit_count: i64 = pool
        .with_reader(|c| {
            Ok(c.query_row(
                "SELECT COUNT(*) FROM audit_log WHERE entity = 'app_setting' \
                 AND entity_id = ?1",
                [hc_storage::case_template::HIDDEN_SECTIONS_SETTING_KEY],
                |r| r.get(0),
            )?)
        })
        .expect("count audit rows");
    assert_eq!(audit_count, 1, "exactly one audit row per toggle");

    // Showing it again clears the key (default-visible, minimal stored map).
    svc.template_set_visibility(
        &pool,
        SetVisibilityRequest {
            section_key: "mental_generals".to_string(),
            hidden: false,
        },
    )
    .expect("set visibility (show)");
    let after_show = pool
        .with_reader(hc_storage::case_template::get_hidden_sections)
        .expect("read hidden sections after show");
    assert!(
        !after_show.contains_key("mental_generals"),
        "showing a section removes it from the hidden map (CASE-002)"
    );
}
