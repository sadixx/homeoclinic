---
name: hc-e2e-testing
description: HomeoClinic end-to-end verification protocol for the hc-e2e-* cell. Round model, directory layout, artifact schemas, enums, gates, and the selection, execution, evaluation, exploration and editing mechanics using WebdriverIO + tauri-driver against the built desktop app. Load before reading or writing any E2E artifact.
---

# HomeoClinic E2E Testing

Mirror of RBKS `integ-test-protocol` + `integ-test-artifacts` +
`integ-test-selection` / `-execution` / `-evaluation` / `-editing` and the
`run-integ-test-round` SOP. The "device" is the built desktop app on a
target OS.

## Stack

- Specs: `$HC_REPO/tests/e2e/specs/**/*.e2e.ts` (WebdriverIO, Mocha).
- Driver: `tauri-driver` (Linux: WebKitWebDriver; Windows: msedgedriver).
  macOS is not a target.
- Linux headless: `xvfb-run -a`.
- Test data: synthetic seeder `tests/perf/seed` with `--patients <n>`;
  every run uses a fresh data dir via `HC_DATA_DIR=<run_dir>/data`.
- Licence in tests: TEST public key build feature `e2e-test-keys`, never
  the production key.

## Spec tagging (how selection works)

Each spec file starts with a header comment:

```ts
// @req PSR-001, PSR-004
// @tier pre_ci | stable | regression
// @area patients | search | case | visit | repertory | rx | billing | backup | licence | settings | packs
// @targets linux, windows
```

`tests/e2e/index.json` is generated from these headers by
`npm --prefix tests/e2e run index`. Selection reads only the index and
spec sources; it never guesses ids.

## Round model

```
<artifacts_dir>/                  = <worklog-dir>/e2e/
  build-<F>/                      F = app build round (1, 2, ...)
    round-<T>/                    T = test round within that build
      e2e-recommendations-<target>.json   (selector)
      e2e-execution.json                  (executor)
      <target>-<N>/                       (one run dir per run)
        junit.xml  wdio.log  app.log  screenshots/
      e2e-evaluation.json                 (analyzer)
```

A code change between rounds starts a new build round F+1.

Caps: max 3 targets per round, max 5 specs per target unless the request
asks for more (never more than 15), max 4 test rounds per build round, max
3 build rounds before escalating to the human.

## Enums

- `target`: `linux`, `windows`
- `tier`: `pre_ci`, `stable`, `regression`
- execution `status`: `completed`, `build_failed`, `infra_incomplete`
- run `result`: `pass`, `fail`, `error`, `skipped`
- assessment: `confirmed`, `not_confirmed`, `inconclusive`
- finding `category`: `product_defect`, `regression`, `crash`, `test_defect`, `infra`
- `auto_route`: `done_pass`, `fix_code`, `fix_test`, `reselect`, `explore`, `escalate`
- explorer verdict: `path_exists`, `needs_change`, `no_path`

## Artifact schemas

`e2e-recommendations-<target>.json`

```json
{ "target": "linux", "verification_request": "...", "task_id": "HC-MVP1-047",
  "specs": [ { "path": "tests/e2e/specs/search/phonetic.e2e.ts",
               "grep": "finds patient by sound-alike name",
               "reqs": ["PSR-004"], "why": "exercises changed ranking" } ],
  "seed_patients": 1000 }
```

`e2e-execution.json`

```json
{ "status": "completed", "build_round": 1, "round": 1,
  "app_build": { "command": "...", "log": "path", "binary": "path" },
  "runs": [ { "target": "linux", "run_dir": "path", "result": "pass",
              "counts": {"pass": 4, "fail": 0, "skipped": 0},
              "junit": "path", "summary": "path/summary.md",
              "infra_error": null } ] }
```

`e2e-evaluation.json`

```json
{ "repro_assessment": "confirmed", "regression_assessment": "confirmed",
  "findings": [ { "category": "product_defect", "is_blocking": true,
                  "evidence": "run_dir/wdio.log:212 ...", "spec": "path" } ],
  "per_run": [ { "target": "linux", "result": "pass", "summary": "path" } ],
  "auto_route": "done_pass", "rationale": "one or two lines" }
```

## Gates

- No handoff on a missing or empty artifact.
- Selector output: every spec path exists and every `grep` matches a test
  title in that file (`grep -n "<title>" <path>`).
- Executor: `build_failed` is blocking; `infra_incomplete` (driver missing,
  xvfb missing, Windows VM unreachable) is non-blocking and must be quoted
  verbatim.
- Analyzer: a passing spec confirms repro only with evidence that the
  changed path ran (assertion on the new behavior, or a log/marker line).
  Any Rust panic, webview crash, or `ERROR` from `hc-app` during a run is a
  blocking `crash` finding regardless of counts.
- A test-side fault is `test_defect`, `is_blocking: false`, assessment
  `inconclusive`, routed to `hc-e2e-editor`.

## Execution mechanics

```
cd $HC_REPO
npm --prefix apps/desktop run tauri build -- --debug --features e2e-test-keys > <log> 2>&1
cargo install tauri-driver --locked   # once per machine, report if absent
HC_DATA_DIR=<run_dir>/data node tests/perf/seed --patients <n>
HC_DATA_DIR=<run_dir>/data xvfb-run -a npx --prefix tests/e2e wdio run wdio.conf.ts \
  --spec <path> --mochaOpts.grep "<grep>" > <run_dir>/wdio.log 2>&1
```

Copy `HC_DATA_DIR/logs/app.log` into the run dir. Write `summary.md`
per run: target, specs, counts, first failure with log line.

## Editing mechanics

- Page objects in `tests/e2e/pages/`, one per screen; specs use page
  objects, never raw selectors.
- Selectors: `data-testid` only. If a screen lacks one, report the needed
  `data-testid` to the spawner (UI change belongs to `hc-ui-dev`).
- No sleeps; use `waitUntil` with a timeout.
- Each spec seeds its own data; no ordering dependencies.
- Validate a new/changed spec by running it on Linux; on Windows too when
  `@targets` includes windows and a Windows runner exists.
