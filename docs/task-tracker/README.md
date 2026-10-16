# HomeoClinic Task Tracker Pack

Features and tasks for every planned stage, ready to copy or import into any task tracker. Everything is generated from one file, `backlog.txt`.

## Totals

| Stage | What it covers | Epics | Features | Tasks | Rough effort (person-days P0 / P1 / P2) |
|---|---|---|---|---|---|
| PREP | Business setup, decisions, legal, signing keys, pilot recruitment | 5 | 7 | 30 | 26.5 / 2.5 / 0 |
| MVP1 | Complete offline desktop app, milestones HANDOFF, M0 to M10, PILOT | 13 | 43 | 213 | 284 / 58.5 / 4 |
| MVP2 | First servers, cloud backup, LAN multi-user, stock, messaging, reports, languages, paid content | 4 | 10 | 40 | 75.5 / 41 / 0 |
| MVP3 | Android and iOS apps with encrypted sync | 1 | 4 | 10 | 34 / 7 / 0 |
| MVP4 | On-device smart features, ABDM, marketplace | 1 | 2 | 6 | 12 / 21 / 3 |
| MVP5 | Migration (de-prioritised) | 1 | 3 | 8 | 12.5 / 4 / 0 |
| Total | | 25 | 69 | 307 | |

Estimates are rough ideal person-days for planning only. Every requirement id in `../requirements/` is covered by at least one task (checked by `generate.py`).

## Hierarchy and ids

```
Stage (PREP, MVP1 ... MVP5)
  Epic      HC-MVP1-E04        e.g. "Patients and 50k search", milestone M2, depends on M1
    Feature HC-MVP1-E04-F02    e.g. "Patient search", linked requirement ids
      Task  HC-MVP1-047        type, priority, estimate, requirement ids, "done when" check
```

Task fields: type (`biz`, `legal`, `decision`, `content`, `design`, `dev`, `test`, `ops`, `doc`), priority (`P0` must, `P1` should, `P2` could), estimate in days, requirement ids, done-when acceptance check, labels (stage, milestone, type, priority), status (`To do`).

## Files

| File | Use it for |
|---|---|
| `markdown/00-PREP.md` ... `markdown/05-MVP5.md` | Copy and paste into any tool that accepts Markdown (issue or card descriptions, wiki pages, Obsidian, Joplin). Tasks are `- [ ]` checklists. |
| `csv/all-tasks.csv` | Every task with all fields (17 columns). Import into any tracker that has a CSV importer and map the columns, or open in LibreOffice Calc. |
| `csv/tasks-<STAGE>.csv` | Same columns, one file per stage, for importing stage by stage. |
| `csv/epics.csv`, `csv/features.csv` | Parent items to create first if your tool has epics or parent tasks. |
| `csv/gitlab-issues.csv` | GitLab issue CSV import format (`title`, `description`), with labels applied by `/label` quick actions in the description. |
| `json/backlog.json` | Nested stages, epics, features and tasks, for scripted import through a tracker's REST API. |
| `backlog.txt` | The source. Edit here, then regenerate. |
| `generate.py` | Regenerates all files and validates the backlog. |

## Importing

- **GitLab (self-hosted or gitlab.com):**
  1. Create the labels first: the stage codes, milestone codes, types and priorities. Quick actions only apply labels that already exist.
  2. Open Issues, then Actions, then Import CSV, and choose `csv/gitlab-issues.csv`.
  3. Try a small test file first, because a large import can only be undone through the API.
- **Trackers with a CSV importer:** use `csv/all-tasks.csv` and map at least `Title`, `Description`, `Status` and `Labels`, plus `Priority` and `Estimate (days)` if the tool has those fields. Check your tool's import documentation for the exact column names it expects; only the GitLab format has been checked against its documentation.
- **Trackers without CSV import (for example Gitea or Forgejo issues):** paste per-stage Markdown into issues or milestones, or script `json/backlog.json` against the tool's API.
- **Recommended structure:**
  - Stage = project or top-level milestone.
  - Epic = epic or milestone.
  - Feature = parent task or label.
  - Task = issue or card.
  - Use `Epic depends on` for ordering: PREP, then HANDOFF, then M0 to M10 in order, with M4 able to start in parallel after M1.

## Changing the backlog

1. Edit `backlog.txt` (format is described at the top of the file).
2. Run `python3 generate.py` from this folder.
3. Fix any reported errors (unknown type, unknown priority, unknown requirement id).

Task ids are numbered in file order within each stage, so inserting a task in the middle renumbers later ids. After you have imported into a tracker, add new tasks at the end of their feature or stage, or keep the tracker as the master from then on.
