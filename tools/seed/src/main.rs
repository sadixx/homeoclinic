#![forbid(unsafe_code)]
//! `hc-seed` CLI (HC-MVP1-056): a thin wrapper over the `hc_seed` library.
//!
//! Usage:
//!   hc-seed --fixture [--count N] --seed S --out PATH
//!   hc-seed --patients 50000     --seed S --out PATH
//!   hc-seed --patients 100000    --seed S --out PATH
//!
//! Exactly one of `--fixture` / `--patients` is required, plus `--seed` and
//! `--out`. Prints only counts on completion (R-PRIV-001: never names). No
//! network, no shell (product rule 1).

use std::path::PathBuf;
use std::process::ExitCode;

use hc_seed::{GenConfig, GenMode, FIXTURE_DEFAULT_PATIENTS, FIXTURE_MIN_PATIENTS};

/// Parsed CLI arguments.
struct Args {
    mode: GenMode,
    seed: u64,
    out: PathBuf,
}

fn usage() -> &'static str {
    "usage: hc-seed (--fixture [--count N] | --patients N) --seed S --out PATH"
}

/// Hand-rolled arg parse (no clap dependency — keep the lock surface small,
/// NFR-024).
///
/// Exactly one of `--fixture` / `--patients N` is required, plus `--seed S` and
/// `--out PATH`. `--count N` is only valid with `--fixture`.
fn parse_args(argv: &[String]) -> Result<Args, String> {
    let mut fixture = false;
    let mut count: Option<usize> = None;
    let mut patients: Option<usize> = None;
    let mut seed: Option<u64> = None;
    let mut out: Option<PathBuf> = None;

    let mut it = argv.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--fixture" => fixture = true,
            "--count" => {
                let v = it
                    .next()
                    .ok_or_else(|| format!("--count needs a value; {}", usage()))?;
                count = Some(
                    v.parse()
                        .map_err(|_| format!("--count must be a number; {}", usage()))?,
                );
            }
            "--patients" => {
                let v = it
                    .next()
                    .ok_or_else(|| format!("--patients needs a value; {}", usage()))?;
                patients = Some(
                    v.parse()
                        .map_err(|_| format!("--patients must be a number; {}", usage()))?,
                );
            }
            "--seed" => {
                let v = it
                    .next()
                    .ok_or_else(|| format!("--seed needs a value; {}", usage()))?;
                seed = Some(
                    v.parse()
                        .map_err(|_| format!("--seed must be a number; {}", usage()))?,
                );
            }
            "--out" => {
                let v = it
                    .next()
                    .ok_or_else(|| format!("--out needs a value; {}", usage()))?;
                out = Some(PathBuf::from(v));
            }
            other => return Err(format!("unknown argument '{other}'; {}", usage())),
        }
    }

    let seed = seed.ok_or_else(|| format!("--seed is required; {}", usage()))?;
    let out = out.ok_or_else(|| format!("--out is required; {}", usage()))?;

    let mode = match (fixture, patients) {
        (true, Some(_)) => {
            return Err(format!(
                "--fixture and --patients are mutually exclusive; {}",
                usage()
            ))
        }
        (true, None) => GenMode::Fixture(count.unwrap_or(FIXTURE_DEFAULT_PATIENTS)),
        (false, Some(n)) => {
            if count.is_some() {
                return Err(format!("--count is only valid with --fixture; {}", usage()));
            }
            GenMode::Scale(n)
        }
        (false, None) => {
            return Err(format!(
                "one of --fixture / --patients is required; {}",
                usage()
            ))
        }
    };

    Ok(Args { mode, seed, out })
}

fn run() -> Result<(), String> {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let args = parse_args(&argv)?;

    // Enforce the fixture minimum (USER REQUIREMENT: >= 200).
    if let GenMode::Fixture(n) = args.mode {
        if n < FIXTURE_MIN_PATIENTS {
            return Err(format!(
                "--count {n} is below the fixture minimum {FIXTURE_MIN_PATIENTS}"
            ));
        }
    }

    let cfg = GenConfig {
        mode: args.mode,
        seed: args.seed,
        out: args.out.clone(),
    };

    let n = hc_seed::generate_into_pool(&cfg).map_err(|e| e.to_string())?;
    // Counts only, never names (R-PRIV-001).
    println!("seeded {n} patients into {}", args.out.display());
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(msg) => {
            eprintln!("hc-seed: {msg}");
            ExitCode::FAILURE
        }
    }
}
