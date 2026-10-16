# S07 Patient dashboard
Screen id: patient-dashboard   Route: /patients/:id   Module: apps/desktop/src/patients
Requirements: PAT-005, PAT-006, PAT-008, PAT-011, BILL-002   Milestone: M2  Release: R2

## Purpose
The single view of one patient: photo and demographics, an allergies/alerts
banner, the visit timeline newest first, last prescription, outstanding dues,
family links, and quick actions that adapt to what the current release supports
(PAT-005, 006, 008, 011, BILL-002).

## Entry points
- Opening any search result (S04), any Today row (S03) or any patient-list row
  (S05).
- After saving a new patient (S06).

## Layout (wireframe)
App shell; left summary column, right timeline. Content area 1366 px.

```
+-----------+----------------------------------------------------------------------+
| ...       | {alerts banner: Allergy: Penicillin. Alert: pregnant.} (PAT-005)      |
|           | +-- Summary -----------+ +-- Visits (newest first) ------------------+ |
|           | | {photo 120x120}       | | 12-10-2026  Follow-up   Sulphur 200  [Open]| |
|           | | Ramesh Kumar          | | 28-09-2026  First visit Nux-v 30     [Open]| |
|           | | HC-000123  34y  M     | | 10-09-2026  Acute       ...          [Open]| |
|           | | 98765 43210  Pune     | | ... virtualised timeline ...               | |
|           | | Referred: Dr Rao      | +-------------------------------------------+ |
|           | | Dues: Rs 250 (BILL-002)| +-- Last prescription ---------------------+ |
|           | | Family: Sita Devi (W) | | 12-10  Sulphur 200/1 dose, SL BD x7d  [View]| |
|           | |  [switch] (PAT-006)   | +-------------------------------------------+ |
|           | +-----------------------+                                              |
|           | Quick:  [ New visit F5 ] [ Repertorise F6 ] [ Prescribe F7 ] [ Bill F8 ]|
|           |         [ Export PDF ] [ Export JSON ]   [ Edit ] [ Move to bin ]       |
+-----------+----------------------------------------------------------------------+
```
(Quick buttons that have no screen yet in the current release are hidden, not
shown disabled; see Release slices.)

## Fields and controls (element | type | rules | testid)
| Element | Type | Rules | testid |
|---|---|---|---|
| Alerts banner | banner | allergies and alerts, text + icon, never colour only (PAT-005, conventions 5) | patient-dash-alerts |
| Photo | image | from patient record (PAT-005) | patient-dash-photo |
| Demographics block | text | name, code, age/sex, mobile, city, referred by (PAT-005) | patient-dash-demographics |
| Dues badge | badge | running balance from invoices/payments (BILL-002) | patient-dash-dues |
| Family links | list + switch | linked members, quick switch (PAT-006) | patient-dash-family |
| Visit timeline | virtualised list | newest first (PAT-005) | patient-dash-timeline |
| Visit row | row | opens the visit (S08/S09 when they exist) | patient-dash-visit-row |
| Last prescription card | card | most recent Rx summary (PAT-005) | patient-dash-last-rx |
| New visit | button | F5; visible from R3 (PAT-005) | patient-dash-new-visit |
| Repertorise | button | F6; visible from R7 (PAT-005) | patient-dash-repertorise |
| Prescribe | button | F7; visible from R4 (PAT-005) | patient-dash-prescribe |
| Bill | button | F8; visible from R5 (PAT-005) | patient-dash-bill |
| Edit | button | opens S06 edit | patient-dash-edit |
| Export PDF | button | full record PDF (PAT-011) | patient-dash-export-pdf |
| Export JSON | button | full record JSON (PAT-011) | patient-dash-export-json |
| Move to bin | button | soft delete, 30-day recycle bin (PAT-008) | patient-dash-delete |

## Behaviour
- Loads the full patient in one call: demographics, alerts, denormalised dues
  (BILL-002), visit timeline (newest first), last prescription and family links
  (PAT-005). The timeline is virtualised (conventions section 4).
- Quick buttons map to the consultation actions: New visit, Repertorise,
  Prescribe, Bill (PAT-005). A quick button appears only when its screen exists
  in the current release and is otherwise hidden (per task rule), so the doctor
  never hits a dead end (ADR-0002 point 5).
- Family quick switch opens the linked patient's dashboard (PAT-006).
- Export PDF and Export JSON produce the full single-patient record and reveal
  the file in the folder (PAT-011).
- Move to bin soft-deletes with a confirm dialog naming the patient
  ("Move Ramesh Kumar (HC-000123) to recycle bin?"); the row stays recoverable
  for 30 days; permanent delete (from the recycle bin in Settings, S18) requires
  the PIN (PAT-008, conventions section 4).

## Release slices
- R2 (M2): dashboard ships with demographics, alerts banner, family links, the
  (empty at first) visit timeline, dues badge wired to BILL-002 (shows Rs 0
  until billing exists), Edit, Export PDF/JSON (PAT-011) and Move to bin
  (PAT-008). At R2 none of the four consultation quick buttons are shown yet
  (their screens do not exist). This covers the R2 demo "open dashboard, edit,
  recycle bin and restore".
- R3 (M3): the "New visit" quick button and live visit timeline rows appear once
  case/visit screens (S08, S09) exist.
- R4 (M7): the "Prescribe" quick button and the last-prescription card become
  live once the Rx screen (S13) exists.
- R5 (M8): the "Bill" quick button appears and the dues badge reflects real
  invoices/payments once billing (S15, S16) ships (BILL-002).
- R7 (M6): the "Repertorise" quick button appears once the repertorisation
  workspace (S11) exists.
- Flagged off before each respective release: the corresponding quick button is
  hidden (compile-time feature flag), never shown disabled leading nowhere.

## States (empty, loading, error, read-only, trial)
- Empty timeline (new patient, no visits): "No visits yet." plus the New visit
  action when that screen exists, otherwise just the sentence.
- Loading: skeleton for the summary and timeline after 150 ms; never a blocking
  spinner.
- Error: an inline "Could not load this patient, Retry" with a Details expander;
  no stack traces (NFR-033).
- Read-only (LIC-020): all viewing, timeline, export PDF/JSON and family switch
  work; New visit / Prescribe / Bill / Edit are disabled with the standard
  tooltip; an already-open visit can still be finished (SUX-008, handled on the
  visit screens).
- Trial: unaffected; trial badge lives in the shell.

## Keyboard
- F5 new visit, F6 repertorise, F7 prescribe, F8 bill (only when visible),
  Ctrl+P print preview of the current document, Alt+Left back (conventions 3).
- Up/Down move in the timeline, Enter opens a visit, Home/End jump.

## Commands used (proposed)
- `patient_get_dashboard({ patient_id }) -> { demographics: { code, name, age_label, sex, mobile, city, referred_by, photo_path }, allergies?: string, alerts?: string, dues_paise: i64, visits: VisitSummary[], last_prescription?: RxSummary, family: { patient_id, name, relation }[] }`  (PAT-005, 006, BILL-002)
- `patient_soft_delete({ patient_id }) -> { recycle_until: date }`  (PAT-008)
- `patient_export_pdf({ patient_id }) -> { file_path }`  (PAT-011)
- `patient_export_json({ patient_id }) -> { file_path }`  (PAT-011)
- where `VisitSummary = { visit_id, visit_at, type, headline_remedy_label? }` and `RxSummary = { prescription_id, printed_at?, items_preview: string }`.

## Acceptance checks
- Opening the dashboard renders demographics, alerts, timeline, last Rx, dues and
  family within 300 ms at the 50k/100k baseline (NFR-002, PAT-005).
- The dues badge equals the patient's running balance from invoices and payments
  (BILL-002).
- Quick buttons appear only for consultation screens that exist in the current
  release and are hidden otherwise (PAT-005, ADR-0002 point 5).
- Move to bin soft-deletes with a named confirm; the patient is restorable for
  30 days; permanent delete asks for the PIN (PAT-008; R2 demo "move one to the
  recycle bin and restore it").
- Export PDF and Export JSON produce the full single-patient record (PAT-011).
- Family quick switch opens the linked patient's dashboard (PAT-006).

## Open questions
- The recycle bin and restore UI (PAT-008) lives in Settings (S18, not in this
  batch). This screen only provides "Move to bin"; confirm restore is owned by
  the Settings recycle-bin screen.
- PAT-005 lists an "outstanding dues" figure; whether advances (negative dues)
  show as "Advance Rs X" on the badge is not stated. Proposed: show "Advance
  Rs X" when the balance is negative (BILL-001 allows advance). Confirm.
- Which single document Ctrl+P prints from the dashboard when no visit is open is
  undefined; proposed: Ctrl+P is inert on the dashboard until a visit, Rx or
  receipt is open. Confirm.
