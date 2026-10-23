# ADR 0019: Case record as ONE rich WYSIWYG document per complaint (TipTap/ProseMirror)

Status: Accepted (M3-RWv2, branch `HC-MVP1-M3a-case-visits`)
Date: 2026-10-23
Supersedes: ADR 0018's *editor* decision (the "big editable box = typed block
list of text/table rendered by bespoke React" model). ADR 0018's product
intent — a dated running journal per complaint, button-inserted editable
tables, side-section data, legacy R3 read, opaque `data_json`, autosave +
kill-restore — is RETAINED and TIGHTENED, not reverted. Only the *rendering /
serialisation mechanism* changes: from a hand-rolled block list to a real
WYSIWYG editor whose document is the single notepad.
Affects: `docs/ui/S08-case-form.md` (revised alongside this ADR),
`docs/ui/S09-follow-up-visit.md` (follow-up copy-forward), the
`visit.data_json` payload contract (v2 journal -> v3 case-rich, specified in
`.worklog/HC-MVP1-M3/handoffs/M3-RWv2-serialization-v3.md`), and
`apps/desktop/src/case/*`. Does NOT change the storage contract:
`visit.data_json` stays an opaque JSON `TEXT` column (ADR 0007), autosave is
still one `UPDATE visit` (R-DATA-001), and the `visit_fts` trigger still
indexes `COALESCE(data_json,'')` verbatim.
Flagged to the orchestrator: ADR 0018 and ADR 0007's example shapes are
narrowed by this ADR; design docs are not silently edited.

## Context

ADR 0018 replaced the structured template-field case form with a
doctor-journal model: one big editable box per complaint, dated entries, and
button-inserted editable **text/table blocks** serialised into an opaque
`visit.data_json` document (`schema: "case-journal"`, `version: 2`). The blocks
were rendered by bespoke React (a `<textarea>` per text block, a hand-rolled
`<input>`-grid per table block).

The product owner tested that build and wants a **true rich WYSIWYG editor**,
not a list of separate boxes and grids. The target feel is WordPad/Word:

- **ONE editor per complaint** is the single notepad. ALL data — free prose AND
  every recorded section — lives inside *one document*, in the order the doctor
  wrote it. There is no separate side rail of section controls that holds data.
- **Record buttons** (Record vitals / modalities / family history / physical
  generals / investigations / prescription) open a popup; on confirm they
  **insert a real, editable Office-style table** into the *current dated entry*,
  under a **numbered section heading**, separated from the previous content by a
  **full-width horizontal rule** (the `=====` separator). Cells stay editable
  in-place afterwards — tab between cells, add/remove rows.
- **Family history** inserts a neat **two-column** table (Maternal | Paternal).
- **Vitals** keeps **BP systolic + diastolic as two fields** plus BMI.
- **Add entry** inserts a dated header node; entries accumulate chronologically.
- **Follow-up** reopens the prior document and appends a new dated entry; prior
  sections (including family history) MUST persist.

This requires a genuine rich-text engine with first-class, *programmatically
insertable*, *real editable* table and horizontal-rule nodes — something the
hand-rolled block list cannot grow into without reinventing an editor.

### Hard constraints (non-negotiable; from `hc-project-context` + `docs/rules/*`)

1. **Fully offline at runtime.** MVP1 makes zero network calls of its own
   (product rule 1). The editor and every asset it needs MUST bundle into the
   app; NO CDN, NO remote fonts/CSS/JS, NO telemetry/analytics, NO license
   "phone-home".
2. **Strict Tauri CSP.** `apps/desktop/src-tauri/tauri.conf.json` ships:
   `script-src 'self'` (NO `'unsafe-eval'`, NO `'wasm-unsafe-eval'`, NO inline
   script), `style-src 'self' 'unsafe-inline'` (inline *styles* allowed),
   `connect-src 'self' ipc: http://ipc.localhost`, `object-src 'none'`,
   `frame-src 'none'`. The editor MUST run under this with NO relaxation of
   `script-src`. Any library that compiles strings to code at runtime
   (`eval` / `new Function` / string `setTimeout`) is DISQUALIFIED.
3. **Permissive licence.** MIT / Apache-2.0 / BSD only (no GPL/commercial-only;
   the `internal_eval` GPL boundary is content-only, product rule 6).
4. **React 18.3.1 + Vite 5.4.11 + TypeScript strict** (R-UI-001). No `any`.
5. **REAL editable tables + programmatic node insertion.** Editable cells, tab
   navigation, add/remove rows/columns, AND an API to insert a table node and
   an `hr` node at the caret from a button handler.
6. **Acceptable bundle size.** This is a small desktop clinical app; the editor
   core + table + hr should be on the order of tens-of-kB gzipped, not a
   multi-hundred-kB monolith.
7. **Pinned versions** (R-UI dependency hygiene; no open ranges).
8. **`visit.data_json` stays backend-opaque** (ADR 0007) AND must keep a
   **plain-text projection extractable** for `visit_fts` search.

## Decision

### 1. Editor library: TipTap v2 (the React/TS layer over ProseMirror), with `prosemirror-tables`.

Adopt **TipTap** — the headless React wrapper around **ProseMirror** — as the
case editor. ProseMirror is the engine; TipTap gives the React binding, the
schema/extension ergonomics, and (via `@tiptap/extension-table`, which wraps
`prosemirror-tables`) a **real, mature, editable table** with tab-between-cells,
add/remove rows and columns, and column resizing. Horizontal rules are a
first-class node (`@tiptap/extension-horizontal-rule`). Both table and hr can be
inserted programmatically from a button handler via TipTap's command chain.

**Exact npm packages to pin** (add to `apps/desktop/package.json`
`dependencies`, EXACT versions — no `^`/`~`; this stage specifies them, the
install stage pins the resolved patch in `package-lock.json`). Pin the whole
TipTap set to **one** identical version so the ProseMirror peer graph stays
coherent:

```jsonc
{
  "@tiptap/react":                    "2.11.5",
  "@tiptap/pm":                       "2.11.5",  // the bundled ProseMirror peer set (state/view/model/transform/commands + prosemirror-tables)
  "@tiptap/starter-kit":              "2.11.5",  // doc/paragraph/text/bold/italic/history/horizontalRule/heading/... (heading + horizontalRule used)
  "@tiptap/extension-table":          "2.11.5",
  "@tiptap/extension-table-row":      "2.11.5",
  "@tiptap/extension-table-cell":     "2.11.5",
  "@tiptap/extension-table-header":   "2.11.5"
}
```

Notes on the set:
- `@tiptap/pm` re-exports the ProseMirror packages (`prosemirror-state`,
  `-view`, `-model`, `-transform`, `-commands`, `-schema-list`,
  `-history`, **`prosemirror-tables`**, ...) at versions matched to the TipTap
  release, so we do NOT separately pin raw `prosemirror-*` packages and cannot
  get a peer-version skew. Import tables via `@tiptap/extension-table`, not raw
  `prosemirror-tables`.
- `horizontalRule` and `heading` ship inside `@tiptap/starter-kit`; no extra
  package for the `=====` rule or the numbered section headings.
- Version **2.11.5** is the pinned target of the current TipTap v2 line
  (MIT, battle-tested, used by The Guardian/NYT/Atlassian per upstream). The
  install stage MUST pin the exact resolved patch in the lockfile and MUST NOT
  silently jump to TipTap v3 (a separate major with its own migration); if v3
  is adopted later it is its own ADR. If 2.11.5 is unavailable at install time,
  pin the latest `2.x` patch and record it in the slice-plan handoff.

**Licence:** TipTap core and the table/hr extensions are **MIT**; ProseMirror is
**MIT**. Satisfies constraint 3.

### 2. Offline confirmation (constraint 1)

TipTap/ProseMirror are plain ES modules published to npm. They are bundled by
Vite into the app's own `script-src 'self'` JavaScript at build time. At
RUNTIME the editor:
- makes **no network request** — no CDN, no web-font fetch, no stylesheet fetch,
  no telemetry/analytics, no license check. (The commercial "Tiptap Pro /
  Collaboration" cloud features are a SEPARATE, OPTIONAL product; we do NOT add
  `@tiptap-pro/*` or `@hocuspocus/*`, so there is nothing that could call home.)
- loads **no remote asset** — table/hr styling is our own CSS under
  `style-src 'self'`; any inline style the editor sets is covered by the
  existing `style-src 'unsafe-inline'`.
This is verified at build time by the offline-asset check in the slice plan (no
`http(s)://` / `cdn` / `fonts.googleapis` references in the editor bundle) and
asserted at runtime by the E2E (airplane-mode case edit works).

### 3. CSP confirmation (constraint 2) — the decisive differentiator

ProseMirror/TipTap do **not** use `eval` or `new Function` at runtime: the
schema and plugins are ordinary JS objects/classes, not compiled-from-string
templates. The editor therefore runs under the EXISTING strict CSP with **no
change to `script-src`**:
- `script-src 'self'` — satisfied (bundled module, no `eval`/`new Function`).
- `style-src 'self' 'unsafe-inline'` — ProseMirror sets some inline styles on
  the editable DOM (e.g. table column-resize widths, caret/selection
  decorations); these are covered by the already-present `'unsafe-inline'` for
  **styles**. No *script* inlining is needed.
- `img-src 'self' asset: data:` — the case editor inserts NO images in R3; if a
  future slice adds images they go through the Tauri `asset:` protocol, not
  remote URLs.
No CSP relaxation is required or permitted. (Lexical and Slate are also
eval-free; the CSP bar does not by itself pick between them — the table bar
does, see Alternatives.)

### 4. Bundle size (constraint 6)

TipTap React + StarterKit + the four table extensions + horizontalRule is on the
order of ~110-140 kB min / ~40-55 kB gzip added to the vendor chunk — acceptable
for a desktop app with no download-size pressure (NFR size budget is about the
installer, and an editor is core to the product). We keep it lean by importing
only the extensions we use (StarterKit + table set + horizontalRule), NOT the
full `@tiptap/extension-*` catalogue, and by NOT adding any Pro/collab package.
The exact measured gzip delta is recorded by the slice plan's bundle check; if
it materially exceeds budget the fallback is to drop `starter-kit` and import
the handful of base nodes individually.

### 5. ONE editor per complaint = the single notepad (RETAINS ADR 0018 #1/#2)

Each complaint owns exactly **one** TipTap editor instance whose ProseMirror
document is the whole case for that complaint: free prose, dated-entry headers,
numbered section headings, horizontal-rule separators and the inserted tables,
all in one document in authored order. There is no separate data-bearing side
rail. "Add entry" inserts a **dated header** node (a styled heading) at the end
of the document; entries accumulate chronologically. (Numbering, headings and
separators are specified in S08 and the v3 serialization handoff.)

### 6. Record buttons insert real editable table nodes (RETAINS ADR 0018 #3, upgrades mechanism)

The structured side sections become a row of **record buttons**:
`Record vitals`, `Record modalities`, `Record family history`,
`Record physical generals`, `Record investigations`, `Add/Update prescription`.
Each opens a popup form; on confirm the UI runs a single TipTap command chain
that, at the end of the current dated entry, inserts in order:
1. a **full-width horizontal rule** node (the `=====` separator) — unless the
   entry is empty of prior sections,
2. a **numbered section heading** node (e.g. "3. Vitals"), and
3. a **table node** seeded from the popup values (Office-style grid).
After insertion every cell is editable in place (tab between cells, add/remove
rows via the table controls). The popup only *seeds the first row*; it is a
fast-entry convenience, not a lock. "Update ..." on a follow-up behaves
identically but inserts under the NEW dated entry.

### 7. Family history = two-column table; Vitals = BP sys/dia + BMI (RETAINS ADR 0018 #3/#4 intent)

- **Family history** popup has **Maternal** and **Paternal** tabs; on confirm it
  inserts a two-column table with a header row `Maternal | Paternal` and the
  entered text as the body row(s).
- **Vitals** popup collects systolic + diastolic as TWO fields, pulse, weight,
  height (BMI computed live), temp, SpO2, and inserts the vitals table with
  `BP (sys)` and `BP (dia)` as separate cells (never a single `120/80` string).

### 8. Numbering (see S08 + v3 spec)

Every inserted section gets a **document-scoped sequential number** carried on
the heading node's attributes and rendered as the heading prefix, so the
chronological insertion order is fixed and visible. Specified in S08 §Numbering
and the v3 handoff.

### 9. Versioned, backend-opaque document with an extractable text projection (RETAINS ADR 0018 #7, bumps to v3)

The editor's **ProseMirror JSON document** is serialised into the opaque
`visit.data_json` as `schema: "case-rich"`, `version: 3`, with the ProseMirror
doc under a `doc` key AND a derived **plain-text mirror** under a `text` key so
`visit_fts` keeps finding case text with no trigger change (the FTS trigger
indexes `COALESCE(data_json,'')` verbatim, and the mirror puts the doctor's
words as a top-level JSON string). Full shape, the v2->v3 and legacy-R3 upcast,
and the text-extraction rule are in
`.worklog/HC-MVP1-M3/handoffs/M3-RWv2-serialization-v3.md`. Storage stays opaque
(ADR 0007); autosave stays one `UPDATE visit`, one audit row (R-DATA-001).

### 10. Follow-up copy-forward (RECONCILES the B7 fix)

In v3 **everything lives in the document**, so follow-up seeds by **copying the
prior complaint's whole ProseMirror document forward and appending a new dated
entry** — prior prose, prior numbered sections (including family history) and
prior separators all persist because they are part of the copied `doc`. The
backend `seed_followup_data_json` (B7 fix) is **reconciled**: it still carries
the prior `data_json` forward, but for a v3 document it copies the opaque `doc`
wholesale and appends a dated-header node; the separate top-level `sections`
object is **retired as the primary store** (its data now lives in the document
as tables) and kept only transitionally as a read source during upcast. See
§Follow-up in the v3 handoff for the exact backend reconciliation.

### 11. Preserved behaviours

- **Autosave (2 s + on-blur) + explicit Save + kill-restore** (CASE-005):
  unchanged. Autosave serialises the whole v3 document (doc JSON + text mirror)
  through `case_visit_autosave` as the opaque `data_json`; Save force-flushes;
  killing mid-type restores the last autosaved document on reopen.
- **Fixed zoom**: now scales the **document root** (a CSS transform/`rem` scale
  on the editor container), so the WYSIWYG page zooms as a unit.
- **Adaptive full-width layout**: the editor uses the full content width.
- **Rx table**: `Add/Update prescription` still inserts a PLACEHOLDER table
  marked `rx_placeholder` (R4 boundary; no Rx row, no print).
- **PAT-009 lab uploads**: the file attach/list/open/remove uploader stays a
  **side control** (it manages real `attachment` rows keyed by `visit_id`, not
  editor content). "Record investigations" inserts an investigations *table*
  into the document for the doctor's notes; the uploader remains adjacent. See
  S08 for the exact placement.

## Alternatives considered

1. **Lexical (Meta, MIT).** Modern, React-first, eval-free, bundles offline,
   good CSP story. REJECTED as the pick because its table support is the
   weakest of the three for our need: the official `@lexical/table` is newer and
   historically rougher around programmatic insertion, cell editing edge cases,
   tab navigation and add/remove-row ergonomics than `prosemirror-tables`. For a
   clinical "Office-style editable grid" that is the central feature, we want the
   most battle-tested table. Lexical is the **closest viable fallback** if TipTap
   is ever disqualified.
2. **Slate (MIT).** Fully controlled React model, eval-free, offline-friendly.
   REJECTED: Slate deliberately ships **no built-in tables** — tables are a
   DIY/plugin concern, and robust editable tables (tab, add/remove rows, nested
   editing) are notoriously hard to get right on Slate. Highest implementation
   risk for exactly our must-have feature.
3. **A commercial/"all-in-one" editor (CKEditor 5, TinyMCE, Froala).** REJECTED:
   licensing (GPL-or-paid for CKEditor 5; paid/commercial for TinyMCE
   self-host-with-strings and Froala) fails constraint 3, and several ship
   cloud/telemetry or CDN-default assets that fight the offline + CSP bar.
4. **Keep the hand-rolled block list (ADR 0018 mechanism).** REJECTED by the
   product owner: it is not a true WYSIWYG — separate textareas/grids, no
   in-flow prose around tables, no real caret/selection across the whole case,
   and growing it into tab-between-cells + in-flow insertion + numbering +
   separators is effectively re-writing an editor by hand.
5. **HTML `contenteditable` directly (no library).** REJECTED: the ADR 0018 #2
   reasoning stands — raw `contenteditable` is a well-known source of
   inconsistent editing behaviour and serialisation/injection hazards; a schema
   editor (ProseMirror) is explicit, testable and safe.

## Consequences

- **No library fully "wins" for free, but TipTap/ProseMirror clears every bar**
  (offline, strict CSP with no `script-src` relaxation, MIT, React 18, real
  editable tables + programmatic table/hr insertion, acceptable bundle). The
  one real cost is adopting a non-trivial dependency; it is justified because a
  true WYSIWYG with real tables is the product's explicit requirement.
- **Storage/data layer unchanged.** `visit.data_json` stays opaque `TEXT`;
  autosave stays one `UPDATE visit` + one audit row; the `visit_fts` trigger is
  untouched because the v3 payload carries a top-level `text` mirror of the
  document (see §9 and the v3 handoff). This is why the v3 bump is cheap.
- **FTS search quality improves slightly**: instead of relying on prose being
  scattered as JSON string values among ProseMirror structural keys, v3 stores a
  clean top-level `text` projection, so "migraine" matches the doctor's words
  with less structural noise.
- **The UI owns (de)serialisation + upcast + text extraction** in
  `apps/desktop/src/case` (pure, unit-testable functions), mirroring ADR 0018
  #8. Legacy R3 and v2-journal documents are upcast in memory on open; disk is
  untouched until the first autosave rewrites v3.
- **`sections` top-level object is retired as a primary store** (its data is now
  in-document tables). Kept transitionally as an upcast read source and as a
  back-compat field the backend copies forward verbatim; a later slice may
  delete it once no stored document carries it.
- **B7 fix reconciled, not reverted**: follow-up still never drops prior data;
  it now copies the whole prior document forward (prose + tables + separators),
  which is strictly more faithful than carrying a separate `sections` blob.
- **CASE-004 custom template editor (R9)** now edits even less structure — the
  case body is a free document and the side sections are record-button popups;
  recorded here so the R9 slice is scoped correctly.
- **`case_summary_render` (CASE-009)** stays deprecated/unused this slice; the
  journal document is the summary, printed via S14/R4 by rendering the v3 `doc`.
- **Keyboard-first (R-UI-004) is strengthened**: ProseMirror gives native caret
  navigation and Tab/Shift-Tab between table cells out of the box.

## Follow-up / open items for later slices

- Confirm the exact pinned patch of the `2.x` TipTap line at install time and
  record it in the slice-plan handoff + `package-lock.json`.
- Measure the real gzip bundle delta in the integration slice and record it; if
  over budget, switch from `starter-kit` to individually-imported base nodes.
- R4 (S13/S14): read v3 `doc` prescription tables (`rx_placeholder`) to seed the
  real Rx engine, and render the v3 `doc` to the printable case record.

---

## Increment M3-RWv3 — complaint-section restructure (2026-10-23)

Status: Accepted (increment on this ADR, branch `HC-MVP1-M3a-case-visits`).
Detail handoff: `.worklog/HC-MVP1-M3/handoffs/M3-RWv3-complaint-sections.md`.
This note records the decision; the handoff is the full spec.

This increment generalises §5 ("ONE editor per complaint"): the single editor
document now holds **multiple complaint SECTIONS, chronologically**, instead of
the UI rendering only `complaints[0]`. It does NOT change the storage contract,
the library, the CSP, or the record-section popups.

- **Serialization: EXTEND v3, no v4 bump.** The payload stays
  `schema:"case-rich", version:3`. The change is additive inside the opaque
  `ProseMirrorDoc`: a new heading kind `hcKind:"complaint"` (a NUMBERED
  complaint-section header carrying `hcComplaintNo` + `hcComplaintId` + the
  name) and a new `heading.attrs.hcEntryKind` (`"first" | "follow_up"`, missing ⇒
  `"first"`), plus a denormalised `hcComplaintName` on entry headings. Every
  existing v3 document is already a valid RWv3 document (single complaint ⇒
  complaint section #1; legacy entries ⇒ `hcEntryKind:"first"`,
  `hcComplaintName = title`). A version bump is reserved for a breaking change;
  this is forward/backward tolerant. (If a discriminator is ever wanted, add an
  additive `"rwv3":true` flag, never a version bump.)

- **Complaint SECTION** = a numbered header (`"<n>. <name>"`) created by typing a
  name in the complaint-name field and pressing **Add new complaint**. Under it
  sit dated ENTRIES. The complaint number is the 1-based position in document
  order (complaints renumber on add/remove); record-SECTION numbers keep the
  existing stable, never-reused rule (§8). **Entries carry no visible number** —
  they are identified by their name-based header + date.

- **Entry headers.** The FIRST entry under a complaint is headed `"<name> — <date>"`;
  a FOLLOW-UP entry is headed `"<name>-follow-up — <date>"`. The `-follow-up`
  suffix is a **localisable literal** (en.json `case.form.entry.followupSuffix`),
  NOT hardcoded English; the header text is derived from attrs at render time and
  cannot drift (same discipline as section headings).

- **Three toolbar buttons replace the single "Add entry":** *Add new entry*
  (new dated `first` entry under the current complaint), *Add follow-up entry*
  (a `<name>-follow-up` dated entry under the current complaint — the in-editor
  per-complaint follow-up), *Add new complaint* (reads the name field → new
  numbered complaint section + its first dated entry). Record-section buttons
  (vitals/family/etc.) are unchanged and still insert a numbered, hr-separated,
  bordered editable table into the CURRENT entry; family stays Maternal|Paternal
  two-column.

- **Follow-up reconciliation.** The dashboard visit-level follow-up (S09) is
  unchanged: `seed_followup_data_json` still copies the prior document forward
  and the UI reopens the multi-complaint record. It does not conflict with the
  in-editor per-complaint "Add follow-up entry" — the former chooses the initial
  document for a new visit, the latter appends an entry within the open document.
  Both produce identically-shaped `hcEntryKind:"follow_up"` entries.

- **FTS mirror** (`text`, §9) is extended to include every complaint-header text,
  every entry-header text (including the `-follow-up` suffix) and every cell, so
  all names/headers/cells stay searchable with no trigger change. Autosave
  (2 s + blur) + explicit Save + kill-restore, app-level zoom, visible table
  borders and full-width layout are all preserved. The orphaned
  `case.form.zoomIn/zoomOut` en.json keys (editor no longer has its own zoom) are
  pruned.
