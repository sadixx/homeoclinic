//! HC-MVP1-049 / PSR-004: ranked UNION query order.
//!
//! Ranking: exact ID or mobile > exact full name > name prefix > phonetic >
//! other fields; ties broken by most recent visit. (PSR-004, PSR-003 exact >
//! phonetic.)
//!
//! RED before green: `search` is a stub returning an empty page, so these
//! assertions fail. Synthetic data only (R-TEST-004).

use hc_search::query::{search, SearchPage};
use hc_search::testing::{insert_patient, memory_search_db, TestPatient};

/// Index (0-based) of the hit with the given patient id, or None.
fn pos_of(page: &SearchPage, id: &str) -> Option<usize> {
    page.hits.iter().position(|h| h.patient_id == id)
}

/// Rank of the hit with the given patient id.
fn rank_of(page: &SearchPage, id: &str) -> Option<i64> {
    page.hits
        .iter()
        .find(|h| h.patient_id == id)
        .map(|h| h.rank)
}

fn p<'a>(
    code: &'a str,
    name: &'a str,
    mobile: Option<&'a str>,
    last_visit: Option<&'a str>,
) -> TestPatient<'a> {
    TestPatient {
        code,
        name,
        mobile,
        city: Some("Pune"),
        last_visit_at: last_visit,
    }
}

#[test]
fn psr004_exact_id_ranks_first() {
    let mut conn = memory_search_db();
    // One patient whose CODE digits are exactly "123", and another whose NAME
    // merely contains a phonetic/prefix hit for the same query.
    let exact = insert_patient(&mut conn, &p("HC-000123", "Zzz Patient", None, None))
        .expect("insert exact id patient");
    let _other = insert_patient(&mut conn, &p("HC-999999", "Ramesh 123street", None, None))
        .expect("insert other");

    let page = search(&conn, "HC-000123", None).expect("search by id");
    assert_eq!(
        rank_of(&page, &exact),
        Some(0),
        "exact ID match must be rank 0 (PSR-004)"
    );
    assert_eq!(
        pos_of(&page, &exact),
        Some(0),
        "exact ID match must sort first"
    );
}

#[test]
fn psr004_exact_mobile_ranks_first() {
    let mut conn = memory_search_db();
    let exact = insert_patient(
        &mut conn,
        &p("HC-000300", "Some Patient", Some("9876543210"), None),
    )
    .expect("insert exact mobile patient");
    let _other = insert_patient(
        &mut conn,
        &p("HC-000301", "Another Patient", Some("9000000000"), None),
    )
    .expect("insert other");

    let page = search(&conn, "9876543210", None).expect("search by mobile");
    assert_eq!(
        rank_of(&page, &exact),
        Some(0),
        "exact full mobile match must be rank 0 (PSR-004/PSR-002)"
    );
}

#[test]
fn psr004_exact_name_beats_prefix_and_phonetic() {
    let mut conn = memory_search_db();
    let exact = insert_patient(&mut conn, &p("HC-000400", "Ramesh Kumar", None, None))
        .expect("insert exact-name patient");
    let prefix = insert_patient(&mut conn, &p("HC-000401", "Ramesh Kumaravel", None, None))
        .expect("insert prefix patient");

    // Query is the exact full name of `exact`.
    let page = search(&conn, "Ramesh Kumar", None).expect("search exact name");
    let exact_pos = pos_of(&page, &exact).expect("exact-name patient present");
    let prefix_pos = pos_of(&page, &prefix).expect("prefix patient present");
    assert!(
        exact_pos < prefix_pos,
        "exact full name must rank above a longer prefix match (PSR-004)"
    );
    assert!(
        rank_of(&page, &exact).unwrap() < rank_of(&page, &prefix).unwrap(),
        "exact-name rank bucket must be better than prefix bucket"
    );
}

#[test]
fn psr004_name_prefix_two_words_matches() {
    let mut conn = memory_search_db();
    let id = insert_patient(&mut conn, &p("HC-000500", "Ramesh Kumar", None, None))
        .expect("insert patient");

    // "ram ku" must find "Ramesh Kumar" (prefix of any word, PSR-002).
    let page = search(&conn, "ram ku", None).expect("prefix search");
    assert!(
        pos_of(&page, &id).is_some(),
        "'ram ku' must match 'Ramesh Kumar' (PSR-002 prefix of any word)"
    );
}

#[test]
fn psr004_phonetic_misspelling_matches() {
    let mut conn = memory_search_db();
    let id = insert_patient(&mut conn, &p("HC-000600", "Sharma Patient", None, None))
        .expect("insert Sharma patient");

    // "sarma" is a phonetic variant of "Sharma" (PSR-003); it must match.
    let page = search(&conn, "sarma", None).expect("phonetic search");
    assert!(
        pos_of(&page, &id).is_some(),
        "'sarma' must phonetically match 'Sharma' (PSR-003)"
    );
}

#[test]
fn psr004_ties_broken_by_most_recent_visit() {
    let mut conn = memory_search_db();
    // Two patients both matching "Kumar" by name prefix (same rank bucket);
    // the one with the more recent visit must sort first (PSR-004 tie-break).
    let older = insert_patient(
        &mut conn,
        &p(
            "HC-000700",
            "Arjun Kumar",
            None,
            Some("2025-01-01T00:00:00Z"),
        ),
    )
    .expect("insert older-visit patient");
    let recent = insert_patient(
        &mut conn,
        &p(
            "HC-000701",
            "Bharat Kumar",
            None,
            Some("2026-09-01T00:00:00Z"),
        ),
    )
    .expect("insert recent-visit patient");

    let page = search(&conn, "kumar", None).expect("search kumar");
    let recent_pos = pos_of(&page, &recent).expect("recent present");
    let older_pos = pos_of(&page, &older).expect("older present");
    assert!(
        recent_pos < older_pos,
        "within the same rank, the most recent visit must sort first (PSR-004)"
    );
}
