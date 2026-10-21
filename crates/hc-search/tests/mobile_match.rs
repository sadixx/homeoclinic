//! HC-MVP1-047/049 / PSR-002: mobile match on any 4+ consecutive digits,
//! ignoring +91 and spaces.
//!
//! RED before green: `search` stub returns empty; `normalize::mobile_digits`
//! stub returns "" so the stored digits are empty. Both make these fail.

use hc_search::normalize::mobile_digits;
use hc_search::query::search;
use hc_search::testing::{insert_patient, memory_search_db, TestPatient};

fn contains(page: &hc_search::query::SearchPage, id: &str) -> bool {
    page.hits.iter().any(|h| h.patient_id == id)
}

#[test]
fn psr002_matches_any_4plus_consecutive_digits() {
    let mut conn = memory_search_db();
    let id = insert_patient(
        &mut conn,
        &TestPatient {
            code: "HC-000800",
            name: "Mobile Patient",
            mobile: Some("+91 98765 43210"),
            city: Some("Mumbai"),
            last_visit_at: None,
        },
    )
    .expect("insert patient");

    // A 4-digit fragment from the middle of the mobile must match (trigram).
    let page = search(&conn, "6543", None).expect("search digits");
    assert!(
        contains(&page, &id),
        "any 4+ consecutive digits of the mobile must match (PSR-002)"
    );

    // The last 4 digits must also match.
    let last4 = search(&conn, "3210", None).expect("search last4");
    assert!(
        contains(&last4, &id),
        "last 4 mobile digits must match (PSR-002)"
    );
}

#[test]
fn psr002_ignores_plus91_and_spaces() {
    // The normalise helper strips +91 and spaces so digit matching ignores them.
    assert_eq!(
        mobile_digits("+91 98765 43210"),
        "9876543210",
        "mobile_digits must strip +91 and spaces (PSR-002)"
    );
    assert_eq!(
        mobile_digits("098765-43210"),
        "09876543210",
        "a leading 0 (not country code) is kept; only +91/spaces/punctuation removed"
    );

    // And a search by the +91-formatted string finds the patient stored under
    // the +91-formatted mobile (both normalise to the same digits).
    let mut conn = memory_search_db();
    let id = insert_patient(
        &mut conn,
        &TestPatient {
            code: "HC-000801",
            name: "Plus Patient",
            mobile: Some("9876501234"),
            city: None,
            last_visit_at: None,
        },
    )
    .expect("insert patient");
    let page = search(&conn, "+91 98765 01234", None).expect("search +91 form");
    assert!(
        contains(&page, &id),
        "searching the +91-formatted mobile must find the patient (PSR-002)"
    );
}
