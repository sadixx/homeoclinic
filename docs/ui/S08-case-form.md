# S08 Case record (one rich WYSIWYG document per complaint)
Screen id: case-form   Route: /patient/:patientId/case/:visitId   Module: apps/desktop/src/case
Requirements: CASE-001, CASE-002, CASE-003, CASE-004, CASE-005, CASE-006, CASE-009, VIS-001, PAT-009   Milestone: M3  Release: R3
Decision: docs/adr/0019-case-rich-editor.md (ONE rich WYSIWYG editor per complaint; TipTap/ProseMirror). Supersedes the ADR 0018 hand-rolled block-list editor (product intent retained). Data shape: `.worklog/HC-MVP1-M3/handoffs/M3-RWv2-serialization-v3.md` (v3 `case-rich`).

> REWORK v2 (M3-RWv2). The case body is now ONE true rich WYSIWYG editor per
> complaint (not separate text boxes + input grids). All data — free prose AND
> every recorded section — lives inside one document, in authored order. The
> structured side-section rail is replaced by RECORD BUTTONS that insert real,
> editable Office-style TABLES into the current dated entry, under a NUMBERED
> section heading, separated by a full-width horizontal rule. The backend
> storage contract is unchanged (opaque `visit.data_json`, ADR 0007).

## Purpose

The first-consultation and ongoing case record. It feels like WordPad/Word: one
editable page per complaint holding free text and inserted editable tables
(vitals, modalities, family history, physical generals, investigations,
prescription), with a new DATED entry appended at every visit. The same document
opens on the first case and on every follow-up (S09) and is appended to, never
replaced. Everything autosaves; a visible Save button force-flushes.

## Entry points

- Patient dashboard (S05) "New visit" / "Take case" when the patient has no
  saved first case; after the first case is saved, "New visit" resolves to a
  follow-up (S09) and starting a fresh first case is greyed out (first-case
  gating, carried from ADR 0018).
- Global shortcut F5 (new visit for the open patient), from the dashboard or
  from inside a case: it checks `visit_has_saved_first_case`; with no saved
  first case it opens this screen as a First visit, and once a first case is
  saved it resolves to a follow-up (S09, the same path as the dashboard's "New
  visit"), so F5 never creates a second first case (HC-MVP1-M3vis). If the
  check fails the existing "could not open" alert shows and nothing is created.
- Deep link from Today (S03) when a first visit is started.

## Layout (wireframe)

Full-width content area, adaptive to the window (no narrow centered column);
usable down to 1280 x 720 at Large font. Left: complaint list. Centre: the
active complaint's ONE rich editor (the single notepad). The record buttons sit
in a toolbar under the editor; the PAT-009 uploader is a side panel.

```
+--------------------------------------------------------------------------------------------------------+
| [< Back] Ramesh Kumar  HC-000123  34 y / M   Visit: First 16-10-2026   Next F/U: 16-11-2026  [-][zoom][+] [Save] {Saved 10:42} |
|          [7 days][15 days][1 month][2 months]  Custom date [dd-mm-yyyy]  [Clear]   (inline after Next F/U; wraps here when narrow) |
+------------------------+-------------------------------------------------------------------------------+
| COMPLAINTS       [+]   |  Headache                                        [+ Add entry]                 |
| > Headache             |  +=====================================================================+       |
|   Acidity              |  | == 02-10-2026 ==                             (dated entry heading)   |       |
|                        |  | Throbbing right temple, 3 yrs, gradual onset. The pain is...        |       |
|                        |  | ================================================  (full-width rule) |       |
|                        |  | 1. Vitals                                    (numbered section)     |       |
|                        |  | +----------+----------+-------+------------+-----+------+-----+     |       |
|                        |  | | BP (sys) | BP (dia) | Pulse | Weight(kg) | BMI | Temp | SpO2|     |       |
|                        |  | |   120    |   80     |  72   |    68      |22.9 | 98.6 | 98  |     |       |
|                        |  | +----------+----------+-------+------------+-----+------+-----+     |       |
|                        |  |        (every cell editable in place; Tab moves between cells)      |       |
|                        |  | ================================================                    |       |
|                        |  | 2. Prescription*       *placeholder — printing arrives in R4        |       |
|                        |  | | Medicine | Potency | Dosage | Instructions |                      |       |
|                        |  | | Belladonna | 200C | single dose | SOS       |                      |       |
|                        |  | == 16-10-2026 ==                                                     |       |
|                        |  | Fewer episodes, milder.                                             |       |
|                        |  +=====================================================================+       |
|                        |  [Record vitals][Record modalities][Record family history]                    |
|                        |  [Record physical generals][Record investigations][Add prescription][+ Text]  |
|                        |  --- Lab reports (uploads) ------------------------------------  (side panel) |
+------------------------+-------------------------------------------------------------------------------+
```

Record-vitals popup (BP as two fields; ADR 0019 #7):

```
+ Record vitals ---------------------------------+
| BP  [120] / [80] mmHg    Pulse [72] /min        |
| Weight [68.0] kg   Height [172] cm   BMI {22.9} |
| Temp [98.6] F      SpO2 [98] %                  |
|                          [Cancel]  [Record]     |
+-------------------------------------------------+
```

Family-history popup (Maternal / Paternal tabs -> two-column table; ADR 0019 #7):

```
+ Record family history --------------------------+
|  [ Maternal ] [ Paternal ]                       |
|  +--------------------------------------------+  |
|  | Diabetes                                   |  |   (one line -> one row;
|  | Thyroid                                    |  |    Maternal in col 1,
|  +--------------------------------------------+  |    Paternal in col 2)
|                           [Cancel]  [Record]     |
+--------------------------------------------------+
```

## Record buttons -> popup -> inserted table-node mapping

| Button (testid) | Popup fields | Inserts (v3 node) | Heading | Table columns |
|---|---|---|---|---|
| Record vitals (`case-form-record-vitals`) | BP sys + dia (two fields), pulse, weight, height (live BMI), temp, SpO2 | rule + section heading + `table hcTableType=vitals` | "N. Vitals" | BP (sys), BP (dia), Pulse, Weight (kg), Height (cm), BMI, Temp, SpO2 |
| Record modalities (`case-form-modalities`) | factor/agg/amel rows | rule + heading + `table hcTableType=modalities` | "N. Modalities" | Factor, Aggravation (<), Amelioration (>) |
| Record family history (`case-form-record-family`) | Maternal tab + Paternal tab (long text) | rule + heading + `table hcTableType=family_history` (TWO columns) | "N. Family history" | Maternal, Paternal |
| Record physical generals (`case-form-record-generals`) | appetite, thirst, cravings, aversions, stool, urine, sweat, sleep, dreams, thermal, constitution, diet, sun-aggravation (yes/no), notes | rule + heading + `table hcTableType=physical_generals` | "N. Physical generals" | Field, Value |
| Record investigations (`case-form-record-investigations`) | investigation / status (Suggested/Submitted) / notes rows | rule + heading + `table hcTableType=investigations` | "N. Investigations" | Investigation, Status, Notes |
| Add/Update prescription (`case-form-add-prescription`) | medicine/potency/dosage/instructions | rule + heading + `table hcTableType=prescription hcRxPlaceholder=true` | "N. Prescription" | Medicine, Potency, Dosage, Instructions |

After insertion every cell (including header cells) is editable in place; Tab /
Shift-Tab move between cells; table controls add/remove rows and columns. The
popup only seeds the first row. On a follow-up the labels read "Update vitals"
etc.; behaviour is identical (insert under the NEW dated entry).

## Numbering scheme

- Per-complaint, monotonic, document-scoped (v3 §4). Each complaint owns a
  `next_section_no` starting at 1. Inserting a section stamps the heading's
  `hcSectionNo`, then increments the stored counter.
- Numbers are stored on the heading node AND the counter is stored on the
  complaint, so a reload renders identical numbers and a new insert never reuses
  a number even after a delete (chronological order is fixed). Deleting a
  section does not renumber survivors.
- Rendered as the heading prefix "N. <Label>" (Label from `en.json` by section
  type), derived from the attrs at render time so it cannot drift.

## Separators

- Each inserted section is preceded by a full-width horizontal rule — a standard
  `horizontalRule` node styled to span the editor width (the `=====` look is a
  CSS rule under `style-src 'self'`; the node is unstyled markup).
- The separator is omitted when the section is the first block after its own
  dated-entry heading (no double rule).

## Fields and controls (element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Back | button | top-left, common placement (00-conventions §3); never discards (autosaves) | case-form-back |
| Save | button | force-flush autosave, shows Saved hh:mm; autosave still runs (CASE-005) | case-form-save |
| Zoom out / in | buttons | scale the editor DOCUMENT ROOT (WYSIWYG page zooms as a unit; SET-005 extension) | case-form-zoom-out, case-form-zoom-in |
| Next follow-up display | text | shows visit.next_followup_on as `Next F/U: DD-MM-YYYY` (or `Next F/U: —`); updates after each successful set/clear | case-form-next-followup |
| Next follow-up group | role=group, name "Next follow-up" | EDITABLE on this screen for first AND follow-up visits (VIS-004, HC-MVP1-M3vis); sits in the header beside the display and wraps under it when the window is narrow (no horizontal scroll at 1366x768) | case-form-next-group |
| 7 days / 15 days / 1 month / 2 months | buttons (visible text = accessible name) | set next follow-up to LOCAL today + 7 / 15 days or + 1 / 2 months (same day of month, clamped to month end, e.g. 31 Jan + 1 month = 28/29 Feb) via `visit_set_next_followup` | case-form-next-7d, case-form-next-15d, case-form-next-1m, case-form-next-2m |
| Custom date | date input inside a visible "Custom date" label | today or later (min = local today); a past date shows an inline alert and is never sent; committed only on blur or Enter of a complete valid date (never by a timer or on an intermediate segment edit); a pointer click on a quick button or Clear supersedes an uncommitted custom date without writing it | case-form-next-custom |
| Clear | button | sets next follow-up to none (`next_followup_on: null`); disabled when none is set | case-form-next-clear |
| Next follow-up error | inline role=alert | "Pick today or a later date." (past custom date) or "Could not set the follow-up date. Please try again." (command failed; the saved value is kept) | case-form-next-error |
| Complaint list item | button | selects the active complaint editor | case-form-complaint-<n> |
| Add complaint | button | appends a new complaint editor | case-form-add-complaint |
| Remove complaint | button | confirm if it has content | case-form-remove-complaint-<n> |
| Complaint title | text input | one-line name; becomes the S09 pre-load row header | case-form-complaint-title-<n> |
| Rich editor | contenteditable (TipTap) | the single notepad for the active complaint; all prose + inserted tables | case-form-editor-<complaintId> |
| Add entry | button | inserts a dated-entry heading (today) + empty paragraph at the end | case-form-add-entry |
| Add text | button | focuses a new paragraph in the current entry (free prose) | case-form-add-text |
| Record vitals / Update vitals | button -> popup | BP sys + dia two fields; inserts editable vitals table; live BMI; mirrors vitals_json (CASE-001) | case-form-record-vitals |
| Vitals popup BP systolic / diastolic | number inputs | TWO separate fields (ADR 0019 #7) | case-vitals-bp-sys, case-vitals-bp-dia |
| Record modalities / Update modalities | button -> popup | inserts editable modalities table | case-form-modalities |
| Record family history | button -> popup | Maternal/Paternal tabs; inserts TWO-column table | case-form-record-family |
| Family popup Maternal / Paternal tab | tabs + long text | two independent tabs (ADR 0019 #7) | case-family-maternal, case-family-paternal |
| Record physical generals | button -> popup | inserts key/value generals table (incl. Constitution, Diet, Sun-aggravation yes/no, Notes) | case-form-record-generals |
| Record investigations | button -> popup | inserts investigations table (Suggested/Submitted status); the uploader is separate | case-form-record-investigations |
| Add prescription / Update prescription | button -> popup | inserts NEW editable Rx table marked PLACEHOLDER (`hcRxPlaceholder`); not a prescription (ADR 0019 #11) | case-form-add-prescription |
| Rx placeholder hint | text | "Not yet a prescription — printing arrives in R4" | case-form-rx-placeholder-hint |
| Table cell | contenteditable cell | EVERY cell editable incl. header cells; Tab moves between cells | case-cell-<complaintId>-<sectionNo>-<r>-<c> |
| Add table row / column | controls | append a row/column to the active table | case-table-add-row, case-table-add-col |
| Investigations uploader | panel (side control) | PAT-009 attach/list/open/remove; manages real attachment rows keyed by visit_id (NOT editor content) | case-form-investigations-* |

REMOVED controls vs ADR 0018 build: the structured side-section RAIL (Physical
generals / Mental generals / Past history / Family history / Investigations /
Provisional diagnosis / Doctor's analysis as separate data-bearing form fields)
is gone — that data is now recorded via the record-button popups as in-document
tables, or typed as free prose. Also still absent (removed in ADR 0018): the
Case summary button (`case-form-case-summary`), the HPI narrative field, the
Personal history section, the per-field complaint grid. Send-to-repertory
(CASE-006) stays behind its R7 feature flag and is not rendered.

## Behaviour

- On open, `case_visit_open_or_create` returns the open/created visit and its
  `data_json`; the UI runs `parseCaseDoc` (v3 §8): a `case-rich` v3 document is
  restored exactly; a v2 `case-journal` document is upcast to v3 in memory; a
  legacy R3 document is upcast R3 -> v2 -> v3 in memory. Disk is untouched until
  the first autosave rewrites v3 (CASE-005; R-DEL-004).
- A brand-new first case shows one empty complaint whose editor has one dated
  entry.
- "Add entry" appends a dated-entry heading with today's date; new content goes
  under it (running log). The same document opens again on every follow-up (S09).
- Record buttons insert EDITABLE tables under a numbered heading separated by a
  full-width rule; cells stay editable (Tab between cells, add/remove rows). The
  vitals popup seeds the first row and splits BP into sys/dia; BMI recomputes
  live (CASE-001) and is written as an editable cell.
- Autosave: 2 s after the last change and on blur, through `case_visit_autosave`
  with the whole serialized v3 document (opaque; includes the regenerated `text`
  mirror for FTS). The Save button force-flushes and shows Saved hh:mm; autosave
  is never removed. Killing mid-type restores the last autosaved document.
- The journal document IS the case summary; there is no separate summary view
  (CASE-009 print path moves to R4/S14, which renders the v3 `doc`).

## Release slices

- R3 (M3, first usable): the full rich-editor case form — one TipTap editor per
  complaint (ADR 0019 #5), dated entries (#5), record buttons inserting editable
  tables with numbered headings + full-width rules (#6), BP sys+dia vitals (#7),
  family two-column table (#7), prescription placeholder table (#11), v2+legacy
  upcast (#9/#10, v3 §8), follow-up copy-forward (#10, v3 §9), autosave +
  explicit Save, fixed document-root zoom, adaptive full-width, PAT-009 uploads
  as a side control. Conditional female/child sections (CASE-001) via record
  popups/prose. Build order in
  `.worklog/HC-MVP1-M3/handoffs/M3-RWv2-build-slice-plan.md`.
- R4 (M7): the prescription placeholder is superseded by the real Rx engine
  (S13); the v3 `doc` becomes printable through S14 (CASE-009 intent).
- R5 (M8): dues auto-shown on save + Clear-dues on home become real (BILL-001..
  002); placeholder/omitted until then.
- R7 (M6): Send-to-repertory (CASE-006) becomes visible/active; feature-flagged
  off and not rendered before then.
- R9 (M10): P1 touches — voice dictation (CASE-007), body diagram (CASE-008),
  and the custom template editor (CASE-004), which now edits the record-button
  popup field sets only (the case body is a free document).

## States

- Empty: new First visit; one empty complaint editor with one dated entry; hint
  "Start writing the case — add vitals, modalities or a prescription with the
  buttons below".
- Loading: skeleton complaint list + skeleton editor after 150 ms; never a
  blocking spinner.
- Error: autosave failure shows the inline status-bar warning "Not saved —
  retrying" with a Details expander for a support code; data kept in memory and
  retried; no stack traces (NFR-033 / R-UI-008).
- Read-only (LIC-020): an already-open visit can always be finished (SUX-008);
  starting a brand-new first case is disabled with the renew tooltip; viewing
  stays enabled.
- Trial: unchanged; trial badge in nav only (SUX-003).

## Keyboard

- F5 new visit (resolves to a follow-up once a first case is saved, see Entry
  points), Ctrl+S / Cmd+S force save from anywhere in the case form (prose, a
  table cell, the header, or nothing focused): the same immediate flush as the
  Save button, the webview's "save page" default is suppressed, autosave still
  runs. It matches the S key on non-Latin layouts too (physical key, e.g. Hindi
  InScript), and holding the chord saves once (auto-repeat is ignored). Esc
  closes a dialog/popup without discarding, Alt+Left back, Ctrl+= / Ctrl+- zoom
  in/out.
- Next follow-up: Tab reaches each quick button, the custom date and Clear;
  Enter/Space on a button sets it, Enter in the custom date commits it. Rapid
  choices are applied one at a time and the LAST choice is what stays.
  Inside a table, Tab / Shift-Tab move between cells (ProseMirror native).
  Shortcuts never fire during IME composition.

## Commands used (proposed Tauri command names)

- `case_visit_open_or_create` req { patient_id, visit_type } resp { visit_id, template_id, data_json, vitals_json, visit_at, next_followup_on }  (data_json now carries the v3 `case-rich` document, opaque)
- `case_template_get_default` req {} resp { template_id, name, schema_json }  (schema_json now drives only the record-popup field sets)
- `case_template_list` req {} resp { templates: [{ id, name, is_default }] }
- `case_visit_autosave` req { visit_id, data_json, vitals_json } resp { saved_at }  (data_json = whole v3 document incl. text mirror, opaque)
- `visit_set_next_followup` req { visit_id, next_followup_on } resp { ok }  (header Next follow-up control; `null` clears; sets visit + patient next_followup_on in one transaction with one audit row, which feeds Today Due / Overdue)
- `visit_has_saved_first_case` req { patient_id } resp { has_saved_first_case }
- PAT-009 attachments (unchanged): `visit_pick_report_file`, `visit_attach_report`, `visit_list_attachments`, `visit_open_attachment`, `visit_delete_attachment`
- `case_summary_render` — DEPRECATED this slice; no UI entry point (ADR 0018 #5 carried).
- `rubric_search_prefill` — R7 only (CASE-006), feature-flagged off.

## Acceptance checks

- Opening a first case shows ONE editable rich editor per complaint; typing
  prose, adding a dated entry, and each record button (vitals with BP sys+dia,
  modalities, family history two-column, physical generals, investigations,
  prescription) inserts an editable table under a numbered heading separated by
  a full-width rule, and all persist.
- Every paragraph and every table cell (including header cells) is editable;
  Tab moves between cells.
- Each inserted section is numbered; numbers are stable across reload and not
  reused after a delete.
- Family history inserts a neat two-column (Maternal | Paternal) table.
- The prescription table is captured but produces no Rx record/print and is
  marked a placeholder (`hcRxPlaceholder`; ADR 0019 #11).
- The Case summary button, the narrative field and the Personal history section
  are absent; there is no separate data-bearing side-section rail.
- PAT-009 lab uploads attach/list/open/remove via the side uploader panel.
- Killing the process mid-typing restores the last autosaved document on reopen
  with no loss (CASE-005; acceptance flow 3).
- Autosave fires within 2 s and on blur; the Save button force-flushes and shows
  Saved hh:mm.
- An upgrade install over R2/R3 opens an existing R3 visit and shows its prior
  content as the first dated entry, editable; a v2-journal visit opens with its
  prose and section tables (ADR 0019 #9; v3 §8).
- Searching a word typed anywhere in the case finds the visit (FTS via the v3
  `text` mirror; trigger unchanged).
- Patient age in the header is derived from DOB at read time.
- Zoom scales the whole editor document root.
- Next follow-up (HC-MVP1-M3vis): on a first AND a follow-up visit, 7 days /
  15 days / 1 month / 2 months / Custom date set the date shown in
  `case-form-next-followup`, Clear empties it, and the patient appears in Today
  Due on that day and in Overdue after it; a past custom date is rejected
  inline and nothing is written; the header fits 1366x768 with no horizontal
  scroll.
- F5 on a patient with a saved first case opens a follow-up, never a second
  first case.
- Ctrl+S / Cmd+S anywhere in the form saves at once (status Saving… then Saved
  hh:mm) and does not trigger the webview's save-page dialog.

## Open questions

- CASE-OQ-1 (autosave debounce 2 s): unchanged; the editor keeps 2 s + blur.
- CASE-OQ-2 (per-template field sets): resolved — templates now describe only
  the record-popup field sets (ADR 0019; CASE-004 R9 edits those).
- CASE-OQ-3 (Marathi in case fields): unchanged; the editor is English-only
  text; Marathi stays limited to printed advice (S14).

---

# S09 delta (Follow-up visit) — M3-RWv2

Full S09 spec: `docs/ui/S09-follow-up-visit.md`. This rework changes S09 as
follows (ADR 0019); the VIS-002/003/004 structured controls are RETAINED.

## What changes in S09

- The follow-up OPENS THE SAME complaint editors as S08 (the v3 `case-rich`
  document copied forward onto this follow-up's `visit.data_json`) and APPENDS a
  new dated entry (today) to each pre-loaded complaint editor. Prior prose, prior
  numbered sections (INCLUDING family history) and prior separators persist
  because they are part of the copied document (ADR 0019 #10; v3 §9). The doctor
  writes the follow-up prose + tables in the same editor as the first case.
- The record buttons appear here too; labels read "Update vitals" / "Update
  modalities" / "Update family history" / ... / "Update prescription". Each
  inserts a NEW table under the new dated entry, continuing the per-complaint
  numbering.
- RETAINED structured controls (unchanged from R3): visit type (VIS-001),
  per-complaint status Better/Same/Worse/New/Resolved + improvement % slider
  (VIS-002, `complaint_status_json` / `improvement_pct_json`, ADR 0016), remedy
  response six options (VIS-003), next-follow-up quick buttons + custom
  (VIS-004). These feed VIS-007's R9 progress chart; the editor adds the prose.
- Header gains the common Back, the Save button, document-root zoom, and a
  next-follow-up DISPLAY, matching S08.
- Pre-load maps the previous visit's complaint editors by `complaint.id` (the
  VIS-002 key) so status/improvement line up with the right editor.

## S09 controls added/changed (element | type | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Save | button | force-flush autosave (mirrors S08) | followup-save |
| Update vitals | button -> popup | sys+dia two fields; inserts editable vitals table into this visit's new entry | followup-record-vitals |
| Update modalities | button -> popup | inserts editable modalities table | followup-modalities |
| Update family history | button -> popup | inserts two-column family table | followup-record-family |
| Update prescription | button -> popup | inserts NEW editable Rx placeholder table (ADR 0019 #11) | followup-add-prescription |
| Complaint editor | contenteditable (TipTap) | prior document carried forward + appended dated entry per pre-loaded complaint | followup-editor-<n> |
| Next follow-up display | text | shows the scheduled date alongside the quick buttons | followup-next-followup |

## S09 acceptance delta

- Opening a follow-up appends a dated entry to each pre-loaded complaint's
  editor (not a replacement); the editor shows the prior entries and sections
  (incl. family history) above.
- Update vitals (BP sys + dia), Update modalities, Update family history and
  Update prescription insert editable tables into the new entry, continuing the
  numbering.
- The VIS-002 status + improvement %, VIS-003 remedy response and VIS-004 next
  follow-up still work and still persist to their columns/JSON (ADR 0016).
- Prescribe (S13, R4) stays rendered-but-disabled (no dead end, ADR 0002); the
  Update-prescription placeholder table is the R3 stand-in and is not a real Rx.
