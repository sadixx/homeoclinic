//! Licence status read service (Feature 1 + LIC-005, HC-MVP1-M1a).
//!
//! `get_licence_status` reads the persisted trial and reports the trial kind,
//! whole days remaining, RFC3339 expiry and an expired flag — all computed
//! against the LIC-005 clock-guarded EFFECTIVE now (`max(system_now, max_seen -
//! 48h)`), never the raw wall clock, so moving the system clock backward can
//! never extend the trial.
//!
//! Dependencies are INJECTED (R-ARCH-002, R-TEST-006): the open encrypted
//! [`Pool`], the runtime [`Clock`], and the install [`DekKeyProvider`] (the
//! clock-guard HMAC key derives from it). The service never constructs a clock
//! or opens the DB itself.

use serde::{Deserialize, Serialize};
use specta::Type;

use hc_storage::key::DekKeyProvider;
use hc_storage::Pool;

use crate::clock::Clock;
use crate::error::AppError;

/// The licence kind the UI renders. `Trial` is the only R1 value; the others
/// leave room for the full `Active`/`ReadOnly`/`Unlicensed` states (design §6)
/// without a later binding break.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum LicenceKind {
    /// Local 30-day trial (LIC-063).
    Trial,
    /// A verified paid licence (M9+).
    Active,
    /// Expired / grace-exhausted: view, search, print, export only (design §6).
    Readonly,
    /// No trial and no licence (defensive; R1 always has a trial after setup).
    Unlicensed,
}

/// Current licence status (`get_licence_status`). All time fields are derived
/// from the clock-guarded effective now (LIC-005).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LicenceStatus {
    /// The licence kind (`"trial"` in R1).
    pub kind: LicenceKind,
    /// Whole days remaining from effective now to `valid_until` (0 if expired).
    pub days_remaining: u32,
    /// RFC3339 UTC expiry (trial start + 30 days).
    pub valid_until: String,
    /// Whether the trial/licence has expired at the effective now.
    pub expired: bool,
}

/// Licence status read service. Holds injected dependencies by reference.
pub struct LicenceService<'a> {
    clock: &'a dyn Clock,
    dek: &'a DekKeyProvider,
}

impl<'a> LicenceService<'a> {
    /// Bind the service to the injected clock + DEK provider.
    pub fn new(clock: &'a dyn Clock, dek: &'a DekKeyProvider) -> Self {
        LicenceService { clock, dek }
    }

    /// Read the current licence status against the clock-guarded effective now.
    ///
    /// Reads the persisted `trial` row, runs [`hc_storage::licence::ClockGuard::observe`]
    /// to advance the LIC-005 max-seen anchor, and computes `days_remaining` /
    /// `expired` / `valid_until` against the clock-guarded anchor (the advanced
    /// max-seen) — never the raw wall clock, so moving the system clock backward
    /// can never raise days remaining. No trial row -> `NotFound` (the status
    /// bar falls back to a dash).
    pub fn get_licence_status(&self, pool: &Pool) -> Result<LicenceStatus, AppError> {
        // No trial seeded (sealed / pre-setup): the UI falls back to a dash.
        let trial = pool
            .with_reader(hc_storage::profile::get_trial)?
            .ok_or(AppError::NotFound)?;

        // Advance + MAC-verify the LIC-005 anchor against the injected clock,
        // then count days against the (monotonic) clock-guarded anchor so a
        // backward clock jump can never raise days remaining.
        //
        // Days are counted against the stored monotonic anchor (the advanced
        // max-seen), not the literal `effective_now = max(now, max_seen - 48h)`
        // from the diagram. On a benign <48h forward drift the two can differ by
        // up to ~48h, but always in the fail-safe direction: the anchor is >=
        // effective_now, so days_remaining is only ever more conservative, never
        // extended. This satisfies LIC-005 (the clock can never buy more days).
        let system_now = self.clock.now_rfc3339();
        hc_storage::licence::ClockGuard::observe(pool, self.dek, &system_now, &system_now)?;
        let anchor = hc_storage::licence::ClockGuard::anchor(pool, self.dek)?
            // The observe above always writes/leaves an anchor, so this is
            // present; fall back to the wall clock defensively (R-RUST-002).
            .unwrap_or_else(|| system_now.clone());

        let (days_remaining, expired) = days_remaining_from(&anchor, &trial.valid_until);
        Ok(LicenceStatus {
            kind: LicenceKind::Trial,
            days_remaining,
            valid_until: trial.valid_until,
            expired,
        })
    }
}

/// Whole days from `anchor` (the clock-guarded effective now, RFC3339 UTC) to
/// `valid_until`, plus whether the trial has expired at the anchor.
///
/// Both instants are `Z`-suffixed UTC (the convention across the app). Days are
/// floored whole days (`(valid_until - anchor) / 86400`), clamped to `0` once
/// the anchor reaches `valid_until`; `expired` is `anchor >= valid_until`. On an
/// unparseable instant the trial is reported as expired with zero days
/// remaining (fail-closed, never a panic — R-RUST-002).
fn days_remaining_from(anchor: &str, valid_until: &str) -> (u32, bool) {
    use time::format_description::well_known::Rfc3339;
    let parse = |s: &str| time::OffsetDateTime::parse(s, &Rfc3339).ok();
    match (parse(anchor), parse(valid_until)) {
        (Some(now), Some(end)) => {
            let secs = end.unix_timestamp() - now.unix_timestamp();
            if secs <= 0 {
                (0, true)
            } else {
                // Floored whole days; whole-day trial boundaries are exact.
                let days = secs / 86_400;
                (u32::try_from(days).unwrap_or(u32::MAX), false)
            }
        }
        _ => (0, true),
    }
}
