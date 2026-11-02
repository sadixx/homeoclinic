//! M3-RW Slice A4 + A5: read-side helpers for the case/follow-up header and the
//! first-case gating signal (ADR 0018 cross-cutting "next-follow-up display" and
//! "first-case gating").
//!
//! CUT: `hc_app::visit::VisitService` over the real migrated `hc_storage` DB.
//! - A4: `case_visit_open_or_create` and `visit_create_followup` responses gain
//!   an additive `next_followup_on` so the header can show the scheduled date.
//! - A5: a new `has_saved_first_case(pool, patient_id) -> bool` read tells the
//!   UI whether a non-deleted `first` visit exists, so New-visit/first-case can
//!   be greyed out after the first saved case.
//!
//! The only fakes are dependencies (R-TEST-002): a `FakeClock` (R-TEST-006) and
//! the `hc_storage::testing` seams (real encrypted migrated DB, synthetic
//! patient/visit seed). Synthetic data only (R-TEST-004). RED until A4/A5 land.

use hc_app::clock::Clock;
use hc_app::visit::{
    CreateFollowupRequest, OpenOrCreateRequest, SetNextFollowupRequest, VisitService,
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

/// Soft-delete a visit by stamping `deleted_at` (test setup on the dependency
/// DB; mirrors the soft-delete the real delete path writes).
fn soft_delete_visit(pool: &Pool, visit_id: &str) {
    pool.with_writer(|c| {
        c.execute(
            "UPDATE visit SET deleted_at = ?2 WHERE id = ?1",
            [visit_id, "2026-10-22T00:00:00Z"],
        )?;
        Ok(())
    })
    .expect("soft-delete visit");
}

/// A4 (VIS-004): re-opening the same-day case visit returns the scheduled
/// `next_followup_on` on the response so the header can display it.
#[test]
fn open_or_create_carries_next_followup_on() {
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
        .expect("open_or_create");

    // Schedule a next follow-up on this visit.
    svc.set_next_followup(
        &pool,
        SetNextFollowupRequest {
            visit_id: created.visit_id.clone(),
            next_followup_on: Some("2026-11-05".to_string()),
        },
    )
    .expect("set next followup");

    // Re-opening the same-day visit must surface the scheduled date.
    let reopened = svc
        .open_or_create(
            &pool,
            OpenOrCreateRequest {
                patient_id,
                visit_type: "first".to_string(),
            },
        )
        .expect("reopen");
    assert_eq!(
        reopened.next_followup_on.as_deref(),
        Some("2026-11-05"),
        "the reopened case read carries next_followup_on for the header (A4)"
    );
}

/// A4 (VIS-004): opening a follow-up surfaces the previously scheduled
/// `next_followup_on` (from the prior visit) for the header.
#[test]
fn create_followup_carries_prev_next_followup_on() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000001", "Test Patient 001");
    // Seed a prior visit that already has a next follow-up scheduled.
    let prev_id = insert_visit_for(
        &pool,
        &patient_id,
        "2026-10-01T09:00:00Z",
        Some("2026-10-21"),
    );

    let clock = FakeClock {
        now: "2026-10-21T09:00:00Z".to_string(),
    };
    let svc = VisitService::new(&clock);

    let followup = svc
        .create_followup(
            &pool,
            CreateFollowupRequest {
                patient_id,
                prev_visit_id: prev_id,
            },
        )
        .expect("create followup");

    assert_eq!(
        followup.next_followup_on.as_deref(),
        Some("2026-10-21"),
        "the follow-up read carries the prior next_followup_on for the header (A4)"
    );
}

/// A5: with no saved first case the gating signal is false.
#[test]
fn has_saved_first_case_false_before_any_saved_case() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000001", "Test Patient 001");
    let clock = FakeClock {
        now: "2026-10-21T09:00:00Z".to_string(),
    };
    let svc = VisitService::new(&clock);

    let has = svc
        .has_saved_first_case(&pool, &patient_id)
        .expect("has_saved_first_case");
    assert!(
        !has,
        "no first case saved yet -> the gating signal is false (A5)"
    );
}

/// A5: after a `first` visit is saved the gating signal is true, so the UI can
/// grey out starting another first case.
#[test]
fn has_saved_first_case_true_after_first_case_saved() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000001", "Test Patient 001");
    let clock = FakeClock {
        now: "2026-10-21T09:00:00Z".to_string(),
    };
    let svc = VisitService::new(&clock);

    // Save a first case through the real create path.
    svc.open_or_create(
        &pool,
        OpenOrCreateRequest {
            patient_id: patient_id.clone(),
            visit_type: "first".to_string(),
        },
    )
    .expect("open first case");

    let has = svc
        .has_saved_first_case(&pool, &patient_id)
        .expect("has_saved_first_case");
    assert!(has, "a saved first case -> the gating signal is true (A5)");
}

/// A5: a soft-deleted first case does NOT count — the signal is false again so
/// the UI does not wrongly keep the first case greyed out.
#[test]
fn has_saved_first_case_ignores_soft_deleted_first_case() {
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
        .expect("open first case");
    soft_delete_visit(&pool, &created.visit_id);

    let has = svc
        .has_saved_first_case(&pool, &patient_id)
        .expect("has_saved_first_case");
    assert!(!has, "a soft-deleted first case must not count (A5)");
}
