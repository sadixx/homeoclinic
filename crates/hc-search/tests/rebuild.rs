//! HC-MVP1-053 / PSR-013: search-index rebuild with progress.
//!
//! After the FTS shadow index is cleared, `rebuild_indexes` must reconstruct it
//! from the base `patient` rows so search works again, and report progress to
//! completion (done == total).
//!
//! RED before green: `rebuild_indexes` is a stub returning 0 without calling
//! the progress callback, and `search` returns empty — both make these fail.

use hc_search::query::search;
use hc_search::rebuild::{rebuild_indexes, RebuildProgress};
use hc_search::testing::{insert_patient, memory_search_db, TestPatient};
use std::cell::RefCell;

fn seed(conn: &mut rusqlite::Connection, n: usize) -> Vec<String> {
    let mut ids = Vec::new();
    for i in 0..n {
        let code = format!("HC-00{:04}", 2000 + i);
        let name = format!("Rebuild{i:02} Sharma");
        let id = insert_patient(
            conn,
            &TestPatient {
                code: &code,
                name: &name,
                mobile: Some("9800000000"),
                city: Some("Pune"),
                last_visit_at: None,
            },
        )
        .expect("insert patient");
        ids.push(id);
    }
    ids
}

#[test]
fn psr013_rebuild_reconstructs_indexes() {
    let mut conn = memory_search_db();
    let ids = seed(&mut conn, 5);

    // Simulate a corrupted / emptied FTS shadow index by deleting its content
    // directly (external-content FTS5 'delete-all' command).
    conn.execute_batch("INSERT INTO patient_fts(patient_fts) VALUES('delete-all');")
        .expect("clear patient_fts");
    conn.execute_batch("INSERT INTO patient_trgm(patient_trgm) VALUES('delete-all');")
        .expect("clear patient_trgm");

    // With the index cleared, search finds nothing.
    let before = search(&conn, "sharma", None).expect("search before rebuild");
    assert!(
        before.hits.is_empty(),
        "precondition: cleared index returns no hits"
    );

    // Rebuild, then search must find the patients again.
    let rebuilt = rebuild_indexes(&mut conn, |_p| {}).expect("rebuild");
    assert_eq!(rebuilt, ids.len() as u64, "rebuild must process every row");

    let after = search(&conn, "sharma", None).expect("search after rebuild");
    let found: Vec<String> = after.hits.iter().map(|h| h.patient_id.clone()).collect();
    for id in &ids {
        assert!(
            found.contains(id),
            "patient {id} must be findable after rebuild (PSR-013)"
        );
    }
}

#[test]
fn psr013_rebuild_reports_progress_to_completion() {
    let mut conn = memory_search_db();
    let n = 7usize;
    seed(&mut conn, n);

    let reports: RefCell<Vec<RebuildProgress>> = RefCell::new(Vec::new());
    let count = rebuild_indexes(&mut conn, |p| reports.borrow_mut().push(p)).expect("rebuild");
    assert_eq!(count, n as u64);

    let reports = reports.into_inner();
    assert!(
        !reports.is_empty(),
        "progress callback must fire at least once (PSR-013 progress bar)"
    );
    let last = reports
        .last()
        .copied()
        .expect("at least one progress report");
    assert_eq!(
        last.total, n as u64,
        "final progress total must equal the row count"
    );
    assert_eq!(
        last.done, last.total,
        "final progress must reach done == total (PSR-013)"
    );
    // Progress is monotonic non-decreasing.
    for w in reports.windows(2) {
        assert!(
            w[1].done >= w[0].done,
            "progress done must be non-decreasing"
        );
    }
}
