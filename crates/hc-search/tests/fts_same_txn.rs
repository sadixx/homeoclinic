//! HC-MVP1-047 / PSR-012: FTS indexes update in the same transaction.
//!
//! A patient inserted (and committed) is findable by `search` on the same
//! connection immediately — proving the sync triggers ran inside the write
//! transaction, not via a later rebuild (R-DATA-006).
//!
//! RED before green: `search` is a stub returning an empty page, so the
//! "is found" assertions fail. Synthetic data only (R-TEST-004).

use hc_search::query::search;
use hc_search::testing::{insert_patient, memory_search_db, TestPatient};

fn hit_ids(page: &hc_search::query::SearchPage) -> Vec<String> {
    page.hits.iter().map(|h| h.patient_id.clone()).collect()
}

#[test]
fn psr012_patient_inserted_in_txn_is_findable_immediately() {
    let mut conn = memory_search_db();
    let id = insert_patient(
        &mut conn,
        &TestPatient {
            code: "HC-000123",
            name: "Ramesh Kumar",
            mobile: Some("+91 98765 43210"),
            city: Some("Pune"),
            last_visit_at: Some("2026-10-01T10:00:00Z"),
        },
    )
    .expect("insert patient");

    // Immediately searchable by name prefix on the SAME connection (PSR-012).
    let page = search(&conn, "ramesh", None).expect("search");
    assert!(
        hit_ids(&page).contains(&id),
        "a just-inserted patient must be findable immediately (PSR-012)"
    );
}

#[test]
fn psr012_updated_name_is_findable_under_new_name_not_old() {
    let mut conn = memory_search_db();
    let id = insert_patient(
        &mut conn,
        &TestPatient {
            code: "HC-000200",
            name: "Sunil Verma",
            mobile: Some("9811122233"),
            city: Some("Delhi"),
            last_visit_at: None,
        },
    )
    .expect("insert patient");

    // Rename to "Anil Gupta" through a normal UPDATE; the AFTER UPDATE trigger
    // must delete the old shadow row and insert the new one, all in-txn.
    let new_norm = "anil gupta";
    let new_phon = hc_search::phonetic_key("Anil Gupta");
    conn.execute(
        "UPDATE patient SET name = ?1, name_norm = ?2, name_phonetic = ?3 WHERE id = ?4",
        rusqlite::params!["Anil Gupta", new_norm, new_phon, id],
    )
    .expect("rename patient");

    let under_new = search(&conn, "anil", None).expect("search new name");
    assert!(
        hit_ids(&under_new).contains(&id),
        "patient must be findable under the new name after update (PSR-012)"
    );

    let under_old = search(&conn, "sunil", None).expect("search old name");
    assert!(
        !hit_ids(&under_old).contains(&id),
        "patient must NOT be findable under the old name after update (stale index)"
    );
}
