# S06 Patient register / edit form
Screen id: patient-form   Route: /patients/new, /patients/:id/edit   Module: apps/desktop/src/patients
Requirements: PAT-001, PAT-002, PAT-004, PAT-006, PAT-007, PAT-009, PAT-012   Milestone: M2  Release: R2

## Purpose
Register a new patient or edit an existing one: demographics with photo, an
auto-assigned unique ID, duplicate detection, family linking, tags, attachments
and a consent record (PAT-001, 002, 004, 006, 007, 009, 012).

## Entry points
- F4 or the "New patient" button on Today (S03) and elsewhere.
- Edit from the patient dashboard (S07).
- "New patient" action from a no-results global search (S04).

## Layout (wireframe)
App shell; single scrollable form, two columns. Content area 1366 px.

```
+-----------+----------------------------------------------------------------------+
| ...       | New patient                 ID: HC-000312 (auto)      [ Cancel ][ Save ]|
|           | +-- Photo ------+  Name *            [__________________________]       |
|           | |   {80x80}     |  Sex   ( )M ( )F ( )Other   Marital [v]              |
|           | | [Webcam][File]|  DOB [__-__-____]  or Age [__y]   (either, PAT-001)  |
|           | +---------------+  Mobile [__________]  Alt mobile [__________]        |
|           |                    Address [__________________]  City [__________]     |
|           |                    Occupation [________]  Blood group [v]              |
|           |                    Referred by [______________]                        |
|           | {duplicate warning banner, PAT-004:}                                   |
|           | +----------------------------------------------------------------+     |
|           | | A patient named Ramesh Kumar with mobile 98765 43210 already     |     |
|           | | exists (HC-000123).  [ Open existing ]  [ Continue anyway ]      |     |
|           | +----------------------------------------------------------------+     |
|           | Tags        [chronic][skin][+ add]                  (PAT-007, P1)       |
|           | Family      [ Link family member... ]  {Wife: Sita Devi HC-000087}     |
|           | Attachments [ + Add file ]  {lab-report.pdf}{xray.jpg}  (PAT-009, P1)   |
|           | Consent     [x] Patient consented to digital record keeping  16-10-2026 |
|           |             [ Print consent form ]                   (PAT-012, P1)      |
+-----------+----------------------------------------------------------------------+
```

## Fields and controls (element | type | rules | testid)
| Element | Type | Rules | testid |
|---|---|---|---|
| Patient ID | readonly | auto prefix + running number, unique, never reused (PAT-002) | patient-form-code |
| Photo | image (webcam/file) | optional (PAT-001) | patient-form-photo |
| Capture webcam | button | opens webcam capture (PAT-001) | patient-form-photo-webcam |
| Choose file | button | picks an image file (PAT-001) | patient-form-photo-file |
| Name | text | required (PAT-001); drives phonetic key | patient-form-name |
| Sex | radio | PAT-001 | patient-form-sex |
| DOB | date | DOB or Age (PAT-001); DD-MM-YYYY | patient-form-dob |
| Age | number + unit | sets estimated DOB if DOB blank (PAT-001) | patient-form-age |
| Marital status | dropdown | PAT-001 | patient-form-marital |
| Mobile | text | digits only, grouped display (conventions 4) | patient-form-mobile |
| Alternate mobile | text | PAT-001 | patient-form-mobile-alt |
| Address | textarea | PAT-001 | patient-form-address |
| City | text | PAT-001 | patient-form-city |
| Occupation | text | PAT-001 | patient-form-occupation |
| Blood group | dropdown | PAT-001 | patient-form-bloodgroup |
| Referred by | text | PAT-001 | patient-form-referred |
| Duplicate banner | banner | shown when name+mobile or name+DOB match (PAT-004) | patient-form-duplicate |
| Open existing | button | opens the matched patient (S07) (PAT-004) | patient-form-duplicate-open |
| Continue anyway | button | dismisses the warning and keeps entry (PAT-004) | patient-form-duplicate-continue |
| Tags | chips multiselect | optional (PAT-007) | patient-form-tags |
| Link family member | button + list | links a patient, shared address, relation (PAT-006) | patient-form-family-link |
| Add attachment | button + thumbnails | images/PDF stored encrypted in data folder (PAT-009) | patient-form-attachment-add |
| Consent checkbox | checkbox + date | records consent date (PAT-012) | patient-form-consent |
| Print consent form | button | prints the consent form (PAT-012) | patient-form-consent-print |
| Save | button | validates and saves (new) | patient-form-save |
| Cancel | button | discards unsaved new entry after confirm | patient-form-cancel |

## Behaviour
- The patient ID is assigned from the configured prefix + running sequence; it
  is unique and never reused, shown read-only before Save (PAT-002).
- Either DOB or Age may be entered; Age fills an estimated DOB
  (`dob_is_estimated`) per the data model (PAT-001).
- Duplicate detection runs on blur of name together with mobile or DOB; a match
  on name+mobile or name+DOB shows the warning banner with Open existing and
  Continue anyway (PAT-004). Merge is a P1 follow-up (PAT-004) and is out of
  scope for this screen.
- Family linking adds a `family_link` with a relation and offers a shared
  address and quick switch between linked patients (PAT-006).
- Tags are free multiselect used later for filtering on S05 (PAT-007).
- Attachments are copied into the data folder encrypted, with a thumbnail viewer
  (PAT-009).
- Consent records the checkbox and date and offers a printable consent form
  (PAT-012, DPDP).
- A newly saved patient is indexed in the same transaction and is findable
  immediately in global search (PSR-012).

## Release slices
- R2 (M2): registration/edit of P0 fields, auto ID (PAT-002), photo
  (webcam/file), duplicate warning (PAT-004) and family linking (PAT-006) ship.
  This is the R2 demo "register 3 patients (one with webcam or file photo)" and
  "edit a patient". Soft delete / recycle bin is on the dashboard (S07).
- P1 fields are flagged off until ready but do not block the core flow: Tags
  (PAT-007), Attachments (PAT-009) and Consent record/print (PAT-012). The form
  saves without them. They remain scheduled within MVP1 (M10 polish for P1).
- No MVP1 release after R2 restructures this screen; later screens only consume
  the data it captures.

## States (empty, loading, error, read-only, trial)
- Empty (new): blank form, ID preview filled, Save disabled until Name is valid.
- Loading: saving shows inline progress on the Save button.
- Error: a save failure shows a plain-language inline message with a Details
  expander; entered values are preserved (NFR-033).
- Read-only (LIC-020): the form opens read-only; Save and Add buttons are
  disabled with the tooltip "Licence expired - renew to add new visits"
  (conventions section 4); existing data stays viewable and exportable.
- Trial: fully editable; no trial-specific behaviour on this screen.

## Keyboard
- Tab follows field order; required Name is first. Enter in a single-line field
  moves to the next; Ctrl+S force-saves (conventions section 3).
- Esc on Cancel prompts before discarding an unsaved new patient; it never
  discards silently.

## Commands used (proposed)
- `patient_next_code() -> { code: string }`  (PAT-002, preview)
- `patient_check_duplicate({ name, mobile?, dob? }) -> { matches: { patient_id, code, name, mobile, dob }[] }`  (PAT-004)
- `patient_create({ name, sex?, dob?, age_years?, dob_is_estimated?, mobile?, mobile_alt?, address?, city?, occupation?, marital_status?, blood_group?, referred_by?, photo_path?, tags?: string[], consent_at? }) -> { patient_id, code }`  (PAT-001, 002, 007, 012)
- `patient_update({ patient_id, ...same editable fields }) -> {}`
- `patient_link_family({ patient_id, related_patient_id, relation, share_address: bool }) -> { family_link_id }`  (PAT-006)
- `patient_add_attachment({ patient_id, visit_id?, file_path, caption? }) -> { attachment_id, sha256 }`  (PAT-009)
- `patient_print_consent({ patient_id }) -> { file_path }`  (PAT-012)

## Acceptance checks
- A new patient gets a unique, never-reused ID from the configured prefix
  (PAT-002).
- Registering with a webcam or file photo works (PAT-001; acceptance flow 2).
- Entering a name+mobile or name+DOB that matches an existing patient shows the
  duplicate warning with Open existing / Continue anyway (PAT-004).
- A saved patient is findable in global search immediately (PSR-012, verified in
  S04).
- Editing an existing patient persists changes and writes an audit entry
  (ADM-002, verified in Settings audit log, out of scope here).
- In read-only mode the form is viewable but Save/Add are disabled (LIC-020).

## Open questions
- Conventions section 4 says clinical forms autosave and only admin forms have
  Save/Cancel. Patient registration sits between the two; this spec uses an
  explicit [ Save ] for new registration and for edits, to let duplicate
  resolution happen before the row exists. Confirm, or switch edits to autosave.
- PAT-002 configurable prefix + running number: the prefix is set in Settings
  (ADM-001); confirm the sequence is per-clinic and whether gaps are allowed when
  a new-patient form is cancelled (proposed: the sequence is only consumed on
  Save, so Cancel leaves no gap, and the previewed code may change).
- Family relation vocabulary (Wife/Husband/Son/Daughter/Father/Mother/Other) is
  not enumerated in PAT-006; proposed default list above. Confirm.
