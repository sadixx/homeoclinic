# Open questions from MVP1 screen specs

Gaps the spec authors did not invent answers for. Record each decision in the screen file (replace the question) or in `docs/design/06-review-questions.md`. Agents treat a question as blocking only when the task touches that behaviour.


## S01 First-run setup wizard

- SET-001 lists the four steps as language, doctor, clinic, licence, but the R1
- SET-006 data-folder chooser and SET-005 font size are folded into the Security
- PIN length / complexity policy and lock-out after repeated wrong confirmations

## S02 Lock / unlock

- SET-004 does not define PIN length, allowed characters, or a lock-out / backoff
- Windows Hello / fingerprint unlock is a P1 idea (SUX-003) but has no MVP1

## S03 Today

- Ordering within "Due today" and "Overdue" (by appointment time, by most
- Whether "Registered today" counts walk-ins without a visit record yet

## S04 Global patient search

- PSR-005 masks mobile except last 4 only for the receptionist role, which is

## S05 Patient list and filters

- The R2 demo expects the "given Sulphur" filter at R2, but prescriptions do not
- PSR-008 lists "diagnosis text" as a filter but the data model stores diagnosis

## S06 Patient register / edit form

- Conventions section 4 says clinical forms autosave and only admin forms have
- PAT-002 configurable prefix + running number: the prefix is set in Settings
- Family relation vocabulary (Wife/Husband/Son/Daughter/Father/Mother/Other) is

## S07 Patient dashboard

- The recycle bin and restore UI (PAT-008) lives in Settings (S18, not in this
- PAT-005 lists an "outstanding dues" figure; whether advances (negative dues)
- Which single document Ctrl+P prints from the dashboard when no visit is open is

## S08 First

- CASE-OQ-1: Default autosave debounce is 2 s (CASE-005); is a shorter debounce
- CASE-OQ-2: Which fields belong to each of the three shipped templates
- CASE-OQ-3: Q3 (docs/design/06-review-questions.md) proposes Marathi advice

## S09 Follow-up visit

- VIS-OQ-1: When a complaint is marked Resolved, should it still appear in the
- VIS-OQ-2: VIS-007 charts "vitals (weight, BP)"; which exact vitals are
- VIS-OQ-3: Should improvement % be required before a visit can set the next

## S10 Repertory browser

- OQ-S10-1: Default sort of search results when timing is tied: by score then
- OQ-S10-2: How many favourite rubrics to show and how a rubric is marked as a
- OQ-S10-3: Keyboard shortcut for "Open in Materia Medica" from a focused remedy

## S11 Repertorisation workspace

- OQ-S11-1: Default chapter weights for the Kent method are MIND 3,
- OQ-S11-2: Whether the graph view is a third distinct view or a strip beside the
- OQ-S11-3: REP-042 (print the chart) is P1 and out of this release; confirm the
- OQ-S11-4: Causation/never-well-since (REP-032) is captured as a flag, but no

## S12 Materia Medica reader

- OQ-S12-1: Acceptance flow 5 (requirements 05 section 7) requires comparing a
- OQ-S12-2: Whether MM full-text search shares the NFR-003 100 ms budget or has
- OQ-S12-3: The maximum number of columns in the compare view (how many books

## S13 Prescription

- RX-OQ-1: Default potency/form/frequency when a row is added - leave blank or
- RX-OQ-2: RX-008 warns on inimical to "the previous remedy"; is that the
- RX-OQ-3: Q3 (docs/design/06-review-questions.md) proposes Marathi advice/diet
- RX-OQ-4: Should the hide-name flag be per remedy row (as drawn) or a single

## S14 Print preview

- PRN-OQ-1: Default letterhead top/side margins (drawn as 45 mm / 12 mm) are
- PRN-OQ-2: Q1 (docs/design/06-review-questions.md) proposes legacy prints
- PRN-OQ-3: Q3 (docs/design/06-review-questions.md) proposes Marathi advice/diet
- PRN-OQ-4: Exact wording and placement of the "TRIAL" mark and the

## S15 Invoice

- INV-OQ-1: Can the receipt number be configured (prefix, reset point) or is
- INV-OQ-2: Should a discount be allowed to exceed the subtotal (credit), or
- INV-OQ-3: Does marking a UPI-QR payment as paid require the UTR/reference, or
- INV-OQ-4: GST breakdown detail for BILL-006 (CGST/SGST split, HSN/SAC codes)

## S16 Reports

- REP16-OQ-1: Does "daily collection" group by payment date (when money was
- REP16-OQ-2: Should the monthly summary also break each day down by mode, or
- REP16-OQ-3: Is a date-range (custom from/to) collection report wanted in

## S17 Backup and restore

- OQ-S17-1: BAK-001 fixes the retention counts (14/8/12) but not the exact daily
- OQ-S17-2: BAK-002 specifies Argon2id and AES-256-GCM but not minimum backup
- OQ-S17-3: SUX-011 says remembered credentials default on the same PC but does
- OQ-S17-4: BAK-005 ("Move to new computer") is P1; confirm whether it ships at
- OQ-S17-5: No requirement defines behaviour when the chosen USB drive is removed

## S18 Settings

- OQ-S18-1: RESOLVED (2026-10-16): a minimal Settings ships at R1 (doctor and
  clinic profile, PIN change, font size, data folder); the full S18 (audit log,
  recycle bin, templates, advice library) completes at R9. milestones/README.md,
  ui/README.md and S18 header (Milestone M1 / Release R1) now agree.
- OQ-S18-2: ADM-002 does not define an audit-log retention period or whether the
- OQ-S18-3: SET-006 does not state what happens to existing data when the folder
- OQ-S18-4: PAT-008 fixes a 30-day recycle window but not whether expired items
- OQ-S18-5: No requirement states whether administrative profile edits should be
- OQ-S18-6: CASE-004 does not say whether a template can be deleted while cases

## S19 Repertory pack manager

- OQ-S19-1: The online catalogue install path (PACK-010) is MVP2; confirm R6
- OQ-S19-2: PACK-009 lists size as a column but no requirement defines whether
- OQ-S19-3: Whether a disabled pack still counts as "used by analyses" for the
- OQ-S19-4: The exact plain-language wording for the public-build rejection of an

## S20 Licence and Buy

- OQ-S20-1 (Q14): plan prices Rs 2,299 / 6 months and Rs 3,999 / year are
- OQ-S20-2 (Q15): support hours Mon-Sat 10:00-19:00 IST and the 1-hour turnaround
- OQ-S20-3 (Q11): the Licence Certificate PDF is not password protected (the
- OQ-S20-4 (Q12): identity (name + reg no) is locked per licence and a second
- OQ-S20-5 (Q13): no PC limit, unlimited reinstalls for the same doctor
- OQ-S20-6: LIC-046 and design 04 section 4 both describe the typed key but
- OQ-S20-7: no requirement defines webcam-permission handling if the OS denies

## S21 Help

- OQ-S21-1: ADM-004 pairs "short how-to videos linked (online)" with "bundled
- OQ-S21-2: No requirement lists which help topics must ship or who authors the
- OQ-S21-3: SUX-012 names a Health check opened by F12 "from Help" but does not
- OQ-S21-4: ADM-003 is P1; confirm the shortcuts reference ships at R9 rather

## S22 Citations

- OQ-S22-1: CIT-007 is P1. Confirm whether it ships in R7 or slips to the M10 P1
- OQ-S22-2: REP-024 requires every personal addition to carry a citation.
- OQ-S22-3: The CSV column set and the PDF layout for CIT-007 export are not
- OQ-S22-4: Whether analysis-rubric and prescription citation targets (CIT-001e,
