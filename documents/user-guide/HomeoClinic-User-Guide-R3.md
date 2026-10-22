# HomeoClinic User Guide

**Covers releases R0 + R1 + R2 + R3 (milestones M0 + M1 + M2 + M3): "Paper
replacement".**

This guide is cumulative. Each milestone's guide includes everything from the
previous milestones plus the new features. This edition (R3) adds on-screen
case taking, follow-up visits, and a live Today screen on top of the patient
register (R2) and the setup/lock/backup features (R1). Later editions (R4, R5,
...) will add prescriptions and printing, billing, and the repertory.

HomeoClinic is a fully offline desktop application. It makes no network calls
of its own: your patient data never leaves your computer, and everything in
this guide works with the internet disconnected.

---

## 1. Installing and opening the app (R0)

### Ubuntu / Linux

You received one of these files:

- **`HomeoClinic_<version>_amd64.AppImage`** — portable, no installation.
  1. Make it executable: right-click → Properties → Permissions → "Allow
     executing file as program", or in a terminal run
     `chmod +x HomeoClinic_*.AppImage`.
  2. Double-click it (or run `./HomeoClinic_<version>_amd64.AppImage`).
- **`HomeoClinic_<version>_amd64.deb`** — installs into the system menu.
  1. Install it: `sudo apt install ./HomeoClinic_<version>_amd64.deb`.
  2. Launch "HomeoClinic" from your applications menu.

### Windows

1. Run the **`.exe`** (NSIS) or **`.msi`** installer and follow the prompts.
   The app installs per-user; no administrator rights are required.
2. Launch "HomeoClinic" from the Start menu.

### What you should see

- The application window opens within a few seconds.
- On a **brand-new installation**, the app opens the **first-run setup
  wizard** (see section 2).
- On an **already set-up installation**, the app opens the **lock screen**
  and asks for your PIN (see section 3).

The main application shell has:

- a **top bar** with a patient search box (press **F2** to focus it) and
  buttons for Help (**F1**) and Lock (**Ctrl+L**);
- a **left navigation** with Today, Patients, Backup and Settings (some items
  are disabled until later releases add their screens);
- a **status bar** at the bottom showing the save state, the last backup
  time, and the licence/trial state.

> In R3 the working areas are: setup, lock, the **Today** home (now with live
> due/overdue lists), the **Patients** register and search, **case taking**
> and **follow-up visits** (new in R3), and Backup. Prescriptions, billing and
> the repertory arrive in later releases.

---

## 2. First-run setup wizard (R1)

The first time you open the app on a new computer, the setup wizard runs
automatically. It has at most four short steps and should take only a couple
of minutes. The language selector at the top is English for this release.

### Step 1 — Doctor profile

Enter your professional details. These print on every prescription and
receipt in later releases.

- **Full name** (required)
- **Qualification** (required) — e.g. BHMS, MD(Hom)
- **Registration number** and **Council** (required)
- **Phone** and **Email** (optional)
- **Signature image** and **Clinic logo** (optional)

Click **Next**. Required fields that are empty show an inline message under
the field.

### Step 2 — Clinic profile

- **Clinic name** (required)
- **Address** (required)
- **Default consultation fee** and **Default follow-up fee** (required) —
  amounts are shown in Indian number format
- **Phone**, **GSTIN**, **Timings** (optional)

Click **Next**.

### Step 3 — Security (PIN and recovery code)

1. **Set a PIN** (4 to 6 digits) and **confirm** it. This PIN protects all
   your patient data.
2. Choose the **auto-lock** time (how many idle minutes before the app locks
   itself; default 15).
3. After the PIN is confirmed, the app shows a **one-time recovery code**.
   - **Write it down or click Print.** It is shown only once.
   - If you ever forget your PIN, this recovery code is the only way back
     into your data.
4. Tick **"I have saved my recovery code"** to continue.

> **Keep the recovery code safe and separate from the computer.** There is no
> way to recover your data without either the PIN or the recovery code — this
> is what keeps patient data private.

### Step 4 — Licence

- Select **Start 30-day free trial**. This release uses a built-in
  **Development trial**; buying and importing a real licence arrives in a
  later release.

Click **Finish setup**. The app creates your encrypted database, starts the
trial, and opens the **Today** screen, unlocked and ready.

> **Setup must be finished before anything else is available.** The rest of
> the app cannot be reached until you complete the wizard and start the trial
> here. **Finish setup** is the only way out of the wizard; there is no
> shortcut that skips the trial. (If you close the app mid-setup, it reopens
> on the wizard where you left off.)

---

## 3. Locking and unlocking the app (R1)

Your data sits behind a single PIN entry.

### When the app locks

- **On every launch** after setup is complete.
- **Automatically** after the idle time you chose (default 15 minutes).
- **On demand** — press **Ctrl+L** or click the **Lock** button in the top
  bar at any time.

### Unlocking

1. Type your **PIN** and press **Enter** (or click **Unlock**).
2. A correct PIN unlocks immediately and returns you to where you were.
3. A wrong PIN shows an inline message and lets you try again — the app never
   locks you out or wipes anything for a wrong entry.

### Forgot your PIN

1. On the lock screen, click **Forgot PIN?**.
2. Enter the **recovery code** from setup, then set and confirm a **new PIN**.
3. Click **Reset PIN**. You can now unlock with the new PIN.

> Unlocking and recovery happen entirely on your computer — no internet is
> used or required.

### Trial status in the status bar (R1)

The status bar shows your licence state, e.g. **"Licence: Trial — expires
<date> (N days left)"**. The days-remaining counts down against a tamper-proof
clock: setting the computer's date backwards does **not** extend the trial.

---

## 4. Registering patients (R2)

Open **Patients** from the left navigation, then **New patient** (or press
**F4**). This opens the registration form (screen S06).

### The registration form

- **Name** (required).
- **Age** (required) **or Date of birth** — entering a date of birth fills the
  age automatically; otherwise type the age directly (it may be estimated).
- **Sex**, **Mobile**, **Alternate mobile**, **Address**, **City**,
  **Occupation**, **Marital status**, **Blood group**, **Referred by** —
  all optional.
- A **patient code** (e.g. `HC-000123`) is assigned automatically with your
  clinic prefix. Codes are **never reused**, even after a patient is deleted
  and restored.
- Required fields validate inline; fees and money show in Indian number
  format.

### Patient photo (R2)

In the form you can attach a photo two ways:

- **Choose file** — pick an image file from disk.
- **Use webcam** — capture from the computer's default camera. The app asks
  for camera access; if a camera is unavailable or access is denied, it tells
  you and you can fall back to a file.

You can **remove**, **retake**, or **swap** the photo (file ↔ webcam) before
or after saving — the photo updates with the patient record.

### Duplicate warning

Before saving, if another patient matches on **name + mobile** or
**name + date of birth** (including common Indian-name spelling variants),
the form shows a **duplicate warning** listing the possible matches. It does
not block you — you decide whether it's truly a new patient.

Click **Save**. The new patient is stored and becomes **findable immediately**
in search.

---

## 5. Finding patients — global search (R2)

Press **F2** or **Ctrl+K** (or click the top-bar search box) to open the
global search overlay from any screen. It finds patients from the first
character you type — no need to choose a field.

### What it matches

- **Name** — any word prefix, e.g. typing `ram ku` finds "Ramesh Kumar".
- **Patient ID** — full code or just the digits, e.g. `123` finds `HC-000123`.
- **Mobile** — any 4 or more consecutive digits, ignoring `+91` and spaces.
- **City** and **family member name**.
- **Phonetic / spelling variants** of Indian names — e.g. `sarma` finds
  "Sharma", `laxmi` finds "Lakshmi", `mohd` finds "Mohammad". Exact matches
  always rank above phonetic ones.

### Using it

- Results update as you type and each row shows photo, name, ID, age/sex,
  mobile, city, last visit and dues.
- Use **Up/Down** to move and **Enter** to open the patient's dashboard.
  **Enter** on an exact ID or mobile match opens that patient directly.
- When the box is empty, your **last 20 opened patients** are shown.
- Search stays fast — results appear in well under a tenth of a second even
  with tens of thousands of patients.

---

## 6. The patient list and filters (R2)

Open **Patients** to see the full list with a filter panel (screen S05).

- **Filters available now:** last visit older than N days, next follow-up
  (today / overdue / date range), age range, sex, city, and "has dues".
  Filters combine together; results are sortable by name, ID, last visit and
  next follow-up.
- **Export CSV** writes the current filtered, sorted list to a file.
- Some filters (by remedy, diagnosis, potency, case-note text, tags, and
  saved filters) are shown but **disabled** — they switch on in later
  releases once more case and prescription data exists.

---

## 7. The patient dashboard (R2)

Clicking a patient (from search or the list) opens their dashboard (screen
S07):

- **Demographics banner** — name, code, age/sex, mobile, city, referred by,
  photo — plus any **allergies / alerts**.
- **Family** — linked family members with quick-switch.
- **New visit / Take case** — starts a case or follow-up for this patient
  (see sections 8 and 9). New in R3.
- **Visit timeline** builds up as you record visits (R3). Prescriptions and
  dues appear here from later releases.

From the dashboard you can **Edit** the patient, **Export** their record
(PDF or JSON), or move them to the **recycle bin**.

---

## 8. Taking a case (R3, new)

From a patient's dashboard, click **Take case** (or **New visit** for a
patient with no prior visit; shortcut **F5**). This opens the detailed
first-case form (screen S08) — the on-screen replacement for the paper case
sheet.

### How the case form works

- The form is **template-driven**. It opens with the default **Chronic
  detailed** template and shows its sections in order: chief complaints,
  history of present illness, past/family/personal history, physical and
  mental generals, examination/vitals, investigations, provisional diagnosis,
  and the doctor's analysis. (Templates **Acute quick** and **Child** are also
  available.)
- **Sections are collapsible, and you can hide the ones you never use** — the
  choice is remembered as your own template.
- **Conditional sections** appear only when relevant: the menstrual/obstetric
  section shows for female patients, and the child-development section for
  patients under 14.
- **Chief complaints** are a repeating block — add as many as needed, each with
  location, sensation, aggravation, amelioration, concomitants, duration and
  onset.
- **Pick lists with free text**: fields like thermal state and thirst offer
  common values but always accept whatever you type.
- **Vitals** compute **BMI live** from weight and height.

### Autosave — nothing is lost

- There is **no Save button**. The form **autosaves every 2 seconds and
  whenever you leave a field**; the status bar shows "Saving..." then
  **"Saved hh:mm"**.
- If the app is closed — or the computer crashes — **mid-typing**, reopening
  the patient's case restores the last autosaved content with **nothing lost**.

### Case summary

- Click **Case summary** (**Ctrl+P**) to open a read-only summary of the case.
  Printing it to paper/PDF arrives with the prescription print path in a later
  release.

> The **"Send to repertory"** action is not shown yet; it switches on when the
> repertory ships in a later release.

---

## 9. Follow-up visits (R3, new)

For a patient who already has a case, click **New visit** on the dashboard
(shortcut **F5**) to record a routine return consultation (screen S09). It
needs far less typing than the first case.

- **Visit type**: First / Follow-up / Acute / Tele.
- **Complaints pre-load** from the previous visit. For each, set a **status**
  — Better / Same / Worse / New / Resolved — and an **improvement %** slider
  (0–100), with an optional note. You can also **add a new complaint**.
- **Remedy response**: pick one of six Hering's-law-aware options
  (Amelioration; Aggravation then amelioration; No change; Aggravation; New
  symptoms; Old symptoms returned).
- **Observations and vitals** as needed.
- **Next follow-up**: quick buttons **7d / 15d / 1m / 2m** or a **custom
  date**. Setting it schedules the patient onto the Today screen for that date
  (see section 10).
- Like the case form, the follow-up **autosaves** (2 s + on blur; "Saved"
  shown in the status bar).

> The **progress chart** and the **Prescribe** action are not active yet; they
> switch on in later releases.

---

## 10. The Today screen (R3 — now live)

**Today** is the home screen (press **F3**). From R3 it shows three live
lists, driven by the follow-up dates you set:

- **Due today** — patients whose next follow-up falls on today's date.
- **Overdue** — patients whose follow-up date has passed (most overdue first).
- **Registered today** — the visits recorded today.

Each row shows the patient's photo, name, code and age/sex; click or press
**Enter** to open their dashboard. Set a follow-up date on a visit and the
patient appears under **Due today** on that date, then moves to **Overdue**
afterwards.

Today also shows the **backup warning banner** when your last good backup is
more than 7 days old (see section 11). The licence-renewal reminder becomes
live in a later release.

---

## 11. Backing up your data (R1)

Backup becomes available **after** you finish the first-run setup (section 2).
Once setup is complete, open **Backup** from the left navigation (or click the
"Last backup" chip in the status bar).

### Back up now (to a folder or USB drive)

1. Under **Back up now**, choose a destination with **Choose folder...** or
   **Use USB drive...**.
2. Enter a **backup password** (at least 8 characters). The first time, you
   also confirm it.
3. Optionally tick **Remember on this PC** so scheduled backups never ask for
   the password again on this computer.
4. Click **Back up now**.

The app writes a single encrypted file, `*.hcbak`, containing your database
and attachments (patients, their photos, and now your cases and visits). After
writing, it verifies the file (checksum + decrypt test).

> The backup password is **separate** from your app PIN. You need this
> password to restore the backup on another computer, so store it safely.

### Automatic daily backups

- Automatic daily backup keeps the last **14 daily**, **8 weekly** and
  **12 monthly** copies, pruning older ones.
- It runs on app close or the first launch of the day and uses your remembered
  password, so it never interrupts you.

### Backup health

- The screen and the status-bar chip show when the **last good backup** ran.
- If the last successful backup is **more than 7 days old**, a warning banner
  appears prompting you to back up.

---

## 12. Restoring from a backup (R1)

Use this to recover data, or to move to a new computer (install HomeoClinic on
the new PC, then restore).

1. On the **Backup** screen, under **Restore from a backup**, click
   **Choose backup file (.hcbak)...**.
2. **Step 1 — File and password:** select the `.hcbak` file and enter its
   backup password. A wrong password is refused here and the wizard does not
   continue.
3. **Step 2 — Preview:** the app shows what the backup contains (counts and
   dates) **without changing anything yet**.
4. **Step 3 — Confirm:** click **Restore**. Before replacing anything, the app
   takes a **safety copy of your current data**, then swaps in the restored
   data. A mistaken restore is therefore recoverable.

After restore, your doctor and clinic profile, **all patients** (with photos)
and **all cases and visits** come back.

> Upgrading from an older version keeps your data: installing a new release
> over an existing one migrates your database automatically and your previous
> backups still open.

> Backup and restore perform **no network calls** and work fully offline.

---

## 13. Quick reference — keyboard shortcuts (R0–R3)

| Key | Action |
|---|---|
| F1 | Help |
| F2 / Ctrl+K | Focus / open global patient search |
| F3 | Today |
| F4 | New patient |
| F5 | New visit for the open patient (case or follow-up) |
| Ctrl+P | Case summary (on the case form) |
| Ctrl+L | Lock the app now |
| Up / Down | Move through search results / lists |
| Enter | Open the selected patient / confirm the current step / unlock |
| Esc | Close a dialog or the search overlay (never discards data) |

---

## 14. Privacy and safety notes (R1–R3)

- **Offline only.** HomeoClinic makes no network connections of its own and
  opens no listening ports.
- **Encrypted at rest.** Your database, patient photos and case records are
  encrypted; the key is derived from your PIN.
- **Autosave never loses clinical work** — cases and follow-ups save
  continuously and restore after a crash or an accidental close.
- **No data in logs.** Diagnostic logs never contain patient details.
- **Never lost by accident.** Patients are soft-deleted to a 30-day recycle
  bin; permanent deletion asks for your PIN.
- **Your data is always recoverable** with your PIN or your recovery code, and
  always **exportable** (per-patient PDF/JSON, filtered-list CSV, or a full
  encrypted backup).

---

## Appendix — what is NOT in this release

The following arrive in later milestones and are intentionally absent or
disabled in R3: prescriptions and printing (including printing the case
summary), billing and reports, the repertory / Materia Medica and
"Send to repertory", per-complaint progress charts, buying/importing a real
licence, custom case-template editing, voice dictation and the body diagram,
and the appointment book. When those ship, this guide will be extended to
cover them.

*HomeoClinic User Guide — R3 edition (M0 + M1 + M2 + M3). Generated from
`documents/user-guide/HomeoClinic-User-Guide-R3.md`.*
