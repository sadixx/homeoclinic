# R7 Repertorisation (milestone M6)

> Release-to-milestone grouping (per `docs/adr/0002-working-software-every-milestone.md`):
> this brief maps **R7 -> M6**. "Prescribe from result" (REP-037 / HC-MVP1-113)
> lives in M6 and plugs into the Rx screen that already shipped in R4.
> Authoritative release table and demo scripts: `docs/milestones/README.md`.

## Doctor outcome

Send symptoms from a case to the repertory, pick rubrics, and run the analysis
methods to get ranked remedy results that match the fixtures, with recompute
under 300 ms. Prescribe straight from the top result (the Rx screen opens
pre-filled) and keep citations for additions.

## Scope

R7 delivers repertorisation and citations on top of the reading UI from R6: the
case clipboard linked to a visit, per-rubric weight/eliminative/causation/
exclude controls, prescribe-from-result into the Rx screen, saved analysis
snapshots, the bitset scoring engine with LRU cache, the six analysis methods,
the result grid and ranked/bar views, the symptom-to-rubric helper under case
form lines, and the full citation layer (source library and CRUD, citation
links, clinical-experience citations, a my-repertory layer with markers, and a
citations screen).

## Task ids (milestone M6)

P0 tasks:
- HC-MVP1-111 Case clipboard linked to visit, up to 10 named clipboards, combine
- HC-MVP1-112 Per-rubric weight, eliminative, causation, exclude; keyboard shortcuts
- HC-MVP1-113 Prescribe from result pre-fills Rx
- HC-MVP1-114 Save analysis snapshot with visit and reopen identically
- HC-MVP1-115 Bitset scoring engine with LRU cache
- HC-MVP1-116 Six analysis methods (sum, totality, Kent, Boenninghausen, elimination, ...)
- HC-MVP1-117 Result grid (rubrics x remedies, grades, scores, coverage)
- HC-MVP1-118 Ranked list and bar graph views
- HC-MVP1-124 Symptom-to-rubric helper under case form lines (FTS plus synonyms)
- HC-MVP1-126 Source library and citation CRUD with all fields
- HC-MVP1-127 Citation links to rubric, rubric-remedy, user rubric, MM section, analysis
- HC-MVP1-128 Clinical-experience citation linked to patient and visits
- HC-MVP1-129 My repertory layer: add remedy or rubric with citation, visually marked
- HC-MVP1-130 Citation markers with hover details

P1 tasks (6): HC-MVP1-119 remedy differentiation, HC-MVP1-120 kingdom/family
filter, HC-MVP1-121 relationship hints, HC-MVP1-122 print repertorisation chart,
HC-MVP1-125 guided acute mode, HC-MVP1-131 include/exclude additions +
confidence filter, HC-MVP1-132 citations list + export.
P2 tasks (2): HC-MVP1-123 cross-repertorisation, HC-MVP1-133 suggest-to-publisher export.
Test task: HC-MVP1-134 citations survive backup and restore.
M6 has 24 tasks (14 P0 + 7 P1 + 2 P2 + 1 test).

Release / demo task:
- HC-MVP1-221 R7 repertorisation: send symptoms, analyse, prescribe from result

Upgrade-path harness: HC-MVP1-226.

## Screens (docs/ui)

- S11 Repertorisation workspace — `docs/ui/S11-repertorisation.md` (new)
- S22 Citations — `docs/ui/S22-citations.md` (new)
- S10 repertory browser, S12 Materia Medica, S19 pack manager — carried over from R6
- S13 Prescription — carried over from R4 (now receives "prescribe from result")
- All earlier screens — carried over

## Demo script

> Copied verbatim from `docs/milestones/README.md` (R7). E2E regression gate
> (R-DEL-005).

R7
1. Send 8 symptoms from a case to the repertory, pick rubrics, run each
   method; results match fixtures; recompute under 300 ms.
2. Prescribe from the top result; the Rx screen opens pre-filled.
3. Acceptance flows 4, 5, 11 pass.

## Requirement ids

Representative ids (fuller detail in `docs/requirements/02-repertory-engine.md`
and the acceptance flows in `docs/requirements/05-nfr-and-acceptance.md` section 7):
- REP-* analysis methods, scoring, result views, prescribe-from-result (REP-037), citations and my-repertory layer
- NFR-004 repertorisation recompute < 300 ms (30 rubrics)
- Acceptance flows 4, 5, 11

## Out of scope

- No licence, trial banner or Buy flow (still dev trial) — R8.
- No hardening, signing, watermark or full 13-flow acceptance suite — R9.
- Cross-repertorisation (P2) and suggest-to-publisher export (P2) are optional
  within M6 and may stay behind a compile-time feature flag.
- No dead-end buttons (R-DEL-002 / R-DEL-006).

## Entry / exit (Done when)

- Entry: R6 merged and its demo green.
- Exit: the R7 demo passes as an E2E run tagged `@tier regression` on Windows
  and Linux, the R0-R6 demos still pass, and an upgrade install over R6 opens
  its data (R-DEL-004 / R-DEL-005; harness HC-MVP1-226).
