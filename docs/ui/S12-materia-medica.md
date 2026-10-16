# S12 Materia Medica reader
Screen id: materia-medica   Route: /materia-medica   Module: apps/desktop/src/materia-medica
Requirements: MM-001, MM-002, MM-003, REP-022, PACK-009, NFR-003   Milestone: M5  Release: R6

## Purpose

Read the Materia Medica for any remedy: pick a remedy, read its sections (Mind,
Head, ... Modalities, Relationship, Dose) from an installed book, and search the
full text across books with highlighting (MM-002). The remedy list comes from the
shared remedy master so every repertory maps to one remedy id (MM-001). The
doctor can compare the same section of a remedy across every installed book side
by side (MM-003). This is where "Open in Materia Medica" from the repertory
browser S10 (REP-022) and the result list S11 lands.

## Entry points

- Left nav "Mat.Med." (hidden by feature flag before R6, ADR 0002 rule 5).
- "Open in Materia Medica" from a remedy popup in S10 (REP-022).
- "MM" button on a result row in S11 (REP-034).
- A remedy abbreviation link anywhere in the repertory opens here for that
  remedy.

## Layout (wireframe)

```
+----------------------------------------------------------------------------------------------+
| Materia Medica        Book [Boericke 1906 v]   [ search all books ....... ] 54 hits  71 ms   |
+--------------------------------+-------------------------------------------------------------+
| Remedies (MM-001)              |  Phosphorus (Phos.)   Boericke, Pocket Manual 1906  [Compare]|
|  [ phos ............ ]         |  Kingdom: Mineral     Common: Phosphorus                     |
|  Phosphorus     Phos.          |-------------------------------------------------------------|
|  Phosphoric ac. Ph-ac.         |  Sections (MM-002)                                          |
|  Phytolacca     Phyt.          |   [Mind]  [Head]  [Stomach] ... [Modalities] [Relationship] |
|  Pulsatilla     Puls.          |   ------------------------------------------------------     |
|  ...                           |   MIND                                                      |
|  (from remedy master,          |   Great lowness of spirits. Excessive sensitiveness to     |
|   shared ids)                  |   external impressions... {search hits highlighted}        |
|                                |   HEAD                                                     |
|                                |   Vertigo of the aged... burning pains...                  |
|--------------------------------|-------------------------------------------------------------|
| Full-text results (MM-002)     |  Dose: 6th to 200th potency.                                |
|  Phos - MIND "sensitiveness"   |  Relationship: complementary Ars., Cepa...                  |
|  Puls - MIND "weeps easily"    |                                                             |
+--------------------------------+-------------------------------------------------------------+
```

### Compare view (MM-003)

```
+----------------------------------------------------------------------------------------------+
| Compare: Phosphorus    Section [Mind v]                     Books [Boericke][+ add book]      |
+--------------------------------+-------------------------------+-----------------------------+
| Boericke 1906                  | (second book when installed)  | (third book when installed) |
| Great lowness of spirits...    | not installed                 | not installed               |
+--------------------------------+-------------------------------+-----------------------------+
```

## Fields and controls (table: element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Book selector | dropdown | Lists installed MM books (MM-002); default is first installed | mm-book-select |
| Remedy search | text input | Filter remedy master by abbrev or name (MM-001) | mm-remedy-search |
| Remedy list row | list row | Shows name and abbrev; Enter opens; virtualised | mm-remedy-row |
| Remedy header | heading | Full Latin name, abbrev, common name, kingdom (MM-001) | mm-remedy-header |
| Section tab | tab | One per section present in the book (Mind..Dose) (MM-002) | mm-section-tab |
| Section body | text | Scrollable remedy text; search hits highlighted (MM-002) | mm-section-body |
| Full-text search | text input | Search across all installed books, per-keystroke, highlight (MM-002) | mm-fulltext-search |
| Search hit count / timing | label | Hit count and last query ms | mm-search-stats |
| Full-text result row | list row | Book, remedy, section, snippet; Enter jumps to that section (MM-002) | mm-fulltext-row |
| Compare button | button | Opens compare view for the current remedy (MM-003) | mm-compare |
| Compare section pick | dropdown | Section shown in every column (MM-003) | mm-compare-section |
| Compare column | panel | Same section from each installed book side by side (MM-003) | mm-compare-column |

## Behaviour

- The remedy list is the shared remedy master (MM-001); selecting a remedy loads
  its sections from the chosen book (MM-002). Sections present depend on the book;
  absent sections are not shown.
- Full-text search runs across all installed MM books per keystroke, cancels
  stale queries, and highlights hits; a result row jumps to the exact section
  (MM-002).
- "Compare" opens a side-by-side view of one chosen section across every
  installed book for the current remedy (MM-003); books not installed show "not
  installed" rather than an empty column.
- Arriving from S10/S11 (REP-022, REP-034) opens the screen on that remedy, with
  the book that supplied the keynote selected when known.

## Release slices

- R6 (this release, M5): remedy master list, book reader with sections, full-text
  search across installed books, and compare across books. On the internal build
  the only MM book is `eval-boericke-mm` (REGISTRY.md), so compare shows one
  populated column until more books are installed; the public build has no MM
  book until a public-domain MM is built.
- Deferred past this release (not built in R6): bookmarks and personal notes on a
  paragraph (MM-004, P1), and the remedy relationships table used by RX-008 and
  REP-041 (MM-005, P1).

## States (empty, loading, error, read-only, trial)

- Empty (no MM book installed): one sentence plus "Install a book" linking to S19
  (PACK-009).
- Empty (no remedy selected): prompt to pick a remedy; show recently viewed
  remedies if any.
- Loading: skeleton text block after 150 ms; search shows skeleton result rows;
  never a blocking spinner (conventions 4).
- Error (book read fails): plain message with a Details expander; other books
  keep working (PACK-013).
- Read-only mode (LIC-020): reading, search and compare all stay enabled
  (viewing is never restricted, conventions 4).
- Trial / internal build: internal build shows the evaluation banner (CONT-004).

## Keyboard

- F2/Ctrl+K is the global patient search, so MM full-text search has its own
  focus via Tab order and a visible label (conventions 5). Up/Down move remedy
  rows and result rows; Enter opens. Left/Right move between section tabs. Esc
  closes the compare view. Alt+Left back.

## Commands used (Tauri commands this screen calls, proposed names)

- `mm_list_books` -> req `{}`; res `{ books: [{ mm_book_id, title, author, edition, pack_id }] }` (MM-002)
- `mm_list_remedies` -> req `{ query?, limit }`; res `{ remedies: [{ remedy_id, abbrev, name, common_name, kingdom }] }` (MM-001)
- `mm_get_remedy_sections` -> req `{ mm_book_id, remedy_id }`; res `{ remedy: { abbrev, name, common_name, kingdom }, sections: [{ section, text, sort_order }] }` (MM-002)
- `mm_search_fulltext` -> req `{ query, book_ids?, limit }`; res `{ took_ms, hits: [{ mm_book_id, remedy_id, section, snippet }] }` (MM-002)
- `mm_compare_remedy` -> req `{ remedy_id, section, book_ids? }`; res `{ columns: [{ mm_book_id, title, section, text, installed }] }` (MM-003)

## Acceptance checks

- AC1 (MM-001): the remedy list is the shared master; a remedy opened from a Kent
  rubric and from a Boericke search resolve to the same remedy id.
- AC2 (MM-002): selecting a remedy shows its sections from the chosen book; the
  section set matches the book's content.
- AC3 (MM-002, NFR-003): full-text search across installed books highlights hits,
  cancels stale queries, and a result row jumps to the exact section within the
  rubric-search budget on the installed content.
- AC4 (MM-003): compare shows the same section of one remedy across every
  installed book side by side; uninstalled books read "not installed".
- AC5 (REP-022): "Open in Materia Medica" from S10 lands on the correct remedy.
- AC6 (LIC-020): reading, search and compare work in read-only mode.

## Open questions

- OQ-S12-1: Acceptance flow 5 (requirements 05 section 7) requires comparing a
  remedy "across 2 books", but MVP1 internal content has only one MM book
  (`eval-boericke-mm`). The second book needed to demonstrate MM-003 is not in
  the registry; which public-domain MM (Allen's Keynotes or Kent's Lectures,
  listed MVP1 in requirements 02 section 2) is built for M5 is not decided.
- OQ-S12-2: Whether MM full-text search shares the NFR-003 100 ms budget or has
  its own budget is not stated; NFR-003 names rubric search only.
- OQ-S12-3: The maximum number of columns in the compare view (how many books
  side by side at 1366 px) is not specified by MM-003.
