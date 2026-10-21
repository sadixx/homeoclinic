#![forbid(unsafe_code)]
//! `hc-perf` CLI — the NFR-002 performance CI gate (HC-MVP1-057).
//!
//! Usage:
//!   hc-perf --patients 50000  --seed 7 [--iters 300] [--baseline-out PATH] [--db PATH]
//!   hc-perf --patients 100000 --seed 7
//!
//! Seeds N synthetic patients via the real hc-seed generator into an encrypted
//! clinic.db (dev/test key — the SAME deterministic key the seed/E2E path uses),
//! measures the four NFR-002 patient paths, prints a Markdown table and the DB
//! size, optionally writes a baseline.json, and EXITS NON-ZERO when any p95
//! budget is missed (so CI fails the build — NFR-007). No network, no shell.

use std::path::PathBuf;
use std::process::ExitCode;

use hc_perf::{render_markdown, run_measurements, seed, RunReport, DEFAULT_ITERS};

/// Parsed CLI args.
struct Args {
    patients: usize,
    seed: u64,
    iters: usize,
    baseline_out: Option<PathBuf>,
    /// Explicit DB path; a temp dir is used when absent.
    db: Option<PathBuf>,
}

fn usage() -> &'static str {
    "usage: hc-perf --patients N --seed S [--iters N] [--baseline-out PATH] [--db PATH]"
}

fn parse_args(argv: &[String]) -> Result<Args, String> {
    let mut patients: Option<usize> = None;
    let mut seed: Option<u64> = None;
    let mut iters: usize = DEFAULT_ITERS;
    let mut baseline_out: Option<PathBuf> = None;
    let mut db: Option<PathBuf> = None;

    let mut it = argv.iter();
    while let Some(arg) = it.next() {
        let mut next = |flag: &str| -> Result<String, String> {
            it.next()
                .cloned()
                .ok_or_else(|| format!("{flag} needs a value; {}", usage()))
        };
        match arg.as_str() {
            "--patients" => {
                patients = Some(
                    next("--patients")?
                        .parse()
                        .map_err(|_| format!("--patients must be a number; {}", usage()))?,
                )
            }
            "--seed" => {
                seed = Some(
                    next("--seed")?
                        .parse()
                        .map_err(|_| format!("--seed must be a number; {}", usage()))?,
                )
            }
            "--iters" => {
                iters = next("--iters")?
                    .parse()
                    .map_err(|_| format!("--iters must be a number; {}", usage()))?
            }
            "--baseline-out" => baseline_out = Some(PathBuf::from(next("--baseline-out")?)),
            "--db" => db = Some(PathBuf::from(next("--db")?)),
            other => return Err(format!("unknown argument '{other}'; {}", usage())),
        }
    }

    Ok(Args {
        patients: patients.ok_or_else(|| format!("--patients is required; {}", usage()))?,
        seed: seed.ok_or_else(|| format!("--seed is required; {}", usage()))?,
        iters,
        baseline_out,
        db,
    })
}

/// Serialize the report to `path` as pretty JSON (the baseline.json artefact).
fn write_baseline(report: &RunReport, path: &std::path::Path) -> Result<(), String> {
    let json = serde_json::to_string_pretty(report).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(())
}

fn run() -> Result<bool, String> {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let args = parse_args(&argv)?;

    // A temp dir owns the seeded DB + the (unused) keystore unless --db is set.
    let tmp = tempfile::tempdir().map_err(|e| format!("tempdir: {e}"))?;
    let db_path = args
        .db
        .clone()
        .unwrap_or_else(|| tmp.path().join("clinic.db"));
    let ks_dir = tmp.path().join("keystore");
    std::fs::create_dir_all(&ks_dir).map_err(|e| format!("mkdir keystore: {e}"))?;

    eprintln!(
        "[hc-perf] seeding {} patients (seed {}) into {} …",
        args.patients,
        args.seed,
        db_path.display()
    );
    let t_seed = std::time::Instant::now();
    let (pool, inserted) = seed(&db_path, args.patients, args.seed)?;
    eprintln!(
        "[hc-perf] seeded {inserted} patients in {:.1}s",
        t_seed.elapsed().as_secs_f64()
    );

    let db_bytes = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);

    eprintln!(
        "[hc-perf] measuring {} iterations/op (warm-ups discarded) …",
        args.iters
    );
    let report = run_measurements(&pool, inserted, args.seed, db_bytes, &ks_dir, args.iters)?;

    // Markdown table to stdout (captured into the perf log / report).
    println!("{}", render_markdown(&report));

    if let Some(path) = args.baseline_out.as_ref() {
        write_baseline(&report, path)?;
        eprintln!("[hc-perf] wrote baseline to {}", path.display());
    }

    Ok(report.all_pass)
}

fn main() -> ExitCode {
    match run() {
        Ok(true) => {
            eprintln!("[hc-perf] all NFR-002 budgets met");
            ExitCode::SUCCESS
        }
        Ok(false) => {
            // A missed budget FAILS the CI build (NFR-007).
            eprintln!("[hc-perf] FAIL: an NFR-002 budget was missed");
            ExitCode::FAILURE
        }
        Err(msg) => {
            eprintln!("hc-perf: {msg}");
            ExitCode::FAILURE
        }
    }
}
