# HomeoClinic hc-* agents

The HomeoClinic equivalent of the RBKS `fw-*` agent family. Same hierarchy,
same gates (scope, red-green, build, lint, review, rules phase, DoD, E2E,
submit), adapted to Tauri 2 + Rust + React + SQLCipher.

## Layout

```
hc-agents/
  AGENTS.md                   entry point for ANY AI tool (read this first)
  agents/<role>/SKILL.md      one file per role; front matter metadata holds
                              hc-skills, hc-spawns (who it may call), hc-base
  skills/<skill>/SKILL.md     shared skills, open Agent Skills format
  export.py                   validates the pack, exports per-tool layouts to dist/
  install.sh                  Kiro only: export + link into ~/.kiro/agents
  dist/                       generated, do not edit by hand
```

The role files and skills are the single source of truth. Everything in
`dist/` is generated from them.

## Using it with any AI tool

| Tool | Command | Copy into your repo | Delegation mode |
|---|---|---|---|
| Kiro CLI | `./install.sh` then `kiro-cli chat --agent hc-leader` | nothing (links into `~/.kiro/agents`) | native subagents, spawn allow-lists enforced |
| Claude Code | `python3 export.py --target claude` | `dist/claude/.claude/` and `dist/claude/hc-agents/` | native subagents (`.claude/agents/`); nested cells driven by the leader |
| GitHub Copilot (CLI, VS Code, cloud agent) | `python3 export.py --target copilot` | `dist/copilot/.github/` and `dist/copilot/hc-agents/` | custom agents (`.github/agents/*.agent.md`) + skills (`.github/skills/`) |
| Codex, Cursor, Gemini CLI, Windsurf, Cline, Aider, others | `python3 export.py --target generic` | `dist/generic/AGENTS.md`, `GEMINI.md`, `.agents/skills/`, `hc-agents/` | role switching, or the tool's own agents if it has them |
| Any web chat / API (ChatGPT, Gemini web, etc.) | `python3 export.py --target bundle` | paste `dist/bundle/hc-agents-bundle.md` | role switching |

`python3 export.py` (no args) validates and exports every target.

How portability works:
- Roles and skills are plain Markdown with Agent Skills front matter
  (`name` = folder name, `description` <= 1024 chars), which 30+ tools load
  natively. Tools that do not load skills still work: every role lists its
  Required reading as plain file paths.
- `skills/hc-delegation/SKILL.md` defines the same workflow in three modes:
  native subagents, persistent teams, or explicit role switching in a
  single chat. Every call writes request/result files under
  `.worklog/<task-id>/handoffs/`, so a run started in one tool can be
  resumed in another.
- Spawn allow-lists are enforced by config only in Kiro. In every other tool
  they are enforced by the role text ("You may delegate ONLY to ...").
- If a skills folder name differs in your tool's version, copy
  `hc-agents/skills/*` into whatever folder its docs name; the files need no
  changes.

## Mapping to fw-*

| fw-* / RBKS | hc-* | Notes |
|---|---|---|
| `leader` | `hc-leader` | dispatcher only |
| `fw-task-scoper` | `hc-task-scoper` | may spawn `hc-architect` |
| `fw-grill-me` | `hc-grill-me` | human-facing, not spawned by leader |
| `fw-architect` | `hc-architect` | |
| `fw-unit-tester` | `hc-unit-tester` | cargo test + Vitest |
| `fw-dev` | `hc-dev` | base contract for all specialists |
| `fw-blink-dev` / `fw-mw-dev` / `fw-altus-dev` | `hc-core-dev`, `hc-ui-dev`, `hc-data-dev`, `hc-licence-dev`, `hc-repertory-dev` | extend `hc-dev` (base contract appended to prompt) |
| `fw-build-analyzer` | `hc-build-analyzer` | |
| `fw-clang-tidy-fixer` | `hc-lint-fixer` | clippy, rustfmt, ESLint, tsc |
| `fw-code-reviewer` | `hc-code-reviewer` | |
| `cacr-review` | `hc-guidelines-reviewer` | rules from `docs/rules/`, 3-pass phase |
| `fw-requirements-reviewer` | `hc-requirements-reviewer` | |
| `fw-code-submitter` | `hc-code-submitter` | git branch + GitHub pull request |
| `fw-code-submitter-hs`, `fw-altus-code-submitter-hs` | none | Headstart is Ring-only |
| `integ-test-orchestrator` | `hc-e2e-orchestrator` | |
| `integ-test-selector` / `-executor` / `-analyzer` / `-explorer` / `-editor` | `hc-e2e-selector` / `-executor` / `-analyzer` / `-explorer` / `-editor` | WebdriverIO + tauri-driver |
| none | `hc-perf-tester` | NFR speed gate |
| none | `hc-release-gate` | release-only checks |

| RBKS skill | hc skill |
|---|---|
| `orchestrate-fw-dev` | `orchestrate-hc-dev` |
| `abbreviations`, `workspace-location`, `code-tree-routing`, `device-kind` | `hc-project-context` |
| `scoping`, `planning`, `scope-task` SOP | `hc-scoping` |
| `firmware-build`, `build-error-patterns` | `hc-build` |
| `unit-testing`, `write-unit-tests` SOP | `hc-unit-testing` |
| `review-guidelines` | `hc-review-guidelines` |
| `commit-message`, `gerrit` | `hc-commit-message` |
| `integ-test-protocol`, `-artifacts`, `-selection`, `-execution`, `-evaluation`, `-editing` | `hc-e2e-testing` |
| `jira-lifecycle-tracking` | `.worklog/<task-id>/status.md` (in `orchestrate-hc-dev`) |

## Hierarchy

```
hc-leader
 |- hc-task-scoper ---> hc-architect
 |- hc-architect, hc-unit-tester
 |- hc-dev | hc-core-dev | hc-ui-dev | hc-data-dev | hc-licence-dev | hc-repertory-dev
 |- hc-build-analyzer, hc-lint-fixer
 |- hc-code-reviewer, hc-guidelines-reviewer, hc-requirements-reviewer
 |- hc-perf-tester
 |- hc-e2e-orchestrator
 |    |- hc-e2e-selector ---> hc-e2e-explorer
 |    |- hc-e2e-executor ---> hc-build-analyzer
 |    |- hc-e2e-analyzer, hc-e2e-explorer, hc-e2e-editor
 |- hc-e2e-editor
 |- hc-code-submitter
 '- hc-release-gate
```

Spawn rights live in each role's `metadata.hc-spawns` and Delegation section.

## Project prerequisites (status)

| Prerequisite | Where | Status |
|---|---|---|
| Code repo | `/tmp/hc-recover/root/Doctor-Clinic/homeoclinic` (git, branch `main`) | done |
| Code layout | `docs/CODE-LAYOUT.md`, `docs/adr/0001-code-layout.md` | done |
| MVP1 screen specs | `docs/ui/` (S01-S22 + conventions) | done; open questions in `docs/ui/OPEN-QUESTIONS.md` |
| Review rules | `docs/rules/` | done |
| Cargo workspace, Tauri app, CI | M0 tasks in `docs/task-tracker/backlog.txt` | to do (first agent task) |
