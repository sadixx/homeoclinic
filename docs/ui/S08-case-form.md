# S08 Case record (dated journal)
Screen id: case-form   Route: /patient/:patientId/case/:visitId   Module: apps/desktop/src/case
Requirements: CASE-001, CASE-002, CASE-003, CASE-004, CASE-005, CASE-006, CASE-009, VIS-001, PAT-009   Milestone: M3  Release: R3
Decision: docs/adr/0018-case-big-box-dated-log.md (doctor-journal model). Data shape: `.worklog/HC-MVP1-M3/handoffs/M3-RW-data-json-schema.md`.

> REWORK (M3-RW). This supersedes the structured template-field case form.
> The case body is now a dated journal of editable text + table blocks; the
> template only drives a small set of structured SIDE sections. The old
> section/field grid, the narrative field, the Personal history section and the
> separate Case summary view are removed (ADR 0018).

## Purpose

The first-consultation and ongoing case record. It feels like the doctor's
paper case book: one big editable box per complaint holding free text and small
editable tables (vitals, modalities, prescription), with a new DATED entry
appended at every visit. The same box opens on the first case and on every
follow-up (S09) and is appended to, never replaced. Everything autosaves; a
visible Save button force-flushes.

## Entry points

- Patient dashboard (S05) "New visit" / "Take case" when the patient has no
  saved first case; after the first case is saved, "New visit" resolves to a
  follow-up (S09) and starting a fresh first case is greyed out (ADR 0018
  first-case gating).
- Global shortcut F5 (new visit for the open patient) when the type resolves
  to First.
- Deep link from Today (S03) when a first visit is started.

## Layout (wireframe)

Full-width content area, adaptive to the window (no narrow centered column);
usable down to 1280 x 720 at Large font. Left: complaint list + structured
side-section rail. Centre: the active complaint's dated journal box.

```
+--------------------------------------------------------------------------------------------------------+
| [< Back] Ramesh Kumar  HC-000123  34 y / M   Visit: First 16-10-2026   Next F/U: 16-11-2026  [-][zoom][+] [Save] {Saved 10:42} |
+------------------------+-------------------------------------------------------------------------------+
| COMPLAINTS       [+]   |  Headache                                        [+ Add entry]                 |
| > Headache             |  +-----------------------------------------------------------------------+     |
|   Acidity              |  | == 02-10-2026 ==                                                      |     |
|                        |  | Throbbing right temple, 3 yrs, gradual onset._____________________   |     |
| SECTIONS               |  |                                                                     |     |
|   Physical generals    |  | [Vitals table: BP(sys) BP(dia) Pulse Wt Ht BMI Temp SpO2 ]          |     |
|   Mental generals      |  |   120  | 80  | 72 | 68 | 172 | 22.9 | 98.6 | 98   (every cell editable)|     |
|   Past history         |  |                                                                     |     |
|   Family history       |  | [Rx table*: Medicine | Potency | Dosage | Instructions ]            |     |
|   Investigations       |  |   Belladonna | 200C | single dose | SOS      *not yet a prescription|     |
|   Provisional diagnosis|  | -------------------------------------------------------------------- |     |
|   Doctor's analysis    |  | == 16-10-2026 ==                                                      |     |
|                        |  | Fewer episodes, milder._______________________________________      |     |
|                        |  +-----------------------------------------------------------------------+     |
|                        |  [ Record vitals ]  [ Modalities ]  [ Add prescription ]  [ + Text ]           |
+------------------------+-------------------------------------------------------------------------------+
```

Record-vitals popup (BP as two fields; ADR 0018 #3):

```
+ Record vitals ---------------------------------+
| BP  [120] / [80] mmHg    Pulse [72] /min        |
| Weight [68.0] kg   Height [172] cm   BMI {22.9} |
| Temp [98.6] F      SpO2 [98] %                  |
|                          [Cancel]  [Record]     |
+-------------------------------------------------+
```

Family history / Investigations side sections render as tabs:

```
Family history:   [ Maternal ] [ Paternal ]       Investigations: [ Suggested ] [ Submitted (uploads) ]
```

## Fields and controls (element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Back | button | top-left, common placement (00-conventions §3); never discards (autosaves) | case-form-back |
| Save | button | force-flush autosave, shows Saved hh:mm; autosave still runs (CASE-005) | case-form-save |
| Zoom out / in | buttons | scale text + layout via rem (SET-005 extension) | case-form-zoom-out, case-form-zoom-in |
| Next follow-up display | text | shows visit.next_followup_on (read-only on this screen) | case-form-next-followup |
| Complaint list item | button | selects the active complaint box | case-form-complaint-<n> |
| Add complaint | button | appends a new complaint box | case-form-add-complaint |
| Remove complaint | button | confirm if it has entries | case-form-remove-complaint-<n> |
| Complaint title | text input | one-line name; becomes the S09 pre-load row header | case-form-complaint-title-<n> |
| Add entry | button | inserts a dated header (today) + an empty block area | case-form-add-entry |
| Entry date header | text (read-only label) | RFC3339 date via shared/datetime | case-form-entry-<complaintId>-<entryIdx> |
| Text block | textarea (editable) | free prose; autosave | case-block-<complaintId>-<blockId> |
| Add text block | button | inserts an empty text block in the current entry | case-form-add-text |
| Table cell | text input (editable) | EVERY cell editable incl. header cells | case-cell-<complaintId>-<blockId>-<r>-<c> |
| Add table row | button | appends a row to a table block | case-table-add-row-<blockId> |
| Remove block | button | removes a text/table block (confirm if non-empty) | case-block-remove-<blockId> |
| Record vitals / Update vitals | button -> popup | popup collects sys+dia+pulse+wt+ht+temp+spo2; inserts editable vitals table; mirrors vitals_json; live BMI (CASE-001) | case-form-record-vitals |
| Vitals popup BP systolic / diastolic | number inputs | TWO separate fields (ADR 0018 #3) | case-vitals-bp-sys, case-vitals-bp-dia |
| Modalities / Update modalities | button | inserts editable modalities table (Factor/Agg/Amel) | case-form-modalities |
| Add prescription / Update prescription | button | inserts NEW editable Rx table (Medicine/Potency/Dosage/Instructions); PLACEHOLDER, not a prescription (ADR 0018 #4) | case-form-add-prescription |
| Rx placeholder hint | text | "Not yet a prescription — printing arrives in R4" | case-form-rx-placeholder-hint |
| Physical generals | fields | appetite, thirst, cravings, aversions, stool, urine, sweat, sleep, dreams, thermal, + Constitution, Diet, Sun-aggravation (yes/no), Notes | case-form-generals-<key> |
| Family history tabs | tabs + long text | Maternal / Paternal (separate data) | case-form-family-maternal, case-form-family-paternal |
| Investigations tabs | tabs + long text | Suggested / Submitted; Submitted hosts PAT-009 uploads | case-form-invest-suggested, case-form-invest-submitted |
| Investigations uploader | panel | PAT-009 attach/list/open/remove (under Submitted) | case-form-investigations-* |
| Provisional diagnosis | long text | free text | case-form-diagnosis |
| Doctor's analysis/notes | long text | free text | case-form-analysis |
| Menstrual/obstetric section | section | shown when sex = female (CASE-001) | case-form-section-menstrual |
| Child development section | section | shown when age < 14 (CASE-001) | case-form-section-child |

REMOVED controls (were in R3): Case summary button (`case-form-case-summary`),
the HPI narrative field, the Personal history section, the per-field complaint
grid (Location/Sensation/Agg/Amel/Concomitant/Duration/Onset as discrete inputs
— now written as journal text/tables). Send-to-repertory (CASE-006) stays
behind its R7 feature flag and is not rendered.

## Behaviour

- On open, `case_visit_open_or_create` returns the open/created First visit and
  its `data_json`; the UI parses the `case-journal` document (schema §1) and
  restores every complaint box exactly (CASE-005). A legacy R3 `data_json`
  (schema !== "case-journal") is upcast in memory to one dated entry per
  complaint (ADR 0018 #8 / schema §7); disk is untouched until first autosave.
- A brand-new first case shows one empty complaint with one dated entry.
- "Add entry" appends a dated header with today's date; new content goes under
  it (running log). The same box opens again on every follow-up (S09).
- Buttons insert EDITABLE table blocks; the vitals popup seeds the first row but
  every cell stays editable. In a follow-up the buttons read "Update ...".
- Autosave: 2 s after the last change and on blur, through `case_visit_autosave`
  with the whole serialized document (CASE-005). The Save button force-flushes
  and shows Saved hh:mm; autosave is never removed.
- Pick-list side fields (thermal, thirst, sun-aggravation) offer common values
  but accept free text where applicable (CASE-003); sun-aggravation is a plain
  yes/no.
- BMI recomputes live in the vitals popup from weight/height (CASE-001) and is
  written as an editable cell.
- The journal is the case summary; there is no separate summary view (CASE-009
  print path moves to R4/S14).

## Release slices

- R3 (M3, first usable): the full journal case form — big editable box per
  complaint (ADR 0018 #1), dated entries (#2), inserted editable vitals/
  modalities tables with BP sys+dia (#3), prescription placeholder table (#4),
  removals (#5), template side-section changes (#6: physical generals additions,
  family Maternal/Paternal tabs, investigations Suggested/Submitted tabs),
  autosave + explicit Save, legacy R3 upcast (#8). Pick lists with free text
  (CASE-003), conditional female/child sections (CASE-001), collapsible/hideable
  side sections (CASE-002), PAT-009 uploads under Submitted.
- R4 (M7): the prescription placeholder table is superseded by the real Rx
  engine (S13); the journal becomes printable through S14 (CASE-009 intent).
- R5 (M8): dues auto-shown on save + Clear-dues on home become real (BILL-001..
  002); placeholder/omitted until then.
- R7 (M6): Send-to-repertory (CASE-006) becomes visible/active; feature-flagged
  off and not rendered before then.
- R9 (M10): P1 touches — voice dictation (CASE-007), body diagram (CASE-008),
  and the custom template editor (CASE-004), which now edits the structured
  side sections only (the journal body is not schema-driven).

## States

- Empty: new First visit; one empty complaint box with one dated entry; hint
  "Start writing the case — add vitals, modalities or a prescription with the
  buttons below".
- Loading: skeleton complaint list + skeleton journal box after 150 ms; never a
  blocking spinner.
- Error: autosave failure shows the inline status-bar warning "Not saved —
  retrying" with a Details expander for a support code; data kept in memory and
  retried; no stack traces (NFR-033).
- Read-only (LIC-020): an already-open visit can always be finished (SUX-008);
  starting a brand-new first case is disabled with the renew tooltip; viewing
  stays enabled.
- Trial: unchanged; trial badge in nav only (SUX-003).

## Keyboard

- F5 new visit, Ctrl+S force save (Save button; autosave still runs), Esc closes
  a dialog/popup without discarding, Alt+Left back, Ctrl+= / Ctrl+- zoom in/out.
  Shortcuts never fire during IME composition.

## Commands used (proposed Tauri command names)

- `case_visit_open_or_create` req { patient_id, visit_type } resp { visit_id, template_id, data_json, vitals_json, visit_at, next_followup_on, has_saved_first_case }  (next_followup_on + has_saved_first_case are additive this rework)
- `case_template_get_default` req {} resp { template_id, name, schema_json }  (schema_json now side-sections only)
- `case_template_list` req {} resp { templates: [{ id, name, is_default }] }
- `case_visit_autosave` req { visit_id, data_json, vitals_json } resp { saved_at }  (data_json carries the case-journal document, opaque)
- `visit_set_next_followup` req { visit_id, next_followup_on } resp { ok }
- PAT-009 attachments (unchanged): `visit_pick_report_file`, `visit_attach_report`, `visit_list_attachments`, `visit_open_attachment`, `visit_delete_attachment`
- `case_summary_render` — DEPRECATED this slice; no UI entry point (ADR 0018 #5).
- `rubric_search_prefill` — R7 only (CASE-006), feature-flagged off.

## Acceptance checks

- Opening a first case shows one editable complaint box; typing text, adding a
  dated entry, recording vitals (BP sys + dia as two fields -> editable vitals
  table), adding modalities and adding a prescription table all persist.
- Every text block and every table cell (including header cells) is editable.
- "Add entry" inserts a dated header; a follow-up (S09) appends a new dated
  entry to the same box rather than replacing it.
- The prescription table is captured but produces no Rx record/print and is
  marked a placeholder (ADR 0018 #4).
- The Case summary button, the narrative field and the Personal history section
  are absent.
- Physical generals shows Constitution, Diet, Sun-aggravation (yes/no) and
  Notes; Family history shows Maternal/Paternal tabs; Investigations shows
  Suggested/Submitted tabs with PAT-009 uploads under Submitted.
- Killing the process mid-typing restores the last autosaved journal on reopen
  with no loss (CASE-005; acceptance flow 3).
- Autosave fires within 2 s and on blur; the Save button force-flushes and
  shows Saved hh:mm.
- An upgrade install over R2/R3 opens an existing R3 visit and shows its prior
  content as the first dated entry, editable (ADR 0018 #8; harness
  HC-MVP1-226).
- Menstrual section only for female; child development only for age < 14.
- Patient age in the header is derived from DOB at read time.

## Open questions

Carried from R3 and newly resolved by ADR 0018:
- CASE-OQ-1 (autosave debounce 2 s): unchanged; the journal keeps 2 s + blur.
- CASE-OQ-2 (per-template field sets): resolved — templates now describe only
  the structured side sections (ADR 0018 #6 / migration change list).
- CASE-OQ-3 (Marathi in case fields): unchanged; the journal is English-only
  text; Marathi stays limited to printed advice (S14).

---

# S09 delta (Follow-up visit) — M3-RW

Full S09 spec: `docs/ui/S09-follow-up-visit.md`. This rework changes S09 as
follows (ADR 0018); the VIS-002/003/004 structured controls are RETAINED.

## What changes in S09

- The follow-up OPENS THE SAME complaint journal boxes as S08 (shared
  `case-journal` document on `visit.data_json` of the follow-up visit) and
  APPENDS a new dated entry (today) to each pre-loaded complaint box. The doctor
  writes the follow-up prose + tables in the same big box as the first case.
- The vitals/modalities/prescription buttons appear here too; their labels read
  "Update vitals" / "Update modalities" / "Update prescription" (ADR 0018
  #3/#4). Each inserts a NEW table block under the new dated entry.
- RETAINED structured controls (unchanged from R3): visit type (VIS-001),
  per-complaint status Better/Same/Worse/New/Resolved + improvement % slider
  (VIS-002, `complaint_status_json` / `improvement_pct_json`, ADR 0016), remedy
  response six options (VIS-003), next-follow-up quick buttons + custom
  (VIS-004). These feed VIS-007's R9 progress chart; the journal adds the prose.
- Header gains the common Back, the Save button, zoom, and a next-follow-up
  DISPLAY (the scheduled date), matching S08.
- Pre-load maps the previous visit's complaint boxes by `complaint.id` (the
  VIS-002 key) so status/improvement line up with the right journal box.

## S09 controls added/changed (element | type | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Save | button | force-flush autosave (mirrors S08) | followup-save |
| Record/Update vitals | button -> popup | sys+dia two fields; inserts editable vitals table into this visit's journal entry | followup-record-vitals |
| Update modalities | button | inserts editable modalities table | followup-modalities |
| Update prescription | button | inserts NEW editable Rx placeholder table (ADR 0018 #4) | followup-add-prescription |
| Complaint journal box | editable box | appended dated entry per pre-loaded complaint | followup-journal-<n> |
| Next follow-up display | text | shows the scheduled date alongside the quick buttons | followup-next-followup |

## S09 acceptance delta

- Opening a follow-up appends a dated entry to each pre-loaded complaint's
  journal box (not a replacement); the big box shows the prior entries above.
- Update vitals (BP sys + dia), Update modalities and Update prescription insert
  editable tables into the new entry.
- The VIS-002 status + improvement %, VIS-003 remedy response and VIS-004 next
  follow-up still work and still persist to their columns/JSON (ADR 0016).
- Prescribe (S13, R4) stays rendered-but-disabled (no dead end, ADR 0002); the
  Update-prescription placeholder table is the R3 stand-in and is not a real Rx.
