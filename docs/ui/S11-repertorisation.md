# S11 Repertorisation workspace
Screen id: repertorisation   Route: /repertory/analysis   Module: apps/desktop/src/repertory
Requirements: REP-030, REP-031, REP-032, REP-033, REP-034, REP-035, REP-036, REP-037, REP-038, CASE-006, CIT-001, CIT-005, CIT-008, MM-001, NFR-004   Milestone: M6  Release: R7

## Purpose

The one-click repertorisation surface. The doctor collects rubrics into one or
more clipboards attached to the visit (REP-030, REP-031), tunes each rubric
(weight, eliminative, causation, exclude; REP-032), picks one of six analysis
methods (REP-033), and reads the result as the classic chart grid or a ranked
list with a score bar (REP-034, REP-035). Any change recomputes instantly within
budget (REP-036, NFR-004). The doctor can prescribe the top remedy, which opens
the existing prescription screen S13 pre-filled (REP-037), and saves the analysis
snapshot with the visit (REP-038).

## Entry points

- "Add to clipboard" from the repertory browser S10 (REP-030).
- "Send to repertory" from the case form on a symptom line (CASE-006), which
  first opens S10 search and then lands the picked rubric here.
- Patient dashboard quick button "Repertorise" (PAT-005) for the open visit.
- Re-open a saved analysis from the visit timeline (REP-038).

## Layout (wireframe)

```
+----------------------------------------------------------------------------------------------+
| Repertorise - Ramesh Kumar (HC-000123), visit 14-10-2026   Method [Totality + grade v] [Run] |
+--------------------------------+-------------------------------------------------------------+
| Clipboards (REP-031)           |  Result   [Grid] [List] [Graph]        Include my additions [x]|
|  (o) Mentals (4)               |  Confidence filter [All v]             Top [20 v]  Recompute 180ms|
|  ( ) Physicals (3)             |-------------------------------------------------------------|
|  ( ) Acute (0)   [+ clipboard] |  GRID (REP-034): rows=rubrics, cols=remedies, cell=grade     |
|  [x] Combine all               |  Score ->        312   298   240   ...                       |
|--------------------------------|  Coverage ->     7/9   6/9   6/9                             |
| Rubrics in Mentals             |                 PHOS  CALC  SULPH ...                        |
|  W E C X                       |  MIND-FEAR-dark   3     3     1                              |
|  [2][x][ ][ ] MIND-FEAR-dark,of|  MIND-ANXIETY     2     1     2                              |
|  [1][ ][x][ ] MIND-GRIEF...{my}|  GENERALITIES-... 0     3     3                              |
|  [1][ ][ ][x] HEAD-PAIN-sun    |  ...                                                        |
|  [3][ ][ ][ ] SLEEP-...        |-------------------------------------------------------------|
|   (W weight 1-4, E elim,       |  LIST (REP-035): rank, remedy, score bar, coverage          |
|    C causation, X exclude)     |   1 PHOS   [##########] 312   7/9   [Prescribe][MM]          |
|  [Remove] [Undo]               |   2 CALC   [#########_] 298   6/9   [Prescribe][MM]          |
|                                |   3 SULPH  [#######___] 240   6/9   [Prescribe][MM]          |
|                                |  (score depends on my additions) marked with {my}          |
+--------------------------------+-------------------------------------------------------------+
| [Save analysis to visit]                                             Saved 10:42             |
+----------------------------------------------------------------------------------------------+
```

## Fields and controls (table: element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Clipboard selector | radio list | Up to 10 named clipboards per analysis (REP-031); shows rubric count | repert-clipboard |
| Add clipboard | button | New named clipboard, max 10 (REP-031) | repert-clipboard-add |
| Rename clipboard | inline edit | Name shown in selector (REP-031) | repert-clipboard-name |
| Combine all | checkbox | Analyse across all clipboards together (REP-031) | repert-combine |
| Rubric row | list row | Shows rubric path and per-rubric settings; "{my}" if it has doctor additions (CIT-005) | repert-rubric-row |
| Weight | stepper 1-4 | Default 1 (REP-032); `1-4` keys set weight on the focused rubric (design 03 section 7) | repert-weight |
| Eliminative | checkbox | Remedy must be present in all eliminative rubrics (REP-032, REP-033e) | repert-eliminative |
| Causation | checkbox | Mark causation / never-well-since (REP-032) | repert-causation |
| Exclude | checkbox | Temporarily drop rubric from scoring (REP-032) | repert-exclude |
| Remove rubric | button | Removes rubric from clipboard; undoable (REP-032, NFR-035) | repert-remove |
| Undo | button | Undo last remove/weight change (NFR-035) | repert-undo |
| Method selector | dropdown | Six methods, default "Totality + grade" (REP-033a..f) | repert-method |
| Run | button | Recompute now; auto-recompute also fires on any change (REP-036) | repert-run |
| View toggle | segmented | Grid / List / Graph (REP-034, REP-035) | repert-view-toggle |
| Include my additions | checkbox | Merge doctor additions into scoring (CIT-008); result marks affected scores (CIT-008) | repert-include-additions |
| Confidence filter | dropdown | All / Confirmed / Probable / To verify for included additions (CIT-008) | repert-confidence-filter |
| Top N | dropdown | Columns shown, default 20, up to 50 (REP-034) | repert-topn |
| Recompute timing | label | Last recompute ms (verifies NFR-004) | repert-recompute-stats |
| Grid cell | cell | Grade with colour plus number (conventions 5); column header shows score and coverage "7/9" (REP-034) | repert-grid-cell |
| Column header remedy | button | Click sorts by that remedy; click remedy name opens MM (REP-034) | repert-grid-col |
| List row | row | Rank, remedy, score bar, coverage, Prescribe, MM (REP-035) | repert-list-row |
| Prescribe from result | button | Opens S13 pre-filled with the remedy (REP-037) | repert-prescribe |
| Open MM | button | Opens S12 for the remedy (REP-034) | repert-open-mm |
| Save analysis | button | Saves snapshot (rubrics, method, settings, top 20) to the visit (REP-038) | repert-save |

## Behaviour

- Rubrics arrive from S10 or CASE-006 into the active clipboard, which is
  attached to the visit and saved automatically (REP-030). The source symptom
  text from the case is kept on the rubric (REP-030, `source_text`).
- Each rubric carries weight (1-4), eliminative, causation and exclude flags
  (REP-032). Changing any flag, weight, method, clipboard combination, Top N, the
  "include my additions" toggle or the confidence filter triggers an automatic
  recompute (REP-036).
- The six methods follow the formulas in requirements 06 section 5 and design 03
  section 3: sum of grades (a), totality then grade tie-break (b), Kent chapter
  weighting (c), Boenninghausen parent generalisation (d), elimination (e),
  weighted with optional small-rubric bonus (f). Grades are normalised per pack
  grade scale to 1..3 (requirements 06 section 5).
- The grid shows rubrics as rows and the top N remedies as columns, cells show
  grade with colour and number, and column headers show score and coverage
  "covered/total" (REP-034). The list shows rank, remedy, a score bar and
  coverage for doctors who prefer not to read a table (REP-035). Graph view shows
  the same scores as bars (REP-035).
- With "include my additions" on, doctor additions are merged into scoring and
  results whose score depends on an addition are marked (CIT-008); the confidence
  filter restricts which additions count (CIT-008).
- "Prescribe this remedy" opens the prescription screen S13 pre-filled with that
  remedy (REP-037).
- "Save analysis to visit" stores a snapshot (rubric list, method, settings, top
  20 results) that re-opens identically even after packs change (REP-038).

## Release slices

- R7 (this release, M6): clipboards, per-rubric settings, all six methods, grid,
  list and graph views, instant recompute, include-my-additions with confidence
  filter, save snapshot, and prescribe-from-result into S13. Depends on S10 (R6)
  for rubric collection and S13 (R4) for the Rx screen, both already shipped.
- Deferred past this release (not built in R7): remedy differentiation view
  (REP-039, P1), kingdom/family and dispensary filters (REP-040, P1), remedy
  relationship hints (REP-041, P1), print/PDF of the chart (REP-042, P1), and
  cross-repertory normalised analysis (REP-043, P2).

## States (empty, loading, error, read-only, trial)

- Empty (no rubrics): one sentence "Add rubrics from the repertory or your case"
  plus a button that focuses S10 search (conventions 4).
- Loading: result area shows skeleton rows; a recompute never blocks editing the
  clipboard (SUX-002, recompute off the UI thread).
- Error (a used pack is missing): the row for a missing rubric shows "repertory
  not installed" and the live result excludes it, while a saved snapshot still
  opens from its stored results (CONT-007, REP-038).
- Read-only mode (LIC-020): an open visit can always be finished (SUX-008), so
  editing this analysis for the current visit stays enabled; starting analysis on
  a new visit is blocked by the new-visit restriction, not here.
- Trial / internal build: internal build shows the evaluation banner (CONT-004)
  and results carry the "EVALUATION" mark when printed via S13.

## Keyboard

- `Ctrl+R` run/recompute, `1`-`4` set weight on the focused rubric, `Enter` on a
  list row opens the remedy, Up/Down move rows (design 03 section 7). Ctrl+S
  forces a save of the analysis. Esc closes a popup. Del removes the focused
  rubric (undoable, NFR-035). F7 prescribes the focused top remedy.

## Commands used (Tauri commands this screen calls, proposed names)

- `get_or_create_analysis` -> req `{ visit_id }`; res `{ analysis_id, clipboards: [{ clipboard_no, name, rubric_count }], method, include_my_additions, confidence_filter, top_n }`
- `add_clipboard` -> req `{ analysis_id, name }`; res `{ clipboard_no }` (max 10; REP-031)
- `rename_clipboard` -> req `{ analysis_id, clipboard_no, name }`; res `{ ok }`
- `list_analysis_rubrics` -> req `{ analysis_id, clipboard_no? }`; res `{ rubrics: [{ analysis_rubric_id, pack_id, rubric_id, full_path, weight, is_eliminative, is_causation, is_excluded, source_text, has_my_additions }] }`
- `set_rubric_settings` -> req `{ analysis_rubric_id, weight?, is_eliminative?, is_causation?, is_excluded? }`; res `{ ok }` (REP-032)
- `remove_analysis_rubric` -> req `{ analysis_rubric_id }`; res `{ ok, undo_token }` (NFR-035)
- `undo_analysis_change` -> req `{ undo_token }`; res `{ ok }`
- `run_repertorisation` -> req `{ analysis_id, method, combine_all, include_my_additions, confidence_filter, top_n }`; res `{ took_ms, columns: [{ remedy_id, abbrev, name, score, coverage_hit, coverage_total, depends_on_addition }], rows: [{ analysis_rubric_id, full_path, cells: [{ remedy_id, grade }] }] }` (REP-033, REP-034, NFR-004)
- `save_analysis_snapshot` -> req `{ analysis_id, method, top_n }`; res `{ saved_at }` (REP-038)
- `start_prescription_from_remedy` -> req `{ visit_id, remedy_id }`; res `{ prescription_id }`, then navigate to S13 (REP-037)
- `open_materia_medica` -> req `{ remedy_id }`; res `{ mm_book_id?, mm_remedy_id? }`, then navigate to S12 (REP-034)

## Acceptance checks

- AC1 (REP-030, REP-031): rubrics added from S10/CASE-006 land in the chosen
  clipboard, up to 10 named clipboards exist, and "Combine all" analyses them
  together; the clipboard persists with the visit without a Save button.
- AC2 (REP-032): weight 1-4, eliminative, causation and exclude each change the
  result as specified; an eliminative rubric restricts candidates to remedies
  present in all eliminative rubrics (REP-033e).
- AC3 (REP-033, requirements 06 section 5): each of the six methods reproduces
  the hand-computed fixture ranking from the 5-rubric x 6-remedy sample pack.
- AC4 (REP-034): the grid shows rubric rows, top N remedy columns (default 20, up
  to 50), grade cells with number plus colour, and per-column score and coverage
  "hit/total"; clicking a column sorts, clicking a remedy opens MM.
- AC5 (REP-035): list and graph views show rank, score bar and coverage and match
  the grid scores.
- AC6 (REP-036, NFR-004): changing any rubric or setting recomputes and the
  reported `took_ms` is < 300 ms for 30 rubrics.
- AC7 (REP-037): "Prescribe" opens S13 pre-filled with the selected remedy for
  the current visit.
- AC8 (REP-038): saving stores rubrics, method, settings and top 20; re-opening
  after a pack change shows the stored results and flags any now-missing pack.
- AC9 (CIT-008): toggling "include my additions" changes scores only when on, and
  scores that depend on an addition are marked; the confidence filter restricts
  counted additions.

## Open questions

- OQ-S11-1: Default chapter weights for the Kent method are MIND 3,
  GENERALITIES 2, others 1 (requirements 06 section 5); the screen needs to say
  whether the doctor can edit these weights here or only in Settings. Not
  specified.
- OQ-S11-2: Whether the graph view is a third distinct view or a strip beside the
  list is not pinned down by REP-035.
- OQ-S11-3: REP-042 (print the chart) is P1 and out of this release; confirm the
  chart is simply not printable in R7 rather than printed through S14.
- OQ-S11-4: Causation/never-well-since (REP-032) is captured as a flag, but no
  requirement defines how it changes scoring versus a normal or eliminative
  rubric; behaviour of the flag in the engine is undefined.
