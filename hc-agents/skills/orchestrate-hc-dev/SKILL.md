---
name: orchestrate-hc-dev
description: Core HomeoClinic development workflow for hc-leader. Agent roster, routing, delegation modes, testing philosophy, validation gates, workflow templates, guidelines phase, lifecycle tracking and failure recovery. Load before planning or spawning any hc-* agent.
---

# Orchestrate HomeoClinic Development

Mirror of RBKS `orchestrate-fw-dev`, adapted to a Tauri 2 + Rust + React
desktop app. Load `hc-project-context` alongside this skill.

## Available Agents

| Agent | Purpose |
|---|---|
| `hc-task-scoper` | Requirements gathering / scoping from backlog + docs |
| `hc-architect` | Code analysis, API / command / schema design, deps |
| `hc-unit-tester` | Unit tests (cargo test, Vitest) |
| `hc-dev` | Production code + builds (general, cross-cutting) |
| `hc-core-dev` | Rust domain, app services, Tauri commands |
| `hc-ui-dev` | React screens and UI state |
| `hc-data-dev` | SQLCipher storage, migrations, search, backup |
| `hc-licence-dev` | Licence, UPI/WhatsApp QR, tamper protection |
| `hc-repertory-dev` | Packs, channels, rubric search, scoring |
| `hc-e2e-orchestrator` | End-to-end verification on the built app |
| `hc-e2e-editor` | E2E test authoring / repair |
| `hc-perf-tester` | NFR speed targets on synthetic 50k/100k data |
| `hc-code-reviewer` | Code review |
| `hc-guidelines-reviewer` | Post-review guidelines phase (below) |
| `hc-build-analyzer` | Build failure diagnosis |
| `hc-lint-fixer` | Fix clippy / rustfmt / ESLint / tsc findings |
| `hc-requirements-reviewer` | DoD verification |
| `hc-code-submitter` | Commit, push feature branch, open GitHub pull request |
| `hc-release-gate` | Release-only checks (channels, signing, scan) |

`hc-grill-me` is human-facing only; the leader never spawns it.

## Hierarchy

```
hc-leader
 |- hc-task-scoper -------> hc-architect
 |- hc-architect <-> hc-unit-tester        (negotiated via leader / team)
 |- hc-dev | hc-core-dev | hc-ui-dev | hc-data-dev | hc-licence-dev | hc-repertory-dev
 |- hc-build-analyzer, hc-lint-fixer
 |- hc-code-reviewer -> hc-guidelines-reviewer (phase after review)
 |- hc-requirements-reviewer
 |- hc-perf-tester
 |- hc-e2e-orchestrator
 |    |- hc-e2e-selector ---> hc-e2e-explorer
 |    |- hc-e2e-executor ---> hc-build-analyzer
 |    |- hc-e2e-analyzer
 |    |- hc-e2e-explorer
 |    '- hc-e2e-editor
 |- hc-e2e-editor
 |- hc-code-submitter
 '- hc-release-gate
```

Leaf agents NEVER spawn. Only `hc-leader`, `hc-task-scoper`,
`hc-e2e-orchestrator`, `hc-e2e-selector` and `hc-e2e-executor` may spawn,
and only the children listed above.

## Choosing the implementation specialist

Route by the path table in `hc-project-context`:

- Only UI files -> `hc-ui-dev`.
- Only storage/search/migrations -> `hc-data-dev`.
- Licence, QR, signing, TAM-* -> `hc-licence-dev` (always, even if small).
- Repertory, packs, channels, scoring -> `hc-repertory-dev`.
- Domain / app services / commands -> `hc-core-dev`.
- Anything spanning 3+ areas, CI, scripts, docs crate -> `hc-dev`.

A vertical slice (command + UI screen) may use two specialists in sequence:
backend first (it owns the command contract), then UI. The selected agent
is `<implementation-agent>` in the templates below.

## Delegation modes

How a call is made depends on the AI tool; `hc-delegation` defines all
three modes (native subagent, parallel team, role switching) and the
handoff file trail. Choose per call:

- **One-shot subagent**: short, self-contained lookups, analyses, builds,
  reviews.
- **Team** (when the tool supports persistent agents): long or
  collaborative work, especially the `hc-architect` <-> `hc-unit-tester`
  API negotiation, or when the user asks agents to collaborate.
- **Role switching**: when the tool has no subagents. Same workflow, same
  gates; reviewers follow the independence rules in `hc-delegation`.

Every call, in every mode, writes the handoff files described in
`hc-delegation`, so a run can be resumed in a different tool.

## Working software at every milestone (ADR 0002)

Plan and order: `docs/milestones/README.md`. Milestone order is
`M0 M1 M2 M3 M7 M8 (early pilot) M4 M5 M6 M9 M10`, releases R0 to R9.

- Every task belongs to a release. Before spawning implementation, check
  that the change is reachable from the UI in that release, or is
  internal and says so. Backend-only work with no UI slice in the same
  milestone is a scoping gap: route back to `hc-task-scoper`.
- Unfinished features stay behind a compile-time feature flag; no visible
  dead ends (R-DEL-002).
- Any schema or file-format change from R1 on needs a migration and an
  upgrade-path test (R-DEL-004).
- A milestone is closed only by the Release workflow below. Never report
  a milestone as done on unit tests alone.

## Testing Philosophy

### Decide test depth BEFORE spawning hc-unit-tester

- Bug fix / small modification: minimal regression test(s) for the changed
  behavior. If the task names tests, ask for exactly those.
- New crate, new use case, new screen, or task asks for comprehensive tests:
  full red-green workflow.
- No tests: task declines tests, or change is test-irrelevant (comments,
  docs, copy text only). Do not spawn `hc-unit-tester`; state the decision
  and reason in the completion report.

Ambiguous -> default to minimal regression tests, record the assumption.

### Red-green cycle

1. Write tests that compile and run against the real CUT (or the
   architect's stub) and FAIL on assertions.
2. Implement until the same tests pass.

Greenfield: agree the public API (Rust signatures / Tauri command types /
React component props), write tests against it, then implement.
Modification: write tests for the new behavior against existing code, then
change it.

### Not allowed

No fake of the CUT. Dependency fakes are fine (in-memory SQLite, fake
clock, fake pack store, mocked Tauri `invoke` in UI tests). A fake of the
thing under test makes tests tautological.

### The gate

Before implementation: tests compile, execute, and fail on assertions.
After implementation: the same tests pass.

### Pragmatic escape hatch

If a component genuinely cannot be unit tested without building hours of
infrastructure, report what was tried and why to the human, proceed only if
they agree, and still require review and requirements verification.

### E2E verification is the last gate before submission

Any change that alters the shipped app (Rust, TS, migrations, packs,
Tauri config, capabilities) MUST get a passing `hc-e2e-orchestrator` round
on the exact code being submitted. Run it after review is clean and the
guidelines phase has landed its fixes, immediately before submission.

A failing round means not ready: fix, re-review if code changed, re-run.
Retry flaky runs freely. NEVER hand a change to `hc-code-submitter` on a
round that did not pass, and NEVER downgrade a failure to a caveat.

Pass the run summary paths from the passing round to the submitter so the
MR description links them.

You MUST NOT claim "cannot run E2E" unless you actually spawned
`hc-e2e-orchestrator` and it returned a concrete error, quoted verbatim.

#### The only cases that reach submission without a passing E2E round

Closed list. Never invent a case, never self-approve one:

1. The change ships nothing in the app: docs, CI config, dev scripts,
   tests only, `backlog.txt`, design docs.
2. The change alters no behavior in the built app: comments / doc-comments
   only. State which files changed.
3. The behavior genuinely cannot be exercised by E2E on any available target
   and a human, told what was tried and the concrete error, agrees. Silence
   is not agreement. The change is then UNVERIFIED: say "NOT verified
   end-to-end" prominently in the completion report and the MR description.

### Performance gate

When the change touches `hc-storage`, `hc-search`, `hc-repertory` scoring,
startup path, or any NFR-tagged requirement, spawn `hc-perf-tester` after
the target build and before review. A regression past an NFR target is a
blocking failure, same as a failing test.

## Validation Requirements

Non-negotiable for any task that produces code:

1. Tests cover the changed behavior (or the no-tests / escape-hatch decision
   is reported with the reason).
2. Existing tests do not regress (`cargo test --workspace`, `npm test`).
3. Target build passes (`hc-build` skill: debug `tauri build` on Linux at
   minimum; Windows too when the change touches platform code, installer,
   DPAPI, paths or printing).
4. Lint clean (clippy `-D warnings`, rustfmt, ESLint, `tsc --noEmit`).
5. Code review clean. When tests changed, include test quality from
   `hc-review-guidelines`.
6. Requirements met. DoD confirmed by `hc-requirements-reviewer`.
7. Perf targets held (when the performance gate applies).
8. Verified end-to-end (a passing `hc-e2e-orchestrator` round), unless one
   of the three closed cases applies.
9. Clean commit on a feature branch, MR opened, per `hc-commit-message`.
10. Usable in the app: the change is reachable from the UI in the current
    release (or is declared internal), with no dead-end UI, and earlier
    release demos still pass (R-DEL-001..003).

Do not submit without all ten. If you cannot reconcile, summarise, notify
the user, and finish.

## Rework Detection (before selecting a workflow)

1. Check `.worklog/<task-id>/status.md` for an MR link.
2. Only if inconclusive, `gh pr list --state open --search <task-id>` (or `git branch
   -a | grep <task-id>`).

- Open MR for this task -> Rework template on that branch.
- Only merged/closed, or nothing -> new work.
- Conflicting signals -> treat as new work and flag the ambiguity.

## Workflow Templates

Starting points; adapt to the task.

### Rework (address MR review feedback)

```
checkout the existing MR branch
  -> hc-code-reviewer (fresh internal review FIRST)
  -> fetch MR comments (`gh pr view <n> --comments`), classify by importance
  -> merge both finding sets
  -> <implementation-agent> (production fixes) / hc-unit-tester (test fixes)
  -> <implementation-agent> (target build)
  -> hc-lint-fixer (if lint fails)
  -> review (loop until clean)
  -> hc-guidelines-reviewer phase (3 passes, each fixed)
  -> hc-perf-tester (if performance gate applies)
  -> hc-e2e-orchestrator (must pass)
  -> hc-code-submitter (push to the SAME branch, update the SAME MR)
```

Rules:
- Arguable or design-level comments: reply on the MR with reasoning and
  options; do not silently apply or ignore.
- Comments on test files, including "is this test needed?", go to
  `hc-unit-tester`.
- All ten validation requirements are re-satisfied on the updated branch;
  earlier passes do not carry over.

### Code Change (new module or modification)

```
hc-architect (analyse + design API / command / schema) <-> hc-unit-tester (challenge + test)
  iterate until: API agreed, tests compile and FAIL
<implementation-agent> (implement -> tests PASS)
  -> <implementation-agent> (target build)
  -> hc-lint-fixer (if needed)
  -> hc-perf-tester (if performance gate applies)
  -> review (loop until clean)
  -> hc-guidelines-reviewer phase (3 passes, each fixed)
  -> hc-requirements-reviewer
  -> hc-e2e-orchestrator (must pass)
  -> hc-code-submitter
```

Collaborative, not sequential: route pushback between architect and tester
until both are satisfied. Database schema changes always go through
`hc-architect` first (migration + rollback plan).

### Investigation

```
reproduce via hc-e2e-orchestrator (when user-observable)
  -> hc-architect (root cause analysis)
  -> findings report -> confirm with human
```

Output is a findings report, not a code change.

### Milestone close (release R<n>)

```
all milestone tasks merged
  -> hc-e2e-editor (turn the R<n> demo script in docs/milestones/README.md
     into a spec tagged @tier regression, if not already present)
  -> hc-e2e-orchestrator (R<n> demo + all earlier demos, linux and windows)
  -> hc-perf-tester (NFR budgets touched by this milestone)
  -> upgrade-path check: install R<n> over R<n-1> data (from R1 on)
  -> report to human with the CI artifact links; human installs and tries it
```

The milestone is done only when this passes. After R5, stop and tell the
human the Clinic Basics build is ready for the early pilot.

### Release (M10 / any release build)

```
all MVP milestone tasks merged
  -> hc-perf-tester (full NFR suite at 50k and 100k)
  -> hc-e2e-orchestrator (full regression tier, Linux + Windows)
  -> hc-release-gate (channel scan, signing, TAM-013 scan, installer checks)
  -> report to human; human signs and publishes (agents never publish)
```

## Guidelines phase (runs AFTER the review step)

`hc-guidelines-reviewer` is a separate phase after `hc-code-reviewer` is
clean, never interleaved into its loop. 3 passes, each followed by a fix
round including the third; the third fix round ends the phase.

Entry condition: `$HC_REPO/docs/rules/` exists and contains at least one
rules file. Otherwise skip and say why.

Its `defect` findings drive this phase's fix loop; they never reopen
requirement 5 and never block submission. A failed or skipped phase costs
advice, not correctness: report it and carry on.

For each comment, address it in code only if it is BOTH actionable (a
concrete change) AND impactful (correctness, safety, privacy, NFR, or needed
to merge). Decline arguable ones with a one-line reason.

Fix rounds: production code before its tests; Rust core before UI when the
UI consumes a changed command type.

## Lifecycle tracking

Write `.worklog/<task-id>/status.md`, appending one line per stage reached:

```
<ISO time> | <stage> | <one-line note>
```

Stages: `triage` (reading the task), `groomed` (rework detection done, task
workable), `executing` (workflow started), `created_mr` (submitter reports
an MR URL), `ended_turn` (close-out, success or terminal failure). Emit only
stages actually reached. On resumed turns, keep appending.

## Run Close-Out

On success and on terminal failure:

1. Append `ended_turn` to `status.md` with outcome and MR link.
2. Write `.worklog/<task-id>/report.md`: classification, agents used,
   validation results (all ten), assumptions made, UNVERIFIED notes, E2E
   run summaries (one line per run: target, PASS/FAIL, summary path).
3. Do NOT edit `backlog.txt` status. The human moves the task in their
   tracker.

## Failure Recovery

- Artifact missing -> retry once with explicit instruction.
- No progress after 2 retries -> escalate to human.
- Build failure -> `hc-build-analyzer`, then feed diagnosis back to the
  implementation agent.
- Lint failure -> `hc-lint-fixer`.
- Tests won't compile -> may be a test-infra gap; evaluate escape hatch.

## Task String Rules

Always include in every spawn:

- `task-id:` e.g. `HC-MVP1-047`
- `worklog-dir:` `$HC_REPO/.worklog/<task-id>/`
- `component-dir:` the crate or UI module path
- `output-dir:` where the agent writes its artifacts
