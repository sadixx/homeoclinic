# S01 First-run setup wizard
Screen id: setup   Route: /setup   Module: apps/desktop/src/setup
Requirements: SET-001, SET-002, SET-003, SET-004, SET-005, SET-006, LIC-006, LIC-063   Milestone: M1  Release: R1

## Purpose
Collect the minimum to make the app usable on a fresh install: doctor profile,
clinic profile, an app PIN with a printable recovery code, and a licence step
that starts a local trial. Runs once, the first time the app opens with no
existing database (SET-001).

## Entry points
- Automatic on first launch when no `clinic.db` / completed-setup flag exists.
- Not reachable afterwards; profile and PIN are later edited in Settings (S18,
  out of scope for this file) subject to identity lock (LIC-006).

## Layout (wireframe)
Max 4 steps (SET-001). Fixed 1366 px content area, centered 900 px card, no left
nav during setup. Step rail across the top.

```
+----------------------------------------------------------------------------------+
| HomeoClinic setup                                   Language: [English v]  (SET-001)|
+----------------------------------------------------------------------------------+
|  (1) Doctor    (2) Clinic    (3) Security    (4) Licence         Step 1 of 4       |
+----------------------------------------------------------------------------------+
|                                                                                    |
|  Doctor profile                                                                    |
|  Full name *            [______________________________]                          |
|  Qualification *        [BHMS / MD(Hom) / ...__________]                           |
|  Registration number *  [__________]   Council *  [State Council v]                |
|  Phone                  [__________]   Email      [____________________]           |
|  Signature image        [ Choose file ] [ Use webcam ]   {preview 120x60}          |
|  Clinic logo            [ Choose file ]                  {preview 80x80}           |
|                                                                                    |
|  Note: your name and registration number will be printed on every prescription     |
|  and receipt. During the trial they are editable; after you activate a licence     |
|  they lock to the licensed values (LIC-006).                                        |
|                                                                                    |
|                                              [ Back ]   [ Next > ]                  |
+----------------------------------------------------------------------------------+
```

Step 2 (Clinic):
```
|  Clinic name *   [________________]   Default consultation fee * [Rs ____]         |
|  Address *       [________________]   Default follow-up fee *    [Rs ____]         |
|  Phone           [__________]         GSTIN (optional)           [___________]     |
|  Timings         [Mon-Sat 10:00-14:00, 17:00-20:00_____________]                   |
```

Step 3 (Security):
```
|  Set app PIN *          [____]   Confirm PIN *   [____]                             |
|  Auto-lock after        [15 v] minutes idle (SET-004)                              |
|  Font size              ( ) Normal  (o) Large  ( ) Extra large  (SET-005)          |
|  Data folder            [ %APPDATA%\HomeoClinic\ ]  [ Change... ]  (SET-006)       |
|                                                                                    |
|  {after PIN confirmed, reveal:}                                                    |
|  +----------------------------------------------------------------+               |
|  | Recovery code (write this down, shown once):  7Q3K-9F2M-XR4T    |  [ Print ]    |
|  | If you forget your PIN this code is the only way back in.       |               |
|  +----------------------------------------------------------------+               |
|  [x] I have saved my recovery code                                                 |
```

Step 4 (Licence):
```
|  Licence                                                                           |
|  (o) Start 30-day free trial   {Trial: 30 days, all features (LIC-063)}            |
|  ( ) I already have a licence file   -> opens Import licence (S20, from R8)        |
|                                                                                    |
|  Development trial                                                                 |
|  This build uses a built-in development trial. Buying and importing a real         |
|  licence arrives in R8.                                                             |
|                                                                                    |
|                                     [ Back ]   [ Finish setup ]                    |
+----------------------------------------------------------------------------------+
```

## Fields and controls (element | type | rules | testid)
| Element | Type | Rules | testid |
|---|---|---|---|
| Language select | dropdown | English only in MVP1, i18n-ready (SET-001) | setup-language |
| Doctor name | text | required (SET-002); editable in trial, locks on activation (LIC-006) | setup-doctor-name |
| Qualification | text | required (SET-002) | setup-doctor-qualification |
| Registration number | text | required (SET-002); locks on activation (LIC-006) | setup-doctor-regno |
| Council | dropdown + free text | required (SET-002) | setup-doctor-council |
| Doctor phone | text | digits only, shown grouped | setup-doctor-phone |
| Doctor email | text | email format on blur | setup-doctor-email |
| Signature image | file / webcam | optional (SET-002) | setup-doctor-signature |
| Clinic logo | file | optional (SET-002) | setup-clinic-logo |
| Clinic name | text | required (SET-003) | setup-clinic-name |
| Clinic address | textarea | required (SET-003) | setup-clinic-address |
| Clinic phone | text | optional (SET-003) | setup-clinic-phone |
| Default consultation fee | money | required (SET-003); integer paise internally | setup-clinic-fee-first |
| Default follow-up fee | money | required (SET-003) | setup-clinic-fee-followup |
| GSTIN | text | optional (SET-003) | setup-clinic-gstin |
| Timings | text | optional (SET-003) | setup-clinic-timings |
| App PIN | password | required (SET-004) | setup-pin |
| Confirm PIN | password | must equal PIN (SET-004) | setup-pin-confirm |
| Auto-lock minutes | dropdown | default 15 (SET-004) | setup-autolock |
| Font size | radio | Normal/Large/Extra large (SET-005) | setup-font-size |
| Data folder | path + button | default per OS dir (SET-006) | setup-data-dir |
| Recovery code card | readonly | shown once after PIN set (SET-004) | setup-recovery-code |
| Print recovery code | button | prints the recovery code (SET-004) | setup-recovery-print |
| Recovery saved ack | checkbox | required to leave step 3 | setup-recovery-ack |
| Licence choice | radio | Trial (default) or Import | setup-licence-choice |
| Back | button | disabled on step 1 | setup-back |
| Next | button | validates current step | setup-next |
| Finish setup | button | completes wizard, routes to Today | setup-finish |

## Behaviour
- Steps validate on Next; required fields show inline messages (per conventions
  section 4), never only a toast.
- Step 3 generates the recovery code only after the PIN and confirm match; the
  code is shown once and must be acknowledged (checkbox) and offered for print
  (SET-004). It is not shown again after setup.
- Changing the data folder (SET-006) before finishing relocates where
  `clinic.db` is created. Default is the per-OS app data dir.
- Finish writes doctor, clinic, PIN hash, settings and starts the local trial
  (LIC-063), then routes to Today (S03) unlocked.
- During the trial the doctor name and registration number stay editable; the
  identity lock (LIC-006) is enforced only after a real licence is imported
  (R8). The licence step in this release only offers the development trial.

## Release slices
- R1 (M1): full wizard works end to end; licence step offers the built-in
  development trial only (ADR-0002 point 6). Produces a usable, PIN-protected
  install. Steps 1-3 and trial start are the R1 demo.
- R8 (M9): the licence step gains the "I already have a licence" path that opens
  the Buy / Import licence screen (S20) and, on activation, locks identity fields
  (LIC-006). Flagged off before R8 (feature flag); the radio option is hidden.
- Font-size (SET-005), data-folder chooser (SET-006) and signature/logo capture
  are present from R1 (P1 items may render but can be flagged off if not ready;
  the wizard still completes without them).

## States (empty, loading, error, read-only, trial)
- Empty: first launch, all fields blank, step 1 shown.
- Loading: writing profiles on Finish shows a short inline progress on the
  button, never a blocking spinner over the form.
- Error: a failed write (e.g. data folder not writable) shows a plain-language
  message with a Details expander for a support code; the wizard stays on the
  step with entered values preserved.
- Read-only: not applicable (licence restrictions cannot exist before setup).
- Trial: step 4 default; on Finish the trial badge begins counting in the shell.

## Keyboard
- Enter advances to Next when the step is valid; Shift+Enter inserts newline in
  textareas. Esc does not discard entered data (conventions section 3).
- Tab order follows visual order; no keyboard trap on any step.

## Commands used (proposed)
- `setup_get_state() -> { completed: bool, current_step: u8, data_dir: string }`
- `setup_save_doctor_profile({ name, qualification, reg_no, reg_council, phone, email, signature_image_path?, clinic_logo_path? }) -> { doctor_id }`
- `setup_save_clinic_profile({ name, address, phone?, timings?, fee_first_paise, fee_followup_paise, gstin? }) -> { clinic_id }`
- `setup_set_pin({ pin, confirm_pin, autolock_minutes }) -> { recovery_code }`
- `setup_set_data_dir({ path }) -> { data_dir }`
- `setup_set_font_size({ size }) -> {}`  (size: "normal" | "large" | "xlarge")
- `setup_start_trial() -> { trial_valid_until, trial_days_remaining }`
- `setup_complete() -> { home_route }`

## Acceptance checks
- Fresh install reaches the home screen in under 3 minutes of doctor effort
  (acceptance flow 1, requirements/05 section 7; NFR-030 <= 3 clicks from home
  to any core task afterwards).
- Wizard is at most 4 steps (SET-001).
- Required fields on each step block Next with an inline message (conventions 4).
- Recovery code is shown exactly once, is printable, and must be acknowledged
  before leaving step 3 (SET-004).
- On Finish the trial is active with 30 days remaining (LIC-063) and the app
  opens unlocked at Today (VIS-005).
- Reopening the app after Finish requires a PIN (SET-004), verified by S02.
- Doctor name and registration number are editable in the trial and would be
  the values printed on documents (LIC-006).

## Open questions
- SET-001 lists the four steps as language, doctor, clinic, licence, but the R1
  demo (docs/milestones/README.md) lists doctor, clinic, PIN + recovery, licence.
  This spec treats PIN/recovery as step 3 (Security) and makes language a small
  header selector (English-only in MVP1). Confirm this resolution of the 4-step
  cap.
- SET-006 data-folder chooser and SET-005 font size are folded into the Security
  step to stay within four steps. Confirm placement, or whether they move to
  Settings and out of the wizard entirely.
- PIN length / complexity policy and lock-out after repeated wrong confirmations
  are not specified in SET-004; see S02 open questions.
