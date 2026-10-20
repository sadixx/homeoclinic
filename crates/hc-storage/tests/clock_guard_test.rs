//! RED tests for the LIC-005 clock-rollback guard (HC-MVP1-M1a).
//!
//! CUT: `hc_storage::licence::ClockGuard` + the `licence_state` max-seen anchor
//! (`read_max_seen` / `write_max_seen` / `compute_max_seen_mac`) over the REAL
//! migrated SQLCipher pool and the REAL DEK-derived HMAC key. The only fakes
//! are DEPENDENCIES (R-TEST-002): the encrypted-file keystore
//! (`temp_file_keystore`) and the system-now STRING we feed in (a deterministic
//! stand-in for the wall clock, R-TEST-006). Synthetic data only (R-TEST-004).
//!
//! Red-first: `ClockGuard::observe` is a stub that echoes `system_now` and
//! advances nothing, `read_max_seen` always returns `None`, and
//! `compute_max_seen_mac` returns `""`. So every assertion below fails until
//! `hc-data-dev` implements the guard; each asserts the resulting
//! instant/state (R-TEST-003), not merely `is_ok()`.

use hc_storage::key::{DekKeyProvider, KeyHierarchy};
use hc_storage::licence::{self, ClockGuard};
use hc_storage::Pool;

/// Parse an RFC3339 `Z`-suffixed UTC instant to whole seconds since the epoch.
/// Deterministic helper for the assertions (no wall clock).
fn to_unix(rfc3339: &str) -> i64 {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::parse(rfc3339, &Rfc3339)
        .unwrap_or_else(|_| panic!("test instant must parse: {rfc3339}"))
        .unix_timestamp()
}

/// Build a REAL migrated, DEK-keyed pool + its `DekKeyProvider` over the
/// encrypted-file keystore (the headless-Linux fallback). The DEK is minted by
/// the real key hierarchy, so the clock-guard HMAC key is the production key
/// path, never a fake.
fn migrated_pool_with_dek() -> (tempfile::TempDir, tempfile::TempDir, Pool, DekKeyProvider) {
    let (ks_dir, keystore) = hc_storage::testing::temp_file_keystore();
    let data_dir = tempfile::tempdir().expect("data dir");
    let (_recovery, dek) = KeyHierarchy::new(&keystore)
        .initialize("1234")
        .expect("mint DEK");
    let db_path = data_dir.path().join("clinic.db");
    let pool = Pool::open(&db_path, &dek).expect("open keyed pool");
    hc_storage::migrate::run(&pool).expect("run migrations (incl. 0003 licence_state)");
    (ks_dir, data_dir, pool, dek)
}

/// LIC-005 (R-TEST-008): advancing the system clock FORWARD advances the stored
/// max-seen and the effective now tracks the real time (no penalty for honest
/// forward motion).
#[test]
fn lic005_forward_clock_advances_max_seen() {
    let (_ks, _dir, pool, dek) = migrated_pool_with_dek();

    // First observe seeds max_seen at the starting instant.
    let start = "2026-01-01T00:00:00Z";
    let eff0 = ClockGuard::observe(&pool, &dek, start, start).expect("observe start");
    assert_eq!(
        eff0, start,
        "first observe pins effective now at system now"
    );

    // Ten days later: effective now is the real (forward) time.
    let later = "2026-01-11T00:00:00Z";
    let eff1 = ClockGuard::observe(&pool, &dek, later, later).expect("observe +10d");
    assert_eq!(
        eff1, later,
        "a forward clock yields effective now == system now (LIC-005)"
    );

    // The stored max-seen advanced to the later instant and is authenticated.
    let stored = licence::read_max_seen(&pool, &dek)
        .expect("read max_seen")
        .expect("a max_seen row must exist after observe");
    assert!(
        stored.mac_ok,
        "stored max_seen MAC must verify under the DEK key"
    );
    assert_eq!(
        stored.last_seen_at, later,
        "max_seen advanced to the latest forward instant"
    );
}

/// LIC-005 (R-TEST-008): moving the clock BACK by more than 48h does NOT roll
/// the effective now back — it stays pinned at ~max_seen (within the 48h floor),
/// so the trial keeps counting and days_remaining cannot increase.
#[test]
fn lic005_backward_clock_beyond_grace_pins_to_max_seen() {
    let (_ks, _dir, pool, dek) = migrated_pool_with_dek();

    // Establish max_seen well into the trial.
    let seen = "2026-01-20T00:00:00Z";
    ClockGuard::observe(&pool, &dek, seen, seen).expect("seed max_seen");

    // Attacker winds the clock back 10 days (far beyond the 48h grace).
    let rolled_back = "2026-01-10T00:00:00Z";
    let eff = ClockGuard::observe(&pool, &dek, rolled_back, rolled_back).expect("observe rollback");

    // effective_now must be pinned to max(now, max_seen - 48h) = max_seen - 48h,
    // NOT the rolled-back system time.
    let floor = to_unix(seen) - licence::GRACE_SECS;
    assert_eq!(
        to_unix(&eff),
        floor,
        "a >48h rollback pins effective now to max_seen - 48h (LIC-005), got {eff}"
    );
    assert!(
        to_unix(&eff) > to_unix(rolled_back),
        "effective now must be LATER than the rolled-back system time, so days_remaining cannot increase"
    );

    // max_seen is monotonic: it did not regress to the rolled-back time.
    let stored = licence::read_max_seen(&pool, &dek)
        .expect("read")
        .expect("row");
    assert_eq!(
        stored.last_seen_at, seen,
        "max_seen never regresses below its previous maximum"
    );
}

/// LIC-005 (R-TEST-008): a SMALL backward drift (< 48h, e.g. NTP correction or
/// a timezone fix) is tolerated — effective now follows the (slightly earlier)
/// system time within the grace band, with no rollback penalty.
#[test]
fn lic005_small_backward_drift_within_grace_is_tolerated() {
    let (_ks, _dir, pool, dek) = migrated_pool_with_dek();

    let seen = "2026-01-20T00:00:00Z";
    ClockGuard::observe(&pool, &dek, seen, seen).expect("seed max_seen");

    // 6h backward drift — well inside the 48h grace.
    let drifted = "2026-01-19T18:00:00Z";
    let eff = ClockGuard::observe(&pool, &dek, drifted, drifted).expect("observe drift");

    assert_eq!(
        eff, drifted,
        "a <48h backward drift is tolerated: effective now == system now (LIC-005)"
    );
}

/// LIC-005 (R-TEST-008): a TAMPERED stored max-seen (its HMAC does not verify)
/// is treated as a rollback — the unauthenticated value is never trusted to
/// increase days remaining; it only ever feeds the `-48h` floor.
#[test]
fn lic005_tampered_max_seen_mac_is_treated_as_rollback() {
    let (_ks, _dir, pool, dek) = migrated_pool_with_dek();

    // Legitimately seed max_seen, then compute what a VALID tag looks like.
    let seen = "2026-01-20T00:00:00Z";
    ClockGuard::observe(&pool, &dek, seen, seen).expect("seed max_seen");
    let good_mac = licence::compute_max_seen_mac(&dek, seen);
    assert!(
        !good_mac.is_empty(),
        "a real MAC over the seeded instant must be non-empty"
    );

    // Tamper: forge a FUTURE last_seen_at directly in the row with a bogus MAC,
    // simulating an attacker editing the encrypted DB's licence_state to push
    // the trial out. Parameterised SQL (R-SEC-001).
    let forged_future = "2026-12-31T00:00:00Z";
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute(
            "UPDATE licence_state SET last_seen_at = ?1, last_seen_mac = ?2 WHERE id = ?3",
            rusqlite::params![forged_future, "deadbeef", licence::SINGLETON_ID],
        )?;
        tx.commit()?;
        Ok(())
    })
    .expect("forge tampered row");

    // read_max_seen must flag the MAC as not verifying.
    let stored = licence::read_max_seen(&pool, &dek)
        .expect("read")
        .expect("row");
    assert!(
        !stored.mac_ok,
        "a forged last_seen_at with a bad MAC must NOT verify"
    );

    // observe at the real (earlier) time must NOT adopt the forged future as
    // the trusted max-seen: effective now cannot jump to ~forged_future.
    let real_now = "2026-01-21T00:00:00Z";
    let eff = ClockGuard::observe(&pool, &dek, real_now, real_now).expect("observe after tamper");
    assert!(
        to_unix(&eff) < to_unix(forged_future),
        "a tampered (bad-MAC) max_seen must not be trusted to extend the trial; \
         effective now {eff} must stay below the forged {forged_future}"
    );
}
