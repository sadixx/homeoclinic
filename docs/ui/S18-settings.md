# S18 Settings
Screen id: settings   Route: /settings   Module: apps/desktop/src/settings
Requirements: ADM-001, ADM-002, ADM-005, SET-004, SET-005, SET-006, CASE-004, RX-005, RX-007, PAT-008, PSR-013, LIC-006   Milestone: M1  Release: R1

## Purpose

One place for the doctor to run and maintain the app: edit the doctor and clinic
profile, fees, ID prefix, auto-lock time, font size and data folder (ADM-001,
SET-004, SET-005, SET-006); edit case templates (CASE-004) and the advice
library (RX-007); set the print layout (RX-005); view the audit log (ADM-002);
work the recycle bin (PAT-008); rebuild the search index (PSR-013); and create a
diagnostic report for support (ADM-005). Settings is organised into sub-tabs and
grows one or two tabs per release; the licensed name and registration number are
shown locked (LIC-006).

## Entry points

- Left nav "Settings".
- The empty-state / "edit this" links from other screens (for example "Edit case
  templates" from S08, "Edit advice" from S13, "Recycle bin" from S05).
- The status-bar PIN/auto-lock and font controls deep-link to the General tab.

## Layout (wireframe)

Tab bar across the top of the content area; each tab renders its own panel.
Tabs that do not yet exist in the current release are hidden (not greyed).

```
+----------------------------------------------------------------------------------------------+
| Settings                                                                                      |
| [ General ] [ Case templates ] [ Advice library ] [ Print layout ] [ Recycle bin ]           |
| [ Audit log ] [ Maintenance ]                                                                 |
+----------------------------------------------------------------------------------------------+
| {active tab panel}                                                                            |
+----------------------------------------------------------------------------------------------+
```

### Tab 1: General (R1)

```
+----------------------------------------------------------------------------------------------+
| Doctor profile                                                                                |
|  Name*         [ Dr Asha Kulkarni        ] (locked)   Reg. no* [ 12345 ] (locked)  [v MCH]   |
|  Qualification [ BHMS, MD (Hom)          ]   Phone [ 98xxx xxxxx ]  Email [ asha@... ]        |
|  Signature image [Choose...] {thumb}         Clinic logo [Choose...] {thumb}                  |
|  Note: Name and Reg. no. are from your licence and print on all documents; they cannot be    |
|        edited here (import a new licence to change them).                                     |
|----------------------------------------------------------------------------------------------|
| Clinic profile                                                                                |
|  Clinic name [ ... ]  Address [ ... ]  Phone [ ... ]  Timings [ ... ]  GSTIN [ ... ]          |
|  Default consultation fee [ Rs 300 ]   Default follow-up fee [ Rs 150 ]                       |
|----------------------------------------------------------------------------------------------|
| App                                                                                           |
|  Patient ID prefix [ HC- ]  next number [ 000124 ] (read-only)                                |
|  Auto-lock after [ 15 ] minutes idle        Font size ( ) Normal (o) Large ( ) Extra large    |
|  Data folder [ C:\Users\...\HomeoClinic ] [Change...]                                         |
|                                                                   [ Cancel ]   [ Save ]       |
+----------------------------------------------------------------------------------------------+
```

### Tab 2: Case templates (R3, CASE-004)

```
+----------------------------------------------------------------------------------------------+
| Templates: [Chronic detailed v]  [New]  [Duplicate]  [Delete]        [ Cancel ]  [ Save ]     |
|----------------------------------------------------------------------------------------------|
| Fields (drag to reorder)                         | Field editor                              |
|  = Chief complaints        (multi)   [edit][x]   |  Label [ Thermal state       ]            |
|  = Thermal state           (choice)  [edit][x]   |  Type  [ single choice     v ]            |
|  = Thirst                  (choice)  [edit][x]   |  Options: Chilly, Hot, Ambithermal [+]    |
|  = Doctor's analysis       (longtext)[edit][x]   |  [x] Optional   [ ] Hidden by default     |
|  [+ Add field]                                   |                                           |
+----------------------------------------------------------------------------------------------+
```

### Tab 3: Advice library (R4, RX-007)

```
+----------------------------------------------------------------------------------------------+
| Advice items                                                     [New advice]  [Import] [x]   |
|----------------------------------------------------------------------------------------------|
| Title                     | Category | Text (do/don't)                          | Actions     |
| Avoid coffee/camphor/mint | Do not   | Avoid strong smelling substances...      | [edit][del] |
| General diet              | Diet     | Light, freshly cooked food; warm water   | [edit][del] |
+----------------------------------------------------------------------------------------------+
```

### Tab 4: Print layout (R4, RX-005)

```
+----------------------------------------------------------------------------------------------+
| Paper size (o) A5 ( ) A4 ( ) Letterhead     Margins T[18] B[18] L[15] R[15] mm                |
| [x] Print on pre-printed letterhead (hide clinic header band)                                 |
| Show on Rx: [x] registration no  [x] clinic address  [x] signature  [x] next-visit date      |
| {live preview thumbnail of the Rx header/footer}                        [ Cancel ]  [ Save ]  |
+----------------------------------------------------------------------------------------------+
```

### Tab 5: Recycle bin (R2, PAT-008)

```
+----------------------------------------------------------------------------------------------+
| Deleted patients (kept 30 days)                                   [Empty bin (PIN)]           |
|----------------------------------------------------------------------------------------------|
| Name            | ID         | Deleted on   | Auto-removes on | Actions                       |
| Ramesh Kumar    | HC-000123  | 10-10-2026   | 09-11-2026      | [Restore]  [Delete now (PIN)] |
+----------------------------------------------------------------------------------------------+
```

### Tab 6: Audit log (R3, ADM-002, read-only)

```
+----------------------------------------------------------------------------------------------+
| From [01-10-2026] To [16-10-2026]  Object [All v]  Action [All v]        [ Export CSV ]       |
|----------------------------------------------------------------------------------------------|
| When             | Action  | Object            | Change summary                               |
| 16-10 10:42      | update  | Patient HC-000123 | mobile changed                               |
| 16-10 10:40      | create  | Visit V-5902      | new follow-up                                |
| (view only; cannot be edited)                                                                 |
+----------------------------------------------------------------------------------------------+
```

### Tab 7: Maintenance (R1 diagnostic report; R2 index rebuild)

```
+----------------------------------------------------------------------------------------------+
| Search index                                                                                  |
|  Rebuild the search index if search looks wrong or after a restore.                           |
|  [ Rebuild index ]   {progress bar: Rebuilding 43,200 / 50,000...}                            |
|----------------------------------------------------------------------------------------------|
| Support                                                                                        |
|  Create a diagnostic report (app logs only, no patient data) to send to support.             |
|  [ Create diagnostic report ]   {result: saved diagnostic-2026-10-16.zip}                     |
+----------------------------------------------------------------------------------------------+
```

## Fields and controls (element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Tab bar | tabs | one tab per feature; absent tabs hidden per release | settings-tabs |
| Doctor name (locked) | text read-only | from licence, prints on documents, not editable (LIC-006, ADM-001) | settings-doctor-name |
| Reg. no (locked) | text read-only | from licence, not editable (LIC-006) | settings-doctor-regno |
| Qualification/phone/email | text | editable doctor fields (ADM-001, SET-002) | settings-doctor-qual |
| Signature image | file | optional image (SET-002) | settings-doctor-signature |
| Clinic fields | text | name, address, phone, timings, GSTIN (ADM-001, SET-003) | settings-clinic-name |
| Default fees | money | consultation and follow-up fee (ADM-001, SET-003) | settings-fee-consult |
| ID prefix | text | patient ID prefix; next number read-only (ADM-001, PAT-002) | settings-id-prefix |
| Auto-lock minutes | number | idle lock time, default 15 (SET-004, ADM-001) | settings-autolock |
| Font size | radio group | Normal / Large / Extra large, applied globally (SET-005) | settings-fontsize |
| Data folder | path + button | shows and changes the data dir (SET-006) | settings-datafolder |
| Save / Cancel | buttons | admin forms use explicit Save/Cancel (00-conventions section 4) | settings-save |
| Template picker | dropdown | choose template to edit; ships Chronic/Acute/Child (CASE-004) | settings-template-select |
| Template field list | list | drag to reorder, add/remove fields (CASE-004) | settings-template-field |
| Field type | dropdown | text, long text, single/multi choice, number, date, scale 0-10 (CASE-004) | settings-field-type |
| Advice item row | table row | title, category, text; edit/delete (RX-007) | settings-advice-row |
| New advice | button | add an advice item (RX-007) | settings-advice-new |
| Paper size | radio group | A5 / A4 / Letterhead (RX-005) | settings-print-paper |
| Margins | number x4 | letterhead margins in mm (RX-005) | settings-print-margins |
| Print toggles | checkboxes | which fields show on the Rx (RX-005) | settings-print-show-regno |
| Recycle row | table row | deleted patient with restore/delete-now (PAT-008) | settings-recycle-row |
| Restore | button | restores a soft-deleted patient (PAT-008) | settings-recycle-restore |
| Delete now (PIN) | button | permanent delete, asks for PIN (PAT-008, 00-conventions section 4) | settings-recycle-purge |
| Empty bin (PIN) | button | purges all expired items, asks for PIN (PAT-008) | settings-recycle-empty |
| Audit filters | inputs | date range, object, action (ADM-002) | settings-audit-filter |
| Audit row | table row | when, action, object, change summary; view only (ADM-002) | settings-audit-row |
| Audit export | button | export filtered log to CSV (ADM-002) | settings-audit-export |
| Rebuild index | button | starts a full index rebuild with a progress bar (PSR-013) | settings-index-rebuild |
| Index progress | progress | counts processed / total; target < 60 s at 50k (PSR-013, NFR) | settings-index-progress |
| Create diagnostic report | button | writes a logs-only zip, no patient data (ADM-005) | settings-diag-report |

## Behaviour

- General is an admin form: edits apply on Save and revert on Cancel (no
  autosave, 00-conventions section 4). The licensed name and registration number
  are rendered read-only with a lock note because print templates read identity
  from the verified licence, not from these fields (LIC-006); changing them needs
  a new licence import on S20.
- Font size applies globally the moment it is saved, scaling every screen through
  the rem base (SET-005, 00-conventions section 1).
- Changing the data folder moves the data directory to the new location and
  points the app at it; the move is transactional and a backup is taken first
  (SET-006, defensive, see Open questions).
- Case templates editing adds, removes, reorders and types fields; three
  templates ship (Chronic detailed, Acute quick, Child) and can be duplicated or
  edited but the shipped ones can be reset (CASE-004).
- The advice library edits reusable advice items that S13 multi-selects into a
  prescription (RX-007).
- Print layout sets paper size and letterhead margins and which identity fields
  appear, feeding S14 print preview (RX-005).
- The recycle bin lists soft-deleted patients for 30 days with Restore; permanent
  delete and Empty bin require the PIN (PAT-008, 00-conventions section 4).
- The audit log is a filterable, exportable, read-only record of create / update
  / delete on patients, visits, prescriptions and bills (ADM-002); it can be
  viewed and exported but never edited.
- Rebuild index runs a full search-index rebuild with a progress bar and also
  runs automatically after a restore or import (PSR-013); the diagnostic report
  zips the app logs with no patient data for the doctor to send to support
  (ADM-005).

## Release slices

The settings container appears at R1 and gains tabs as the features behind them
ship. Each tab's first release:

| Tab | First release | Milestone | Requirements |
|---|---|---|---|
| General (profile, fees, ID prefix, auto-lock, font size, data folder) | R1 | M1 | ADM-001, SET-004, SET-005, SET-006 |
| Maintenance - diagnostic report | R1 | M1 | ADM-005 |
| Recycle bin | R2 | M2 | PAT-008 |
| Maintenance - index rebuild | R2 | M2 | PSR-013 |
| Audit log | R3 | M3 | ADM-002 |
| Case templates | R3 | M3 | CASE-004 |
| Advice library | R4 | M7 | RX-007 |
| Print layout | R4 | M7 | RX-005 |

- The identity-lock read-only state of name and registration number becomes real
  at R8 when activation exists (LIC-006, S20); before R8 (dev trial) those fields
  are editable and are marked "will lock on activation".
- Nothing in Settings is removed in a later release; tabs only appear.

## States (empty, loading, error, read-only, trial)

- Empty: the recycle bin and audit log show one-sentence empty states; case
  templates and advice always have the shipped defaults so they are never empty.
- Loading: the index rebuild shows its progress bar; other tabs load instantly or
  show skeleton rows after 150 ms (00-conventions section 4).
- Error: a save failure or rebuild failure shows a plain-language message with a
  Details expander for a support code; no SQL or file paths (NFR-033).
- Read-only mode (LIC-020): viewing all tabs, the audit log, the recycle-bin
  list, index rebuild, diagnostic report and data export stay enabled; creating
  or editing clinical content is blocked elsewhere, but profile/clinic edits
  (administrative) remain allowed so the doctor can keep the clinic details
  correct. (See Open questions on whether profile edits should also be gated.)
- Trial: all tabs that exist in the release are available; the name and
  registration number are still editable until activation (LIC-006).

## Keyboard

- Left/Right (or Ctrl+Tab) move between tabs; Tab moves within a form; Enter in a
  text field does not submit an admin form (explicit Save button).
- Esc cancels an open dialog (field editor, delete confirm, PIN prompt) without
  changing data (00-conventions section 3).
- In list tabs Up/Down move rows and Home/End jump (00-conventions section 4).

## Commands used (proposed Tauri command names)

- `get_settings` req `{}` resp `{ doctor: { name, reg_no, council, qualification, phone, email, signature_path?, identity_locked }, clinic: { name, address, phone, timings, gstin?, fee_consult, fee_followup }, app: { id_prefix, next_number, autolock_minutes, font_size, data_folder } }` (ADM-001, SET-002..006)
- `update_doctor_profile` req `{ qualification, phone, email, signature_path? }` resp `{ ok }` (ADM-001; name/reg_no refused when locked, LIC-006)
- `update_clinic_profile` req `{ name, address, phone, timings, gstin?, fee_consult, fee_followup, id_prefix }` resp `{ ok }` (ADM-001, SET-003, PAT-002)
- `set_font_size` req `{ size: "normal"|"large"|"xlarge" }` resp `{ ok }` (SET-005)
- `set_autolock_minutes` req `{ minutes }` resp `{ ok }` (SET-004)
- `set_data_folder` req `{ new_path }` resp `{ ok, moved_from, moved_to, error?: { code, message } }` (SET-006)
- `list_case_templates` / `save_case_template` req `{ template }` / `delete_case_template` req `{ template_id }` (CASE-004)
- `list_advice_items` / `save_advice_item` req `{ item }` / `delete_advice_item` req `{ item_id }` (RX-007)
- `get_print_layout` / `save_print_layout` req `{ paper, margins_mm, letterhead, show_fields }` (RX-005)
- `recycle_bin_list` req `{}` resp `{ items: [{ patient_id, name, deleted_at, auto_remove_at }] }` (PAT-008)
- `recycle_bin_restore` req `{ patient_id }` resp `{ ok }` (PAT-008)
- `recycle_bin_purge` req `{ patient_id?, all_expired?, pin }` resp `{ ok, purged_count }` (PAT-008)
- `audit_log_query` req `{ from, to, object?, action? }` resp `{ rows: [{ at, action, object, summary }] }` (ADM-002)
- `audit_log_export` req `{ from, to, object?, action?, out_path }` resp `{ file_path, row_count }` (ADM-002)
- `rebuild_search_index` req `{}` resp (progress events) `{ processed, total, done }` (PSR-013)
- `create_diagnostic_report` req `{ out_dir }` resp `{ file_path }` (ADM-005; logs only, no patient data)

## Acceptance checks

- AC1 (ADM-001, SET-003): editing clinic details and fees and pressing Save
  persists them; Cancel reverts; next patient uses the configured ID prefix.
- AC2 (LIC-006): after activation the name and registration number show locked
  and cannot be edited here; before activation they are editable.
- AC3 (SET-005): changing font size to Large scales every screen and stays usable
  at 1280 x 720 (00-conventions section 1).
- AC4 (SET-006): changing the data folder moves the data and the app keeps
  working from the new location; a backup is taken before the move.
- AC5 (CASE-004): a new case template with reordered, retyped fields is usable in
  S08; the three shipped templates can be reset.
- AC6 (RX-007): an advice item added here is selectable into a prescription in
  S13.
- AC7 (RX-005): print layout changes (paper size, margins, shown fields) are
  reflected in S14 print preview.
- AC8 (PAT-008): a soft-deleted patient appears in the recycle bin for 30 days
  and restores correctly; permanent delete and Empty bin require the PIN.
- AC9 (ADM-002): the audit log shows create/update/delete rows for patients,
  visits, prescriptions and bills, is filterable and exportable, and cannot be
  edited.
- AC10 (PSR-013): a full index rebuild for 50k patients completes under 60 s with
  a progress bar and runs automatically after a restore.
- AC11 (ADM-005): the diagnostic report is a zip of logs only and contains no
  patient data (checked by scanning the archive).

## Open questions

- OQ-S18-1: The release plan (docs/milestones/README.md) lists S18 only at R9,
  but several of its tabs (General, diagnostic report) are functionally needed
  from R1 and others from R2-R4; this spec slices the tabs across releases.
  Confirm the per-tab release mapping above.
- OQ-S18-2: ADM-002 does not define an audit-log retention period or whether the
  log is included in backups. Proposed default: retained for the life of the
  database and included in backups. Confirm.
- OQ-S18-3: SET-006 does not state what happens to existing data when the folder
  changes. This spec assumes a transactional move with a safety backup first;
  confirm that is wanted rather than a copy-and-leave-original.
- OQ-S18-4: PAT-008 fixes a 30-day recycle window but not whether expired items
  auto-purge silently or need a manual Empty bin. Proposed: auto-purge on the
  daily maintenance run, with manual Empty bin also available. Confirm.
- OQ-S18-5: No requirement states whether administrative profile edits should be
  blocked in read-only mode (LIC-020). This spec keeps them enabled; confirm.
- OQ-S18-6: CASE-004 does not say whether a template can be deleted while cases
  reference it. Proposed: deletion is blocked or soft (hidden) while referenced,
  mirroring the pack-uninstall rule in S19. Confirm.
