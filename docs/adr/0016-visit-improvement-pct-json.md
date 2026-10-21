# ADR 0016: visit per-complaint improvement stored as `improvement_pct_json`

Status: Accepted (M3-A, HC-MVP1-M3a-case-visits)
Date: 2026-10-21
Supersedes/affects: `docs/requirements/06-architecture-data-model.md` section 3
(the `visit` table column list)

## Context

`docs/requirements/06` section 3 lists the `visit` table with a scalar column
`improvement_pct`. VIS-002, however, requires the follow-up form to track a
**status and a percentage improvement per complaint** (the previous visit's
complaints are pre-loaded, each with Better / Same / Worse / New / Resolved and
a 0–100 improvement slider). A single scalar cannot hold a per-complaint map.

The leader-extracted S09 command contract and the M3 task both specify
`improvement_pct_json` (a JSON object keyed by complaint key), consistent with
the sibling `complaint_status_json` column that §3 already lists.

## Decision

The `visit` table stores `improvement_pct_json TEXT` — a JSON object keyed by
complaint key (e.g. `{"cc1": 40, "cc2": 0}`) — instead of the scalar
`improvement_pct` named in §3. This is a **forward-only superset** of §3: it
carries strictly more information (per-complaint rather than one number) and
matches the VIS-002 behaviour and the `complaint_status_json` shape already in
§3.

No value is lost; a consumer that only wants an overall number can derive it
from the per-complaint map.

## Consequences

- `docs/requirements/06` §3 needs a one-line note that `improvement_pct` is
  realised as `improvement_pct_json` (per-complaint), cross-referencing this
  ADR. (Flagged to the orchestrator; the design doc is not silently edited.)
- Migration `0009_visit.sql` creates `improvement_pct_json TEXT`.
- `hc_storage::visit::VisitRow` carries `improvement_pct_json: Option<String>`.
- The `visit_autosave` command request carries `improvementPctJson: string`.
- VIS-007 (progress chart) at R9 reads this per-complaint map directly; the
  scalar would have blocked that feature, so this decision also avoids a future
  migration.

## Alternatives considered

1. **Keep the scalar `improvement_pct`.** Rejected: cannot represent VIS-002's
   per-complaint requirement; would force a later breaking migration for VIS-007.
2. **A separate `visit_complaint` child table.** Deferred: heavier than needed
   for MVP1; the JSON column mirrors `complaint_status_json` and keeps the
   follow-up autosave a single-row write (one txn, one audit row — R-DATA-001).
   A normalised child table can be introduced later without changing the
   command contract if query needs demand it.
