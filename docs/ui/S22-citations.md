# S22 Citations
Screen id: citations   Route: /citations   Module: apps/desktop/src/repertory
Requirements: CIT-007 (P1), CIT-002, CIT-003, CIT-001, CIT-004, CIT-005, CIT-009   Milestone: M6  Release: R7

## Purpose

A single list of every citation the doctor has recorded, so they can review,
filter, edit, delete and export them (CIT-007, P1). A citation records where a
piece of knowledge came from: a book, a journal, a lecture, a website, a
colleague, or the doctor's own cured case (CIT-002). This screen is the teaching
and thesis surface; the quick-add flows live on the rubric detail (S10, CIT-006)
and the prescription screen (CIT-001f). Because CIT-007 is P1, the screen ships
in R7 if time allows and otherwise slips to the P1 batch in M10 (build order 06
section 6).

## Entry points

- Left nav Settings, then "Citations", or a link from the repertory area.
- "View all citations" from a citation marker popup in S10 (CIT-005).
- A clinical-experience citation opened from here links back to the patient and
  visit (CIT-004).

## Layout (wireframe)

```
+----------------------------------------------------------------------------------------------+
| Citations                                                        [Export CSV] [Export PDF]   |
+----------------------------------------------------------------------------------------------+
| Source [All v]  Remedy [All v]  Rubric [ filter text ]  Confidence [All v]      142 citations |
+----------------------------------------------------------------------------------------------+
| Source                  | Attached to                    | Ref        | Confidence | Added    |
|-------------------------|--------------------------------|------------|------------|----------|
| Phatak, Concise Rep 2e  | MIND-FEAR-dark + Calc-p (add)  | p.142      | Confirmed  | 14-10-26 |
| Clinical: HC-000123     | HEAD-PAIN-school girls + Nat-m | visit 3    | Confirmed  | 02-10-26 |
| Allen's Keynotes        | MM: Phosphorus / Mind          | p.311      | Probable   | 28-09-26 |
| Kent lecture (seminar)  | Rx: Sulphur 200 (reason)       | -          | To verify  | 20-09-26 |
| ...                     |                                |            |            |          |
+----------------------------------------------------------------------------------------------+
| Row -> [Edit] opens the citation editor; [Open target] jumps to rubric / MM / case / Rx       |
+----------------------------------------------------------------------------------------------+
```

### Citation editor (CIT-002)

```
+--------------------------------------------------+
| Edit citation                                    |
|  Source type [Book v]   (required)               |
|  Title  [Phatak, Concise Repertory .........]*   |
|  Author [S R Phatak ...]  Edition [2nd] Year[19..]|
|  Publisher [.....]  Page/ref [p.142]             |
|  URL [.................] (optional)              |
|  Quote [............................] (optional) |
|  Comment [.................................]     |
|  Confidence ( ) Confirmed (o) Probable ( ) Verify|
|  Patient (clinical type only) [HC-000123]        |
|  [Save]  [Delete]                                |
+--------------------------------------------------+
```

## Fields and controls (table: element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Source filter | dropdown | From the source library (CIT-003); filters list (CIT-007) | cit-filter-source |
| Remedy filter | autocomplete | Remedy master (MM-001); filters list (CIT-007) | cit-filter-remedy |
| Rubric filter | text input | Matches target rubric path (CIT-007) | cit-filter-rubric |
| Confidence filter | dropdown | All / Confirmed / Probable / To verify (CIT-002, CIT-007) | cit-filter-confidence |
| Citation count | label | Count of rows after filters | cit-count |
| Citation row | table row | Source, attached target with label, page ref, confidence, date (CIT-002, CIT-005) | cit-row |
| Open target | button | Jumps to the rubric (S10), MM section (S12), case/visit (CIT-004), or Rx | cit-open-target |
| Edit | button | Opens the citation editor (CIT-007) | cit-edit |
| Delete | button | Confirm dialog naming the source; removes the citation and its links (CIT-007, conventions 4) | cit-delete |
| Export CSV | button | Current filtered list to CSV (CIT-007) | cit-export-csv |
| Export PDF | button | Current filtered list to PDF (CIT-007) | cit-export-pdf |
| Editor source type | dropdown | Book / Repertory / Journal article / Lecture or seminar / Website / Clinical experience / Colleague / Other (CIT-002) | cit-edit-type |
| Editor title | text input | Required unless clinical type, then patient is required (CIT-002) | cit-edit-title |
| Editor author/edition/year/publisher | text inputs | Optional (CIT-002) | cit-edit-meta |
| Editor page ref | text input | Page/chapter/rubric reference (CIT-002) | cit-edit-pageref |
| Editor URL | text input | Optional (CIT-002) | cit-edit-url |
| Editor quote | text area | Optional quoted text (CIT-002) | cit-edit-quote |
| Editor comment | text area | Doctor's comment (CIT-002) | cit-edit-comment |
| Editor confidence | radio | Confirmed / Probable / To verify (CIT-002) | cit-edit-confidence |
| Editor patient | autocomplete | Shown and required only for clinical-experience type (CIT-002, CIT-004) | cit-edit-patient |
| Editor save | button | Validates required fields on blur and submit (conventions 4) | cit-edit-save |

## Behaviour

- The list shows every citation across all targets; filters by source, remedy,
  rubric and confidence combine and the count updates (CIT-007).
- Each row names the source and the target it is attached to (a rubric, a
  rubric-remedy addition, an MM section, an analysis rubric, or a prescription;
  CIT-001) with the page reference, confidence and date added (CIT-002).
- "Open target" navigates to the right screen; a clinical-experience citation
  opens the linked patient and visit (CIT-004).
- Edit opens the editor pre-filled; only source type plus title (or patient for
  clinical experience) are required, so entry stays under 20 seconds (CIT-002).
  Sources are reused from the source library by autocomplete so the doctor does
  not retype them (CIT-003).
- Delete asks for confirmation naming the source and removes the citation and its
  links (CIT-007, conventions 4). Deleting a citation attached to a personal
  remedy addition must warn that the addition requires a citation (REP-024); the
  exact handling is an open question.
- Export writes the current filtered list to CSV or PDF for teaching, papers and
  theses (CIT-007). Citations are included in backups (CIT-009).

## Release slices

- R7 (this release, M6), only if the P1 budget allows: the citations list,
  filters, editor, delete, and CSV/PDF export. The quick-add and marker display
  it depends on (CIT-001, CIT-005, CIT-006) are P0 and already in M6 via S10.
- If the P1 budget does not allow it in R7, the screen slips to the M10 P1 batch
  (build order 06 section 6); citations are still captured and displayed by the
  P0 flows in S10 and the Rx screen in the meantime.
- Deferred past MVP1: "suggest to publisher" export (CIT-010, P2) is not built
  here.

## States (empty, loading, error, read-only, trial)

- Empty (no citations): one sentence "Citations you add to rubrics, remedies and
  prescriptions appear here" plus a link to the repertory (conventions 4).
- Loading: skeleton rows after 150 ms; virtualised list (conventions 4).
- Error (export fails): plain message with a Details expander; the list is
  unaffected (conventions 4).
- Read-only mode (LIC-020): viewing, filtering and export stay enabled; Edit and
  Delete are disabled with the standard tooltip (conventions 4).
- Trial / internal build: internal build shows the evaluation banner (CONT-004)
  and exported PDFs carry the "EVALUATION" mark.

## Keyboard

- Up/Down move rows; Enter opens the editor; Ctrl+P is not bound here (export is
  via the buttons). Esc closes the editor without saving (conventions 3).
  Alt+Left back.

## Commands used (Tauri commands this screen calls, proposed names)

- `list_citations` -> req `{ source_id?, remedy_id?, rubric_text?, confidence?, limit, cursor? }`; res `{ total, citations: [{ citation_id, source_title, source_type, target_type, target_label, page_ref?, confidence, created_at, patient_id?, visit_ids? }] }` (CIT-007)
- `list_sources` -> req `{ query? }`; res `{ sources: [{ source_id, type, title, author, edition }] }` (CIT-003)
- `get_citation` -> req `{ citation_id }`; res `{ citation: { citation_id, source_id, source_type, title, author, edition, year, publisher, page_ref, url, quote, comment, confidence, patient_id?, visit_ids?, links: [{ target_type, target_id, pack_id? }] } }` (CIT-002, CIT-001)
- `update_citation` -> req `{ citation_id, source_id?, page_ref?, url?, quote?, comment?, confidence?, patient_id? }`; res `{ ok }` (CIT-007, CIT-002)
- `delete_citation` -> req `{ citation_id }`; res `{ ok, blocked?: true, reason? }` (CIT-007; blocked if it is the only citation on a personal addition, see open questions)
- `export_citations` -> req `{ format: "csv"|"pdf", source_id?, remedy_id?, rubric_text?, confidence? }`; res `{ file_path }` (CIT-007)
- `open_citation_target` -> req `{ citation_id }`; res `{ target_type, route, patient_id?, visit_id?, pack_id?, rubric_id?, mm_book_id?, mm_remedy_id?, prescription_id? }` (CIT-001, CIT-004)

## Acceptance checks

- AC1 (CIT-007): the list shows all citations; filtering by source, remedy,
  rubric and confidence narrows it and the count updates.
- AC2 (CIT-002): the editor saves with only source type and title set (or patient
  for a clinical-experience citation), and all optional fields persist.
- AC3 (CIT-003): sources are picked from the library by autocomplete and reused
  across citations without retyping.
- AC4 (CIT-004): opening a clinical-experience citation navigates to the linked
  patient and visit.
- AC5 (CIT-005): a citation shown here matches the marker and hover detail on the
  rubric in S10.
- AC6 (CIT-007): export produces a CSV and a PDF of the current filtered list.
- AC7 (CIT-009): citations survive a backup and restore round trip (verified via
  the backup flow, requirements 05 flow 11).
- AC8 (LIC-020): in read-only mode viewing, filtering and export work while Edit
  and Delete are disabled.

## Open questions

- OQ-S22-1: CIT-007 is P1. Confirm whether it ships in R7 or slips to the M10 P1
  batch; the release plan lists S22 under R7 but the build order puts P1 items in
  M10.
- OQ-S22-2: REP-024 requires every personal addition to carry a citation.
  Deleting the only citation on an addition is ambiguous: block the delete, delete
  the addition too, or demand a replacement citation first. No requirement
  resolves this; `delete_citation` returns a `blocked` flag pending the decision.
- OQ-S22-3: The CSV column set and the PDF layout for CIT-007 export are not
  specified (teaching vs thesis format).
- OQ-S22-4: Whether analysis-rubric and prescription citation targets (CIT-001e,
  CIT-001f) are shown in this same list or filtered separately is not stated.
