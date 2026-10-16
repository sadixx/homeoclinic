# 03. Repertory Engine Design

Requirements: REP-*, MM-*, PACK-*, CIT-* in `../requirements/02-repertory-engine.md`.
Diagrams: `diagrams/svg/06-er-content.svg`, `diagrams/svg/08-seq-repertorise.svg`, `diagrams/svg/15-pack-pipeline.svg`.

## 1. Components

| Component | Responsibility |
|---|---|
| PackRegistry | Discovers `content/*.hcpack`, verifies signature + checksum + entitlement, attaches each pack DB read-only, exposes enabled packs |
| RemedyMaster | Merged remedy list across packs (MM-001, PACK-008); maps pack remedy codes to global remedy ids |
| RubricSearch | FTS5 trigram over `full_path` + synonym expansion + abbreviation expansion; ranking |
| RubricStore | Rubric tree navigation, rubric detail, cross-refs; reads pack DB + `user_content.db` overlay |
| ScoringEngine | Builds per-rubric remedy bitsets and grade arrays; runs analysis methods |
| CitationService | CRUD for sources/citations/links; overlay of doctor additions |
| MMReader | Materia Medica sections, full-text search, compare |

## 2. Rubric search pipeline (REP-010..017)

1. Normalise input: lowercase, strip punctuation, British/US spelling map.
2. Expand: each word -> {word, synonyms(word, lang), abbreviation forms}; multi-word synonyms matched first ("loose motions" -> "diarrhoea").
3. Query every enabled pack's `rubric_fts` with `MATCH` on expanded terms (AND across user words, OR within a word's expansions).
4. Rank: score = BM25 + 3 x (all words in leaf text) + 2 x (chapter matches a chapter synonym) + 1 x log(remedy_count) - 0.5 x depth. Top 50.
5. Return rows with full path, remedy count, top 5 remedies (precomputed column `top5_json` in pack).

Budget: < 100 ms per keystroke (NFR-003). Query cancelled when the next keystroke arrives.

## 3. Scoring engine (REP-033..036)

Data per analysis (built when a rubric is added, cached by rubric id):
- `present: BitSet` over global remedy index (about 2,500 remedies = 40 x u64)
- `grade: [u8; N]` sparse map for remedies present (normalised 1..3 via pack `grade_scale`)
- doctor additions from `user_rubric_remedy` merged when "include my additions" is on (CIT-008), marked with a flag bitset

Algorithm (all methods share one loop):
```
candidates = ALL
for r in eliminative rubrics: candidates &= present[r]
for m in candidates:
    for r in active rubrics:
        g = grade[r][m]; if g == 0: continue
        cover[m] += 1
        score[m] += g * w(r) * chapterWeight(method, r.chapter)
        if method.smallBonus and r.remedy_count < T: score[m] += B
        if method == Boenninghausen: add parent rubric grades at g-1
sort by method key (score, cover, abbrev)
```
Complexity: 30 rubrics x 2,500 remedies = 75k operations, well under 1 ms. The 300 ms budget is for the UI.

Snapshot (REP-038): rubric list + settings + top 20 results stored in `analysis.result_snapshot_json` so an old analysis opens identically even after packs change.

## 4. Pack format (PACK-001..013)

```
eval-publicum-1.0.hcpack  (zip, stored, not compressed for mmap)
  manifest.json      { pack_id, type, title, edition, version, format_version, grade_max,
                       language, distribution: public|internal_eval, licence_spdx,
                       source_ref (registry row), licence: free|sku, min_app_version, sha256 }
  content.db         SQLite (schema in 05-data-design.md section 3)
  signature.ed25519  signature over manifest.json + sha256(content.db)
```
Install flow: copy to temp -> verify signature with the content keys embedded in this build profile (public build: public key only, so internal_eval packs fail here) -> verify `sha256` -> check `format_version` and entitlement -> move into `content/` -> build remedy mapping -> register. Any failure leaves existing packs untouched.

Doctor-built packs (PACK-011) are unsigned; they load with an "Unverified" badge and are stored in `user_content.db` until exported.

## 5. Content pipeline (internal tool)

Diagram: `diagrams/svg/15-pack-pipeline.svg`. `tools/content-builder` stages: check registry row (CONT-006) -> import (OOREP dump / CSV / OCR text / publisher XML) -> intermediate JSON -> normalise remedy abbreviations -> proofread queue (web UI, local) -> build `content.db` + FTS + `top5_json` -> sign with the channel's key (public or eval, CONT-002) -> import report (CONT-010) -> publish to that channel.

## 5b. Content channels (CONT-001..010)

Diagram: `diagrams/svg/21-content-channels.svg`.

| | Internal build profile | Public build profile |
|---|---|---|
| Who gets it | Our team, pilot testers under agreement | Doctors (public release) |
| Embedded content keys | public + eval | public only |
| Bundled packs | all internal_eval + public packs | public packs only |
| Eval pack copied in by hand | opens | rejected at signature check |
| Marking | permanent banner, "EVALUATION" on prints | none |
| CI gate | none | fails if any eval pack, eval key or `content-sources/internal-eval/` file is present (CONT-005) |

`import-oorep` mapping (OOREP PostgreSQL dump -> pack schema, 05-data-design.md section 3):

| OOREP table | Pack table | Notes |
|---|---|---|
| `info` (abbrev, title, languag, author, yearr, license, edition) | `pack_meta` | one pack per `abbrev`; licence copied to manifest |
| `chapter` (abbrev, id, textt) | `chapter` | |
| `rubric` (abbrev, id, mother, ismother, chapterid, fullpath, path, textt) | `rubric` | `mother` -> `parent_id`; `fullpath` -> `full_path`; depth from path |
| `rubricremedy` (abbrev, rubricid, remedyid, weight, chapterid) | `rubric_remedy` | `weight` 1-3 -> `grade`; grade_scale 1..3 |
| `remedy` (id, nameabbrev, namelong, namealt) | `remedy` + remedy master mapping | PACK-008 |
| `mminfo`, `mmchapter`, `mmsection` | `mm_book`, `mm_section` | Boericke; section tree via parent/successor ids |
| `member`, `caze`, `cazerubric`, `file`, `activity`, `emailhistory`, `passwordchangerequest` | ignored | OOREP user/account tables, never imported |

## 6. Citations (CIT-001..010)

- `source` rows are reusable; each installed pack auto-creates a source row.
- `citation` holds page ref, quote, confidence, optional patient/visit link.
- `citation_link(target_type, target_id)` attaches one citation to any target (rubric, rubric-remedy, user rubric, MM section, analysis rubric, prescription).
- UI quick-add: rubric panel -> "Add remedy" -> remedy, grade, source (last used pre-selected), page -> Save; single transaction writes `user_rubric_remedy` + `citation` + `citation_link`.

## 7. UI layout (repertory workspace)

Wireframe: `diagrams/svg/16-wireframe-repertory.svg`. Three panes: left = search + tree, centre = rubric detail with grade-styled remedies, right = case clipboard with weights; bottom drawer = result grid/list/graph with method selector. Keyboard: `/` focus search, `Enter` add rubric to clipboard, `Ctrl+R` run, `1-4` set weight.
