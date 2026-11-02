# ADR 0018: Case record as a dated journal of editable text + table blocks

Status: Accepted (M3-RW, branch `HC-MVP1-M3a-case-visits`)
Date: 2026-10-22
Affects: `docs/ui/S08-case-form.md`, `docs/ui/S09-follow-up-visit.md`,
`docs/adr/0007-case-data-template-json-fts.md` (narrows how `data_json` is
shaped — the "template-driven JSON" is now a journal document, not a
section/field answer map), the three seed templates in migration 0008, and the
`visit.data_json` contract. Flagged to the orchestrator; design docs are not
silently edited.
Supersedes for the case form: the structured template-field engine shipped by
HC-MVP1-058..064. Does NOT change the storage contract: `visit.data_json`
remains an opaque JSON `TEXT` column (ADR 0007), so autosave/restore and the
`visit_fts` triggers (migration 0009) keep working unchanged.

## Context

R3 shipped a structured case form (S08): a JSON-schema template renders
sections -> typed fields; the doctor fills discrete fields (`sensation`,
`agg`, `thermal`, vitals numbers, ...) and the answers serialize into
`visit.data_json` as `{ chief_complaints: [ {field: value} ], <section>: {field:
value} }`. The follow-up form (S09) is a separate, differently-shaped screen
(status/improvement per complaint + remedy response + observations).

The product owner has decided this does not match how a homoeopath actually
writes a case. A doctor writes a **running journal per complaint**: free prose
interleaved with small tables (vitals, modalities, a medicine list), with a new
**dated entry** appended at every visit. The structured field grid gets in the
way; the narrative field, the "Personal history" section and the separate
"Case summary" view are redundant with a good journal.

The decision is to **replace** (not supplement) the structured form with a
doctor-journal model, keeping the backend storage contract opaque so the data
layer, autosave, restore, FTS and the one-txn-one-audit rule are untouched.

## Decision

1. **One big editable box per complaint.** The case screen is a list of
   complaints; each complaint owns a single rich content box the doctor edits
   freely. The box is an ordered list of **blocks**: a `text` block (editable
   prose) or a `table` block (editable grid, every cell editable). There is no
   section/field grid and no per-field schema for the body.

2. **Dated entries (running log).** Each complaint box is a sequence of
   **entries**; an entry carries the date it was opened (`entry_date`) and owns
   the blocks added under it. "Add entry" appends a new entry with today's date
   header; the same box opens on the first case and on every follow-up and is
   **appended to**, never replaced. The follow-up screen (S09) reuses this
   model: opening a follow-up adds a new dated entry to each pre-loaded
   complaint's box.

3. **Buttons insert editable table blocks.** "Record vitals" opens a small
   popup (BP systolic + diastolic as two fields, pulse, weight, height, temp,
   SpO2) and on Record inserts an **editable** `vitals` table block into the
   current entry; "Modalities", "Aggravation/Amelioration" etc. insert editable
   `modalities` table blocks. In a follow-up the same buttons read "Update
   vitals" / "Update ..." but behave identically (insert a new table block under
   the new dated entry). After insertion every cell is editable like any other
   table block — the popup is only a fast way to seed the first row.

4. **Prescription box = placeholder editable medicine table.** "Add
   prescription" (first) / "Update prescription" (follow-up) inserts a NEW
   editable `prescription` table block (columns Medicine, Potency, Dosage,
   Instructions). Each press inserts another table. This is a **placeholder**:
   the captured rows are plain `data_json` content marked `rx_placeholder:
   true`; they are NOT a prescription record, produce no Rx row and no print.
   The real Rx engine is R4 / M7 (RX-001..006, S13). The boundary is explicit so
   R4 can migrate or ignore these rows.

5. **Removals.** The "Case summary" button and its UI path are removed from the
   case screen (the journal IS the summary). The backend `case_summary_render`
   command MAY remain registered but unused/deprecated this slice (no dead-end
   control is rendered; a later slice can delete it). The `narrative` field and
   the "Personal history" section are removed from all templates.

6. **Template changes (migration-forward).** Templates no longer describe the
   case body; they now describe only the small set of **structured side
   sections** that remain useful as discrete data: Physical generals (adds
   Constitution, Diet, a "Sun aggravation" yes/no, Notes), Family history
   (Maternal / Paternal tabs = two separate data groups), Investigations
   (Suggested / Submitted tabs; Submitted holds the PAT-009 uploads). See the
   migration change list in the handoff.

7. **Versioned, backend-opaque document.** `visit.data_json` carries a
   versioned journal document (`schema: "case-journal"`, `version: 2`). Storage
   stays opaque (ADR 0007): the column is still `TEXT`, written whole on
   autosave, restored whole on open, and the `visit_fts` trigger still indexes
   `COALESCE(data_json,'')` — because the doctor's text lives inside the JSON as
   string values, FTS continues to find case text with no trigger change. The
   exact shape is specified in
   `.worklog/HC-MVP1-M3/handoffs/M3-RW-data-json-schema.md`.

8. **Backward compatibility (read old R3 data_json).** Existing R3 visits hold
   the structured `{ chief_complaints:[...], <section>:{...} }` shape
   (`version: 1` or absent). On open, the UI detects a non-journal document and
   runs a **best-effort, one-way, in-memory upcast**: it renders the prior
   structured content as the text of a single dated entry (dated from the
   visit's `visit_at`) under a complaint per `chief_complaints[]` entry, and
   folds the old non-repeatable sections into a readable text block. Vitals from
   the old `vitals_json` seed one `vitals` table block. Nothing is destroyed on
   disk until the doctor edits and autosave rewrites the column in `version: 2`.
   This keeps "upgrade install over R2/R3 opens its data" (R-DEL-004) true. See
   the compatibility note in the handoff.

## Cross-cutting decisions (designed now, built in later slices)

- **Explicit Save button + autosave.** The clinical form keeps 2 s / on-blur
  autosave (CASE-005), and additionally shows an explicit "Save" button that
  force-flushes and shows "Saved hh:mm" (Ctrl+S already does this; the button
  makes it visible). This is additive — autosave is never removed.
- **Next-follow-up display.** The scheduled next follow-up (from `visit.
  next_followup_on`) is displayed on the case/follow-up header, not only set.
- **Patient age auto-updates from DOB on read.** Age shown on the header is
  derived from DOB at read time (a pure display computation), not stored; a
  stored `age_years` remains the fallback when DOB is unknown.
- **First-case gating.** Once the patient's first case (type `first`) is saved,
  "New visit" resolves to follow-up only; starting a brand-new first case is
  greyed out (the first case is done). This is a UI resolution rule over
  existing visit data; no new column.
- **UX shell.** Common Back placement (00-conventions §3), zoom in/out of text
  AND layout (extends SET-005 font-size to a layout zoom), and an adaptive
  full-resolution layout (the journal uses the full content width instead of a
  narrow centered column). Dues auto-shown on save + Clear-dues on home are
  **placeholders** (billing is R5 / M8, BILL-001..002).

## Consequences

- The data layer, migrations 0009 triggers, `VisitRow`, `case_visit_autosave`
  and `visit_autosave` command contracts are UNCHANGED — `data_json` stays an
  opaque string the UI owns. This is the main reason the journal model is cheap
  to adopt.
- FTS keeps working with no trigger edit because case text is stored as JSON
  string values inside `data_json`; a doctor searching "migraine" still matches.
  (Minor: JSON punctuation is indexed too, but the `unicode61` tokenizer already
  drops it; no correctness loss.)
- The template `schema_json` becomes much smaller (only the structured side
  sections). The case BODY is no longer schema-driven, so the R9 custom-template
  editor (CASE-004) now edits only the side sections — recorded here so that
  later slice is scoped correctly.
- ADR 0007 still holds in spirit (case data is template-driven opaque JSON with
  FTS) but its example shape is superseded by the journal document; a one-line
  cross-reference is flagged to the orchestrator.
- `case_summary_render` (CASE-009) loses its UI entry point. CASE-009's intent
  (a printable record) is served later by printing the journal (R4 via S14); the
  backend command is left deprecated-but-present this slice to avoid a churny
  delete, and no dead-end button is rendered (ADR 0002 / R-DEL-002).
- VIS-002's status/improvement-per-complaint data (`complaint_status_json`,
  `improvement_pct_json`, ADR 0016) is RETAINED: the follow-up still records a
  status + improvement per complaint alongside the journal entry, so VIS-007's
  R9 progress chart still has its series. The journal adds the prose; it does not
  remove the structured follow-up signals.

## Alternatives considered

1. **Supplement the structured form with a free-text journal field.** Rejected
   by the product owner: the field grid is the thing doctors dislike; keeping it
   alongside a journal is two sources of truth.
2. **Model the journal as HTML in `data_json`.** Rejected: HTML in an opaque
   column is hard to migrate, hard to make every cell reliably editable, and
   risks injection when rendered. A typed block list (text | table) is explicit,
   testable, and trivially FTS-indexable.
3. **A normalised `case_entry` / `case_block` table set.** Deferred: heavier
   than MVP1 needs and would change the autosave write from one-row to many-row,
   breaking the one-txn-one-audit single-row write. The versioned JSON document
   keeps autosave a single `UPDATE visit` (R-DATA-001).
4. **Hard-migrate R3 structured data into journal blocks via a SQL migration.**
   Rejected for this slice (the task forbids writing migrations and prefers a
   best-effort read-time upcast): a lossy one-way transform is safer done
   in-memory on open, leaving disk untouched until the doctor edits.
