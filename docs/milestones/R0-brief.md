# R0 Walking skeleton (milestone M0)

> Release-to-milestone grouping (per `docs/adr/0002-working-software-every-milestone.md`):
> this brief maps **R0 -> M0**. The release plan regroups milestones into releases;
> the backlog's older "M0 to M10 / 11 files" shape predates ADR-0002. Authoritative
> release table and demo scripts: `docs/milestones/README.md`.

## Doctor outcome

Install the app per-user on Windows (or run the AppImage on Linux) and open
it. The doctor sees the application shell with working navigation (Today,
Patients, Settings) and an empty Today screen. Nothing is stored yet; this
release proves the installer, the shell and the build pipeline work end to
end on both operating systems.

## Scope

The walking-skeleton release stands up the whole engineering frame that every
later release builds on: the monorepo, the Tauri 2 + React shell, the Rust
workspace crates, typed Tauri commands, the capability allowlist and CSP, the
CI pipeline producing Windows and Linux installers, lint/format gates,
dependency pinning, the i18n scaffold, structured logging and error mapping.
The only user-facing surface is the shell, an empty Today and a Settings stub.

## Task ids (milestone M0)

P0 tasks:
- HC-MVP1-008 Create monorepo with apps/desktop, crates, tools, content-sources, docs
- HC-MVP1-009 Tauri 2 shell with React 18, TypeScript strict, Vite, Tailwind, shadcn
- HC-MVP1-010 Rust workspace with domain, storage, search, repertory, licence, docs crates
- HC-MVP1-011 Typed Tauri commands with tauri-specta; generated TS types checked in
- HC-MVP1-012 Tauri capability allowlist and webview Content Security Policy (no shell)
- HC-MVP1-013 CI pipeline (GitHub Actions or Forgejo Actions) building Windows and Linux
- HC-MVP1-014 Lint and format gates: clippy -D warnings, eslint, prettier, TS strict
- HC-MVP1-015 Dependency pinning and audit (Cargo.lock, package-lock, cargo audit, npm audit)
- HC-MVP1-016 i18n scaffold with locales/en.json; no hard-coded UI strings
- HC-MVP1-017 Structured logging with rotation, no patient identifiers
- HC-MVP1-018 Error mapping to friendly messages with suggested action
- HC-MVP1-019 ADR folder with ADR-001 to ADR-011 copied from design

Release / demo task:
- HC-MVP1-214 R0 walking skeleton: installer from CI opens on Windows and Linux, shell works

M0 has 12 tasks, all P0 (no P1/P2).

## Screens (docs/ui)

- shell — app shell, routing, nav (new; `apps/desktop/src/app/`)
- S03 Today (empty state) — `docs/ui/S03-today.md` (new; usable from R0)
- S02 Lock / unlock (stub) — `docs/ui/S02-lock-unlock.md` (stub only; full screen lands in R1)

## Demo script

> Copied verbatim from `docs/milestones/README.md` (R0). This is the E2E
> regression gate (R-DEL-005).

R0
1. Install from the CI artifact (per-user on Windows, AppImage on Linux).
2. App opens in under 4 s; nav shows Today, Patients, Settings.
3. Today shows its empty state; F2 focuses the search box (no results yet).

## Requirement ids

Representative ids satisfied by this release (fuller detail in
`docs/requirements/05-nfr-and-acceptance.md`, `docs/requirements/06-architecture-data-model.md`
and `docs/CODE-LAYOUT.md`):
- NFR-001 cold start to usable home screen < 4 s
- The code-layout crate list and dependency rule (`docs/CODE-LAYOUT.md`, ADR-0001)
- i18n / no-hard-coded-strings scaffold and structured logging without patient data

## Out of scope

- No data persistence, no patients, no cases, no prescriptions, no billing.
- No PIN lock, backup, repertory, licence or Buy flow — those arrive in later
  releases.
- Any nav entry whose screen is not yet built must be hidden behind a
  compile-time feature flag; no visible button may lead to a dead end
  (R-DEL-002 / R-DEL-006).

## Entry / exit (Done when)

- Entry: none — R0 is the first release.
- Exit: the R0 demo passes as an E2E run tagged `@tier regression` on Windows
  and Linux (R-DEL-005). No earlier demos exist yet; no upgrade-path check
  applies before R1 (R-DEL-004 begins at R1).
