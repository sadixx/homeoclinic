# S13 Prescription
Screen id: rx   Route: /visit/:visitId/prescription   Module: apps/desktop/src/prescription
Requirements: RX-001, RX-002, RX-003, RX-004, RX-005, RX-006, RX-007, RX-008   Milestone: M7  Release: R4

## Purpose

Build the prescription for a visit: one or more remedies with potency, form,
dose, frequency, duration and instructions, plus advice and diet. It is fully
usable the moment consultations ship (R4) without any repertory; the repertory
links in later releases.

## Entry points

- Follow-up (S09) or case form (S08) Prescribe button.
- Global shortcut F7 (prescribe for the current visit).
- From R7: "Prescribe this remedy" on a repertorisation result (S11), which
  opens this screen pre-filled (REP-037).

## Layout (wireframe)

```
+--------------------------------------------------------------------------------------------------------+
| Rx  Ramesh Kumar  HC-000123   Visit: Follow-up 16-10-2026        {Saved 10:58}      [Repeat last (Ctrl+R)] |
+--------------------------------------------------------------------------------------------------------+
| Remedies                                                                        [+ Add remedy] [Template v]|
| +----------------------------------------------------------------------------------------------------+   |
| | # | Remedy             | Potency | Form     | Dose   | Frequency | Duration | Instructions | [x]   |   |
| | 1 | [Sulphur_______ v] | [200C v]| [Globules v]|[4 pills]|[OD    v] |[7 days] |[Empty stomach]| [x]  |   |
| |   | {! inimical to prev remedy (R6)}                                                            |   |
| | 2 | [Sac lac (SL)___ v]| [--  v] | [Globules v]|[4 pills]|[TDS   v] |[7 days] |[            ] | [x]  |   |
| |   | [x] Hide true remedy name on printed Rx                                                     |   |
| +----------------------------------------------------------------------------------------------------+   |
|                                                                                                          |
| Advice / diet:  [x] Avoid coffee  [x] Avoid camphor  [ ] Avoid mint   [+ From advice library (R9)]        |
|                 [Free advice text ________________________________________________________________]      |
|                                                                                                          |
| Next visit: 16-11-2026 (from S09)                        [ Print preview (Ctrl+P) ]  [ Share WhatsApp ]   |
+--------------------------------------------------------------------------------------------------------+
```

## Fields and controls (element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Add remedy | button | appends a remedy row (RX-001) | rx-add-remedy |
| Remedy name | combo (autocomplete) | free text at R4; autocomplete from remedy master at R6 (RX-001); stores remedy_label always, remedy_id when matched | rx-remedy-<n> |
| Potency | combo | 3X..CM, LM/Q 0/1..0/30, Q (RX-001) | rx-potency-<n> |
| Form | dropdown | globules/pills/liquid/tablets/mother tincture/biochemic/ointment (RX-001) | rx-form-<n> |
| Dose | text input | e.g. "4 pills" (RX-001) | rx-dose-<n> |
| Frequency | combo | OD/BD/TDS/QID/SOS/weekly/single/custom (RX-001) | rx-frequency-<n> |
| Duration | text input | e.g. "7 days" (RX-001) | rx-duration-<n> |
| Instructions | text input | free text (RX-001) | rx-instructions-<n> |
| Remove remedy row | button | undo via toast (NFR-035) | rx-remove-remedy-<n> |
| Placebo/SL entry | remedy row preset | Sac lac / Phytum / Placebo (RX-002) | rx-placebo-<n> |
| Hide true remedy name | checkbox | hides name on print only; real remedy stored (RX-002) | rx-hide-name-<n> |
| Template | dropdown [v] | insert favourites / saved Rx template (RX-003) | rx-template |
| Repeat last | button | copies previous prescription items (RX-004) | rx-repeat-last |
| Advice multi-select | checkboxes | from advice library (RX-007, R9) | rx-advice-<key> |
| Free advice text | long text | free text advice/diet (RX-005 advice content) | rx-advice-text |
| Inimical warning | inline chip | shown when remedy inimical to previous Rx (RX-008, R6) | rx-inimical-<n> |
| Print preview | button | opens S14 for this Rx (RX-005) | rx-print |
| Share WhatsApp | button | opens S14 share path / wa.me link (RX-006) | rx-share-whatsapp |

## Behaviour

- Add remedy appends a row; all RX-001 attributes are editable per row.
- Placebo/SL rows can hide the true remedy name on the printed Rx while the
  real remedy is always stored (RX-002).
- Template inserts a saved favourite/kit in one click (RX-003); Repeat last
  copies the previous visit's items (RX-004).
- Autosave follows the clinical-form pattern (2 s + blur); the real remedy is
  persisted regardless of the hide-name flag (RX-002).
- Print preview (Ctrl+P) opens S14; Share WhatsApp opens the S14 share path
  (RX-006).
- Inimical warning: when a remedy is inimical to a remedy in the previous
  prescription, an inline chip appears (RX-008). This needs the remedy
  relationships table (MM-005), available from R6.

## Release slices

- R4 (M7, first usable): full manual prescription - add remedies, potency,
  form, dose, frequency, duration, instructions (RX-001), placebo with hidden
  name (RX-002), favourites/templates (RX-003), repeat last (RX-004), free
  advice/diet text, print preview and PDF via S14 (RX-005), WhatsApp share
  (RX-006). The remedy field is plain free text (remedy master not built until
  M4/R6); acceptance flow 6 runs here.
- R6 (M4+M5): remedy-name autocomplete backs the remedy field from the remedy
  master (RX-001), and the inimical warning (RX-008) activates once the remedy
  relationships data (MM-005) is present. Before R6 the autocomplete is a
  plain text box and the inimical chip is behind a compile-time feature flag
  and never shown.
- R7 (M6): the "Prescribe this remedy" entry from a repertorisation result
  pre-fills this screen (REP-037). Before R7 there is no such entry point.
- R9 (M10): the editable advice library multi-select (RX-007, P1) appears;
  until then only the free advice text is available.

## States

- Empty: no remedy rows; one-line hint "Add the first remedy" with the Add
  remedy button; Repeat last offered if a previous prescription exists.
- Loading: skeleton table rows after 150 ms.
- Error: autosave failure shows the inline status-bar warning and retries; no
  loss; plain-language message, no stack traces (NFR-033).
- Read-only (LIC-020): a prescription on an open visit can always be finished
  and printed (SUX-008); starting a prescription on a new visit is disabled
  with the renew tooltip. Viewing and printing an existing Rx stay enabled.
- Trial: unchanged on screen; the "Trial" mark is applied at print time in
  S14, not here.

## Keyboard

- F7 prescribe, Ctrl+R repeat last, Ctrl+P print preview, Ctrl+S force save,
  Esc close dialog, Alt+Left back (00-conventions section 3).

## Commands used (proposed Tauri command names)

- `prescription_get_or_create` req { visit_id } resp { prescription_id, items: [{ remedy_id, remedy_label, potency, form, dose, frequency, duration, instructions, is_placebo }], advice_text, diet_json, hide_remedy_names }
- `prescription_autosave` req { prescription_id, items, advice_text, diet_json } resp { saved_at }
- `remedy_autocomplete` req { query, limit } resp { matches: [{ remedy_id, abbrev, name }] }  (R6 only; RX-001)
- `rx_template_list` req {} resp { templates: [{ id, name }] }  (RX-003)
- `rx_template_insert` req { prescription_id, template_id } resp { items }  (RX-003)
- `prescription_repeat_last` req { visit_id } resp { items }  (RX-004)
- `remedy_relationship_check` req { remedy_ids, prev_remedy_ids } resp { inimical: [remedy_id] }  (R6 only; RX-008 / MM-005)
- `prescription_prefill_from_analysis` req { visit_id, analysis_id, remedy_id } resp { prescription_id, items }  (R7 only; REP-037)
- `advice_library_list` req {} resp { items: [{ key, text }] }  (R9 only; RX-007)

## Acceptance checks

- Add two remedies plus a placebo with the true name hidden on print; the
  stored prescription keeps the real remedy (RX-002; acceptance flow 6).
- Potency/form/frequency pick lists offer the RX-001 values and accept custom
  frequency.
- Repeat last copies the previous visit's prescription (RX-004).
- Insert a saved Rx template in one click (RX-003).
- Print preview opens A5 within 1 s (NFR-005, verified in S14) and WhatsApp
  share opens the wa.me link (RX-006).
- R6 build: typing "sulph" autocompletes to Sulphur (RX-001); prescribing a
  remedy inimical to the previous Rx shows the warning chip (RX-008). Pre-R6:
  free text only, no chip.
- R7 build: "Prescribe this remedy" from analysis opens this screen pre-filled
  (REP-037).

## Open questions

- RX-OQ-1: Default potency/form/frequency when a row is added - leave blank or
  default to the doctor's last-used values? RX-001 does not specify defaults.
- RX-OQ-2: RX-008 warns on inimical to "the previous remedy"; is that the
  single last prescription, or any remedy in a configurable look-back window?
- RX-OQ-3: Q3 (docs/design/06-review-questions.md) proposes Marathi advice/diet
  print in MVP1. Is the advice captured bilingually here, or entered in English
  and translated only at print time in S14?
- RX-OQ-4: Should the hide-name flag be per remedy row (as drawn) or a single
  prescription-level toggle? RX-002 allows hiding the true name but does not
  fix the granularity.
