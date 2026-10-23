//! M3-RW Slice A2: pure age-from-DOB tests (ADR 0018 "patient age auto-updates
//! from DOB on read"). Pure domain, no IO, no wall clock — `today` is injected
//! so the boundaries are deterministic (R-TEST-006 / R-ARCH-002).
//!
//! CUT: `hc_domain::age::age_years_from_dob` and `hc_domain::age::age_label`
//! (both absent at RED). `age_years_from_dob(dob, today) -> Option<i64>` returns
//! completed years, or `None` for an unparseable / future DOB (fail closed).
//! `age_label(dob, age_years, today) -> String` prefers the DOB-derived age,
//! falls back to the stored `age_years`, else empty.

use hc_domain::age::{age_label, age_years_from_dob};

/// On the birthday (and after it) the age is the full completed-year count —
/// no off-by-one. DOB 1990-05-15 on 2026-05-15 is 36; a day later still 36.
#[test]
fn age_is_full_years_on_and_after_birthday() {
    assert_eq!(
        age_years_from_dob("1990-05-15", "2026-05-15"),
        Some(36),
        "age ticks up exactly on the birthday"
    );
    assert_eq!(
        age_years_from_dob("1990-05-15", "2026-05-16"),
        Some(36),
        "age stays the same the day after the birthday"
    );
    assert_eq!(
        age_years_from_dob("1990-05-15", "2027-01-01"),
        Some(36),
        "later in the following calendar year, before next birthday, still 36"
    );
}

/// The day before the birthday the patient is still one year younger — the
/// not-yet-had-birthday adjustment must apply. DOB 1990-05-15 on 2026-05-14 is
/// 35, not 36.
#[test]
fn age_decrements_the_day_before_birthday() {
    assert_eq!(
        age_years_from_dob("1990-05-15", "2026-05-14"),
        Some(35),
        "the day before the birthday is still the lower age"
    );
}

/// A 29-Feb DOB is handled in a common (non-leap) year without panicking: the
/// 2000-02-29 patient is 24 on 2024-02-29 (a leap year), still 23 on
/// 2024-02-28, and 24 by 2025-03-01 (common year, boundary rolled to 01-Mar).
#[test]
fn age_handles_leap_day_dob() {
    assert_eq!(
        age_years_from_dob("2000-02-29", "2024-02-29"),
        Some(24),
        "leap-day birthday in a leap year"
    );
    assert_eq!(
        age_years_from_dob("2000-02-29", "2024-02-28"),
        Some(23),
        "the day before the leap-day birthday is still the lower age"
    );
    assert_eq!(
        age_years_from_dob("2000-02-29", "2025-03-01"),
        Some(25),
        "in a common year the leap-day birthday boundary rolls to 01-Mar"
    );
}

/// A malformed or future DOB yields `None` (fail closed), never a bogus or
/// negative age that could then be rendered on the header.
#[test]
fn age_is_none_for_unparseable_or_future_dob() {
    assert_eq!(age_years_from_dob("not-a-date", "2026-05-15"), None);
    assert_eq!(age_years_from_dob("", "2026-05-15"), None);
    assert_eq!(
        age_years_from_dob("2030-01-01", "2026-05-15"),
        None,
        "a DOB in the future is not a valid age (fail closed)"
    );
}

/// The age label prefers a present DOB, falls back to the stored `age_years`
/// when DOB is absent, and is empty when neither is known.
#[test]
fn age_label_prefers_dob_then_stored_then_empty() {
    // DOB present -> derived label dominates even if a (stale) stored age is given.
    assert_eq!(
        age_label(Some("1990-05-15"), Some(5), "2026-05-15"),
        "36y",
        "a present DOB drives the label, ignoring a stale stored age"
    );
    // No DOB -> fall back to the stored age.
    assert_eq!(
        age_label(None, Some(42), "2026-05-15"),
        "42y",
        "with no DOB the stored age_years is the fallback"
    );
    // Neither known -> empty.
    assert_eq!(
        age_label(None, None, "2026-05-15"),
        "",
        "no DOB and no stored age -> empty label"
    );
}
