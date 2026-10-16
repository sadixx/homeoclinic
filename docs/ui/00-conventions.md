# UI Conventions (all MVP1 screens)

Every screen spec in `docs/ui/` follows this file. If a screen spec and this
file disagree, the screen spec wins for that screen only.

## 1. Target environment

- Reference PC: Intel i3 7th gen, 4 GB RAM, HDD, Windows 10 (NFR section 1).
- Minimum window: 1280 x 720. Design at 1366 x 768 (most common clinic
  laptop). Must stay usable at 1280 x 720 with font size "Large".
- Font sizes (SET-005): Normal 14 px base, Large 16 px, Extra large 18 px.
  All layouts use rem so the setting scales everything.
- Fonts: system UI font plus a bundled Devanagari-capable font (Noto Sans
  Devanagari) so Hindi/Marathi names and advice render offline.

## 2. App shell

```
+----------------------------------------------------------------------------------+
| [Logo] HomeoClinic  [ Search patients... (F2) ...........................]  [?] [L]|  <- top bar 48px
+-----------+----------------------------------------------------------------------+
| Today  F3 |                                                                      |
| Patients  |                         content area                                 |
| Repertory |                                                                      |
|   F6      |                                                                      |
| Mat.Med.  |                                                                      |
| Billing   |                                                                      |
| Reports   |                                                                      |
| Backup    |                                                                      |
| Settings  |                                                                      |
|           |                                                                      |
| [Trial: 9 |                                                                      |
|  days]    |                                                                      |
+-----------+----------------------------------------------------------------------+
| status bar: Saved 10:42 | Last backup: today 09:10 | Licence: Active till 31 Mar   |  <- 24px
+----------------------------------------------------------------------------------+
```

- Left nav 180 px, collapsible to icons (Ctrl+B). Active item highlighted.
- `[?]` opens Help (F1). `[L]` locks the app immediately (Ctrl+L).
- The trial / renew badge in the nav is the ONLY licence UI shown during
  normal work (SUX-003). Clicking it opens the Licence screen.
- Status bar: autosave state, last backup, licence state; warning colour if
  last backup > 7 days (BAK-004).

## 3. Global keyboard shortcuts (ADM-003)

| Key | Action |
|---|---|
| F1 | Help |
| F2 or Ctrl+K | Focus global search |
| F3 | Today |
| F4 | New patient |
| F5 | New visit for the open patient |
| F6 | Repertory (for the open patient's current visit if any) |
| F7 | Prescribe (current visit) |
| F8 | Bill (current visit) |
| Ctrl+P | Print preview of the current document |
| Ctrl+S | Force save now (autosave still runs) |
| Ctrl+L | Lock |
| Esc | Close dialog / overlay; never discards data silently |
| Alt+Left | Back |

Shortcuts never fire while an IME composition is active.

## 4. Common patterns

- Autosave (CASE-005): forms with clinical data save 2 s after the last
  change and on blur. Status bar shows "Saving..." then "Saved hh:mm". No
  Save button on clinical forms; admin forms (settings) have Save/Cancel.
- Required fields: label suffix `*`; validation on blur and on submit;
  inline message under the field, never only a toast.
- Dates: `DD-MM-YYYY` display, date picker plus typed entry; ages show as
  `34 y` or `2 y 3 m` for children.
- Money: integer paise internally; displayed `Rs 1,25,000.00` (Indian
  grouping). Inputs accept `1250` or `1,250.50`.
- Mobile: stored digits only, shown `98765 43210`.
- Lists: virtualised; 20 rows first, more on scroll; keyboard Up/Down,
  Enter opens, Home/End jump.
- Empty states: one sentence plus the primary action button.
- Loading: skeleton rows after 150 ms; never a blocking spinner over a form.
- Errors: plain language plus what to do, with a "Details" expander for
  support codes. Never show stack traces, SQL or file paths.
- Destructive actions: confirm dialog naming the object ("Move Ramesh Kumar
  (HC-000123) to recycle bin?"); permanent deletes ask for the PIN.
- Toasts: bottom-right, 4 s, for confirmations only ("Bill saved").
- Read-only mode (LIC-020): create/edit buttons disabled with a tooltip
  "Licence expired - renew to add new visits"; viewing, search, print and
  export stay enabled. An open visit can always be finished (SUX-008).

## 5. Accessibility

- Every input has a visible label; icons have aria-labels.
- Visible focus ring; logical tab order; no keyboard traps.
- Contrast AA. Never colour alone: status chips have text.
- Clinical grades in repertory use number + style (bold/italic), not only
  colour.

## 6. Test hooks

- Every interactive element and every asserted value has
  `data-testid="<screen>-<element>"`, e.g. `patient-form-name`,
  `today-overdue-row`, `rx-add-remedy`.
- Screen ids are listed in each spec's header and used as the prefix.

## 7. Wireframe notation in specs

ASCII boxes, approximate proportions, 1366 px wide content area unless
noted. `[Button]`, `( ) radio`, `[x] checkbox`, `[____]` text input,
`[v]` dropdown, `{...}` dynamic content, `<F5>` shortcut hint.

## 8. Spec template (every screen file)

```
# S<NN> <Screen name>
Screen id: <id>   Route: /<path>   Module: apps/desktop/src/<folder>
Requirements: <REQ-IDs>   Milestone: M<n>

## Purpose
## Entry points
## Layout (wireframe)
## Fields and controls (table: element | type | rules | testid)
## Behaviour
## States (empty, loading, error, read-only, trial)
## Keyboard
## Commands used (Tauri commands this screen calls, proposed names)
## Acceptance checks
## Open questions
```
