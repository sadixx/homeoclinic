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
- **Registration number** (required)
- **Council** (required) — pick your registering council from the list. The
  list holds the state and UT homoeopathy boards and councils published by
  the Ministry of AYUSH, shown as *State: Council name* (for example
  *Maharashtra: Maharashtra Council of Homoeopathy*), plus the **National
  Commission for Homoeopathy (National Register)** and the former **Central
  Council of Homoeopathy (pre-2020)**. If yours is not listed (for example
  Himachal Pradesh, or a state or UT without its own board), choose **Other
  (type manually)** and type the council name; it cannot be left empty.
- **Phone** (optional) — asked only here. The same number is saved as both
  your phone and the clinic phone, so Step 2 does not ask again.
- **Email** (optional)
- **Signature image** and **Clinic logo** (optional)

Click **Next**. Required fields that are empty show an inline message under
the field.

### Step 2 — Clinic profile

- **Clinic name** (required)
- **Address** (required)
- **Default consultation fee** and **Default follow-up fee** (required) —
  amounts are shown in Indian number format
- **GSTIN** (optional)
- **Timings** (optional) — two tabs, **Morning** and **Evening**. For each,
  type the **From** and **To** time the way it reads on a clock: an **hour
  box (1 to 12)** and a **minute box (00 to 59)**. You never choose AM or
  PM; it is set for you:
  - **Morning** times are AM. A 12 o'clock time, or a To hour smaller than
    the From hour, is read as PM — so *9:30 to 1:00* becomes **9:30 AM to
    1:00 PM**.
  - **Evening** times are PM — *5:00 to 8:30* becomes **5:00 PM to 8:30 PM**.
  - An hour outside 1–12, minutes outside 00–59, or a To time that is not
    after the From time shows a message under the box.
  - Leave a session empty if the clinic is closed then.

  Your timings are saved as, for example, *Morning 9:30 AM-1:00 PM; Evening
  5:00 PM-8:30 PM*.

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
  **Occupation**, **Blood group**, **Referred by** — all optional.
- **Marital status** (optional) — **Single**, **Married**, **Divorced** or
  **Widowed**. A value saved by an earlier version still shows.
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

If no photo is added, the app shows a plain **default figure** instead: a male
or female outline once **Sex** is chosen. It appears wherever the photo would
(the form, the dashboard and the patient lists) and is replaced as soon as you
add a real photo.

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

- **Demographics banner** — name, code, **age**/sex, mobile, city, referred by,
  photo (or the default figure) — plus any **allergies / alerts**. The **age
  updates itself** over time from the date of birth, so it is always current.
- **Family** — linked family members with quick-switch.
- **Take case** — starts the patient's first case (section 8). Once a first
  case is saved, **New visit** is greyed out ("First case already recorded —
  use Follow-up") and **Follow-up** is offered instead (section 9), so you
  cannot start a second first case by mistake.
- **Visits (newest first)** — every saved case and follow-up, latest at the
  top, with its date and type. The **last visit date** updates as soon as you
  save.
- **Last prescription** — the medicines (name, potency, dosage) from the most
  recent prescription table you recorded. This is a **preview** taken from
  the case notes; real prescriptions arrive in R4.
- **Lab reports & Scans** — every report and scan uploaded for this patient,
  from any visit, each with a **PDF** or **Image** badge. **Open** shows it;
  **Delete file** removes the file everywhere (after a confirmation), including
  from any investigation it was linked to. See section 8 for how reports are
  uploaded and linked.

A **dues** area and a **Clear dues** button appear as **disabled
placeholders** — automatic fee totals and marking dues paid arrive with the
billing release (R5).

From the dashboard you can **Edit** the patient, **Export** their record
(PDF or JSON), or move them to the **recycle bin**.

---

## 8. Taking a case (R3, new)

From a patient's dashboard, click **Take case** (shortcut **F5**). This opens
the case form (screen S08) — the on-screen replacement for the paper case
sheet. The whole case is **one running record** that works like a word
processor: you type freely, and everything you record drops into the same
record as an editable table, in date order.

### Complaints and entries

A new case opens empty, with the prompt *"Type the complaint name above, then
choose Add new complaint."*

1. Type the complaint (for example *Headache*) in the **Complaint name** box
   and click **Add new complaint**. A new complaint section appears with a
   **numbered heading in bold and underlined**, for example **1. Headache**,
   and under it today's first entry, headed *Headache — 02-11-2026*. Record
   everything for today under this entry.
2. When the patient returns for the same complaint, click **Add follow-up
   entry**. A new entry is added under the same complaint, headed
   *Headache-follow-up — <date>*, and you record the follow-up findings there.
3. For a different complaint, type its name and click **Add new complaint**
   again; it becomes **2. …** and works the same way.

Complaint numbers follow what is on the page: a new complaint always takes
the highest number already shown plus one. If you remove complaint 2 and add
another, the new one is numbered 2 again. If you click **Add new complaint**
without a name, the section is added as *Untitled complaint*; remove it with
its **✕** button if it was a mistake.

**Removing:** every complaint heading and every entry has a **✕** button.
The app asks you to confirm first ("Remove this complaint and everything
recorded under it? This cannot be undone."). The remaining complaints are
renumbered.

**Editing:** all text, and every cell of every table, can be clicked into and
changed at any time (Tab moves between cells). Use the **Bullet list** and
**Numbered list** buttons to format notes like a word processor. Lists work
in your notes, not on a complaint heading.

### Record buttons — sections as tables

The buttons above the record each open a small pop-up. When you confirm, the
section is added to the **entry you are working in** (the one where your
cursor is) as an editable table, under a bullet heading such as **• Vitals**
and a separator line:

- **Record vitals** — blood pressure as **two fields, systolic and
  diastolic**, plus pulse, temperature, SpO2, weight and height; **BMI is
  worked out for you**.
- **Modalities** — factor, aggravation (<) and amelioration (>).
- **Record family history** — **Maternal** and **Paternal** tabs (one
  condition per line), shown as a two-column table *Maternal | Paternal*.
- **Record physical generals** — appetite, thirst, thermal state,
  constitution, diet, cravings, aversions, urine, stool, perspiration, **sun
  aggravation (Yes / No)**, sleep, dreams and sleep position. Anything you
  leave blank shows as *Not recorded*.
- **Record investigations** — the investigation name, its **status** chosen
  from a list (**Suggested** or **Submitted**), and notes. See *Lab and scan
  reports* below.
- **Add prescription** — medicine, potency, dosage and instructions. This is a
  **preview** saved with the case; real prescriptions and printing arrive in
  R4.

**One table of each kind per entry.** The first time you record, say, vitals
in an entry, a vitals table is created. Recording vitals again in the **same
entry** adds new rows to that **same table** rather than starting another
one. The same applies to every kind of table. A **follow-up entry gets its
own fresh tables**, so each visit's readings stay together and the earlier
visit's tables are never changed.

**Family history fills in, not down.** If you record only the mother's side
and later record the father's side in the same entry, the father's side fills
the empty *Paternal* column of the existing rows from the top, so the table
stays lined up. New rows are added only if there are more lines than empty
cells.

**Deleting a row:** each data row has a small **−** button at its right-hand
end. Click it, confirm, and that row is removed. From the keyboard, put the
cursor in the row and press **Ctrl+Shift+Backspace**. The header row cannot be
deleted, and deleting the last remaining row removes the whole table.

### Lab and scan reports

There are two ways to attach a PDF or image report (ultrasound, CT, blood
report and so on):

- **From an investigation:** in **Record investigations**, set the status to
  **Submitted**. The *Submit a report* pop-up offers **Upload a new report**,
  or **pick an already-uploaded report** for this patient and click **Link
  selected report**. A reminder under the upload reads *"Make sure to upload
  the correct file against the name."* The report is named automatically as
  *<investigation>-<patient name>-<date>* so it is easy to match later.
- **Directly:** use **Upload report** in the case's *Lab reports & scans*
  area, with an optional caption.

Either way the report also appears in the patient's **Lab reports & Scans**
list on the dashboard (section 7). In the investigation's row, click **Open**
to view the report in one click.

**Removing a link versus deleting a file.** If a report was linked to the
wrong investigation, use **Remove from this investigation**: only the link is
removed, and the file stays in Lab reports & Scans. To get rid of the file
itself, use **Delete file** (in Lab reports & Scans) or **Remove** next to the
report in the case; that permanently deletes it everywhere. Both ask you to
confirm.

Reports are stored **encrypted** on your computer and never leave it.

### Saving — autosave plus a Save button

- The case **autosaves every 2 seconds and whenever you pause**; the status
  shows "Saving..." then **"Saved hh:mm"**.
- There is also an explicit **Save** button (or press **Ctrl+S**). Pressing it forces an immediate
  save and confirms **"Saved"** — for peace of mind that the case is written.
- If the app closes — or the computer crashes — **mid-typing**, reopening the
  case restores the last saved content (text **and** the inserted tables) with
  **nothing lost**.
- When you open a saved case, a short loading screen shows until the whole
  record is ready, so nothing you click can land on a half-loaded page.

> The **"Send to repertory"** action is not shown yet; it switches on when the
> repertory ships in a later release.

---

## 9. Follow-up visits (R3, new)

Once a patient has a saved first case, the dashboard greys out **New visit**
and offers **Follow-up**. Click **Follow-up** to record a return consultation.

A follow-up **reopens the same record** with everything from earlier visits
already in it — every complaint, every dated entry, and every table you
recorded, **including family history**. Nothing is lost between visits.

1. For each complaint the patient reports on, click inside that complaint and
   click **Add follow-up entry**. A new entry headed
   *<complaint>-follow-up — <today's date>* is added under it.
2. Record today's findings in that entry with the same buttons as in section
   8. The follow-up entry gets **its own fresh tables**, so today's vitals,
   modalities and so on sit together, while earlier visits' tables stay as
   they were. Recording the same kind again in this entry adds rows to its
   table.
3. A new complaint can be added at any visit with **Add new complaint**.

**Scheduling the next follow-up.** The **Next follow-up** buttons sit at the
top of the case screen, on the first case and on every follow-up:

- **7 days**, **15 days**, **1 month** or **2 months** sets the date counted
  from today. (One month from 31 January is the last day of February.)
- **Custom date** picks any date. Past dates are refused with *"Pick today or
  a later date."*
- **Clear** removes the scheduled date.

The header then shows it, for example *Next F/U: 10-11-2026*. On that date the
patient appears under **Due today** on the Today screen, and under **Overdue**
if the date passes without a visit.

Like the first case, a follow-up **autosaves** and has a **Save** button.
After you save, the visit is listed on the patient dashboard under **Visits
(newest first)** above the earlier ones, the **last visit date** updates,
**Last prescription** shows the newest prescription you recorded, and the
Today screen lists the visit under **Registered today**.

> The **progress chart** and formatted **Prescribe / print** actions are not
> active yet; they switch on in later releases. The prescription table you
> record is saved as a preview in the meantime.

---

## 10. The Today screen (R3 — now live)

**Today** is the home screen (press **F3**). From R3 it shows three live
lists, driven by the follow-up dates you set:

- **Due today** — patients whose next follow-up falls on today's date.
- **Overdue** — patients whose follow-up date has passed (most overdue first).
- **Registered today** — the visits recorded today.

Each row shows the patient's photo (or default figure), name, code and
age/sex; click or press **Enter** to open their dashboard. A patient with a
follow-up date appears under **Due today** on that date, then moves to
**Overdue** afterwards. Set the date with the **Next follow-up** buttons on
the case screen (section 9).

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
| F5 | Open the case for the open patient: **Take case** for a new patient, **Follow-up** once a first case is saved |
| Ctrl+S | Save the case now (same as the **Save** button) |
| Ctrl+Shift+Backspace | Delete the table row the cursor is in (asks to confirm) |
| Alt+← | Back (up one level: case/follow-up → dashboard → list → Today) |
| Ctrl+= / Ctrl+- | Zoom text and layout in / out |
| Ctrl+0 | Reset zoom |
| Ctrl+L | Lock the app now |
| Up / Down | Move through search results / lists |
| Enter | Open the selected patient / confirm the current step / unlock |
| Esc | Close a dialog or the search overlay (never discards data) |

> **Back** is always in the **same place** (top of the screen) on every
> screen, and **Alt+←** does the same from the keyboard. Going back never
> discards your work — the case is already autosaved.

> **Zoom** scales the **whole app** — text, buttons and layout — not just the
> case record, so you can make everything larger on a big consulting-room
> screen or smaller to fit more in. Use the zoom buttons at the top or the
> keys above. The layout **adjusts to the window size at any zoom**: when you
> maximise, go full-screen, tile the window to one side or drag it smaller,
> the screen re-flows to fit instead of sitting in a narrow centred column or
> being cut off.

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
shown as **disabled placeholders** in R3: formatted prescriptions and printing
(the prescription table you add to the case is saved as a preview only),
billing — including the **dues** total and **Clear dues** — and reports, the
repertory / Materia Medica and "Send to repertory", per-complaint progress
charts, buying/importing a real licence, custom case-template editing, voice
dictation and the body diagram, and the appointment book. When those ship,
this guide will be extended to cover them.

*HomeoClinic User Guide — R3 edition (M0 + M1 + M2 + M3). Generated from
`documents/user-guide/HomeoClinic-User-Guide-R3.md`.*
