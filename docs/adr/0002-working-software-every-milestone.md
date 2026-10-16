# ADR 0002: Working software at every milestone

Date: 2026-10-16. Status: accepted.

## Context

The original build order (requirements/06 section 6) is layered: M1 has
no user-facing screen, M4 is tooling only, and a doctor cannot finish a
single consultation (register, case, prescription, print, bill) until M8.
Pilot doctors only see the app after M10. A long period with nothing
usable hides integration bugs and delays real feedback.

## Decision

1. Every milestone ends with a release `R<n>`: an installable Windows and
   Linux build from CI in which everything built so far is usable through
   the UI. Release plan and demo scripts: `docs/milestones/README.md`.
2. Milestone order changes to put a complete consultation first:
   `M0 -> M1 -> M2 -> M3 -> M7 -> M8 -> M4 -> M5 -> M6 -> M9 -> M10`.
   M7 no longer depends on M6 ("Prescribe from result" REP-037 stays in M6
   and plugs into the existing Rx screen). Milestone ids and task ids are
   unchanged.
3. After R5 ("Clinic Basics": patients, cases, follow-ups, Rx, print,
   billing, backup) 3 to 5 pilot doctors use an internal build for real
   consultations. It carries no repertory content, so the GPL review for
   OOREP packs does not block it.
4. From R1 on, every release must open the previous release's data
   (upgrade install with migrations); tested in CI.
5. `main` is always releasable. Unfinished features are hidden behind a
   compile-time feature flag; no visible button leads to a dead end.

## Consequences

- Each milestone needs a thin UI slice even when its focus is backend
  (M1 ships the setup wizard, unlock and backup screens).
- The licence step in the wizard uses a dev trial until M9. The early
  pilot build is internal, under the pilot agreement.
- Backlog epic `RELEASES` (HC-MVP1-214 onward) holds one demo task per
  release plus the early pilot and the upgrade-path harness.
- requirements/06 section 6 stays as written; this ADR overrides its
  order and its "Done when" is extended by the release demo.
