---
name: hc-scoping
description: Scoping and planning framework for HomeoClinic tasks. Gap-finding questions, blocking vs non-blocking classification, the scope-task procedure, and the original-prompt.md / task-overview.md templates. Use when scoping a backlog task or checking whether a task is specified well enough to code.
---

# HomeoClinic Scoping

Mirror of RBKS `scoping` + `planning` + the `scope-task` SOP.

## Inputs

- A task id from `$HC_REPO/docs/task-tracker/backlog.txt`, or a free-text ask.
- The linked requirement ids, read in full from `$HC_REPO/docs/requirements/`.
- The relevant design doc in `$HC_REPO/docs/design/` and its diagrams.
- `design/06-review-questions.md` for open questions (Q1..Q17).

## Gap framework

Ask each question; a gap exists when the docs do not answer it.

| Area | Question |
|---|---|
| Behavior | What exactly does the doctor see / do before and after? |
| Data | Which tables / columns / pack fields change? Migration needed? |
| Contract | Which Tauri commands are added or changed? Request/response types? |
| Screens | Is there a wireframe or a written layout for every screen touched? |
| Errors | What happens on bad input, locked DB, missing pack, expired licence? |
| Offline | Does anything need the network? (MVP1: it must not) |
| Privacy | Does any patient data reach logs, files, clipboard or links? |
| Speed | Which NFR applies and how is it measured? |
| Platform | Windows-only or Linux-only behavior (paths, DPAPI, printing)? |
| Content | Which channel (public / internal_eval) does any content belong to? |
| Open Qs | Does an unresolved Q in design/06 decide this task? |
| Done | Is the backlog "done when" check testable as written? |
| Usable | In which release R<n> does the doctor reach this, and through which screen? |

## Classify every gap

- BLOCKING: no correct implementation can be chosen without the answer
  (e.g. code layout conflict, unresolved Q12 for print identity lock, no
  screen spec for a new screen).
- NON-BLOCKING: a reasonable default exists. Record the default as an
  assumption.

Blocking gaps: batch every question into ONE ask. Do not drip-feed.
Non-blocking: proceed and list assumptions in `task-overview.md`.

## scope-task procedure

1. Read the backlog task line and its epic/feature context.
2. Read every linked requirement id in full, plus the design section.
3. Run the gap framework. Classify gaps.
4. If blocking gaps: write them to `worklog-dir/questions.md` and stop.
5. Otherwise write `original-prompt.md` and `task-overview.md` (templates
   below) and `worklog.md` (empty log with a header).
6. Optionally spawn `hc-architect` in analysis-only mode to confirm the
   affected surface before finalising the overview.
7. Report: files written, assumptions, suggested specialist, test depth.

## original-prompt.md template

```markdown
# <task-id>: <title>

## Ask
<the task line and any human instruction, verbatim>

## Requirements
- <REQ-ID>: <one-line summary> (source: requirements/<file>.md)

## Definition of Done
1. <backlog "done when" check, verbatim>
2. <each requirement acceptance criterion that applies>
3. Tests cover the changed behavior
4. Build, lint, review, E2E gates pass (orchestrate-hc-dev)
```

## task-overview.md template

```markdown
# <task-id> overview

## Why
<problem in the doctor's words>

## What
<behavior change; commands; data; screens>

## Affected areas
| Path | Specialist |

## Test depth
minimal | full red-green | none (reason)

## Release
R<n> from docs/milestones/README.md; UI path that makes it usable, or "internal"

## Gates that apply
perf: yes/no (which NFR) ; e2e: yes / closed-case <n>

## Assumptions (non-blocking defaults)
- ...

## Out of scope
- ...
```

## Planning rules

- One task = one MR. If the task needs more than ~400 changed lines or more
  than two specialists, propose a split into sub-tasks with ids
  `<task-id>a`, `<task-id>b`.
- Respect milestone dependencies in `backlog.txt` (e.g. M5 needs M4).
  A task whose dependency milestone is not merged is BLOCKED; say so.
