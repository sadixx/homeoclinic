//! hc-perf-tester storage-layer timing harness (M1 measurable NFRs).
//!
//! Measures the parts of the NFR-001 cold-start budget (< 4 s to usable
//! screen) that live in the storage layer and are observable headless with NO
//! GUI: the SQLCipher pool open (key derivation + PRAGMA setup for 1 writer +
//! 4 readers) and the forward-only migration run (0001_init + 0002_setup).
//!
//! This is a MEASUREMENT harness, not a pass/fail product test: the full
//! NFR-001 cold-start budget and the NFR-002 patient-search / open-patient /
//! filter budgets are GUI + webview + 50k/100k-seed concerns that defer to a
//! GUI target (R2+). This file only reports the storage-layer slice so the
//! release report can state exactly what was measured here.
//!
//! Run (release profile, numbers only meaningful optimised):
//!   cargo test --release -p hc-storage --test perf_db_open -- --nocapture
//!
//! Synthetic data only (R-TEST-004); file-backed temp DBs (R-TEST-006).

use hc_storage::key::KeyProvider;
use hc_storage::pool::Pool;
use std::time::{Duration, Instant};

fn percentile(sorted: &[Duration], p: f64) -> Duration {
    if sorted.is_empty() {
        return Duration::ZERO;
    }
    let rank = (p / 100.0 * (sorted.len() as f64 - 1.0)).round() as usize;
    sorted[rank.min(sorted.len() - 1)]
}

fn report(name: &str, mut samples: Vec<Duration>, budget_note: &str) {
    samples.sort();
    let p50 = percentile(&samples, 50.0);
    let p95 = percentile(&samples, 95.0);
    let p99 = percentile(&samples, 99.0);
    let max = *samples.last().unwrap();
    let ms = |d: Duration| d.as_secs_f64() * 1000.0;
    println!(
        "PERF {name} n={} p50={:.3}ms p95={:.3}ms p99={:.3}ms max={:.3}ms :: {budget_note}",
        samples.len(),
        ms(p50),
        ms(p95),
        ms(p99),
        ms(max),
    );
}

/// Time `Pool::open` alone (SQLCipher key + PRAGMAs for 1 writer + 4 readers),
/// then `Pool::open` + full migration run, over many iterations. Each uses a
/// fresh temp-file DB so the open is a real cold on-disk open, not a cache hit.
#[test]
fn perf_pool_open_and_migrate_storage_slice() {
    const WARMUP: usize = 10;
    const ITERS: usize = 200;

    let key = hc_storage::testing::test_key();

    // Warm up: amortise bundled-sqlcipher/library first-touch costs.
    for _ in 0..WARMUP {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clinic.db");
        let pool = Pool::open(&path, &key as &dyn KeyProvider).unwrap();
        hc_storage::migrate::run(&pool).unwrap();
    }

    // (1) Pool open only.
    let mut open_samples = Vec::with_capacity(ITERS);
    for _ in 0..ITERS {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clinic.db");
        let t0 = Instant::now();
        let _pool = Pool::open(&path, &key as &dyn KeyProvider).unwrap();
        open_samples.push(t0.elapsed());
    }

    // (2) Pool open + forward-only migrations (0001_init + 0002_setup).
    let mut open_migrate_samples = Vec::with_capacity(ITERS);
    for _ in 0..ITERS {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clinic.db");
        let t0 = Instant::now();
        let pool = Pool::open(&path, &key as &dyn KeyProvider).unwrap();
        hc_storage::migrate::run(&pool).unwrap();
        open_migrate_samples.push(t0.elapsed());
    }

    // (3) Re-open an already-migrated DB (steady-state unlock path: open an
    //     existing clinic.db, migrations are a no-op/version check).
    let mut reopen_samples = Vec::with_capacity(ITERS);
    {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("clinic.db");
        {
            let pool = Pool::open(&path, &key as &dyn KeyProvider).unwrap();
            hc_storage::migrate::run(&pool).unwrap();
        }
        for _ in 0..ITERS {
            let t0 = Instant::now();
            let pool = Pool::open(&path, &key as &dyn KeyProvider).unwrap();
            hc_storage::migrate::run(&pool).unwrap();
            reopen_samples.push(t0.elapsed());
            drop(pool);
        }
    }

    report(
        "pool_open_fresh",
        open_samples,
        "SQLCipher open (1 writer + 4 readers); storage slice of NFR-001 cold-start (<4s whole app)",
    );
    report(
        "pool_open+migrate_fresh",
        open_migrate_samples,
        "first-run DB bring-up (open + 0001_init + 0002_setup); storage slice of NFR-001",
    );
    report(
        "pool_reopen_migrated",
        reopen_samples,
        "steady-state unlock re-open of an existing migrated clinic.db; storage slice of NFR-001",
    );
}
