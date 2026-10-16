# S04 Global patient search
Screen id: search   Route: overlay (no route; opened over any screen)   Module: apps/desktop/src/app
Requirements: PSR-001, PSR-002, PSR-003, PSR-004, PSR-005, PSR-006, PSR-007   Milestone: M2  Release: R2

## Purpose
One search box that finds any patient from the first character, matching name,
patient ID, mobile, city and family member name without the doctor choosing a
field (PSR-001, PSR-002). Opens as an overlay from the top-bar search box on
every screen.

## Entry points
- The top-bar search box, available on every screen (conventions section 2).
- F2 or Ctrl+K focuses it from anywhere (PSR-001, conventions section 3).

## Layout (wireframe)
Dropdown overlay anchored under the top-bar search box, 760 px wide, over a dim
backdrop. Content area 1366 px.

```
+----------------------------------------------------------------------------------+
| [Logo] HomeoClinic  [ ram ku| .........................................]  [?] [L] |
+----------------------------------------------------------------------------------+
| +------------------------------------------------------------------------------+ |
| | {typing: live results, debounce 80 ms}                                        | |
| | +--+ Ramesh Kumar          HC-000123   34y M   98765 43210  Pune  12-10  Rs0   | |
| | |ph|                                                       (exact name)       | |
| | +--+ Ramesh Kulkarni       HC-000217   40y M   99887 11223  Pune  02-10 Rs250 | |
| | +--+ Ram Kumar Sharma      HC-000455   29y M   91234 56789  Nashik 28-09 Rs0  | |
| | +--+ {phonetic} Raam Kumaar HC-000902  33y M   90000 00000  Pune  ...         | |
| | ...                                                     (scroll loads more)    | |
| +------------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------+
```

Empty box (PSR-007):
```
| +------------------------------------------------------------------------------+ |
| | Recent patients                                                               | |
| | +--+ Sita Devi    HC-000087  51y F  ...  (opened 10:31)                        | |
| | ... last 20 opened ...                                                        | |
| +------------------------------------------------------------------------------+ |
```

## Fields and controls (element | type | rules | testid)
| Element | Type | Rules | testid |
|---|---|---|---|
| Search input | text | debounce 80 ms, search from first char (PSR-001) | search-input |
| Result list | virtualised list | top 20 shown, scroll loads more (PSR-005) | search-results |
| Result row | row | shows photo, name, ID, age/sex, mobile, city, last visit, dues (PSR-005) | search-result-row |
| Match-type tag | text | "exact", "name", "phonetic" etc. (never colour only, conventions 5) | search-result-matchtype |
| Recent list | list | shown when box empty, last 20 opened (PSR-007) | search-recent |
| No-results message | text | plain language + New patient action | search-empty |

## Behaviour
- Typing starts searching from the first character and updates as the doctor
  types with an 80 ms input debounce (PSR-001); a new keystroke cancels the
  in-flight query (per data model, search runs on a read connection off the UI
  thread).
- The single box matches name (prefix of any word, "ram ku" finds "Ramesh
  Kumar"), patient ID (full or last digits, "123" finds HC-000123), mobile (any
  4+ consecutive digits, ignoring +91 and spaces), city and family member name
  without any field selector (PSR-002).
- Indian-name tolerance: phonetic and spelling-variant matches (Sharma/Sarma,
  Mohd/Mohammad, Lakshmi/Laxmi), case and diacritic insensitive; exact matches
  always rank above phonetic (PSR-003).
- Ranking: exact ID or mobile, then exact full name, then name prefix, then
  phonetic, then other fields; ties broken by most recent visit first (PSR-004).
- Each row shows photo thumbnail, name, ID, age/sex, mobile, city, last visit
  date and a dues badge; only the top 20 load instantly, the rest stream on
  scroll via a virtualised list, never a full result load (PSR-005).
- Keyboard-only: type, Up/Down to move, Enter opens the patient dashboard (S07);
  Enter on an exact ID or mobile match opens that patient directly (PSR-006).
- When the box is empty, the last 20 opened patients are shown (PSR-007).
- Esc closes the overlay without losing anything on the screen behind it.

## Release slices
- R2 (M2): full global search ships with the patient register (PSR-001..007).
  This is the R2 demo "search by partial name, last 4 mobile digits, ID digits,
  a phonetic misspelling; each opens the right dashboard" and the 50k p95 budget.
- The overlay is reachable from the shell from R0, but returns the empty state
  (no patients) until R2; the search box and F2 focus exist at R0 (R0 demo
  step 3) with the live query flagged off until the patient store exists.
- No MVP1 release after R2 changes this overlay. Full-text case-note search
  (PSR-009) and advanced filters (PSR-008) live on S05, not here.

## States (empty, loading, error, read-only, trial)
- Empty box: recent patients list (PSR-007); if none, a one-line hint.
- No results: "No patient matches 'xyz'." plus a [ New patient ] action
  (conventions: empty state = one sentence + primary action).
- Loading: skeleton rows after 150 ms; stale queries are cancelled, so results
  never flicker backwards.
- Error: an inline "Search failed, Retry" row with a Details expander; never a
  stack trace (NFR-033).
- Read-only (LIC-020): search, opening and viewing all work unchanged.
- Trial: unaffected.

## Keyboard
- F2 / Ctrl+K focus the box (PSR-001).
- Up/Down move the selection, Enter opens, Enter on an exact ID/mobile match
  opens directly (PSR-006). Home/End jump to first/last loaded row.
- Esc closes the overlay (conventions section 3).

## Commands used (proposed)
- `patient_search({ query: string, limit: u16, cursor?: string }) -> { results: SearchRow[], next_cursor?: string }`
- `patient_recent({ limit: u16 }) -> { results: SearchRow[] }`  (PSR-007)
- where `SearchRow = { patient_id, code, name, age_label, sex, mobile_masked, city, last_visit_at, dues_paise, match_type, photo_path }`.
  `match_type` in { "exact_id", "exact_mobile", "exact_name", "name_prefix", "phonetic", "other" } drives ranking display (PSR-004).

## Acceptance checks
- Results appear from the first character typed, updating as you type with an
  80 ms debounce (PSR-001).
- The single box, without field selection, finds a patient by partial name, by
  last 4 mobile digits, by ID digits, by city and by family member name
  (PSR-002); phonetic misspelling finds the patient and ranks below exact
  matches (PSR-003, PSR-004). (Acceptance flow 2, requirements/05 section 7.)
- Each keystroke returns results under 100 ms p95 at the 50k and 100k baseline
  (NFR-002).
- Keyboard-only flow opens the right dashboard; Enter on an exact ID/mobile
  opens it directly (PSR-006).
- Empty box shows the last 20 opened patients (PSR-007).
- A newly registered patient is findable immediately (PSR-012, verified via S06).

## Open questions
- PSR-005 masks mobile except last 4 only for the receptionist role, which is
  MVP2; in MVP1 (single doctor) the full mobile is shown. The `mobile_masked`
  field returns the full number in MVP1. Confirm no masking in MVP1.
