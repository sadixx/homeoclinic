# R5 Clinic Basics (milestone M8)

> Release-to-milestone grouping (per `docs/adr/0002-working-software-every-milestone.md`):
> this brief maps **R5 -> M8**. R5 is the early-pilot build: after it, 3 to 5
> doctors use an internal build for real consultations for two weeks (it carries
> no repertory content, so the GPL review for OOREP packs does not block it).
> Authoritative release table and demo scripts: `docs/milestones/README.md`.

## Doctor outcome

Bill a visit with consultation and medicine lines, take a partial payment, and
see outstanding dues on the patient dashboard. Produce a correct daily
collection report totalled by payment mode and export it as CSV. This is the
build that goes to the early pilot.

## Scope

R5 adds the clinic's money basics: an invoice per visit with lines, discount,
payments by mode and balance (money stored in paise), a running patient
balance on the dashboard, receipt printing with an FY sequential number and
amount in words, the clinic UPI QR for patient payments, optional GST invoice
fields, and the daily-collection-by-mode plus monthly summary reports with
Excel/CSV export.

## Task ids (milestone M8)

P0 tasks:
- HC-MVP1-148 Invoice with lines, discount, payments by mode, balance; money in paise
- HC-MVP1-149 Running patient balance on dashboard
- HC-MVP1-150 Receipt print with FY sequential number and amount in words
- HC-MVP1-153 Daily collection by mode and monthly summary; Excel and CSV export

P1 task (1): HC-MVP1-151 clinic UPI QR for patient payments.
P2 task (1): HC-MVP1-152 GST invoice fields if GSTIN set.
M8 has 6 tasks (4 P0 + 1 P1 + 1 P2).

Release / demo task:
- HC-MVP1-219 R5 clinic basics: bill, partial payment, dues, daily collection report

Early-pilot tasks (after R5): HC-MVP1-224 ship R5 internal build to 3 to 5
pilot doctors, HC-MVP1-225 two-week early pilot with feedback log.
Upgrade-path harness: HC-MVP1-226.

## Screens (docs/ui)

- S15 Invoice — `docs/ui/S15-invoice.md` (new)
- S16 Reports — `docs/ui/S16-reports.md` (new; collection reports)
- Rx/print S13/S14, case/visit S08/S09, Today S03, patient screens, setup/lock/backup/settings — carried over

## Demo script

> Copied verbatim from `docs/milestones/README.md` (R5). E2E regression gate
> (R-DEL-005).

R5
1. Bill a visit with consultation and medicine lines, take a partial
   payment; dues show on the dashboard.
2. Daily collection report totals by mode are correct; export CSV.
3. Acceptance flows 1, 2, 3, 6 (without repertory), 7, 8, 9 pass.
4. This build goes to the early pilot.

## Requirement ids

Representative ids (fuller detail in `docs/requirements/01-mvp1-requirements.md`
and the acceptance flows in `docs/requirements/05-nfr-and-acceptance.md` section 7):
- BILL-001.. invoice lines, discount, payment modes, balance, receipt with FY sequential number
- Reports: daily collection by mode, monthly summary, CSV/Excel export
- Clinic UPI QR (doctor's own UPI ID) and optional GST fields
- Acceptance flows 1, 2, 3, 6 (without repertory), 7, 8, 9

## Out of scope

- No repertory, Materia Medica or repertorisation — R6/R7 (the internal pilot
  build deliberately carries no repertory content).
- No real licence, trial banner or Buy flow (still dev trial) — R8.
- No hardening, signing or full acceptance-flow suite — R9.
- Not-yet-built features stay behind a compile-time feature flag; no dead-end
  buttons (R-DEL-002 / R-DEL-006).

## Entry / exit (Done when)

- Entry: R4 merged and its demo green.
- Exit: the R5 demo passes as an E2E run tagged `@tier regression` on Windows
  and Linux, the R0-R4 demos still pass, and an upgrade install over R4 opens
  its data (R-DEL-004 / R-DEL-005; harness HC-MVP1-226). The R5 internal build
  then goes to the early pilot (HC-MVP1-224 / HC-MVP1-225).
