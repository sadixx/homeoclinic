# Release plan: working software at every milestone

Decision record: `docs/adr/0002-working-software-every-milestone.md`.

Every milestone ends with release `R<n>`: a CI-built installer for Windows
and Linux in which everything built so far works end to end through the
UI. A release is done only when its demo script passes as an E2E run on
both OS, every earlier demo still passes, and (from R1) the previous
release's data opens after an upgrade install.

## Order

```
M0 -> M1 -> M2 -> M3 -> M7 -> M8 -> | early pilot | -> M4 -> M5 -> M6 -> M9 -> M10 -> pilot -> launch
R0    R1    R2    R3    R4    R5                    (R6 at M5)   R7    R8    R9
```

## Releases

| Release | Milestone | What a doctor can do | Screens (docs/ui) | Backlog |
|---|---|---|---|---|
| R0 Walking skeleton | M0 | Install, open the app, see the shell, nav and an empty Today | shell, S03 empty, S02 stub | HC-MVP1-214 |
| R1 Set up and protect | M1 | Run first-run wizard (dev trial), lock and unlock with PIN, back up to USB and restore | S01 (licence step = dev trial), S02, S17 | HC-MVP1-215 |
| R2 Patient register | M2 | Register patients with photo, find anyone instantly, open dashboard, edit, recycle bin | S04, S05, S06, S07 | HC-MVP1-216 |
| R3 Paper replacement | M3 | Take a full case, record follow-ups, see who is due today | S08, S09, S03 | HC-MVP1-217 |
| R4 Consultation complete | M7 | Prescribe, print A5 or letterhead, save PDF, share on WhatsApp | S13, S14 | HC-MVP1-218 |
| R5 Clinic Basics | M8 | Bill, take partial payment, see dues, daily collection report | S15, S16 | HC-MVP1-219 |
| Early pilot | after R5 | 3 to 5 doctors use R5 for real consultations for 2 weeks | | HC-MVP1-224, 225 |
| R6 Repertory reading | M4 + M5 | Search rubrics, browse repertory, read Materia Medica (internal build) | S10, S12, S19 | HC-MVP1-220 |
| R7 Repertorisation | M6 | Send symptoms from case, analyse, prescribe from result, cite | S11, S22 | HC-MVP1-221 |
| R8 Licence and purchase | M9 | Trial, Buy with UPI QR, import licence, expiry goes read-only | S20, S01 licence step | HC-MVP1-222 |
| R9 Release candidate | M10 | Everything above on the hardened, signed build | S18, S21, all | HC-MVP1-223 |

Upgrade-path harness: HC-MVP1-226.

## Demo scripts (run as E2E, network disabled)

R0
1. Install from the CI artifact (per-user on Windows, AppImage on Linux).
2. App opens in under 4 s; nav shows Today, Patients, Settings.
3. Today shows its empty state; F2 focuses the search box (no results yet).

R1
1. Fresh install: wizard collects doctor profile, clinic profile, PIN and
   shows the recovery code; licence step shows "Development trial".
2. Close and reopen: unlock with PIN; wrong PIN is refused.
3. Backup now to a folder with a password; restore it on a clean install;
   doctor and clinic profile come back.
4. R0 demo still passes.

R2
1. Register 3 patients (one with webcam or file photo).
2. Search by partial name, last 4 mobile digits, ID digits, a phonetic
   misspelling; each opens the right dashboard.
3. With 50k seeded patients the same searches stay under 100 ms p95.
4. Edit a patient, move one to the recycle bin and restore it.
5. Upgrade install over R1: profile and backups still open.

R3
1. Record a detailed chronic case with the default template; kill the app
   mid-typing; reopen; nothing lost.
2. Add a follow-up with complaint statuses and improvement %.
3. Set next follow-up; the patient appears on Today on that date (test clock)
   and under overdue after it.
4. Upgrade install over R2 keeps all patients.

R4
1. From a visit, prescribe two remedies plus placebo with hidden name.
2. Print preview A5 under 1 s; print to PDF; layout matches S14.
3. Share on WhatsApp opens the wa.me link and reveals the PDF.
4. Repeat last prescription works on the next visit.

R5
1. Bill a visit with consultation and medicine lines, take a partial
   payment; dues show on the dashboard.
2. Daily collection report totals by mode are correct; export CSV.
3. Acceptance flows 1, 2, 3, 6 (without repertory), 7, 8, 9 pass.
4. This build goes to the early pilot.

R6
1. Internal build installs eval packs; public build refuses them.
2. Rubric search under 100 ms; browse a chapter; open Materia Medica for a
   remedy from a rubric.

R7
1. Send 8 symptoms from a case to the repertory, pick rubrics, run each
   method; results match fixtures; recompute under 300 ms.
2. Prescribe from the top result; the Rx screen opens pre-filled.
3. Acceptance flows 4, 5, 11 pass.

R8
1. Trial banner, Buy screen offline UPI QR and WhatsApp QR render.
2. Import a test `.hclic`; identity locks on prints.
3. Expire it with the test clock; read-only mode keeps viewing, search,
   print and export working.
4. Acceptance flow 10 passes.

R9
1. All 13 acceptance flows in requirements/05 section 7 pass on the
   protected, signed build on Windows and Linux.
