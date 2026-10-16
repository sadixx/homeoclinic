# R6 Repertory reading (milestone M4 + M5)

> Release-to-milestone grouping (per `docs/adr/0002-working-software-every-milestone.md`):
> this brief maps **R6 -> M4 + M5** (the release lands at the end of M5). R6 is
> the one release that spans two milestones: M4 builds the content-pack
> pipeline, M5 builds the reading UI on top of it. Authoritative release table
> and demo scripts: `docs/milestones/README.md`.

## Doctor outcome

Search repertory rubrics and browse a repertory chapter by chapter, and read
Materia Medica for a remedy opened straight from a rubric. On an internal
evaluation build this works with the eval content packs; a public build refuses
those packs. Rubric search stays under 100 ms per keystroke.

## Scope

R6 delivers repertory and Materia Medica reading, split across its two
milestones. M4 builds the signed content-pack pipeline: pack format and
verifier/installer, generic repertory schema, remedy-reference mapping, stable
rubric ids, internal vs public build profiles with separate content keys, the
EVALUATION banner and release gate, the OOREP and CSV/Excel importers, FTS +
top-5 building, registry enforcement, and the starter sample pack. M5 builds
the reading UI: rubric search over enabled packs with synonym expansion and
filters, the book view, rubric detail, the remedy popup with open-in-MM, the
Materia Medica reader with full-text search and single-remedy compare, and the
repertory pack manager.

## Task ids (milestones M4 + M5)

### M4 (content pipeline)
P0 tasks:
- HC-MVP1-075 Pack format: zip with manifest.json, content.db, signature
- HC-MVP1-076 Pack verifier and installer (signature with build-profile keys, sha256)
- HC-MVP1-077 Generic repertory schema with per-pack grade scale, display style, paging
- HC-MVP1-078 Remedy master mapping on install; unmapped remedies added and flagged
- HC-MVP1-079 Stable rubric ids across pack versions with id map
- HC-MVP1-080 Internal and public build profiles embedding different content keys
- HC-MVP1-081 Internal build banner and EVALUATION mark on every print
- HC-MVP1-082 Release gate: fail public build if eval pack, eval key or internal-eval present
- HC-MVP1-083 Bundle the packs allowed for each build profile in the installer
- HC-MVP1-084 Registry enforcement: refuse sources without REGISTRY.md row
- HC-MVP1-085 import-oorep: parse oorep.sql.gz into one pack per repertory and MM
- HC-MVP1-086 Generic CSV and Excel importer (chapter, rubric path, remedy, grade)
- HC-MVP1-087 Build FTS, top5_json, sign with channel key
- HC-MVP1-090 Starter sample pack (5 rubrics x 6 remedies) with hand-computed scoring
- HC-MVP1-091 Synonym and modern-language mapping table, 2,000 entries, language-tagged
- HC-MVP1-094 Public repertory for release: OOREP permission (Q16) or OCR and proofread

P1 tasks (4): HC-MVP1-088 import report, HC-MVP1-089 promote pack eval->public,
HC-MVP1-092 archaic-terms glossary, HC-MVP1-093 remedy relationships table.
M4 has 20 tasks (16 P0 + 4 P1).

### M5 (reading UI)
P0 tasks:
- HC-MVP1-095 Rubric search over all enabled packs with synonym and abbreviation expansion
- HC-MVP1-096 Filters: repertory, chapter, minimum remedy count, contains remedy
- HC-MVP1-097 Result rows with full path, count, top 5 remedies, source
- HC-MVP1-100 Book view: chapter list, rubric tree, breadcrumb, keyboard navigation
- HC-MVP1-101 Rubric detail with grade styling, counts, cross-references, parent and child
- HC-MVP1-102 Remedy popup with keynotes and open-in-MM
- HC-MVP1-104 MM reader with remedy list and sections
- HC-MVP1-105 Full-text search across MM books with highlight
- HC-MVP1-106 Compare one remedy across books
- HC-MVP1-108 Repertory manager: list, install from file, enable, disable, default

P1 tasks (5): HC-MVP1-099 recent/favourite rubrics, HC-MVP1-103 compare rubric
across repertories, HC-MVP1-107 bookmarks and notes, HC-MVP1-109 doctor-built
repertory + export, HC-MVP1-110 publisher SDK doc.
Test task: HC-MVP1-098 performance test on publicum + kent-de under 100 ms/keystroke.
M5 has 16 tasks (10 P0 + 5 P1 + 1 test).

Release / demo task:
- HC-MVP1-220 R6 repertory reading: rubric search, browser, materia medica on internal build

Upgrade-path harness: HC-MVP1-226.

## Screens (docs/ui)

- S10 Repertory browser — `docs/ui/S10-repertory-browser.md` (new)
- S12 Materia Medica reader — `docs/ui/S12-materia-medica.md` (new)
- S19 Repertory pack manager — `docs/ui/S19-pack-manager.md` (new)
- All earlier screens (setup, lock, Today, patients, case/visit, Rx/print, billing/reports, backup, settings) — carried over
- Note: S11 repertorisation workspace (M6) is NOT in R6; it arrives in R7.

## Demo script

> Copied verbatim from `docs/milestones/README.md` (R6). E2E regression gate
> (R-DEL-005).

R6
1. Internal build installs eval packs; public build refuses them.
2. Rubric search under 100 ms; browse a chapter; open Materia Medica for a
   remedy from a rubric.

## Requirement ids

Representative ids (fuller detail in `docs/requirements/02-repertory-engine.md`
and `docs/requirements/05-nfr-and-acceptance.md`):
- REP-001.. source attribution, content-pack format, repertory and MM reading
- CONT-001..010 distribution/licence_spdx, two signing keys, internal vs public build profiles, EVALUATION banner/mark, release gate
- PACK-* generic repertory schema, grade scale, stable rubric ids, importers
- NFR-003 rubric search < 100 ms per keystroke on 200,000 rubrics

## Out of scope

- No repertorisation workspace, analysis methods, "prescribe from result" or
  citations — all R7 (M6).
- No licence / Buy flow (still dev trial) — R8; no hardening/signing — R9.
- Public builds must refuse internal-eval packs and must not ship eval content
  (release gate, CONT-003); the EVALUATION banner/mark applies only to internal
  builds.
- Not-yet-built features stay behind a compile-time feature flag; no dead-end
  buttons (R-DEL-002 / R-DEL-006).

## Entry / exit (Done when)

- Entry: R5 merged and its demo green (and the early pilot underway).
- Exit: the R6 demo passes as an E2E run tagged `@tier regression` on Windows
  and Linux, the R0-R5 demos still pass, and an upgrade install over R5 opens
  its data (R-DEL-004 / R-DEL-005; harness HC-MVP1-226).
