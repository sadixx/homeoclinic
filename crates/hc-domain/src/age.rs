//! Pure age-from-DOB helpers (M3-RW Slice A2, ADR 0018 "patient age
//! auto-updates from DOB on read").
//!
//! Pure domain only: no IO, no async, no SQL, no wall clock (R-ARCH-002). The
//! caller injects `today` (an `YYYY-MM-DD` date string, normally derived from
//! the app [`Clock`](../../hc-app) rather than the real wall clock) so age
//! derivation is deterministic and testable at the birthday boundaries.
//!
//! Dates are `YYYY-MM-DD` calendar dates. Parsing is deliberately
//! dependency-free (no `time` crate) so `hc-domain` keeps depending on no other
//! crate; the only shape accepted is a zero-padded `YYYY-MM-DD`, which is what
//! the storage layer persists and what the app clock's date part produces.

/// A parsed calendar date (year, month 1-12, day 1-31). Internal to this
/// module; comparisons use the natural `(year, month, day)` tuple ordering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct CalDate {
    year: i64,
    month: u8,
    day: u8,
}

/// Parse a strict `YYYY-MM-DD` calendar date. Returns `None` for any shape that
/// is not exactly four digits, a dash, two digits, a dash, two digits with an
/// in-range month (1-12) and day (1-31). Fail closed (R-RUST-002): a malformed
/// value yields `None` rather than a bogus date.
fn parse_ymd(s: &str) -> Option<CalDate> {
    let bytes = s.as_bytes();
    // Exactly "YYYY-MM-DD" (10 chars) with dashes in the fixed positions.
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let digits = |slice: &str| -> Option<i64> {
        if slice.bytes().all(|b| b.is_ascii_digit()) {
            slice.parse::<i64>().ok()
        } else {
            None
        }
    };
    let year = digits(&s[0..4])?;
    let month = digits(&s[5..7])?;
    let day = digits(&s[8..10])?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    Some(CalDate {
        year,
        month: month as u8,
        day: day as u8,
    })
}

/// Completed years from `dob` to `today`, both `YYYY-MM-DD`.
///
/// Returns `None` (fail closed, R-RUST-002) when either date is unparseable or
/// when `dob` is after `today` (a future DOB is not a valid age). On and after
/// the birthday the value is the full completed-year count; the day before the
/// birthday it is one less. A 29-Feb DOB is compared on its raw `(02, 29)`
/// month/day, so in a common year the birthday boundary rolls to 01-Mar.
///
/// # Examples
/// ```
/// use hc_domain::age::age_years_from_dob;
/// assert_eq!(age_years_from_dob("1990-05-15", "2026-05-15"), Some(36));
/// assert_eq!(age_years_from_dob("1990-05-15", "2026-05-14"), Some(35));
/// assert_eq!(age_years_from_dob("bad", "2026-05-15"), None);
/// ```
pub fn age_years_from_dob(dob: &str, today: &str) -> Option<i64> {
    let dob = parse_ymd(dob)?;
    let today = parse_ymd(today)?;

    // A DOB strictly after today has no valid age (fail closed).
    if dob > today {
        return None;
    }

    let mut years = today.year - dob.year;
    // Not yet had this year's birthday -> subtract one. The 29-Feb DOB is
    // compared on its raw (month, day); in a common year (month, day) before
    // (02, 29) means the birthday has not rolled over to 01-Mar yet.
    if (today.month, today.day) < (dob.month, dob.day) {
        years -= 1;
    }
    Some(years)
}

/// Human age label for the patient header.
///
/// Prefers a present, derivable DOB (anchored to the injected `today`), falling
/// back to the stored `age_years` when DOB is absent or unparseable, and an
/// empty string when neither is known. The label is `"{n}y"`.
///
/// # Examples
/// ```
/// use hc_domain::age::age_label;
/// assert_eq!(age_label(Some("1990-05-15"), Some(5), "2026-05-15"), "36y");
/// assert_eq!(age_label(None, Some(42), "2026-05-15"), "42y");
/// assert_eq!(age_label(None, None, "2026-05-15"), "");
/// ```
pub fn age_label(dob: Option<&str>, age_years: Option<i64>, today: &str) -> String {
    if let Some(dob) = dob {
        if let Some(years) = age_years_from_dob(dob, today) {
            return format!("{years}y");
        }
    }
    match age_years {
        Some(a) => format!("{a}y"),
        None => String::new(),
    }
}
