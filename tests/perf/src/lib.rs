#![forbid(unsafe_code)]
//! `hc-perf` — the NFR-002 performance CI gate for HomeoClinic (HC-MVP1-057).
//!
//! Measures the four patient hot paths at the NFR-002 design baseline (50k
//! patients) and at 100k, against synthetic data produced by the real
//! `hc-seed` generator (NFR-007). Each path is run many times; the harness
//! reports p50/p95/p99/max and FAILS (non-zero exit, via the caller) when any
//! p95 budget is missed.
//!
//! What is measured (the real command paths, not toys):
//!   * `patient_search` — the ranked UNION keyset query + per-hit row
//!     enrichment, i.e. `PatientService::patient_search`. Budget: p95 < 100 ms.
//!   * `patient_get_dashboard` — demographics + family load + recent touch,
//!     i.e. `PatientService::get_dashboard`. Budget: p95 < 300 ms.
//!   * `patient_list_query` (advanced filter) — the AND-combined facet query
//!     with keyset pagination, i.e. `PatientService::list_query`. Budget:
//!     p95 < 500 ms.
//!   * Today follow-up list — VIS-005 (R3). No Today command exists at R2, so
//!     we measure the EQUIVALENT storage query: `list_query` with the
//!     `followup = "today"` facet, which bounds `next_followup_on` to today.
//!     The seed does not populate `next_followup_on` at R2, so this returns 0
//!     rows but still exercises the indexed follow-up predicate at scale. This
//!     substitution is reported honestly. Budget: p95 < 200 ms.
//!
//! The DB is opened with the SAME deterministic dev/test key the seed and E2E
//! path use (`hc_storage::key::DevKeyProvider::new_test`, via
//! `hc_seed::generate_and_open`). No production key, no network, no shell.

use std::path::Path;
use std::time::{Duration, Instant};

use hc_app::patient::{
    GetDashboardRequest, ListQueryRequest, PatientFilter, PatientService, PatientSort,
    SearchRequest, SortDir, SortField,
};
use hc_seed::{GenConfig, GenMode};
use hc_storage::keystore::FileKeystore;
use hc_storage::Pool;

use serde::Serialize;

/// Default iteration count per measured op (>= 200 per the hc-perf-tester
/// procedure). Warm-ups are run and discarded before these.
pub const DEFAULT_ITERS: usize = 300;

/// Warm-up iterations discarded before timing (prime caches / mmap).
pub const WARMUP_ITERS: usize = 20;

/// Page size requested from the paginated paths (the UI's PSR-004 "top 20").
const PAGE_LIMIT: i64 = 20;

/// Fixed clock instant for the Today-window bound and any audit timestamps the
/// measured service methods stamp. Reproducible; no wall clock (R-TEST-006
/// spirit). Chosen to sit just past the seed's reference window.
const FIXED_NOW: &str = "2026-06-01T09:00:00Z";

/// A deterministic clock returning [`FIXED_NOW`]. The dashboard/list/today
/// service methods stamp audit/recent rows with `now`; a fixed instant keeps
/// the run reproducible.
struct FixedClock;
impl hc_app::clock::Clock for FixedClock {
    fn now_rfc3339(&self) -> String {
        FIXED_NOW.to_string()
    }
}

/// One NFR-002 budget: a human name, the measured op id, and the p95 ceiling.
#[derive(Debug, Clone, Copy)]
pub struct Budget {
    /// Stable op id (also the baseline.json key).
    pub id: &'static str,
    /// Human label for the report.
    pub label: &'static str,
    /// p95 ceiling in milliseconds (a miss fails CI).
    pub p95_ms: f64,
}

/// The four NFR-002 patient-path budgets measured by this gate.
pub const BUDGETS: &[Budget] = &[
    Budget {
        id: "patient_search",
        label: "Patient search (per-keystroke ranked query)",
        p95_ms: 100.0,
    },
    Budget {
        id: "patient_get_dashboard",
        label: "Open dashboard (full visit timeline)",
        p95_ms: 300.0,
    },
    Budget {
        id: "patient_list_query",
        label: "Advanced filter query",
        p95_ms: 500.0,
    },
    Budget {
        id: "today_followup_list",
        label: "Today follow-up list (VIS-005 equivalent query)",
        p95_ms: 200.0,
    },
];

/// Latency percentiles for one measured op, in milliseconds.
#[derive(Debug, Clone, Serialize)]
pub struct Percentiles {
    /// Median.
    pub p50_ms: f64,
    /// 95th percentile — the NFR-002 budget is on this.
    pub p95_ms: f64,
    /// 99th percentile.
    pub p99_ms: f64,
    /// Worst observed.
    pub max_ms: f64,
    /// Iteration count the percentiles were computed over.
    pub iters: usize,
}

impl Percentiles {
    /// Compute percentiles from raw durations. Sorts a copy; uses
    /// nearest-rank on the sorted samples.
    pub fn from_durations(mut samples: Vec<Duration>) -> Percentiles {
        assert!(!samples.is_empty(), "percentiles need >= 1 sample");
        samples.sort();
        let n = samples.len();
        let ms = |d: Duration| d.as_secs_f64() * 1000.0;
        let at = |q: f64| -> f64 {
            // Nearest-rank: ceil(q * n) clamped to [1, n], 1-based.
            let rank = (q * n as f64).ceil() as usize;
            let idx = rank.clamp(1, n) - 1;
            ms(samples[idx])
        };
        Percentiles {
            p50_ms: at(0.50),
            p95_ms: at(0.95),
            p99_ms: at(0.99),
            max_ms: ms(samples[n - 1]),
            iters: n,
        }
    }
}

/// The measured result for one op: its budget, its percentiles, and whether it
/// passed. A representative result count is carried so a reviewer can see the
/// query actually returned rows (not a no-op).
#[derive(Debug, Clone, Serialize)]
pub struct OpResult {
    /// Op id (matches a [`Budget::id`]).
    pub id: String,
    /// Human label.
    pub label: String,
    /// p95 ceiling (ms).
    pub budget_p95_ms: f64,
    /// Measured percentiles.
    pub pct: Percentiles,
    /// Rows the representative invocation returned (sanity: query did work).
    pub result_rows: usize,
    /// True when `pct.p95_ms <= budget_p95_ms`.
    pub pass: bool,
}

/// A full run at one data size.
#[derive(Debug, Clone, Serialize)]
pub struct RunReport {
    /// Patient count seeded for this run.
    pub patients: usize,
    /// Deterministic seed used.
    pub seed: u64,
    /// On-disk DB size in bytes (clinic.db; excludes attachments — none here).
    pub db_bytes: u64,
    /// Per-op results.
    pub ops: Vec<OpResult>,
    /// True when every op passed its budget.
    pub all_pass: bool,
}

impl RunReport {
    /// DB size in mebibytes (reporting convenience).
    pub fn db_mib(&self) -> f64 {
        self.db_bytes as f64 / (1024.0 * 1024.0)
    }
}

/// Time a closure `iters` times (after `warmup` discarded runs) and return the
/// durations plus the result-row count of the last invocation.
fn measure<F>(warmup: usize, iters: usize, mut op: F) -> (Vec<Duration>, usize)
where
    F: FnMut() -> usize,
{
    for _ in 0..warmup {
        let _ = op();
    }
    let mut samples = Vec::with_capacity(iters);
    let mut last_rows = 0usize;
    for _ in 0..iters {
        let t0 = Instant::now();
        last_rows = op();
        samples.push(t0.elapsed());
    }
    (samples, last_rows)
}

/// A rotating set of realistic per-keystroke search queries so the search
/// measurement is not a single cached plan. Mixed name prefixes, a mobile-digit
/// fragment and an id fragment, matching the seed's data shapes.
const SEARCH_QUERIES: &[&str] = &[
    "ra", "ram", "sha", "shar", "ku", "kri", "pa", "pat", "sin", "9", "98", "987", "HC-0",
];

/// Build + seed a DB at `out` with `patients` rows (deterministic `seed`) via
/// the real hc-seed generator, returning the open pool keyed with the dev/test
/// key and the number of patients inserted.
pub fn seed(out: &Path, patients: usize, seed: u64) -> Result<(Pool, usize), String> {
    let cfg = GenConfig {
        mode: GenMode::Scale(patients),
        seed,
        out: out.to_path_buf(),
    };
    let (pool, generated) =
        hc_seed::generate_and_open(&cfg).map_err(|e| format!("seed failed: {e}"))?;
    Ok((pool, generated.len()))
}

/// Run the full NFR-002 measurement against an already-seeded `pool` of
/// `patients` rows. `db_bytes` is the on-disk clinic.db size for the report.
///
/// Constructs the real `PatientService` (the Tauri command backend) with a
/// `FileKeystore` under `ks_dir` (unused by the measured read paths) and a
/// fixed clock, then measures each of the four ops.
pub fn run_measurements(
    pool: &Pool,
    patients: usize,
    seed: u64,
    db_bytes: u64,
    ks_dir: &Path,
    iters: usize,
) -> Result<RunReport, String> {
    let keystore = FileKeystore::open(ks_dir).map_err(|e| format!("keystore open: {e}"))?;
    let clock = FixedClock;
    let data_dir = ks_dir; // the measured read paths never write under it.
    let svc = PatientService::new(&keystore, &clock, data_dir);

    // Pick a representative patient id to open the dashboard for: the ranked
    // search's first hit on a common prefix. This exercises the same id→row
    // path the UI uses when a doctor clicks a search result.
    let probe = svc
        .patient_search(
            pool,
            SearchRequest {
                query: "a".to_string(),
                limit: PAGE_LIMIT,
                cursor: None,
            },
        )
        .map_err(|e| format!("probe search failed: {e}"))?;
    let dashboard_id = probe
        .results
        .first()
        .map(|r| r.patient_id.clone())
        .ok_or("probe search returned no rows to open a dashboard for")?;

    let mut ops = Vec::with_capacity(BUDGETS.len());

    // ---- 1. patient_search (per-keystroke ranked query) ----
    {
        let mut i = 0usize;
        let (samples, rows) = measure(WARMUP_ITERS, iters, || {
            let q = SEARCH_QUERIES[i % SEARCH_QUERIES.len()];
            i += 1;
            let resp = svc
                .patient_search(
                    pool,
                    SearchRequest {
                        query: q.to_string(),
                        limit: PAGE_LIMIT,
                        cursor: None,
                    },
                )
                .expect("search op must not error");
            resp.results.len()
        });
        ops.push(op_result("patient_search", samples, rows));
    }

    // ---- 2. patient_get_dashboard ----
    {
        let (samples, rows) = measure(WARMUP_ITERS, iters, || {
            let resp = svc
                .get_dashboard(
                    pool,
                    GetDashboardRequest {
                        patient_id: dashboard_id.clone(),
                    },
                )
                .expect("dashboard op must not error");
            // Rows "returned" ~ demographics(1) + family; a stable sanity count.
            1 + resp.family.len()
        });
        ops.push(op_result("patient_get_dashboard", samples, rows));
    }

    // ---- 3. patient_list_query (advanced filter) ----
    // A realistic multi-facet AND query: age range + sex + city, sorted by
    // name. These are the R2-active facets (PSR-008); they AND together in SQL.
    {
        let filters = PatientFilter {
            age_min: Some(20),
            age_max: Some(60),
            sex: Some("F".to_string()),
            city: Some("Pune".to_string()),
            ..Default::default()
        };
        let (samples, rows) = measure(WARMUP_ITERS, iters, || {
            let resp = svc
                .list_query(
                    pool,
                    ListQueryRequest {
                        filters: filters.clone(),
                        sort: PatientSort {
                            field: SortField::Name,
                            dir: SortDir::Asc,
                        },
                        cursor: None,
                        limit: PAGE_LIMIT,
                    },
                )
                .expect("list op must not error");
            resp.rows.len()
        });
        ops.push(op_result("patient_list_query", samples, rows));
    }

    // ---- 4. Today follow-up list (VIS-005 equivalent) ----
    // No Today command at R2. Measure the equivalent storage query: list_query
    // with the `followup = "today"` facet, which bounds next_followup_on to the
    // fixed clock's date. next_followup_on is not populated at R2, so this
    // returns 0 rows but still exercises the indexed follow-up predicate at
    // scale. Honest substitution (reported as such).
    {
        let filters = PatientFilter {
            followup: Some("today".to_string()),
            ..Default::default()
        };
        let (samples, rows) = measure(WARMUP_ITERS, iters, || {
            let resp = svc
                .list_query(
                    pool,
                    ListQueryRequest {
                        filters: filters.clone(),
                        sort: PatientSort {
                            field: SortField::NextFollowup,
                            dir: SortDir::Asc,
                        },
                        cursor: None,
                        limit: PAGE_LIMIT,
                    },
                )
                .expect("today op must not error");
            resp.rows.len()
        });
        ops.push(op_result("today_followup_list", samples, rows));
    }

    let all_pass = ops.iter().all(|o| o.pass);
    Ok(RunReport {
        patients,
        seed,
        db_bytes,
        ops,
        all_pass,
    })
}

/// Assemble an [`OpResult`] from raw samples: look up the op's budget, compute
/// percentiles, decide pass/fail on p95.
///
/// An optional `HC_PERF_MAX_P95_MS` env override makes EVERY budget STRICTER
/// (clamped to the real NFR-002 ceiling — it can only tighten, never loosen, so
/// it can never let a regression through). It exists so CI can run a
/// "prove-the-gate-fails" self-test against real data: set it to a tiny value
/// and the gate must exit non-zero. Absent/invalid => the real budget applies.
fn op_result(id: &str, samples: Vec<Duration>, rows: usize) -> OpResult {
    let budget = BUDGETS
        .iter()
        .find(|b| b.id == id)
        .unwrap_or_else(|| panic!("no budget for op '{id}'"));
    op_result_with_ceiling(id, samples, rows, effective_p95_ceiling(budget.p95_ms))
}

/// Core of [`op_result`] with the gate ceiling injected (pure; unit-testable
/// without touching the process environment).
fn op_result_with_ceiling(id: &str, samples: Vec<Duration>, rows: usize, ceiling: f64) -> OpResult {
    let budget = BUDGETS
        .iter()
        .find(|b| b.id == id)
        .unwrap_or_else(|| panic!("no budget for op '{id}'"));
    let pct = Percentiles::from_durations(samples);
    let pass = pct.p95_ms <= ceiling;
    OpResult {
        id: budget.id.to_string(),
        label: budget.label.to_string(),
        budget_p95_ms: ceiling,
        pct,
        result_rows: rows,
        pass,
    }
}

/// The p95 ceiling to gate on: the real NFR-002 budget, optionally tightened by
/// `HC_PERF_MAX_P95_MS`. Reads the env, then defers to the pure
/// [`clamp_ceiling`].
fn effective_p95_ceiling(nfr_ceiling_ms: f64) -> f64 {
    let override_ms = std::env::var("HC_PERF_MAX_P95_MS")
        .ok()
        .and_then(|v| v.parse::<f64>().ok());
    clamp_ceiling(nfr_ceiling_ms, override_ms)
}

/// Pure clamp: an override can only make the gate STRICTER than NFR-002, never
/// looser (so it is safe to leave wired into CI — R-PERF-004 is never
/// weakened). A `None` or non-positive override leaves the NFR ceiling intact.
fn clamp_ceiling(nfr_ceiling_ms: f64, override_ms: Option<f64>) -> f64 {
    match override_ms {
        Some(v) if v > 0.0 => nfr_ceiling_ms.min(v),
        _ => nfr_ceiling_ms,
    }
}

/// Render a run report as a Markdown table block for the perf-report / logs.
pub fn render_markdown(report: &RunReport) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "### {} patients (seed {}), DB {:.1} MiB ({} bytes, excl. attachments)\n\n",
        report.patients,
        report.seed,
        report.db_mib(),
        report.db_bytes,
    ));
    s.push_str("| Op | p50 ms | p95 ms | p99 ms | max ms | budget p95 | rows | result |\n");
    s.push_str("|---|---|---|---|---|---|---|---|\n");
    for o in &report.ops {
        s.push_str(&format!(
            "| {} | {:.2} | {:.2} | {:.2} | {:.2} | < {:.0} ms | {} | {} |\n",
            o.label,
            o.pct.p50_ms,
            o.pct.p95_ms,
            o.pct.p99_ms,
            o.pct.max_ms,
            o.budget_p95_ms,
            o.result_rows,
            if o.pass { "PASS" } else { "FAIL" },
        ));
    }
    s.push_str(&format!(
        "\n**Verdict: {}**\n",
        if report.all_pass {
            "PASS"
        } else {
            "FAIL (a budget was missed)"
        }
    ));
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles_nearest_rank_is_monotonic_and_bounded() {
        let samples: Vec<Duration> = (1..=100).map(Duration::from_millis).collect();
        let p = Percentiles::from_durations(samples);
        assert!(p.p50_ms <= p.p95_ms, "p50 <= p95");
        assert!(p.p95_ms <= p.p99_ms, "p95 <= p99");
        assert!(p.p99_ms <= p.max_ms, "p99 <= max");
        assert_eq!(p.max_ms, 100.0, "max is the worst sample");
        assert_eq!(p.iters, 100);
        // p95 of 1..=100 (nearest-rank) is the 95th sample = 95 ms.
        assert_eq!(p.p95_ms, 95.0);
    }

    #[test]
    fn op_result_fails_when_p95_exceeds_budget() {
        // 400 ms samples against the 100 ms search budget must FAIL. The
        // nested-thread guard keeps this deterministic regardless of any env
        // override set by the override test running in parallel.
        let samples: Vec<Duration> = std::iter::repeat_n(Duration::from_millis(400), 50).collect();
        let r = op_result_with_ceiling("patient_search", samples, 20, 100.0);
        assert!(!r.pass, "p95 400ms must miss the 100ms search budget");
        assert_eq!(r.budget_p95_ms, 100.0);
    }

    #[test]
    fn op_result_passes_when_p95_within_budget() {
        let samples: Vec<Duration> = std::iter::repeat_n(Duration::from_millis(5), 50).collect();
        let r = op_result_with_ceiling("patient_list_query", samples, 20, 500.0);
        assert!(r.pass, "5ms p95 is well within the 500ms filter budget");
    }

    #[test]
    fn every_budget_has_a_stable_id_and_ceiling() {
        for b in BUDGETS {
            assert!(!b.id.is_empty());
            assert!(b.p95_ms > 0.0);
        }
        // The four NFR-002 patient paths.
        assert_eq!(BUDGETS.len(), 4);
    }

    #[test]
    fn budget_override_can_only_tighten_never_loosen() {
        // Pure clamp (no env): a stricter value wins, a looser value is ignored.
        assert_eq!(clamp_ceiling(100.0, Some(5.0)), 5.0, "override tightens");
        assert_eq!(
            clamp_ceiling(100.0, Some(100_000.0)),
            100.0,
            "a looser override can never weaken the gate"
        );
        assert_eq!(
            clamp_ceiling(100.0, None),
            100.0,
            "no override => NFR ceiling"
        );
        assert_eq!(
            clamp_ceiling(100.0, Some(-1.0)),
            100.0,
            "a non-positive override is ignored"
        );
    }
}
