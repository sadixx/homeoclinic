# S09 Follow-up visit
Screen id: followup   Route: /patient/:patientId/visit/:visitId/followup   Module: apps/desktop/src/visit
Requirements: VIS-001, VIS-002, VIS-003, VIS-004, VIS-007   Milestone: M3  Release: R3

## Purpose

The routine return consultation. It pre-loads the previous visit's complaints,
records how each has changed, captures the remedy response and sets the next
follow-up date, with far less typing than the first case (S08).

## Entry points

- Patient dashboard (S05) quick button "New visit" when a prior visit exists.
- Today (S03): clicking a patient whose follow-up is due or overdue.
- Global shortcut F5 for the open patient when the resolved type is Follow-up.

## Layout (wireframe)

```
+--------------------------------------------------------------------------------------------------------+
| Ramesh Kumar  HC-000123   34 y / M      Visit: Follow-up  16-10-2026   Prev: 02-10-2026   {Saved 10:51} |
+--------------------------------------------------------------------------------------------------------+
| Type: ( ) First  (o) Follow-up  ( ) Acute  ( ) Tele                                                     |
|                                                                                                         |
| Complaints since last visit (pre-loaded)                                                                |
| +-----------------------------------------------------------------------------------------------------+ |
| | Headache (right temple)   Status [o Better] [ Same] [ Worse] [ New] [ Resolved]   Improve [|||||  ]65%| |
| |                           Note [Fewer episodes, milder_________________________________________]    | |
| +-----------------------------------------------------------------------------------------------------+ |
| | Acidity                   Status [ Better] [o Same] [ Worse] [ New] [ Resolved]   Improve [||      ]20%| |
| +-----------------------------------------------------------------------------------------------------+ |
| [+ Add new complaint]                                                                                   |
|                                                                                                         |
| Remedy response:  (o) Amelioration ( ) Agg then amel ( ) No change ( ) Aggravation ( ) New symptoms     |
|                   ( ) Old symptoms returned                                                             |
|                                                                                                         |
| Observations [__________________________________]   Vitals  BP [__]/[__]  Pulse [__]  Wt [__] kg        |
|                                                                                                         |
| Next follow-up:  [7d] [15d] [1m] [2m] [Custom: 16-11-2026 ]        {Progress chart (R9)}  [Prescribe F7] |
+--------------------------------------------------------------------------------------------------------+
```

## Fields and controls (element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Visit type | radio group | First / Follow-up / Acute / Tele (VIS-001) | followup-type |
| Pre-loaded complaint row | repeated block | loaded from previous visit (VIS-002) | followup-complaint-<n> |
| Complaint status | segmented control | Better / Same / Worse / New / Resolved (VIS-002) | followup-status-<n> |
| Improvement % | slider 0-100 | per complaint (VIS-002) | followup-improve-<n> |
| Complaint note | text input | free text per complaint (VIS-002) | followup-note-<n> |
| Add new complaint | button | adds a complaint not present last visit (VIS-002) | followup-add-complaint |
| Remedy response | radio group | six Hering-aware options (VIS-003) | followup-remedy-response |
| Observations | text input | free text (VIS-001) | followup-observations |
| Vitals | number inputs | BP/pulse/weight etc (VIS-001) | followup-vital-<key> |
| Next follow-up quick buttons | buttons | 7d, 15d, 1m, 2m (VIS-004) | followup-next-7d etc |
| Next follow-up custom | date input | DD-MM-YYYY, typed or picker (VIS-004) | followup-next-custom |
| Progress chart | chart panel | improvement % over time + vitals (VIS-007, P1) | followup-progress-chart |
| Prescribe | button | opens S13 for this visit (F7) | followup-prescribe |

## Behaviour

- On create, the service pre-loads the previous visit's complaints, each with
  an unset status for the doctor to mark (VIS-002).
- Improvement % defaults to 0 and is editable per complaint (VIS-002).
- The six remedy-response options use Hering's-law-aware wording (VIS-003).
- Next follow-up quick buttons compute the date from today; Custom accepts a
  typed or picked date (VIS-004). Setting it schedules the patient onto Today
  for that date (feeds VIS-005 on S03).
- Autosave follows the clinical-form pattern: 2 s after change and on blur,
  no Save button (CASE-005 applies to clinical forms generally; status shown
  in the shell status bar).
- Prescribe (F7) opens S13 for the current visit.

## Release slices

- R3 (M3, first usable): visit type (VIS-001), pre-loaded complaints with
  status + improvement % (VIS-002), remedy response (VIS-003), next follow-up
  date and scheduling onto Today (VIS-004). Acceptance flow 7's data-entry
  half runs here.
- R4 (M7): the Prescribe button leads to a working Rx (S13) and print (S14).
- R5 (M8): the Bill action (F8) leads to a working invoice (S15).
- R9 (M10): the per-complaint progress chart and vitals chart (VIS-007, P1)
  become visible. Until then the chart panel is behind a compile-time feature
  flag and is not rendered (no dead-end control, per ADR 0002).

## States

- Empty: a patient with no previous visit should be sent to S08 instead; if
  reached directly, the complaint list shows the empty state "No earlier
  complaints to pre-load" with "Add new complaint".
- Loading: skeleton complaint rows after 150 ms.
- Error: autosave failure shows the inline status-bar warning and retries;
  no data discarded (NFR-012, NFR-033).
- Read-only (LIC-020): an already-open visit can be finished (SUX-008);
  creating a new follow-up is disabled with the renew tooltip. Viewing stays
  enabled.
- Trial: unchanged; trial badge in nav only (SUX-003).

## Keyboard

- F5 new visit, F7 prescribe, F8 bill, Ctrl+S force save, Esc close dialog,
  Alt+Left back (00-conventions section 3).

## Commands used (proposed Tauri command names)

- `visit_create_followup` req { patient_id, prev_visit_id } resp { visit_id, visit_at, prev_complaints: [{ key, text, location }] }
- `visit_autosave` req { visit_id, type, complaint_status_json, improvement_pct_json, remedy_response, vitals_json, observations } resp { saved_at }
- `visit_set_next_followup` req { visit_id, next_followup_on } resp { ok }
- `visit_progress_series` req { patient_id, complaint_key } resp { points: [{ visit_at, improvement_pct }] }  (R9 only; VIS-007)

## Acceptance checks

- A follow-up pre-loads the previous visit's complaints (VIS-002).
- Each complaint can be set Better/Same/Worse/New/Resolved with an
  improvement % (VIS-002).
- A remedy response can be chosen from the six options (VIS-003).
- Next follow-up quick buttons and custom date both set next_followup_on; the
  patient then appears on Today on that date (VIS-004; acceptance flow 7).
- R9 build: the progress chart shows the recorded improvement % across visits
  (VIS-007). Pre-R9 build: the chart is not present.

## Open questions

- VIS-OQ-1: When a complaint is marked Resolved, should it still appear in the
  next follow-up's pre-load, or drop off? VIS-002 does not say.
- VIS-OQ-2: VIS-007 charts "vitals (weight, BP)"; which exact vitals are
  charted and over what default window (all visits, last 12 months)?
- VIS-OQ-3: Should improvement % be required before a visit can set the next
  follow-up, or stay optional? VIS-002/VIS-004 do not state a dependency.
