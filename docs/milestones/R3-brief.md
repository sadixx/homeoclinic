# R3 Paper replacement (milestone M3)

> Release-to-milestone grouping (per `docs/adr/0002-working-software-every-milestone.md`):
> this brief maps **R3 -> M3**. Authoritative release table and demo scripts:
> `docs/milestones/README.md`.

## Doctor outcome

Take a full chronic case using the default case template, with auto-save so
nothing is lost if the app is killed mid-typing. Record follow-up visits with
complaint statuses and improvement percentages, and set the next follow-up
date. See who is due today and who is overdue on the Today screen, which is now
the default home.

## Scope

R3 replaces the paper case paper: a form engine that renders case templates
from JSON schema, collapsible/hideable and conditional (female, child)
sections, pick lists with free text, auto-save every 2 s and on blur, vitals
with BMI, a printable case summary, and the send-to-repertory hook (wired but
inert until R6/R7). It adds the visit model, the follow-up form that pre-loads
complaints with status and improvement sliders, the remedy-response quick-pick,
next-follow-up quick buttons, and the Today screen as default home.

## Task ids (milestone M3)

P0 tasks:
- HC-MVP1-058 Form engine rendering case templates from JSON schema (text, long text, etc.)
- HC-MVP1-059 Collapsible and hideable sections per doctor; female and child sections conditional
- HC-MVP1-060 Pick lists with free text (thermal, thirst, appetite and similar)
- HC-MVP1-061 Auto-save every 2 s and on blur with Saved indicator
- HC-MVP1-062 Vitals with BMI auto-calc
- HC-MVP1-063 Printable case summary
- HC-MVP1-064 Send selected text to repertory hook
- HC-MVP1-068 Visit model and types (first, follow-up, acute, tele)
- HC-MVP1-069 Follow-up form pre-loading complaints with status and improvement sliders
- HC-MVP1-070 Remedy response quick-pick
- HC-MVP1-071 Next follow-up quick buttons
- HC-MVP1-072 Today screen: due today, overdue, today's visits; default home

P1 tasks (5): HC-MVP1-065 template editor, HC-MVP1-066 voice dictation,
HC-MVP1-067 body-diagram annotation, HC-MVP1-073 appointment book day view,
HC-MVP1-074 progress charts.
M3 has 17 tasks (12 P0 + 5 P1).

Release / demo task:
- HC-MVP1-217 R3 paper replacement: case form, follow-up visit, Today list with due

Upgrade-path harness: HC-MVP1-226.

## Screens (docs/ui)

- S08 First (detailed) case form — `docs/ui/S08-case-form.md` (new)
- S09 Follow-up visit — `docs/ui/S09-follow-up-visit.md` (new)
- S03 Today — `docs/ui/S03-today.md` (carried over from R0; now default home with due/overdue lists)
- Patient screens S04-S07, setup/lock/backup/settings — carried over from R1/R2

## Demo script

> Copied verbatim from `docs/milestones/README.md` (R3). E2E regression gate
> (R-DEL-005).

R3
1. Record a detailed chronic case with the default template; kill the app
   mid-typing; reopen; nothing lost.
2. Add a follow-up with complaint statuses and improvement %.
3. Set next follow-up; the patient appears on Today on that date (test clock)
   and under overdue after it.
4. Upgrade install over R2 keeps all patients.

## Requirement ids

Representative ids (fuller detail in `docs/requirements/01-mvp1-requirements.md`
sections for case taking and visits):
- CASE-001.. detailed case form sections, templates, auto-save, printable summary, send-to-repertory hook
- VIS-001.. visit model and types, follow-up with complaint status and improvement, next follow-up
- Today / home requirements (due today, overdue, today's visits) per the case and visit sections

## Out of scope

- No prescriptions or printing of Rx — R4.
- No billing — R5.
- No repertory, Materia Medica or repertorisation; the send-to-repertory hook
  is wired but its target screens do not exist until R6/R7 and stay behind a
  compile-time feature flag.
- No dead-end buttons (R-DEL-002 / R-DEL-006).

## Entry / exit (Done when)

- Entry: R2 merged and its demo green.
- Exit: the R3 demo passes as an E2E run tagged `@tier regression` on Windows
  and Linux, the R0-R2 demos still pass, and an upgrade install over R2 keeps
  all patients (R-DEL-004 / R-DEL-005; harness HC-MVP1-226).
