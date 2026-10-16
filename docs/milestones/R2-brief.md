# R2 Patient register (milestone M2)

> Release-to-milestone grouping (per `docs/adr/0002-working-software-every-milestone.md`):
> this brief maps **R2 -> M2**. Authoritative release table and demo scripts:
> `docs/milestones/README.md`.

## Doctor outcome

Register patients with a photo (from webcam or file) and find anyone instantly
by partial name, the last digits of a mobile, patient-ID digits, or even a
phonetic misspelling of an Indian name. Open a patient's dashboard, edit their
record, and move a patient to the 30-day recycle bin and restore them. Search
stays fast (under 100 ms p95) even with 50,000 seeded patients.

## Scope

R2 delivers the patient register and the fast search that makes it usable at
scale: the registration form with auto patient code and duplicate warning,
photo capture, the patient dashboard, family linking, soft delete with recycle
bin, single-patient export, FTS5 prefix/trigram tables with same-transaction
triggers, the Indian-name phonetic key, the ranked UNION query, the global
search box with debounce, virtualised result rows, advanced filters, the index
rebuild tool, and the synthetic data generator plus a performance CI gate.

## Task ids (milestone M2)

P0 tasks:
- HC-MVP1-036 Patient registration form with age or DOB, mobile, address, occupation
- HC-MVP1-037 Auto patient code with configurable prefix, never reused
- HC-MVP1-038 Patient photo from webcam or file
- HC-MVP1-039 Duplicate warning on name plus mobile or name plus DOB
- HC-MVP1-040 Patient dashboard: banner, alerts, visit timeline, last Rx, dues, quick buttons
- HC-MVP1-041 Family linking and quick switch
- HC-MVP1-042 Soft delete, 30-day recycle bin, PIN-protected permanent delete
- HC-MVP1-043 Export single patient as PDF and JSON
- HC-MVP1-047 FTS5 tables (prefix and trigram) with triggers in the same transaction
- HC-MVP1-048 Indian-name phonetic key (Sharma/Sarma, Mohd/Mohammad, Lakshmi/Laxmi)
- HC-MVP1-049 Ranked UNION query (exact ID or mobile, name prefix, phonetic, other fields)
- HC-MVP1-050 Global search box (Ctrl+K, F2), debounce, cancel on keystroke, keyboard flow
- HC-MVP1-051 Result rows with photo, code, age, last visit, dues; virtualised list
- HC-MVP1-052 Advanced filters: dates, follow-up due, age, sex, city, tags, diagnosis
- HC-MVP1-053 Search index rebuild tool with progress
- HC-MVP1-056 Synthetic data generator tools/seed for 50k and 100k realistic Indian data

P1 tasks (5): HC-MVP1-044 tags+filter, HC-MVP1-045 attachments+thumbnails,
HC-MVP1-046 consent record, HC-MVP1-054 full-text case-note search,
HC-MVP1-055 saved filters.
Test task: HC-MVP1-057 performance CI gate (search, dashboard, filter, Today at 50k/100k).
M2 has 22 tasks (16 P0 + 5 P1 + 1 test).

Release / demo task:
- HC-MVP1-216 R2 patient register: register, search, open dashboard, edit, recycle bin

Upgrade-path harness: HC-MVP1-226.

## Screens (docs/ui)

- S04 Global patient search — `docs/ui/S04-global-search.md` (new)
- S05 Patient list and filters — `docs/ui/S05-patient-list.md` (new)
- S06 Patient register / edit form — `docs/ui/S06-patient-form.md` (new)
- S07 Patient dashboard — `docs/ui/S07-patient-dashboard.md` (new)
- shell, S03 Today, S01/S02/S17/S18 — carried over from R0/R1

## Demo script

> Copied verbatim from `docs/milestones/README.md` (R2). E2E regression gate
> (R-DEL-005).

R2
1. Register 3 patients (one with webcam or file photo).
2. Search by partial name, last 4 mobile digits, ID digits, a phonetic
   misspelling; each opens the right dashboard.
3. With 50k seeded patients the same searches stay under 100 ms p95.
4. Edit a patient, move one to the recycle bin and restore it.
5. Upgrade install over R1: profile and backups still open.

## Requirement ids

Representative ids (fuller detail in `docs/requirements/01-mvp1-requirements.md`
section 2/2b and `docs/requirements/05-nfr-and-acceptance.md`):
- PAT-001..PAT-012 register, auto ID, duplicate warning, dashboard, family linking, soft delete, export
- PSR-001..PSR-012 global search box, Indian-name tolerance, ranking, advanced filters, same-transaction index
- NFR-002 search < 100 ms, dashboard < 300 ms, filter < 500 ms at 50k/100k; NFR-007 synthetic data generator

## Out of scope

- No case form, follow-ups, prescriptions, printing or billing — R3/R4/R5.
- No repertory, Materia Medica or repertorisation — R6/R7.
- No real licence or Buy flow (still dev trial) — R8.
- Not-yet-built features stay behind a compile-time feature flag; no dead-end
  buttons (R-DEL-002 / R-DEL-006).

## Entry / exit (Done when)

- Entry: R1 merged and its demo green.
- Exit: the R2 demo passes as an E2E run tagged `@tier regression` on Windows
  and Linux, the R0 and R1 demos still pass, and an upgrade install over R1
  opens its profile and backups (R-DEL-004 / R-DEL-005; harness HC-MVP1-226).
