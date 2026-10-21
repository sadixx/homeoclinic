//! Visit storage tests (HC-MVP1-068..072, R-DATA-006/009). Exercise the real
//! migrated DB (0009 visit + visit_fts triggers) through the `testing` seams.
//! Synthetic data only (R-TEST-004, R-PRIV-001).

use hc_storage::testing::{insert_visit_for, seed_patient, temp_db};
use hc_storage::visit as repo;

/// A term in a visit's indexed text is findable via `visit_fts` immediately
/// after the write commits — the 0009 trigger syncs the shadow row in the same
/// transaction (test 6, R-DATA-006).
#[test]
fn case_visit_autosave_makes_visit_fts_findable_immediately() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000001", "Test Patient 001");
    // insert_visit_for seeds observations = "synthetic visit" into the FTS text.
    insert_visit_for(&pool, &patient_id, "2026-10-21T09:00:00Z", None);

    let hits = pool
        .with_reader(|c| repo::fts_match_count(c, "synthetic"))
        .expect("fts match count");
    assert!(
        hits >= 1,
        "the seeded visit text must be FTS-findable in-txn"
    );
}

/// Seeding a visit bumps the patient's denormalised `visit_count` and sets
/// `last_visit_at` in the write transaction (R-DATA-009, D5).
#[test]
fn insert_visit_maintains_patient_denormalised_counters() {
    let (_dir, pool) = temp_db();
    let patient_id = seed_patient(&pool, "HC-000002", "Test Patient 002");
    insert_visit_for(
        &pool,
        &patient_id,
        "2026-10-21T09:00:00Z",
        Some("2026-11-01"),
    );

    let (count, last_visit, next_followup): (i64, Option<String>, Option<String>) = pool
        .with_reader(|c| {
            Ok(c.query_row(
                "SELECT visit_count, last_visit_at, next_followup_on FROM patient WHERE id = ?1",
                [&patient_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )?)
        })
        .expect("read denormalised counters");
    assert_eq!(count, 1);
    assert_eq!(last_visit.as_deref(), Some("2026-10-21T09:00:00Z"));
    assert_eq!(next_followup.as_deref(), Some("2026-11-01"));
}
