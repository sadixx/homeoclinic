//! HC-MVP1-049 / PSR-004 + R-DATA-007: keyset pagination.
//!
//! The query returns at most PAGE_LIMIT (=20) hits and a cursor; passing the
//! cursor returns the NEXT page with no repeats and no `OFFSET` scan.
//!
//! RED before green: `search` is a stub returning an empty page, so the
//! page-size and continuation assertions fail. Synthetic data only.

use hc_search::query::{search, PAGE_LIMIT};
use hc_search::testing::{insert_patient, memory_search_db, TestPatient};
use std::collections::HashSet;

#[test]
fn psr004_keyset_paging_returns_next_page_without_offset() {
    let mut conn = memory_search_db();

    // 25 patients that all match the same query token at the same rank
    // (shared surname "Kumar"), with distinct visit dates so ordering is total.
    let total = 25usize;
    let mut all_ids = Vec::with_capacity(total);
    for i in 0..total {
        let code = format!("HC-00{:04}", 1000 + i);
        let name = format!("Patient{i:02} Kumar");
        // Descending visit dates: i=0 most recent … i=24 oldest.
        let day = 28 - (i % 28);
        let last_visit = format!("2026-02-{day:02}T00:00:00Z");
        let id = insert_patient(
            &mut conn,
            &TestPatient {
                code: &code,
                name: &name,
                mobile: None,
                city: Some("Pune"),
                last_visit_at: Some(&last_visit),
            },
        )
        .expect("insert patient");
        all_ids.push(id);
    }

    // Page 1: exactly PAGE_LIMIT hits and a continuation cursor.
    let page1 = search(&conn, "kumar", None).expect("page 1");
    assert_eq!(
        page1.hits.len(),
        PAGE_LIMIT,
        "page 1 must return exactly {PAGE_LIMIT} hits"
    );
    let cursor = page1
        .next
        .clone()
        .expect("a next-page cursor when more rows remain");

    // Page 2: the remaining 5, no OFFSET — driven purely by the cursor.
    let page2 = search(&conn, "kumar", Some(&cursor)).expect("page 2");
    assert_eq!(
        page2.hits.len(),
        total - PAGE_LIMIT,
        "page 2 must return the remaining {} hits",
        total - PAGE_LIMIT
    );

    // No row repeats across pages; union covers all 25 distinct patients.
    let mut seen: HashSet<String> = HashSet::new();
    for h in page1.hits.iter().chain(page2.hits.iter()) {
        assert!(
            seen.insert(h.patient_id.clone()),
            "patient {} appeared on two pages (keyset paging must not repeat)",
            h.patient_id
        );
    }
    assert_eq!(seen.len(), total, "both pages together cover all patients");

    // Page 2 is the last page.
    assert!(
        page2.next.is_none(),
        "no cursor after the final page (result set exhausted)"
    );
}
