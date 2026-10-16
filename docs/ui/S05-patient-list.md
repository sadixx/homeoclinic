# S05 Patient list and filters
Screen id: patient-list   Route: /patients   Module: apps/desktop/src/patients
Requirements: PSR-008, PSR-009, PSR-010, PSR-011   Milestone: M2  Release: R2

## Purpose
Browse and filter the whole patient base with an advanced filter panel, run
full-text searches inside case notes, save frequently used filters and export
the current filtered list (PSR-008..011).

## Entry points
- "Patients" nav item (conventions section 2).
- Saved-filter chips on Today (S03) deep-link here with a filter applied
  (PSR-010).

## Layout (wireframe)
App shell; filter panel on the left of the content area, results table on the
right. Content area 1366 px.

```
+-----------+----------------------------------------------------------------------+
| Today     | Patients                             [ Save filter ] [ Export CSV ]   |
| Patients  | +-- Filters ---------------+ +-- 1,284 patients ---------------------+ |
| Repertory | | Visit date  [__] to [__]  | | Name          ID       Age/Sex LastVisit Next f/u Dues ||
| ...       | | Last visit older than [_] | | Ramesh Kumar  HC-000123 34 M  12-10   23-10    Rs0   ||
|           | | Next follow-up:           | | Sita Devi     HC-000087 51 F  05-10   14-10    Rs250 ||
| [Trial: 9 | |  ( )Today ( )Overdue      | | Asha Patil    HC-000210 28 F  01-10   -        Rs0   ||
|  days]    | |  ( )Range [__] to [__]    | | ... virtualised, 20 first, scroll ...               ||
|           | | Age [_] to [_]  Sex [v]   | |                                                     ||
|           | | City [________]           | | {sortable column headers: Name, ID, LastVisit,       ||
|           | | Tags [chronic][skin][+]   | |  Next follow-up}                                    ||
|           | | Diagnosis text [________] | |                                                     ||
|           | | Remedy [Sulphur v] Pot[v] | |                                                     ||
|           | | [x] Dues > 0              | |                                                     ||
|           | | Case-note text [________] | |                                                     ||
|           | | [ Apply ]   [ Clear ]     | |                                                     ||
|           | +---------------------------+ +-----------------------------------------------------+ |
+-----------+----------------------------------------------------------------------+
```

Full-text snippet rows (PSR-009) expand under a matching patient:
```
|   > "...chronic migraine since 2019, worse before menses..."  visit 12-10  [Open] |
```

## Fields and controls (element | type | rules | testid)
| Element | Type | Rules | testid |
|---|---|---|---|
| Visit date range | date + date | filter visits in range (PSR-008) | patient-list-filter-visitrange |
| Last visit older than | number (days) | PSR-008 | patient-list-filter-lastvisit-older |
| Next follow-up radio | radio | today / overdue / range (PSR-008) | patient-list-filter-followup |
| Follow-up range | date + date | enabled when Range chosen (PSR-008) | patient-list-filter-followup-range |
| Age range | number + number | PSR-008 | patient-list-filter-age |
| Sex | dropdown | PSR-008 | patient-list-filter-sex |
| City | text | PSR-008 | patient-list-filter-city |
| Tags | chips multiselect | PSR-008 (tags from PAT-007) | patient-list-filter-tags |
| Diagnosis text | text | PSR-008 | patient-list-filter-diagnosis |
| Remedy prescribed | autocomplete | all patients given remedy X (PSR-008) | patient-list-filter-remedy |
| Potency | dropdown | PSR-008 | patient-list-filter-potency |
| Dues > 0 | checkbox | PSR-008 | patient-list-filter-dues |
| Case-note text | text | full-text search inside notes (PSR-009) | patient-list-filter-casenote |
| Apply | button | runs the combined AND query (PSR-008) | patient-list-apply |
| Clear | button | resets all filters | patient-list-clear |
| Results table | virtualised table | 20 rows first, scroll loads more (conventions 4) | patient-list-results |
| Result row | row | Enter/click opens dashboard (S07) | patient-list-row |
| Column header | sortable header | sort by name, ID, last visit, next follow-up (PSR-008) | patient-list-sort |
| Snippet row | expandable row | highlighted case-note match, link to the exact visit (PSR-009) | patient-list-snippet |
| Save filter | button | saves current filter set with a name (PSR-010) | patient-list-save-filter |
| Export CSV | button | exports the current filtered list (PSR-011) | patient-list-export |

## Behaviour
- Filters combine with AND; results are sortable by name, ID, last visit and
  next follow-up (PSR-008). Apply runs one keyset-paginated query (per data
  model: UNION with rank, LIMIT 20, no OFFSET scans).
- Case-note text search returns matching patients with highlighted snippets and
  a link to the exact visit (PSR-009); clicking a snippet opens that visit.
- Save filter stores the current filter set under a name; saved filters appear
  as one-click chips on Today (PSR-010).
- Export CSV writes the current filtered list (respecting sort) to a file and
  reveals it in the folder (PSR-011).
- Lists are virtualised: 20 rows first, more on scroll, keyboard Up/Down, Enter
  opens, Home/End jump (conventions section 4).

## Release slices
- R2 (M2): the screen ships with the core filters that only need patient and
  visit data: visit date range, last-visit-older-than, next follow-up
  today/overdue/range, age, sex, city, dues > 0, plus sorting, virtualised
  table, Save filter (PSR-010) and Export CSV (PSR-011). This supports the R2
  demo filter "overdue follow-ups, given Sulphur" together with the remedy
  filter below.
- Filters that depend on later data are flagged off until their data exists:
  Tags (PAT-007) render once tags ship; Diagnosis text, Remedy prescribed and
  Potency depend on visits/prescriptions and light up at R3/R4; Case-note
  full-text search (PSR-009, P1) lights up at R3 when case text exists.
- The R2 acceptance uses the remedy filter for "given Sulphur"; if remedy data
  is not yet present at R2 it is flagged off and that part of the demo runs at
  R4. See Open questions.

## States (empty, loading, error, read-only, trial)
- Empty (no patients): "No patients yet. Register your first patient." with a
  [ New patient ] action.
- Empty (filter matches nothing): "No patients match these filters." with a
  [ Clear filters ] action.
- Loading: skeleton rows after 150 ms; the count header shows "Counting..." then
  the number.
- Error: inline "Could not load, Retry" with a Details expander (NFR-033).
- Read-only (LIC-020): filtering, sorting, opening, and Export CSV all work;
  only create/edit entry points are disabled elsewhere.
- Trial: unaffected.

## Keyboard
- Up/Down move in the results, Enter opens, Home/End jump (conventions 4).
- Ctrl+S is reserved for force-save elsewhere; on this screen Apply has its own
  button (admin-style screen).
- Esc closes any open filter popover without clearing applied filters.

## Commands used (proposed)
- `patient_list_query({ filters: PatientFilter, sort: { field, dir }, cursor?: string, limit: u16 }) -> { rows: PatientRow[], total?: u32, next_cursor?: string }`
- `patient_list_export_csv({ filters: PatientFilter, sort: { field, dir } }) -> { file_path: string }`  (PSR-011)
- `patient_casenote_search({ text: string, cursor?: string, limit: u16 }) -> { hits: { patient_id, code, name, visit_id, snippet }[], next_cursor?: string }`  (PSR-009)
- `saved_filter_list() -> { filters: { id, name }[] }`  (PSR-010)
- `saved_filter_save({ name, filters: PatientFilter, sort }) -> { id }`  (PSR-010)
- `saved_filter_delete({ id }) -> {}`  (PSR-010)
- `PatientFilter = { visit_from?, visit_to?, last_visit_older_than_days?, followup: "none"|"today"|"overdue"|"range", followup_from?, followup_to?, age_min?, age_max?, sex?, city?, tags?: string[], diagnosis_text?, remedy_id?, potency?, dues_positive?: bool, casenote_text? }`

## Acceptance checks
- Filters combine with AND and the result is sortable by name, ID, last visit
  and next follow-up (PSR-008).
- The filter "overdue follow-ups, given Sulphur" returns the correct rows
  (acceptance flow 2, requirements/05 section 7).
- An advanced filter query returns under 500 ms at the 50k/100k baseline
  (NFR-002).
- Case-note full-text search returns highlighted snippets within 1 s and links
  to the exact visit (PSR-009, NFR-002).
- Export CSV writes the current filtered, sorted list (PSR-011).
- Saving a filter makes it available as a one-click chip on Today (PSR-010).

## Open questions
- The R2 demo expects the "given Sulphur" filter at R2, but prescriptions do not
  exist until R4 (M7). Proposed resolution: the remedy/potency/diagnosis filters
  are flagged off until R4 and that clause of the demo runs at R4; the rest of
  the filter set is fully usable at R2. Confirm.
- PSR-008 lists "diagnosis text" as a filter but the data model stores diagnosis
  inside `visit.data_json`; confirm whether this filters the provisional
  diagnosis field specifically or any case text (overlapping with PSR-009).
