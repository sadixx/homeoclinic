//! Injected clock seam (HC-MVP1-026/027, R-TEST-006).
//!
//! The use-case services read the wall clock ONLY through this trait so trial
//! math ("30 days remaining") and audit timestamps are deterministic under
//! test (a `FakeClock` returns a fixed instant). No service constructs a clock
//! internally (R-ARCH-002 / hc-architect DI principle).

/// Supplies the current time as an RFC3339 UTC string.
pub trait Clock: Send + Sync {
    /// The current instant, RFC3339 UTC (e.g. `"2026-10-17T12:00:00Z"`).
    fn now_rfc3339(&self) -> String;
}

/// Fixed UTC timestamp description: `YYYY-MM-DDThh:mm:ssZ`.
///
/// The `time` crate's built-in `Rfc3339` emits a numeric offset (`+00:00`) for
/// UTC; HomeoClinic stores and compares timestamps with the `Z` suffix, so we
/// use an explicit description that appends a literal `Z`. All stored instants
/// are UTC, so the literal `Z` is always correct.
const UTC_Z: &[time::format_description::FormatItem<'static>] =
    time::macros::format_description!("[year]-[month]-[day]T[hour]:[minute]:[second]Z");

/// Runtime clock: the real system wall clock.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_rfc3339(&self) -> String {
        // UTC, second precision, `Z` suffix (see `UTC_Z`). `now_utc` is
        // infallible; formatting with the fixed description cannot fail for a
        // valid instant. On the impossible error path fall back to the Unix
        // epoch (deterministic, never a panic — R-RUST-002).
        time::OffsetDateTime::now_utc()
            .format(UTC_Z)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
    }
}

/// Seconds in the 30-day local trial window (LIC-063). Trial `valid_until` is
/// `started_at + TRIAL_DURATION_SECS`.
pub const TRIAL_DURATION_SECS: i64 = 30 * 86_400;

/// Whole days in the trial window (LIC-063). A fresh trial reports this many
/// days remaining.
pub const TRIAL_DURATION_DAYS: u32 = 30;

/// Compute the trial expiry (`started` + 30 days) as an RFC3339 UTC string.
///
/// Parses the injected clock's `started` timestamp (RFC3339, `Z`-suffixed),
/// adds the fixed window and re-formats as `YYYY-MM-DDThh:mm:ssZ`.
/// Deterministic given `started` (the trial math is tested with a `FakeClock`,
/// R-TEST-006). On an unparseable input the `started` value is returned
/// unchanged so the caller never panics (R-RUST-002); valid service inputs
/// always parse.
pub fn trial_valid_until(started: &str) -> String {
    use time::format_description::well_known::Rfc3339;
    match time::OffsetDateTime::parse(started, &Rfc3339) {
        Ok(start) => {
            let expiry = start + time::Duration::seconds(TRIAL_DURATION_SECS);
            expiry.format(UTC_Z).unwrap_or_else(|_| started.to_string())
        }
        Err(_) => started.to_string(),
    }
}
