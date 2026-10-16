# HomeoClinic

Offline-first clinic management software for homoeopathic doctors in India:
patients, case taking, visits, integrated repertory, prescriptions,
billing, backup, and an offline licence. Windows and Linux desktop
(Tauri 2 + Rust + React + SQLCipher).

## Where things are

| Path | What |
|---|---|
| `docs/requirements/` | Requirements (MVP1-MVP5), requirement ids like PAT-001 |
| `docs/design/` | Architecture and design docs, PlantUML diagrams, review site |
| `docs/ui/` | MVP1 screen specs: written layouts + wireframes |
| `docs/rules/` | Coding and review rules (used by humans and the review agents) |
| `docs/task-tracker/` | Backlog (`backlog.txt` is the source of truth) and exports |
| `docs/CODE-LAYOUT.md` | Authoritative code layout and module ownership |
| `docs/adr/` | Architecture decision records |
| `apps/desktop/` | Tauri app: `src/` (React UI), `src-tauri/` (Rust shell) |
| `crates/` | Rust workspace crates (`hc-*`) |
| `tools/` | Vendor licence tool, content builder, synthetic seeder |
| `tests/` | End-to-end and performance tests |
| `content-sources/` | Content registry; `internal-eval/` data is never pushed |
| `hc-agents/` | AI agent pack (works with Kiro and other AI tools) |
| `services/`, `web/` | MVP2 placeholders |

## Status

Pre-M0: documentation, screen specs and rules are in place; the code
scaffold (Cargo workspace, Tauri app, CI) is task M0 in
`docs/task-tracker/backlog.txt`.

## Working with AI agents

Read `AGENTS.md`. With Kiro: `hc-agents/install.sh`, then
`kiro-cli chat --agent hc-leader`.

## Licence

Proprietary. All rights reserved. Content sources keep their own licences;
see `content-sources/REGISTRY.md`.
