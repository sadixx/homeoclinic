# S10 Repertory browser
Screen id: repertory-browser   Route: /repertory   Module: apps/desktop/src/repertory
Requirements: REP-010, REP-011, REP-012, REP-013, REP-014, REP-015, REP-017, REP-020, REP-021, REP-022, REP-024, CIT-001, CIT-005, CIT-006, PACK-007, NFR-003   Milestone: M5  Release: R6

## Purpose

Let the doctor find and read rubrics the way the printed repertory reads: one
search box that matches full rubric paths as you type (REP-010, REP-011), a
chapter tree to browse like a book (REP-020), and a detail panel that shows the
rubric's remedies by grade with styling, cross references, parents and children
(REP-021). The doctor can open any remedy in Materia Medica (REP-022) and add a
personal remedy to a rubric with a required citation (REP-024, CIT-001). This is
the reading surface; picking rubrics into a clipboard and scoring them is the
repertorisation workspace S11 (R7).

## Entry points

- Left nav "Repertory" (F6). The nav item is hidden by a compile-time feature
  flag before R6 (ADR 0002 rule 5).
- F6 with a patient visit open: opens here with the search box focused; adding a
  rubric to the clipboard is routed to S11 (gated to R7, see Release slices).
- "Send to repertory" from the case form (CASE-006): opens here with the search
  box pre-filled with the selected symptom text (REP-011).
- Cross reference link inside a rubric detail (REP-021) navigates within S10.

## Layout (wireframe)

```
+----------------------------------------------------------------------------------------------+
| Repertory                                             Packs: [All enabled v]  My additions [x]|
+---------------------------+------------------------------------------------------------------+
| [ fear dark ........(/)]  |  MIND - FEAR - dark, of                         Publicum (Kent)  |
| 12 results   62 ms        |  Remedy count: 23    Page ref: p.44 col.2    [+ My addition] [Clip|
|---------------------------|------------------------------------------------------------------|
| {search results}          |  Remedies (grade 3 bold, 2 italic, 1 plain; number shown)        |
|  MIND-FEAR-dark, of   23  |   STRAM(3)  CALC(3)  PHOS(3)  CAUST(2)  PULS(2)  ARS(1) ...       |
|  >Stram Calc Phos ...     |   [book-icon] = has citation; {my} = my addition (green)         |
|  MIND-FEAR-dark, agg  9   |------------------------------------------------------------------|
|  >Stram Carb-v ...        |  Cross references (REP-021)                                      |
|  EYE-DARKNESS...      4    |   -> MIND - FEAR - night                                         |
|  ...                      |   -> MIND - DARKNESS, agg                                        |
|---------------------------|------------------------------------------------------------------|
| Chapters (book view)      |  Parent:  MIND - FEAR                                            |
|  [-] MIND            1024 |  Children:                                                       |
|    [-] FEAR            88 |   - dark, of - children in                                       |
|       - dark, of      23 |   - dark, agg                                                    |
|       - night          9 |------------------------------------------------------------------|
|    [+] ANXIETY        140 |  {remedy popup on hover/click}                                   |
|  [+] VERTIGO          210 |   Phosphorus (Phos.)  "fear of dark, of being alone"             |
|  [+] HEAD             980 |   [Open in Materia Medica]                                        |
+---------------------------+------------------------------------------------------------------+
```

## Fields and controls (table: element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Search box | text input | Plain words any order; matches full path (REP-010, REP-011); debounce per keystroke, cancel stale query; synonym + abbreviation + trigram expansion (REP-012, REP-013); `/` focuses it | rep-browser-search |
| Result count / timing | label | Shows match count and last query time in ms (verifies NFR-003) | rep-browser-search-stats |
| Pack filter | dropdown | One repertory or All enabled (REP-014); default repertory pre-selected (PACK-009) | rep-browser-pack-filter |
| Chapter filter | dropdown | Limit search to one chapter (REP-014) | rep-browser-chapter-filter |
| Min remedy count | number input | Hide rubrics with fewer remedies (REP-014) | rep-browser-min-count |
| Contains remedy | autocomplete | Only rubrics containing remedy X (REP-014) | rep-browser-contains-remedy |
| My additions toggle | checkbox | Show/hide doctor additions overlay in detail (REP-024, CIT-008 belongs to S11) | rep-browser-my-additions |
| Result row | list row | Shows full path, remedy count, top 5 remedies by grade, source repertory (REP-015); Enter opens detail; virtualised list | rep-browser-result-row |
| Recent/favourite list | list | Shown when search box is empty (REP-017) | rep-browser-recent |
| Chapter tree node | tree row | Expand/collapse; arrows navigate; shows rubric count; Enter opens detail (REP-020) | rep-browser-tree-node |
| Breadcrumb | label | Current rubric path, segments clickable (REP-020) | rep-browser-breadcrumb |
| Rubric title | heading | Full path of open rubric | rep-browser-rubric-title |
| Remedy chip | inline token | Grade styling: 3 bold, 2 italic, 1 plain, plus number and non-colour cue (REP-021, conventions 5); book icon if cited (CIT-005); green "{my}" if addition (REP-024) | rep-browser-remedy |
| Remedy popup | popover | Full name, keynotes from MM, "Open in Materia Medica" (REP-022) | rep-browser-remedy-popup |
| Open in MM button | button | Navigates to S12 for that remedy | rep-browser-open-mm |
| Cross reference link | link | Navigates to target rubric (REP-021) | rep-browser-xref |
| Parent link | link | Opens parent rubric (REP-021) | rep-browser-parent |
| Child link | link | Opens child rubric (REP-021) | rep-browser-child |
| Page ref | label | Printed book page/column if present in pack (PACK-007) | rep-browser-page-ref |
| Add my addition | button | Opens quick-add remedy + citation flow (REP-024, CIT-006); same flow on right-click of a rubric (CIT-006) | rep-browser-add-addition |
| Add to clipboard | button | Sends rubric to S11 clipboard (REP-030); hidden by feature flag before R7 | rep-browser-add-clipboard |

### Add-my-addition quick flow (REP-024, CIT-006, CIT-001, CIT-002)

| Element | Type | Rules | testid |
|---|---|---|---|
| Remedy pick | autocomplete | From remedy master (MM-001) | rep-browser-add-remedy |
| Grade pick | dropdown | Pack grade scale 1..grade_max (PACK-007) | rep-browser-add-grade |
| Source pick | autocomplete | From source library, last used pre-selected (CIT-003) | rep-browser-add-source |
| Page/ref | text input | Optional page/chapter/rubric reference (CIT-002) | rep-browser-add-pageref |
| Confidence | dropdown | Confirmed / Probable / To verify (CIT-002) | rep-browser-add-confidence |
| Save addition | button | Writes addition + citation + link in one transaction (design 03 section 6) | rep-browser-add-save |

## Behaviour

- Typing in the search box runs search per keystroke, cancels any in-flight
  query, and ranks results (full path match, chapter synonym, remedy count,
  depth per design 03 section 2). Each row shows path, remedy count, top 5
  remedies, source (REP-015).
- Synonyms and modern words expand before the query ("worse" to "agg",
  "headache" to "HEAD - PAIN"; REP-012); abbreviations and typos tolerated
  (REP-013).
- Selecting a result or tree node loads the rubric detail: remedies sorted by
  grade then alphabetically, grade styled with number (REP-021); cross
  references, parent and children as links (REP-021); page ref if the pack
  carries it (PACK-007).
- Hover or click a remedy shows a popup with full name and keynotes and an
  "Open in Materia Medica" action (REP-022) that navigates to S12.
- "My additions" toggle overlays the doctor's personal remedies for the rubric,
  visually distinct and never changing source data (REP-024). Personal additions
  carry a citation marker (CIT-005).
- "Add my addition" (or right-click a rubric) opens the quick-add flow; a
  citation is mandatory for a personal addition (REP-024, CIT-001).
- Cross reference, parent and child links navigate within S10 and update the
  breadcrumb.

## Release slices

- R6 (this release, M5): rubric search, chapter tree, rubric detail with graded
  remedies and cross references, remedy popup and Open in Materia Medica, "My
  additions" overlay, and the add-remedy-with-citation quick flow. Internal
  build only (eval packs); the public build has only the starter sample pack
  (REGISTRY.md), so results are sparse there.
- R7 (M6): the "Add to clipboard" control becomes active and routes rubrics into
  the repertorisation workspace S11 (REP-030). Before R7 it is hidden by the
  feature flag; the browser is read-only for analysis.
- Deferred past MVP1 window inside this screen: side-by-side compare of the same
  rubric across two repertories (REP-023, P1), Hindi/Hinglish keyword mapping
  (REP-016, P1, MVP2). These are not built in R6/R7.

## States (empty, loading, error, read-only, trial)

- Empty (no query): show recent and favourite rubrics (REP-017) and the chapter
  tree; one-line hint "Type symptoms in any order, e.g. fear dark".
- Empty (no packs installed): one sentence plus a button "Install a repertory"
  linking to S19 (PACK-009).
- Loading: skeleton result rows after 150 ms; tree lazy-loads child nodes; never
  a blocking spinner (conventions 4).
- Error (pack read fails): plain message "This repertory could not be read" with
  a Details expander for the support code; other packs keep working (PACK-013).
- Read-only mode (LIC-020): search, browse, read and open MM stay enabled;
  "Add my addition" is disabled with the standard tooltip (conventions 4).
- Trial / internal build: internal build shows the permanent evaluation banner
  (CONT-004) above the content area.

## Keyboard

- `/` focus search (design 03 section 7). Up/Down move result rows and tree
  nodes; Enter opens detail (REP-020, conventions 4). Left/Right collapse/expand
  a tree node. Alt+Left back to the previous rubric. Esc closes the remedy popup
  or the add-addition dialog. F6 re-focuses the screen.

## Commands used (Tauri commands this screen calls, proposed names)

- `rubric_search` -> req `{ query, pack_ids, chapter_id?, min_remedy_count?, contains_remedy_id?, limit }`; res `{ took_ms, results: [{ pack_id, rubric_id, full_path, remedy_count, top5: [{ remedy_id, abbrev, grade }], source_title }] }`
- `list_chapters` -> req `{ pack_id }`; res `{ chapters: [{ chapter_id, name, rubric_count, sort_order }] }`
- `list_child_rubrics` -> req `{ pack_id, parent_rubric_id? }`; res `{ rubrics: [{ rubric_id, text, depth, remedy_count, has_children }] }`
- `get_rubric_detail` -> req `{ pack_id, rubric_id, include_my_additions }`; res `{ full_path, page_ref?, parent_rubric_id?, remedies: [{ remedy_id, abbrev, name, grade, normalised_grade, is_my_addition, citation_id? }], xrefs: [{ target_rubric_id, target_full_path, kind }], children: [{ rubric_id, text, remedy_count }] }`
- `get_remedy_keynote` -> req `{ remedy_id }`; res `{ abbrev, name, common_name, keynotes, mm_book_id?, mm_remedy_id? }`
- `list_recent_rubrics` -> req `{ limit }`; res `{ recent: [...], favourites: [...] }` (REP-017)
- `list_sources` -> req `{ query? }`; res `{ sources: [{ source_id, title, author, edition }] }` (CIT-003)
- `add_personal_remedy` -> req `{ pack_id, rubric_id, remedy_id, grade, citation: { source_id, page_ref?, confidence, comment? } }`; res `{ user_rubric_remedy_id, citation_id }` (REP-024, CIT-001)
- `add_rubric_to_clipboard` -> req `{ visit_id, analysis_id?, pack_id, rubric_id, clipboard_no, source_text? }`; res `{ analysis_rubric_id }` (REP-030; active from R7)

## Acceptance checks

- AC1 (REP-010, REP-011, NFR-003): typing "fear dark" returns "MIND - FEAR -
  dark, of" and each keystroke reports `took_ms` < 100 ms on 200,000 rubrics
  across enabled packs; stale queries are cancelled.
- AC2 (REP-012, REP-013): "worse" expands to "agg", "headache" to "HEAD - PAIN",
  and a one-letter typo still returns the intended rubric.
- AC3 (REP-014): pack, chapter, min remedy count and contains-remedy filters each
  narrow the result set correctly.
- AC4 (REP-015): a result row shows full path, remedy count, top 5 remedies by
  grade, and source repertory.
- AC5 (REP-020, REP-021): the chapter tree expands by keyboard; opening a rubric
  shows remedies grade-sorted with number plus style (not colour alone,
  conventions 5), cross references, parent and children as working links.
- AC6 (REP-022): opening a remedy popup and clicking "Open in Materia Medica"
  navigates to S12 for that remedy.
- AC7 (REP-024, CIT-001, CIT-005): adding a personal remedy requires a citation;
  the addition shows the book icon marker and is visually distinct; source data
  is unchanged.
- AC8 (PACK-007): a rubric from a pack that stores page references shows the page
  and column.
- AC9 (LIC-020): in read-only mode search and browse work while "Add my addition"
  is disabled with the tooltip.

## Open questions

- OQ-S10-1: Default sort of search results when timing is tied: by score then
  remedy count, or by chapter order? (design 03 section 2 defines the score but
  not the final tie-break for the browser list.)
- OQ-S10-2: How many favourite rubrics to show and how a rubric is marked as a
  favourite (star on the detail panel?) is not specified by REP-017.
- OQ-S10-3: Keyboard shortcut for "Open in Materia Medica" from a focused remedy
  chip is not defined in conventions 3.
