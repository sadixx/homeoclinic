# S08 First (detailed) case form
Screen id: case-form   Route: /patient/:patientId/case/:visitId   Module: apps/desktop/src/case
Requirements: CASE-001, CASE-002, CASE-003, CASE-004, CASE-005, CASE-006, CASE-007, CASE-008, CASE-009, VIS-001   Milestone: M3  Release: R3

## Purpose

The structured first-consultation case sheet. It must feel like writing the
paper case record but save every field automatically and feed the repertory
later. This is the detailed (first-visit) form; routine follow-ups use S09.

## Entry points

- Patient dashboard (S05) quick button "New visit" when the patient has no
  open first case, or "Take case".
- Global shortcut F5 (new visit for the open patient) when the visit type
  resolves to First.
- Deep link from Today (S03) when a first visit is started.

## Layout (wireframe)

Content area, 1366 px. Left: collapsible section rail. Centre: the active
section's fields. Autosave status lives in the app-shell status bar.

```
+--------------------------------------------------------------------------------------------------------+
| Ramesh Kumar  HC-000123   34 y / M   Mob 98765 43210        Visit: First  16-10-2026 10:42  {Saved 10:42}|
+------------------------+-------------------------------------------------------------------------------+
| SECTIONS               |  Chief complaints                                       [+ Add complaint]      |
| > Chief complaints (2) |  +-----------------------------------------------------------------------+     |
|   History of illness   |  | Complaint 1                                              [v] [x remove] |     |
|   Past history         |  | Complaint*  [Headache________________]                                 |     |
|   Family history       |  | Location    [Right temple_________]  Sensation [Throbbing_________]    |     |
|   Personal history     |  | Agg (<)     [Sun, 11am-3pm________]  Amel (>) [Pressure, dark room_]   |     |
|   Physical generals    |  | Concomitant [Nausea_______________]  Duration [3 years] Onset [Gradual]|     |
|   Mental generals      |  |                                            {[>> Send to repertory]}    |     |
|   Menstrual/obstetric  |  +-----------------------------------------------------------------------+     |
|   Child development    |  +-----------------------------------------------------------------------+     |
|   Examination/vitals   |  | Complaint 2 ...                                          [v] [x remove] |     |
|   Investigations       |  +-----------------------------------------------------------------------+     |
|   Provisional diagnosis|                                                                               |
|   Doctor's analysis    |  {Symptom -> rubric suggestions appear here under the active line (R7)}        |
|                        |                                                                               |
| [ Hide sections... ]   |  [ Case summary (Ctrl+P) ]                                                     |
+------------------------+-------------------------------------------------------------------------------+
```

Examination/vitals section:

```
| BP [120]/[80] mmHg   Pulse [72] /min   Wt [68.0] kg   Ht [172] cm   BMI {22.9}   Temp [98.6] F   SpO2 [98] % |
```

## Fields and controls (element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Section rail item | button | shows per-section filled count; collapsible (CASE-002) | case-form-section-<key> |
| Hide sections | button -> dialog | per-doctor template; toggles section visibility (CASE-002) | case-form-hide-sections |
| Template picker | dropdown [v] | Chronic detailed / Acute quick / Child; default from case_template (CASE-004) | case-form-template |
| Add complaint | button | appends a chief-complaint block (CASE-001) | case-form-add-complaint |
| Complaint text | text input | required per block; validate on blur (CASE-001) | case-form-complaint-<n> |
| Location / Sensation | text input | free text (CASE-001) | case-form-location-<n>, case-form-sensation-<n> |
| Aggravation / Amelioration | text input | modalities (CASE-001) | case-form-agg-<n>, case-form-amel-<n> |
| Concomitant / Duration / Onset | text input | free text (CASE-001) | case-form-concomitant-<n> etc |
| Remove complaint | button | confirm if block has data (undo via toast, NFR-035) | case-form-remove-complaint-<n> |
| Thermal / Thirst / etc pick list | combo (pick + free) | pick lists with free text allowed (CASE-003) | case-form-generals-<key> |
| Vitals (BP, pulse, wt, ht, temp, SpO2) | number inputs | numeric; BMI auto from wt/ht (CASE-001) | case-form-vital-<key> |
| BMI | read-only field | computed wt/(ht^2) (CASE-001) | case-form-bmi |
| Menstrual/obstetric section | section | shown when sex = female (CASE-001) | case-form-section-menstrual |
| Child development section | section | shown when age < 14 (CASE-001) | case-form-section-child |
| Provisional diagnosis | long text | free text; ICD-10 search is P2, not in R3 (CASE-001) | case-form-diagnosis |
| Doctor's analysis/notes | long text | free text (CASE-001) | case-form-analysis |
| Send to repertory | button on selection/line | hidden until R7 (CASE-006); see Release slices | case-form-send-to-repertory |
| Voice dictation | OS input affordance | uses OS speech; no custom engine (CASE-007, P1) | case-form-dictate-<field> |
| Body diagram | canvas annotation | front/back lesion marks (CASE-008, P1) | case-form-body-diagram |
| Case summary | button | opens read-only printable summary (CASE-009) | case-form-case-summary |

## Behaviour

- On open, the service returns an existing open visit for the patient or
  creates one of type First (VIS-001); the default template's sections render
  in template order (CASE-004).
- Every section is optional and collapsible; a doctor can hide sections they
  never use and the choice persists as their template (CASE-002).
- Pick lists offer common values but always accept free text (CASE-003).
- Autosave: 2 s after the last change and on blur; the status bar shows
  "Saving..." then "Saved hh:mm". There is no Save button on this clinical
  form (CASE-005).
- Killing the app mid-typing and reopening restores the last autosaved state
  with nothing lost (CASE-005; acceptance flow 3).
- BMI recomputes live when weight or height changes (CASE-001).
- Case summary opens a read-only view (CASE-009); printing it is done through
  S14 print preview.

## Release slices

- R3 (M3, first usable): full case form, all CASE-001 sections, collapsible
  and hideable sections (CASE-002), pick lists with free text (CASE-003), the
  three shipped templates (CASE-004), autosave (CASE-005), and the read-only
  case summary view (CASE-009). Acceptance flow 3 runs here.
- R4 (M7): the case summary becomes printable through S14 (CASE-009 + RX-005
  print path).
- R7 (M6): "Send to repertory" (CASE-006) and the inline symptom-to-rubric
  suggestions become visible and active. Before R7 the control is behind a
  compile-time feature flag and is not rendered (no dead-end button, per ADR
  0002); the `{...}` suggestion strip is absent.
- R9 (M10): P1 touches land - voice dictation (CASE-007), body diagram
  (CASE-008), and the custom template editor (CASE-004 editing beyond the
  three shipped templates). Until then template editing is not exposed.

## States

- Empty: new visit with the default template; first chief-complaint block
  shown ready to type; one-line hint "Start with the chief complaint".
- Loading: skeleton section rail + skeleton fields after 150 ms; never a
  blocking spinner over the form.
- Error: autosave failure shows an inline status-bar warning "Not saved -
  retrying" with a Details expander for a support code; data is kept in memory
  and retried; no stack traces (NFR-033).
- Read-only (LIC-020): when an open visit already exists it can always be
  finished (SUX-008); starting a brand new first case is disabled with the
  tooltip "Licence expired - renew to add new visits". Viewing and case
  summary stay enabled.
- Trial: no change to this screen; the trial badge stays in the nav only
  (SUX-003).

## Keyboard

- F5 new visit, Ctrl+S force save (autosave still runs), Ctrl+P case summary
  print preview, Esc closes a dialog without discarding data, Alt+Left back
  (00-conventions section 3). Shortcuts never fire during IME composition.

## Commands used (proposed Tauri command names)

- `case_visit_open_or_create` req { patient_id, visit_type } resp { visit_id, template_id, data_json, vitals_json, visit_at }
- `case_template_get_default` req {} resp { template_id, name, schema_json }
- `case_template_list` req {} resp { templates: [{ id, name, is_default }] }
- `case_visit_autosave` req { visit_id, data_json, vitals_json } resp { saved_at }
- `case_summary_render` req { visit_id } resp { html }
- `rubric_search_prefill` req { visit_id, source_text } resp { opened: bool }  (R7 only; CASE-006 / REP-030)

## Acceptance checks

- Default template opens and all CASE-001 sections render in template order
  (CASE-001, CASE-004).
- Sections collapse, hide and persist per doctor (CASE-002).
- A pick-list field accepts a value not in the list (CASE-003).
- Typing then killing the process restores the last autosaved content on
  reopen with no loss (CASE-005; acceptance flow 3).
- Autosave fires within 2 s of the last keystroke and on blur; status bar
  shows Saved hh:mm (CASE-005).
- Menstrual section appears only for female patients; child development only
  for age < 14 (CASE-001).
- BMI updates when weight/height change (CASE-001).
- Case summary opens read-only (CASE-009).
- R7 build: "Send to repertory" opens rubric search pre-filled with the
  selected symptom text (CASE-006). Pre-R7 build: the control is not present.

## Open questions

- CASE-OQ-1: Default autosave debounce is 2 s (CASE-005); is a shorter debounce
  wanted on the long-text analysis field to reduce loss on a crash?
- CASE-OQ-2: Which fields belong to each of the three shipped templates
  (Chronic detailed, Acute quick, Child)? CASE-004 names them but the field
  sets are not specified in the requirements.
- CASE-OQ-3: Q3 (docs/design/06-review-questions.md) proposes Marathi advice
  and diet sheets in MVP1. The case form itself is English-only; does any case
  field need Marathi entry, or is Marathi limited to the printed advice in S14?
