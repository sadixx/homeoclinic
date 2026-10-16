# S03 Today
Screen id: today   Route: /today   Module: apps/desktop/src/home
Requirements: VIS-005, PSR-010, BAK-004, LIC-021   Milestone: M0  Release: R0

## Purpose
The default home screen (VIS-005). Shows what the doctor needs to act on today:
follow-ups due today, overdue follow-ups, today's registered visits, plus
one-click saved filters, a backup warning and licence renewal reminders.

## Entry points
- Default screen after unlock (S02) and after setup Finish (S01).
- F3 from anywhere; the "Today" nav item (conventions section 2).
- Alt+Left back target from most screens.

## Layout (wireframe)
Standard app shell (conventions section 2) with Today in the content area.

```
+----------------------------------------------------------------------------------+
| [Logo] HomeoClinic  [ Search patients... (F2) .........................]  [?] [L] |
+-----------+----------------------------------------------------------------------+
| Today  F3 | Today - Thu 16-10-2026                             [ New patient F4 ] |
| Patients  |                                                                       |
| Repertory | {reminder banner: Licence expires in 7 days  [ Renew ] }  (LIC-021)   |
|   F6      | {backup banner: Last backup 9 days ago        [ Backup now ] } BAK-004 |
| Mat.Med.  |                                                                       |
| Billing   | Saved filters:  [Overdue chronic skin]  [Dues > 0]  [+ New]  (PSR-010) |
| Reports   |                                                                       |
| Backup    | +-- Due today (5) ------------------+ +-- Overdue (3) ----------------+ |
| Settings  | | {photo} Ramesh Kumar HC-000123    | | {photo} Sita Devi HC-000087    | |
|           | |   34y M  due today  Sulphur 200   | |   51y F  7d overdue            | |
| [Trial: 9 | | {photo} Asha Patil  HC-000210     | | {photo} ...                    | |
|  days]    | |   ...                             | |                                | |
|           | +-----------------------------------+ +--------------------------------+ |
|           | +-- Registered today (12) ----------------------------------------------+|
|           | | {photo} Imran Shaikh HC-000311  First visit  10:05  [ Open ]          ||
|           | | ...                                                                   ||
|           | +-----------------------------------------------------------------------+|
+-----------+----------------------------------------------------------------------+
| Saved 10:42 | Last backup: 07-10 09:10 (9 days ago) | Licence: Trial 9 days         |
+----------------------------------------------------------------------------------+
```

## Fields and controls (element | type | rules | testid)
| Element | Type | Rules | testid |
|---|---|---|---|
| Date heading | text | today in DD-MM-YYYY (conventions section 4) | today-date |
| New patient | button | opens S06 (F4) | today-new-patient |
| Licence reminder banner | banner + button | shown at 30/15/7/1 days before expiry (LIC-021) | today-licence-reminder |
| Renew button | button | opens Buy screen (S20) with current plan preselected (LIC-021) | today-renew |
| Backup warning banner | banner + button | shown if last good backup > 7 days (BAK-004) | today-backup-warning |
| Backup now button | button | opens backup flow (S17) | today-backup-now |
| Saved filters chips | chips | one click applies a filter on S05 (PSR-010) | today-saved-filter |
| New saved filter | button | opens S05 filter panel to create one (PSR-010) | today-saved-filter-new |
| Due today list | virtualised list | follow-ups with next_followup_on = today (VIS-005) | today-due-list |
| Due today row | row | Enter/click opens patient dashboard (S07) | today-due-row |
| Overdue list | virtualised list | next_followup_on < today (VIS-005) | today-overdue-list |
| Overdue row | row | opens patient dashboard (S07) | today-overdue-row |
| Registered today list | virtualised list | today's visits (VIS-005) | today-registered-list |
| Registered today row | row | opens patient dashboard (S07) | today-registered-row |

## Behaviour
- On open, loads the three lists plus banners in one call; lists are virtualised
  (conventions section 4), 20 rows first.
- A row shows photo thumbnail, name, code, age/sex, and context (due today /
  N days overdue / visit time and type). Enter or click opens S07.
- The licence reminder banner appears only inside the reminder windows (30, 15,
  7, 1 days before expiry) and its Renew button deep-links to the Buy screen
  with the current plan preselected (LIC-021).
- The backup banner appears only when the last successful backup is older than
  7 days (BAK-004); it mirrors the status-bar warning colour.
- Saved filters are clinic-local; clicking one navigates to S05 with that filter
  applied; "+ New" opens S05 with the filter panel ready to save (PSR-010).

## Release slices
- R0 (M0): the screen renders in the shell with its empty state (no patients
  yet); F2 focuses search (no results). Due/overdue/registered lists, saved
  filters, backup banner and licence reminder are all flagged off and render as
  the empty state. This is the R0 demo.
- R1 (M1): the backup warning banner (BAK-004) becomes live once backup/restore
  (S17) ships.
- R3 (M3): due-today, overdue and registered-today lists become live once visits
  and follow-ups (S08, S09) exist (VIS-005). This is part of the R3 demo
  (patient appears on Today on the follow-up date; overdue after it).
- R8 (M9): the licence renewal reminders (LIC-021) become live once the Buy
  screen (S20) and real licence expiry exist.
- Saved filters (PSR-010, P1) become usable with S05 at R2; before S05 exists
  the chips row is hidden.

## States (empty, loading, error, read-only, trial)
- Empty: "No follow-ups or visits yet. Register your first patient." with a
  [ New patient ] button (conventions: empty state = one sentence + primary
  action). This is the R0 state.
- Loading: skeleton rows after 150 ms per list; never a blocking spinner.
- Error: a list that fails to load shows an inline "Could not load, Retry" row
  with a Details expander; other lists still render.
- Read-only (LIC-020): lists, banners and opening patients all work; the New
  patient button is disabled with the standard tooltip (conventions section 4).
- Trial: the nav trial badge and status bar show days remaining; no extra Today
  content.

## Keyboard
- F3 focuses Today; F4 new patient; F2 / Ctrl+K focus search.
- Up/Down move within the focused list, Enter opens, Home/End jump (conventions
  section 4).
- Tab moves between the banner actions, saved-filter chips and the three lists.

## Commands used (proposed)
- `today_get_overview({ today: date }) -> { due_today: PatientRow[], overdue: PatientRow[], registered_today: VisitRow[], backup_warning: { last_backup_at, days_since } | null, licence_reminder: { days_to_expiry, plan } | null }`
- `today_list_saved_filters() -> { filters: { id, name }[] }`  (PSR-010)
- where `PatientRow = { patient_id, code, name, age_label, sex, photo_path, next_followup_on, dues_paise }` and `VisitRow = { patient_id, code, name, photo_path, visit_at, type }`.

## Acceptance checks
- Today is the screen shown on launch after unlock (VIS-005).
- The Today follow-up list loads within budget: under 200 ms at the 50k/100k
  baseline (NFR-002).
- At R0 the empty state renders and F2 focuses search (R0 demo step 3).
- From R3, a patient with next follow-up = today appears under Due today, and
  after that date under Overdue, using the test clock (R3 demo step 3; VIS-005).
- The backup banner appears only when last good backup > 7 days (BAK-004).
- The licence reminder shows at 30/15/7/1 days and Renew opens the Buy screen
  with the current plan preselected (LIC-021).

## Open questions
- Ordering within "Due today" and "Overdue" (by appointment time, by most
  overdue, or alphabetical) is not specified; proposed default: overdue sorted
  most-overdue first, due-today by patient name. Confirm.
- Whether "Registered today" counts walk-ins without a visit record yet
  (appointments, VIS-006) or only saved visits. Proposed default: saved visits
  only in MVP1. Confirm.
