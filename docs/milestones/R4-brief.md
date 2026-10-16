# R4 Consultation complete (milestone M7)

> Release-to-milestone grouping (per `docs/adr/0002-working-software-every-milestone.md`):
> this brief maps **R4 -> M7**. ADR-0002 reorders the build so a complete
> consultation comes early: M7 runs before M4/M5/M6, and "Prescribe from result"
> (REP-037) stays in M6 and plugs into this Rx screen later. Authoritative
> release table and demo scripts: `docs/milestones/README.md`.

## Doctor outcome

Prescribe one or more remedies plus placebo (with the remedy name hidden on
print when wanted) from a visit, preview and print on A5 or letterhead in
under a second, and save the prescription as a PDF. Share the PDF on WhatsApp
via a wa.me link, and repeat the last prescription on the next visit with one
action.

## Scope

R4 completes a consultation end to end by adding prescribing and printing: Rx
items with remedy autocomplete, potency, form, dose, frequency and duration;
placebo entries and hide-remedy-name on print; favourites and saved Rx
templates; repeat-last-prescription; the hc-docs HTML-to-PDF renderer with
Unicode fonts and Indian number formatting; A4 / A5 / letterhead page setups
with margin calibration; doctor identity on prints read only from a verified
licence; and saving the Rx PDF plus a WhatsApp share link.

## Task ids (milestone M7)

P0 tasks:
- HC-MVP1-135 Rx items with remedy autocomplete, potency, form, dose, frequency, duration
- HC-MVP1-136 Placebo entries and hide-remedy-name on print
- HC-MVP1-137 Favourites and saved Rx templates
- HC-MVP1-138 Repeat last prescription
- HC-MVP1-141 hc-docs: HTML templates to PDF via webview, Unicode fonts, Indian numbers
- HC-MVP1-142 Page setups A4, A5, letterhead with margin calibration
- HC-MVP1-143 Doctor identity on prints read from verified licence only
- HC-MVP1-144 Save Rx PDF and WhatsApp share link

P1 tasks (5): HC-MVP1-139 advice library, HC-MVP1-140 inimical remedy warning,
HC-MVP1-145 certificate/referral/envelope/declaration prints,
HC-MVP1-146 birthday list on Today, HC-MVP1-147 Marathi advice/diet sheet print.
M7 has 13 tasks (8 P0 + 5 P1).

Release / demo task:
- HC-MVP1-218 R4 consultation complete: prescription, print A5, PDF, WhatsApp share

Upgrade-path harness: HC-MVP1-226.

## Screens (docs/ui)

- S13 Prescription — `docs/ui/S13-prescription.md` (new)
- S14 Print preview — `docs/ui/S14-print-preview.md` (new; Rx, receipt, case summary)
- Case/visit screens S08/S09, Today S03, patient screens, setup/lock/backup/settings — carried over

## Demo script

> Copied verbatim from `docs/milestones/README.md` (R4). E2E regression gate
> (R-DEL-005).

R4
1. From a visit, prescribe two remedies plus placebo with hidden name.
2. Print preview A5 under 1 s; print to PDF; layout matches S14.
3. Share on WhatsApp opens the wa.me link and reveals the PDF.
4. Repeat last prescription works on the next visit.

## Requirement ids

Representative ids (fuller detail in `docs/requirements/01-mvp1-requirements.md`
and `docs/requirements/05-nfr-and-acceptance.md`):
- RX-001.. remedy, potency, form, dose, frequency, duration, instructions; placebo; hide name
- Print / page-setup requirements for A4/A5/letterhead and PDF + WhatsApp share
- Doctor identity on prints read from verified licence only (ties to LIC-006)
- NFR-005 Rx print preview < 1 s

## Out of scope

- No billing yet — R5.
- No repertory, Materia Medica or repertorisation — R6/R7. "Prescribe from
  result" (REP-037) lands in M6 (R7) and plugs into this Rx screen.
- No real licence or Buy flow (still dev trial) — R8.
- Not-yet-built features stay behind a compile-time feature flag; no dead-end
  buttons (R-DEL-002 / R-DEL-006).

## Entry / exit (Done when)

- Entry: R3 merged and its demo green.
- Exit: the R4 demo passes as an E2E run tagged `@tier regression` on Windows
  and Linux, the R0-R3 demos still pass, and an upgrade install over R3 opens
  its data (R-DEL-004 / R-DEL-005; harness HC-MVP1-226).
