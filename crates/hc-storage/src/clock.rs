//! Injectable clock seam (HC-MVP1-031/034, R-TEST-006).
//!
//! Backup rotation (14/8/12 keep) and staleness (> 7 days) must be
//! deterministic in tests — no wall clock, no sleeps (R-TEST-006). Production
//! uses [`SystemClock`]; tests drive a [`FakeClock`] that advances by whole
//! days / seconds.

/// A source of the current UTC time, injected so backup rotation and staleness
/// are deterministic in tests (R-TEST-006).
pub trait Clock: Send + Sync {
    /// The current instant as an RFC3339 UTC string (matches the audit/stamp
    /// convention used across `hc-storage`).
    fn now_rfc3339(&self) -> String;
    /// The current instant as whole seconds since the Unix epoch (for
    /// day/week/month bucketing and age maths).
    fn now_unix(&self) -> i64;
}

/// Format `unix_secs` (seconds since the Unix epoch, UTC) as an RFC3339 UTC
/// string `YYYY-MM-DDTHH:MM:SSZ`.
///
/// Dependency-free: uses Howard Hinnant's `days_from_civil` inverse
/// (`civil_from_days`) so backup stamps match the `created_at`/audit RFC3339
/// convention without pulling in a date crate (R-SEC-008: no new dep). Only
/// whole-second UTC is needed for backup rotation and staleness (HC-MVP1-031/
/// 034); negative (pre-1970) instants are clamped to the epoch, which never
/// occurs with the real wall clock or the test epoch.
pub(crate) fn format_rfc3339_utc(unix_secs: i64) -> String {
    let secs = unix_secs.max(0);
    let days = secs / 86_400;
    let secs_of_day = secs % 86_400;
    let hour = secs_of_day / 3_600;
    let minute = (secs_of_day % 3_600) / 60;
    let second = secs_of_day % 60;

    // civil_from_days: days since 1970-01-01 → (year, month, day). Public-domain
    // algorithm by Howard Hinnant (http://howardhinnant.github.io/date_algorithms.html).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let day = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let month = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = if month <= 2 { y + 1 } else { y };

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Real wall-clock implementation (production).
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_rfc3339(&self) -> String {
        format_rfc3339_utc(self.now_unix())
    }
    fn now_unix(&self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }
}

/// Test clock that returns a fixed instant, advanceable by whole days/seconds
/// (behind `cfg(any(test, feature = "testing"))`, R-TEST-006).
#[cfg(any(test, feature = "testing"))]
pub struct FakeClock {
    secs: std::sync::atomic::AtomicI64,
}

#[cfg(any(test, feature = "testing"))]
impl FakeClock {
    /// A clock fixed at `secs` seconds since the Unix epoch.
    pub fn at_unix(secs: i64) -> Self {
        FakeClock {
            secs: std::sync::atomic::AtomicI64::new(secs),
        }
    }

    /// Advance the clock by `days` whole days.
    pub fn advance_days(&self, days: i64) {
        self.advance_secs(days * 86_400);
    }

    /// Advance the clock by `secs` seconds.
    pub fn advance_secs(&self, secs: i64) {
        self.secs
            .fetch_add(secs, std::sync::atomic::Ordering::SeqCst);
    }
}

#[cfg(any(test, feature = "testing"))]
impl Clock for FakeClock {
    fn now_rfc3339(&self) -> String {
        format_rfc3339_utc(self.now_unix())
    }
    fn now_unix(&self) -> i64 {
        self.secs.load(std::sync::atomic::Ordering::SeqCst)
    }
}
