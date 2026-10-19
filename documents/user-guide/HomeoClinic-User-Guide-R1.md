# HomeoClinic User Guide

**Covers releases R0 + R1 (milestones M0 + M1): "Set up and protect".**

This guide is cumulative. Each milestone's guide includes everything from the
previous milestones plus the new features. This edition (R1) covers the
walking-skeleton shell (R0) and the first-run setup, app lock, and
backup/restore features (R1). Later editions (R2, R3, ...) will add patient
records, cases, prescriptions, billing and more, on top of this.

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
- a **left navigation** with Today, Backup and Settings (some items are
  disabled until later releases add their screens);
- a **status bar** at the bottom showing the save state, the last backup
  time, and the licence/trial state.

> In R1 the only working screens are the setup wizard, the lock screen, the
> empty **Today** screen and the **Backup** screen. Patient, case, billing and
> repertory features arrive in later releases.

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
> the app — including Backup — cannot be reached until you complete the wizard
> and start the trial here. **Finish setup** is the only way out of the wizard;
> there is no shortcut that skips the trial. (If you close the app mid-setup,
> it reopens on the wizard where you left off.)

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
3. A wrong PIN shows an inline message and lets you try again — the app is
   never locked you out or wiped for a wrong entry.

### Forgot your PIN

1. On the lock screen, click **Forgot PIN?**.
2. Enter the **recovery code** from setup, then set and confirm a **new PIN**.
3. Click **Reset PIN**. You can now unlock with the new PIN.

> Unlocking and recovery happen entirely on your computer — no internet is
> used or required.

---

## 4. Backing up your data (R1)

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
and attachments. After writing, it verifies the file (checksum + decrypt
test).

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

## 5. Restoring from a backup (R1)

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

After restore, your doctor and clinic profile (and, in later releases, all
patient data and attachments) are back.

> Backup and restore perform **no network calls** and work fully offline.

---

## 6. Quick reference — keyboard shortcuts (R0/R1)

| Key | Action |
|---|---|
| F1 | Help |
| F2 / Ctrl+K | Focus patient search |
| F3 | Today |
| Ctrl+L | Lock the app now |
| Enter | Confirm the current step / unlock |
| Esc | Close a dialog (never discards data) |

---

## 7. Privacy and safety notes (R1)

- **Offline only.** HomeoClinic makes no network connections of its own and
  opens no listening ports.
- **Encrypted at rest.** Your database and attachments are encrypted; the key
  is derived from your PIN.
- **No data in logs.** Diagnostic logs never contain patient details.
- **Your data is always recoverable** with your PIN or your recovery code, and
  always **exportable** via backup.

---

## Appendix — what is NOT in this release

The following arrive in later milestones and are intentionally absent or
disabled in R1: patient registration and search, case taking and follow-ups,
prescriptions and printing, billing and reports, the repertory and materia
medica, buying/importing a real licence, the global font-size setting, the
data-folder chooser, and the guided "move to a new computer" flow. When those
ship, this guide will be extended to cover them.

*HomeoClinic User Guide — R1 edition (M0 + M1). Generated from
`documents/user-guide/HomeoClinic-User-Guide-R1.md`.*
