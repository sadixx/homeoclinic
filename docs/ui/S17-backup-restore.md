# S17 Backup and restore
Screen id: backup   Route: /backup   Module: apps/desktop/src/backup
Requirements: BAK-001, BAK-002, BAK-003, BAK-004, BAK-005, SUX-011, LIC-064   Milestone: M1  Release: R1

## Purpose

Keep the doctor's data safe and portable without any server. The screen shows
when the last backup ran and whether it is healthy (BAK-004), lets the doctor
back up now to a folder or USB drive with a password (BAK-002), runs automatic
daily backups with retention (BAK-001), restores from a backup file through a
preview-and-confirm wizard (BAK-003), and guides moving to a new computer
(BAK-005). Backups are a single encrypted `.hcbak` archive of the database and
attachments.

## Entry points

- Left nav "Backup".
- Status bar "Last backup: ..." chip (00-conventions section 2) opens this
  screen; the chip turns to a warning colour when the last good backup is older
  than 7 days (BAK-004).
- The R1 setup wizard (S01) links here once setup is complete.

## Layout (wireframe)

```
+----------------------------------------------------------------------------------------------+
| Backup and restore                                                                            |
+----------------------------------------------------------------------------------------------+
| Backup health                                                                                 |
|  Last backup: today 09:10  (checked, OK)            Automatic daily backup: [x] On            |
|  Keeps: 14 daily, 8 weekly, 12 monthly                                                        |
|  {warning banner if last good backup > 7 days: "Your last backup is 9 days old. Back up now"} |
+----------------------------------------------------------------------------------------------+
| Back up now                                                                                   |
|  Save to: [ D:\HomeoClinic-backups\            ] [Choose folder...]  [Use USB drive...]       |
|  Password: [**********]   [x] Remember on this PC                                             |
|            {first time only: Confirm password [**********]}                                   |
|  Includes: patient records + attachments, encrypted.                                          |
|                                                            [ Back up now ]                     |
+----------------------------------------------------------------------------------------------+
| Restore from a backup                                                                         |
|  [ Choose backup file (.hcbak)... ]                                                            |
|  {opens the restore wizard below}                                                              |
+----------------------------------------------------------------------------------------------+
| Move to a new computer                                                                         |
|  Step-by-step: back up here, copy the file and your .hclic, restore on the new PC.            |
|                                                            [ Start move guide ]                |
+----------------------------------------------------------------------------------------------+
```

### Restore wizard (modal, 3 steps)

```
+------------------------------------------------------------+   +-----------------------------------------+
| Restore - Step 1 of 3: choose file and password           |   | Restore - Step 2 of 3: preview          |
|  File: patients-2026-10-16.hcbak                           |   |  This backup contains:                  |
|  Password: [**********]                                    |   |   Patients: 1,284                       |
|  {inline error if wrong password}                          |   |   Visits: 5,902                         |
|                                     [Cancel]  [Next >]     |   |   Last visit: 15-10-2026                |
+------------------------------------------------------------+   |   Backup made: 16-10-2026 09:10         |
                                                                 |   App version: 1.0.3                     |
+------------------------------------------------------------+   |  Your current data is backed up first.  |
| Restore - Step 3 of 3: confirm                            |   |                      [< Back] [Next >]  |
|  Replace all current data with this backup?                |   +-----------------------------------------+
|  A safety copy of the current data is saved first.         |
|                                   [Cancel]  [Restore]      |
+------------------------------------------------------------+
```

## Fields and controls (element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Last backup status | text | date/time and checked result from BAK-004 | backup-status-last |
| Stale-backup banner | banner | shown when last good backup > 7 days (BAK-004); text, not colour alone | backup-stale-banner |
| Auto daily toggle | checkbox | enable/disable automatic daily backup (BAK-001) | backup-auto-toggle |
| Retention line | text | shows 14 daily / 8 weekly / 12 monthly (BAK-001) | backup-retention |
| Destination path | text | folder or USB path for Back up now (BAK-002) | backup-dest-path |
| Choose folder | button | folder picker (BAK-002) | backup-choose-folder |
| Use USB drive | button | lists mounted removable drives (BAK-002) | backup-choose-usb |
| Backup password | password | required; Argon2id + AES-256-GCM key (BAK-002) | backup-password |
| Confirm password | password | shown only when setting a new backup password | backup-password-confirm |
| Remember on this PC | checkbox | stores the password so scheduled backups never ask (SUX-011) | backup-remember |
| Back up now | button | runs backup then integrity check (BAK-002, BAK-004) | backup-run |
| Choose backup file | button | file picker for `.hcbak`; opens restore wizard (BAK-003) | backup-restore-choose |
| Restore password | password | decrypts the chosen file (BAK-002, BAK-003) | backup-restore-password |
| Restore preview panel | panel | patient count, visit count, last visit date, made date, app version (BAK-003) | backup-restore-preview |
| Restore next | button | advances wizard; disabled until file+password valid | backup-restore-next |
| Restore confirm | button | applies restore after a current-data safety copy (BAK-003) | backup-restore-confirm |
| Start move guide | button | opens the move-to-new-computer guide (BAK-005) | backup-move-start |

## Behaviour

- Back up now writes a single encrypted `.hcbak` archive (database plus the
  encrypted attachments) to the chosen folder or USB drive, keyed from the
  backup password with Argon2id and AES-256-GCM (BAK-002). It uses the SQLite
  online backup API so it is safe while the app runs (BAK-001).
- After every backup (manual or automatic) the app verifies the archive by
  checksum and a decrypt test and records the result; if the last good backup is
  older than 7 days it raises the warning banner and the status-bar chip turns to
  a warning colour (BAK-004).
- Automatic daily backup runs on app close or the first launch of the day,
  keeping the last 14 daily, 8 weekly and 12 monthly copies and pruning older
  ones (BAK-001). The password is reused silently from the remembered credential
  so scheduled backups never prompt (SUX-011).
- Restore is always preview first: step 1 takes the file and password, step 2
  shows the counts and dates read from the archive without changing anything,
  step 3 confirms. The current database is backed up to a safety copy before the
  restore is applied, so a mistaken restore is recoverable (BAK-003).
- A wrong restore password shows an inline message on step 1 and does not
  advance; a corrupt or truncated file is reported in plain language with a
  Details expander for a support code (NFR-033).
- Move to a new computer is a guided wrapper over the same backup and restore
  plus a reminder to copy the `.hclic` licence file, which re-imports on the new
  PC without contacting us (BAK-005, LIC-064).

## Release slices

- R1 (M1, first usable): backup health status with the 7-day warning, Back up
  now to a folder or USB with a password and Remember-on-this-PC, automatic daily
  backup with the 14/8/12 retention, and the full restore wizard with preview and
  pre-restore safety copy (BAK-001, BAK-002, BAK-003, BAK-004, SUX-011). This is
  the R1 demo "back up now to a folder with a password; restore it on a clean
  install".
- R2 and later: no screen change, but each later release's new data (patients at
  R2, cases at R3, and so on) is carried by the same archive, and from R1 every
  release must restore the previous release's backups (ADR-0002 item 4).
- Deferred within MVP1: the "Move to a new computer" guided flow is BAK-005 (P1);
  if it is not built at R1 the plain back-up-then-restore path still achieves the
  same result and the button is feature-flagged off (recorded in Open questions).

## States (empty, loading, error, read-only, trial)

- Empty: before any backup exists, the health panel shows "No backup yet. Back
  up now to protect your records" with Back up now as the primary action
  (00-conventions empty-state rule).
- Loading: Back up now and restore show per-step progress (archiving,
  encrypting, verifying); never a blocking spinner over the form.
- Error: wrong password -> inline message; corrupt file or no space -> plain
  message naming the cause with a Details expander; no SQL or file paths
  (NFR-033).
- Read-only mode (LIC-020): backup, restore and the move guide stay fully enabled
  on an expired licence, because data must always be exportable and recoverable
  (00-conventions section 4, LIC-020).
- Trial: unchanged; the trial badge is in the nav only (SUX-003).

## Keyboard

- Tab order: destination, password, Back up now. Enter on the password field
  runs Back up now when a destination is set.
- In the restore wizard Enter is Next / Restore, Esc cancels the wizard without
  changing data (00-conventions section 3).
- Alt+Left goes back (00-conventions section 3).

## Commands used (proposed Tauri command names)

- `get_backup_status` req `{}` resp `{ last_backup_at, last_backup_ok, days_since_good, auto_enabled, retention: { daily, weekly, monthly }, stale: bool }` (BAK-001, BAK-004)
- `set_auto_backup` req `{ enabled }` resp `{ ok }` (BAK-001)
- `list_removable_drives` req `{}` resp `{ drives: [{ path, label, free_bytes }] }` (BAK-002, USB picker)
- `backup_now` req `{ out_dir, password?, remember_password }` resp `{ ok, file_path?, size_bytes?, verified?, error?: { code, message } }` (BAK-002, BAK-004, SUX-011)
- `restore_preview` req `{ file_path, password }` resp `{ ok, preview?: { patient_count, visit_count, last_visit_date, created_at, app_version }, error?: { code, message } }` (BAK-003)
- `restore_apply` req `{ file_path, password }` resp `{ ok, pre_restore_backup_path?, error?: { code, message } }` (BAK-003)
- `verify_backup` req `{ file_path, password }` resp `{ ok, checksum_ok, decrypt_ok }` (BAK-004)
- `start_move_to_new_computer` req `{ out_dir, password?, remember_password }` resp `{ ok, backup_file_path, licence_file_path?, steps: [string] }` (BAK-005, LIC-064)

## Acceptance checks

- AC1 (BAK-002, demo R1 step 3): Back up now to a folder with a password
  produces a `.hcbak`; restoring it on a clean install brings back the doctor and
  clinic profile.
- AC2 (BAK-001): automatic daily backup keeps at most 14 daily, 8 weekly and 12
  monthly copies; older copies are pruned.
- AC3 (BAK-004): every backup is checksum- and decrypt-verified; a last good
  backup older than 7 days raises the warning banner and the status-bar warning
  colour.
- AC4 (BAK-003): restore shows the preview counts and dates before any change and
  takes a safety copy of current data first; a wrong password is refused on step
  1 without advancing.
- AC5 (SUX-011): with Remember-on-this-PC set, scheduled backups run without
  asking for a password; a restore to a different PC still asks for it.
- AC6 (BAK-005, LIC-064): the move guide produces a backup and names the `.hclic`
  to copy; restoring and re-importing on a never-online PC reproduces all data
  and the licence.
- AC7 (NFR-022 / SUX-004): backup and restore perform no network call; verified
  with the network disabled.

## Open questions

- OQ-S17-1: BAK-001 fixes the retention counts (14/8/12) but not the exact daily
  trigger time; "on app close or first launch of the day" is assumed. Confirm.
- OQ-S17-2: BAK-002 specifies Argon2id and AES-256-GCM but not minimum backup
  password strength or whether an empty password is allowed for a local-only
  copy. Proposed default: a password is required and must be at least 8
  characters. Confirm.
- OQ-S17-3: SUX-011 says remembered credentials default on the same PC but does
  not name the store; the OS secure store (Windows DPAPI / Linux Secret Service,
  NFR-020) is assumed, falling back to a DEK-encrypted file. Confirm.
- OQ-S17-4: BAK-005 ("Move to new computer") is P1; confirm whether it ships at
  R1 or the button is feature-flagged off until later in MVP1.
- OQ-S17-5: No requirement defines behaviour when the chosen USB drive is removed
  mid-backup or runs out of space beyond the generic error rule (NFR-033).
  Proposed: fail safely, keep the previous good backup, and show a plain message.
  Confirm.
