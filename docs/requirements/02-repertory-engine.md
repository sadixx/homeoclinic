# Repertory and Materia Medica Engine

This is the product's main differentiator. Goal: a doctor finds the right rubrics in seconds, repertorises with one click, and understands the result visually.

## 1. Concepts (plain words, for the coding agent)

- Remedy: a homoeopathic medicine, e.g. Sulphur (abbrev. "Sulph."), Pulsatilla ("Puls.").
- Rubric: one symptom line in a repertory, e.g. "MIND - FEAR - dark, of". Rubrics form a tree: Chapter (MIND) > rubric (FEAR) > sub-rubric (dark, of) > deeper sub-rubrics.
- Grade (intensity): how strongly a remedy is associated with a rubric. Kent uses 3 grades (bold caps = 3, italic = 2, plain = 1). Some repertories use 4 or 5. Store as integer, normalise per repertory.
- Repertorisation: doctor picks several rubrics from the case; the engine combines remedy lists and ranks remedies.
- Cross-reference: "see also" link from one rubric to another.
- Materia Medica (MM): books describing each remedy's symptoms (e.g. Boericke, Allen's Keynotes, Clarke).
- Remedy relationships: complementary, antidote, inimical, follows well.

## 2. Content sources and copyright (must be resolved before launch)

| Source | Status in India | Plan |
|---|---|---|
| Kent, Repertory of the Homoeopathic Materia Medica (Kent died 1916) | Public domain (India: life + 60 years) | Ship in MVP1. Use a scanned original edition, OCR + human proofreading, or a verified open dataset. |
| Boenninghausen, Therapeutic Pocket Book (Allen ed. 1891) | Public domain | MVP1 (P1) |
| Boger-Boenninghausen Characteristics and Repertory | Public domain (Boger died 1935) | MVP2 |
| Boericke, Pocket Manual of MM with Repertory (Boericke died 1929) | Public domain | MVP1 MM + repertory |
| Allen's Keynotes, Clarke's Dictionary, Kent's Lectures on MM, Nash Leaders | Public domain | MVP1 Allen + Kent Lectures; Clarke MVP2 |
| Phatak, Synthesis, Complete Repertory, Murphy, Synoptic Key | Copyrighted | Only with written licence from publisher (MVP2+ paid add-on). Never scrape. |

Requirement REP-001 (P0): Every content item carries `source_id`, edition, and licence note. A content-pack format (section 6) lets us add licensed repertories later without app changes.

Note: confirm public-domain status per edition with an IP lawyer; later editions edited by others may carry new copyright on the edits.

### 2b. Internal evaluation content (MVP1 testing only, never publicly distributed)

To prove the engine on real-sized data before our own public-domain packs are ready, MVP1 integrates every repertory and materia medica we can obtain, in a separate **internal-eval** channel that is removed from public releases automatically (CONT-001..010).

| Pack id | Content | Source | Licence | Size | Channel |
|---|---|---|---|---|---|
| `eval-publicum` | Repertorium Publicum (English, Kent-derived), V. Polony 2008 | OOREP `oorep.sql.gz` (commit ac6dbb00ba60) | GPL v3 (OpenRep) | 74,667 rubrics, 735,566 remedy entries, grades 1-3 | internal-eval |
| `eval-kent-de` | German translation of Kent's Repertory, 2012 | same | GPL v3 (OpenRep fork) | 68,741 rubrics, 624,010 remedy entries, grades 1-3 | internal-eval |
| `eval-boericke-mm` | Boericke, Pocket Manual of Homoeopathic Materia Medica (1906) | same | not stated in dump (book is public domain) | 688 remedies, 6,393 sections | internal-eval |
| `eval-remedy-master` | Remedy list (abbreviation, long name, alternative names) | same | GPL v3 (as part of dump) | 2,432 remedies | internal-eval |

Not usable even internally: OOREP's other repertories (English Kent, Boger, Boenninghausen, Hering, Clarke, Allen and others) are served on oorep.com but "not intended for any further redistribution" (OOREP FAQ); use them only after written permission from the OOREP author.

Public channel (target for public release): our own digitisation of public-domain books, or the same OOREP conversions with written permission, after legal review. Until those exist, a public build ships with only the starter sample pack and the synonym/glossary packs we write ourselves.

### 2c. Content channels and plug-and-play rules (CONT)

| ID | Pri | Requirement |
|---|---|---|
| CONT-001 | P0 | Every pack manifest declares `distribution` (`public` or `internal_eval`) and `licence_spdx` (e.g. `GPL-3.0-only`, `public-domain`, `proprietary`). |
| CONT-002 | P0 | Two signing keys: public packs are signed with the public content key, internal-eval packs with a separate eval content key. |
| CONT-003 | P0 | Two build profiles from the same code: `internal` (team testing; embeds both content public keys, bundles internal-eval packs) and `public` (release; embeds only the public content key). A public build cannot verify, install or open an internal-eval pack, even if someone copies the file in. Removal is automatic, no code change. |
| CONT-004 | P0 | Internal builds show a permanent "Internal evaluation build: contains content not licensed for distribution" banner and print "EVALUATION" on every prescription and report. |
| CONT-005 | P0 | Release gate (extends TAM-012): public release CI fails if any internal_eval pack, the eval content public key, or any `content-sources/internal-eval/` file is present in the installer or binary. |
| CONT-006 | P0 | Content registry `content-sources/REGISTRY.md`: one row per source (pack id, title, edition, origin URL + commit/checksum, licence, channel, permission status, date imported, owner). A source without a registry row cannot be built into a pack (content-builder refuses). |
| CONT-007 | P0 | Add a repertory = put the source file in `content-sources/`, add a registry row, run `content-builder build <pack-id>`; it then appears in the repertory manager (PACK-009). Remove = delete the registry row and pack, or uninstall in the app; saved analyses keep their snapshot (REP-038) and show "repertory not installed" for live re-runs. No app code changes either way (PACK-006). |
| CONT-008 | P0 | Moving a pack from internal_eval to public (e.g. after permission is granted) is only a registry change plus re-signing with the public key; rubric ids stay stable (PACK-005) so saved analyses keep working. |
| CONT-009 | P0 | Importers in `tools/content-builder`: (a) `import-oorep` reading `oorep.sql.gz` (chapter, rubric, rubricremedy, remedy, mminfo, mmchapter, mmsection, info tables; user/account tables are ignored), one pack per repertory abbrev and per MM; (b) generic CSV/Excel importer (chapter, rubric path, remedy abbrev, grade, citation) shared with PACK-011; (c) OCR/text parser for scanned books (later). |
| CONT-010 | P1 | Import report per pack: counts (chapters, rubrics, remedy entries, remedies), unmapped remedy abbreviations, rubrics without remedies, grade distribution; compared against the previous build to catch regressions. |

## 3. Rubric search (REP-010 to REP-019)

| ID | Pri | Requirement |
|---|---|---|
| REP-010 | P0 | Single search box. Type plain words in any order ("fear dark", "headache sun worse") and get matching rubrics ranked as you type (< 100 ms after keystroke on 200k rubrics). |
| REP-011 | P0 | Matches full rubric path, not just the leaf, so "fear dark" finds "MIND - FEAR - dark, of". |
| REP-012 | P0 | Synonym and modern-language mapping table: e.g. "worse" = "agg", "better" = "amel", "headache" = "HEAD - PAIN", "anxiety" -> "MIND - ANXIETY", "tiredness" -> "GENERALITIES - WEAKNESS", "loose motions" -> "RECTUM - DIARRHOEA", British/US spellings (diarrhoea/diarrhea). Ship 2,000+ curated mappings; doctor can add own. |
| REP-013 | P0 | Typo tolerance (trigram) and abbreviation expansion (e.g. "agg." "amel." "aft." "eve."). |
| REP-014 | P0 | Filters: repertory (one or all), chapter, minimum remedy count, contains remedy X. |
| REP-015 | P0 | Each result shows: full path, remedy count, top 5 remedies by grade, and source repertory. |
| REP-016 | P1 | Hindi/Hinglish keyword mapping in MVP2 ("sir dard" -> HEAD - PAIN). Design synonym table to be language-tagged now. |
| REP-017 | P1 | Recent and favourite rubrics list. |

## 4. Repertory browser (REP-020 to REP-029)

| ID | Pri | Requirement |
|---|---|---|
| REP-020 | P0 | Book view: chapter list > expandable rubric tree, like reading the printed book, with breadcrumb. Keyboard arrows navigate. |
| REP-021 | P0 | Rubric detail panel: remedies sorted by grade then alphabetically, displayed with grade styling (grade 3 bold red caps, 2 italic blue, 1 plain black; configurable), remedy count, cross-references as clickable links, parent and child rubrics. |
| REP-022 | P0 | Hover/click a remedy -> popup with remedy full name, keynotes (from MM), and "Open in Materia Medica". |
| REP-023 | P1 | Side-by-side compare of the same rubric across two repertories. |
| REP-024 | P0 | Doctor's personal additions: add remedy to rubric with own grade, or add personal rubric. Stored separately in "My repertory" layer, visually marked, never modifies source data, toggle on/off in analysis. Every addition must carry a citation (see section 10, CIT-001). |

## 5. Repertorisation workspace (REP-030 to REP-049)

| ID | Pri | Requirement |
|---|---|---|
| REP-030 | P0 | Case clipboard: doctor adds rubrics (from search, browser, or from case text via CASE-006). Clipboard is attached to the patient's visit and saved automatically. |
| REP-031 | P0 | Up to 10 named clipboards per analysis (e.g. "Mentals", "Physicals", "Acute") with option to combine. |
| REP-032 | P0 | Per rubric settings: weight/intensity (1 to 4, default 1), mark as Eliminative (remedy must be present), mark as Causation/Never-well-since, exclude temporarily. |
| REP-033 | P0 | Analysis methods (selectable, default "Totality + grade"): (a) Sum of grades, (b) Number of rubrics covered (totality) then sum of grades as tie-break, (c) Kent method: mentals weighted higher via chapter weights, (d) Boenninghausen method: uses parent rubrics generalisation and grade, (e) Elimination: only remedies present in all eliminative rubrics, (f) Weighted: sum(grade x rubric weight) with optional small-rubric bonus (rubrics with < 10 remedies score extra, configurable). Formulas must be documented in code and unit-tested with hand-computed fixtures. |
| REP-034 | P0 | Result grid (the classic repertory chart): rows = rubrics, columns = top N remedies (default 20, configurable up to 50), cells show grade with colour; header shows score and rubric coverage "7/9". Click column sorts; click remedy opens MM. |
| REP-035 | P0 | Result also as ranked list with bar graph (score) and coverage, for low-literacy-in-tables users. Toggle grid/list/graph. |
| REP-036 | P0 | Recalculate instantly (< 300 ms for 30 rubrics x 2,500 remedies) when any rubric or setting changes. |
| REP-037 | P0 | "Prescribe this remedy" from result pre-fills RX-001. |
| REP-038 | P0 | Save analysis snapshot with the visit (rubrics, method, results top 20). Re-openable and comparable across visits. |
| REP-039 | P1 | Remedy differentiation view: select 2 to 5 remedies, show their keynotes and rubric presence side by side. |
| REP-040 | P1 | Kingdom/family filter (Plant, Mineral, Animal, Nosode, Sarcode) and "show only remedies in my dispensary" filter (MVP2 stock). |
| REP-041 | P1 | Remedy relationship hints on top results (complementary, inimical with previous Rx). |
| REP-042 | P1 | Print/PDF the repertorisation chart for the patient file. |
| REP-043 | P2 | Cross-repertorisation: use rubrics from multiple repertories in one analysis with grade normalisation. |

## 6. Materia Medica reader (MM)

| ID | Pri | Requirement |
|---|---|---|
| MM-001 | P0 | Remedy master: ~2,500 remedies with standard abbreviation, full Latin name, common name, kingdom, synonyms. All repertories map to this master (single remedy ID). |
| MM-002 | P0 | Book reader for each MM: remedy list, sections (Mind, Head, ... Modalities, Relationship, Dose), full-text search across all books with highlight. |
| MM-003 | P0 | "Compare remedies" across books: pick remedy, see the same section from every installed book side by side. |
| MM-004 | P1 | Bookmarks and personal notes on any paragraph. |
| MM-005 | P1 | Remedy relationships table (complementary, antidote, inimical, follows well) from Boericke/Clarke, used by RX-008 and REP-041. |

## 7. Content pack format (PACK)

| ID | Pri | Requirement |
|---|---|---|
| PACK-001 | P0 | Content is delivered as signed packs (`.hcpack` = zip of SQLite DB + manifest.json + Ed25519 signature). App verifies signature with embedded public key before install. |
| PACK-002 | P0 | Manifest: pack_id, type (repertory / materia_medica / synonyms / relationships), distribution and licence (CONT-001), title, edition, version, licence (free / paid sku), min_app_version, checksum. |
| PACK-003 | P0 | Base install bundles the packs allowed for that build profile (CONT-003): internal builds bundle all internal-eval packs (section 2b); public builds bundle only public packs (starter sample, synonyms, glossary, and public-domain repertories/MM once built). |
| PACK-004 | MVP2 | Paid packs unlocked by licence entitlement (LIC-030); installable offline from file. |
| PACK-005 | P0 | Pack updates replace content without touching patient data or "My repertory" layer; rubric IDs stable across versions (mapping table when rubrics split/merge so old analyses still open). |
| PACK-006 | P0 | Pluggable repertories: adding a new repertory must need only a new pack file, never an app code change or app update. The engine, search, browser, analysis and MM reader read everything (chapters, grade scale, display styles, abbreviations) from the pack. |
| PACK-007 | P0 | Generic repertory schema covers differing book structures: any number of chapters and rubric depth, per-pack grade scale (1-3, 1-4, 1-5, or named grades) with a normalisation map, per-pack grade display style, optional page/column reference for each rubric (so the doctor can cross-check the printed book), optional remedy author/source codes per entry (as in modern repertories that cite the author of each addition). |
| PACK-008 | P0 | Remedy mapping on install: pack remedies map to the shared remedy master (MM-001) by abbreviation/name; unmapped remedies are added as new master entries flagged "from pack X" so analysis across repertories still works. |
| PACK-009 | P0 | Repertory manager screen: list installed repertories (title, edition, version, size, free/paid, source), install from file or online catalogue, enable/disable per repertory, set default repertory, uninstall (blocked if saved analyses use it, unless doctor confirms; old analyses keep their snapshot). |
| PACK-010 | MVP2 | Online catalogue (when internet available): shows new free and paid repertories/MM books; one-click download and install; paid ones unlock through licence entitlement (LIC-030). Same packs also distributed as files for offline clinics. |
| PACK-011 | P1 | Doctor-built repertory: doctor (or a teacher/institute) can create a full personal repertory inside the app (chapters, rubrics, remedies, grades, citations) or import one from Excel/CSV (template columns: chapter, rubric path, remedy abbrev, grade, citation). It behaves like any installed repertory and can be exported as an unsigned `.hcpack` to share with colleagues (marked "Unverified" on their side). |
| PACK-012 | P1 | Publisher SDK: documented pack format spec, JSON schema, and the `content-builder` CLI so publishers can build packs; we sign them after review. |
| PACK-013 | P0 | Backward and forward compatibility: packs declare `format_version`; app refuses packs with a newer major format with a clear "update the app" message and keeps working with the rest. |

## 8. Content pipeline (internal tool, not shipped)

1. Source: existing digital dataset (e.g. OOREP dump, CONT-009), scan/OCR, or licensed digital file; registered in `content-sources/REGISTRY.md` first (CONT-006).
2. Parser per book layout -> intermediate JSON (chapter, rubric path, remedies with grade, cross-refs).
3. Remedy abbreviation normalisation to remedy master; unknown abbreviations go to a review queue.
4. Human proofreading UI (sample 100% of grade-3 entries, 10% random of others). Target error rate < 0.5%.
5. Build pack, sign, publish.

Coding agent must build this pipeline as a separate CLI (`tools/content-builder`) with tests on sample pages.

## 9. Smart and interactive touches (MVP1 where marked)

- P0: "Symptom to rubric" helper inside case form: when doctor types a symptom line, show 3 suggested rubrics below it (FTS + synonyms, no AI). One click adds to clipboard.
- P1: Rubric "explain" tooltip in plain English for archaic words (e.g. "Coryza" = running nose, "Eructations" = belching). Ship glossary of 1,000 terms.
- P1: Guided acute mode: pick complaint (fever, cold, cough, diarrhoea, injury), answer 5-8 tap questions (modalities, thirst, mental state), engine picks rubrics automatically and shows ranked remedies.
- MVP4: on-device language model to convert free-text case into candidate rubrics (see 04).

## 10. Doctor citations (CIT)

Plain words: a citation records where a piece of knowledge came from, e.g. "Calc-p. added to HEAD - PAIN - school girls, per Phatak, Concise Repertory, 2nd ed., p. 142" or "Confirmed in my patient HC-000123, cured 2026". Doctors regularly use books that are not installed, lectures, journals and their own cured cases; the app must capture that source.

| ID | Pri | Requirement |
|---|---|---|
| CIT-001 | P0 | Doctor can attach a citation to: (a) a personal remedy addition in a rubric, (b) a personal rubric, (c) any existing rubric or rubric-remedy entry as a note ("also confirmed by..."), (d) an MM paragraph, (e) a rubric used in a patient analysis, (f) a prescription (reason for remedy choice). |
| CIT-002 | P0 | Citation fields: source type (Book / Repertory / Journal article / Lecture or seminar / Website / Clinical experience / Colleague / Other), title, author, edition, year, publisher, page / chapter / rubric reference, URL (optional), quoted text (optional), doctor's comment, confidence (Confirmed / Probable / To verify), date added. Only source type + title (or patient for clinical experience) are required, so entry takes < 20 seconds. |
| CIT-003 | P0 | Source library: each book/source is saved once and reused from a pick list (autocomplete) so the doctor does not retype "Phatak, Concise Repertory" every time. Installed packs appear automatically as sources. |
| CIT-004 | P0 | Clinical experience citation links to the patient and visit(s) where the remedy worked; clicking it opens that case (respects user role permissions from MVP2). |
| CIT-005 | P0 | Display: entries with citations show a small reference marker (e.g. superscript book icon) beside the remedy/rubric; hover shows the citation, click opens full details. Doctor's own additions are visually distinct from book content (REP-024). |
| CIT-006 | P0 | Quick-add flow from the rubric detail panel: "Add remedy" -> pick remedy, grade, source (last used source pre-selected), page -> Save. Same flow from right-click on any rubric. |
| CIT-007 | P1 | Citations list screen: filter by source, remedy, rubric, confidence; edit/delete; export to CSV/PDF (useful for teaching, papers and theses). |
| CIT-008 | P1 | Analysis toggle: include/exclude doctor additions, and filter by confidence (e.g. only "Confirmed") in repertorisation. Result grid marks scores that depend on doctor additions. |
| CIT-009 | P1 | Citations travel with the data: included in backups, cloud sync (MVP2/3) and in exported doctor-built repertory packs (PACK-011). |
| CIT-010 | P2 | Optional "suggest to publisher" export: a doctor's confirmed additions with citations exported in a standard format that can be sent to repertory editors. |
