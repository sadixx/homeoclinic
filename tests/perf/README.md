# tests/perf — NFR-002 performance CI gate (HC-MVP1-057)

Release-profile harness that measures the four NFR-002 patient hot paths at the
design baseline (50k patients) and at 100k, against synthetic data produced by
the real `hc-seed` generator (NFR-007). Owner role: `hc-perf-tester`.

## What it measures (the real command paths)

| Op | What runs | Budget (p95) |
|---|---|---|
| `patient_search` | `PatientService::patient_search` — ranked UNION keyset query + per-hit row enrichment, per keystroke | < 100 ms |
| `patient_get_dashboard` | `PatientService::get_dashboard` — demographics + family + recent touch | < 300 ms |
| `patient_list_query` | `PatientService::list_query` — AND-combined advanced-filter facets, keyset-paginated | < 500 ms |
| `today_followup_list` | `list_query` with the `followup = "today"` facet — the VIS-005 Today list equivalent (see note) | < 200 ms |

**Today substitution (honest):** there is no Today command at R2 (VIS-005 is
R3). The gate measures the equivalent storage query — `list_query` bounding
`next_followup_on` to today. R2 does not populate `next_followup_on`, so this
returns 0 rows but still exercises the indexed follow-up predicate at scale.

The DB is opened with the SAME deterministic dev/test key the seed and E2E path
use (`DevKeyProvider::new_test`, via `hc_seed::generate_and_open`). No network,
no shell, synthetic data only.

## Run locally

```bash
cargo build --release -p hc-perf
# 50k baseline (writes/refreshes baseline.json):
./target/release/hc-perf --patients 50000  --seed 7 --iters 300 --baseline-out tests/perf/baseline.json
# 100k:
./target/release/hc-perf --patients 100000 --seed 7 --iters 300
```

The process **exits non-zero when any p95 budget is missed** (so CI fails the
build — NFR-007). It prints a Markdown table and the on-disk `clinic.db` size
(NFR-007 target: < 1 GB at 50k, excluding attachments).

The heavy run is a **binary, not a `cargo test`**, so `cargo test --workspace`
stays fast. CI runs it explicitly in the `perf-gate` job
(`.github/workflows/ci.yml`) at both 50k and 100k.

## `baseline.json`

The latest committed 50k measurement (p50/p95/p99/max per op, DB size, verdict).
Refresh with `--baseline-out tests/perf/baseline.json`.

## Gate self-test

`HC_PERF_MAX_P95_MS=<ms>` tightens every budget (clamped — it can only make the
gate *stricter* than NFR-002, never looser). Used to prove the gate fails on a
regression against real data:

```bash
HC_PERF_MAX_P95_MS=0.001 ./target/release/hc-perf --patients 50000 --seed 7   # exits 1
```
