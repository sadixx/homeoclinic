# S14 Print preview
Screen id: print-preview   Route: /print/:docType/:id   Module: apps/desktop/src/print
Requirements: RX-005, RX-006, CASE-009, BILL-003, LIC-006, NFR-005   Milestone: M7  Release: R4

## Purpose

One preview-and-print surface for every clinical document: the prescription
(A4/A5/letterhead), the fee receipt, and the read-only case summary. It shows
exactly what will print, lets the doctor pick paper and letterhead margins,
prints or saves a PDF, and shares on WhatsApp.

`docType` is one of `rx`, `receipt`, `case_summary`.

## Entry points

- Prescription (S13) Print preview / Share WhatsApp (RX-005, RX-006).
- Invoice (S15) Print receipt (BILL-003) - from R5.
- Case form (S08) Case summary (CASE-009) - printable from R4.
- Global shortcut Ctrl+P on any of those screens.

## Layout (wireframe)

Left: controls. Right: live page preview (the printed document).

```
+--------------------------------------------------------------------------------------------------------+
| Print preview - Prescription                                                        [ Print (Ctrl+P) ]  |
+---------------------------+----------------------------------------------------------------------------+
| Document: (o) Rx          |   +------------------------------------------------------------------+     |
|           ( ) Receipt     |   |  { live preview of the page at the chosen size }                 |     |
|           ( ) Case summary|   |                                                                  |     |
| Paper:    ( ) A4  (o) A5  |   |                                                                  |     |
| Letterhead:[x] Use pre-   |   |                                                                  |     |
|            printed head   |   |                                                                  |     |
|   Top margin   [ 45 ] mm  |   |                                                                  |     |
|   Side margins [ 12 ] mm  |   |                                                                  |     |
| Hide remedy names: {from  |   |                                                                  |     |
|   Rx setting}             |   |                                                                  |     |
|                           |   |                                                                  |     |
| [ Save PDF ]              |   |                                                                  |     |
| [ Share on WhatsApp ]     |   |                                                                  |     |
+---------------------------+----------------------------------------------------------------------------+
```

Printed A5 prescription (what prints; letterhead header suppressed when "Use
pre-printed head" is on):

```
+--------------------------- A5 148 x 210 mm -----------------------------+
| Dr. Ramesh Iyer, BHMS                         Reg: MH-12345 (MH Council)|   <- doctor identity (LIC-006)
| Sunrise Homoeo Clinic, 12 MG Road, Pune 411001   Ph 020 1234 5678       |   <- clinic profile (editable)
|-------------------------------------------------------------------------|
| Patient: Ramesh Kumar (HC-000123)   Age/Sex: 34 y / M   Date: 16-10-2026|
|-------------------------------------------------------------------------|
| Rx                                                                      |
|  1. Sulphur 200C  - 4 globules, OD x 7 days, empty stomach              |
|  2. SL 4 globules, TDS x 7 days                 {true name hidden}      |
|                                                                         |
| Advice: Avoid coffee, camphor, strong mint.                             |
| Diet:   Light warm food; plenty of water.                               |
|                                                                         |
| Next visit: 16-11-2026                                                  |
|                                                        ______________   |
|                                                        Dr. Ramesh Iyer  |   <- signature image (SET-002)
| {TRIAL / EVALUATION watermark when applicable}                          |
+-------------------------------------------------------------------------+
```

## Fields and controls (element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Document type | radio group | rx / receipt / case_summary; receipt enabled from R5 (BILL-003) | print-doctype |
| Paper size | radio group | A4 / A5 for Rx (RX-005); receipt default A5; case summary A4 | print-paper |
| Use pre-printed letterhead | checkbox | suppresses printed header; enables margin inputs (RX-005) | print-letterhead |
| Top margin | number mm | only when letterhead on; print on pre-printed head (RX-005) | print-margin-top |
| Side margins | number mm | configurable margins (RX-005) | print-margin-side |
| Hide remedy names (indicator) | read-only | reflects the S13 RX-002 flag for this Rx | print-hide-names |
| Print | button | sends to the OS print dialog | print-print |
| Save PDF | button | writes a PDF to the data folder (RX-006 for Rx) | print-save-pdf |
| Share on WhatsApp | button | opens wa.me link and reveals the PDF (RX-006) | print-share-whatsapp |
| Preview page | render surface | live preview matches print output (NFR-005) | print-preview-page |

## Behaviour

- The preview renders the selected document from stored data; for the Rx it
  honours the RX-002 hide-name flag (true remedy stored, printed label hidden).
- Paper size and letterhead margins re-render the preview live (RX-005). With
  "Use pre-printed letterhead" on, the clinic header block is suppressed and
  content starts below the configured top margin.
- Print opens the OS print dialog; Save PDF writes to the data folder; Share
  on WhatsApp opens `https://wa.me/<patient mobile>` with a message and reveals
  the PDF file for drag-and-drop (RX-006; no WhatsApp API in MVP1).
- Doctor identity on every document (name + registration number + council)
  comes from the doctor profile (SET-002) until R8; from R8 it is the locked
  licensed identity (LIC-006) and cannot be edited in the app. Clinic name,
  address, logo and timings stay editable throughout.
- Receipt (BILL-003) carries the sequential receipt number per financial year;
  printing receipts is enabled from R5.
- Case summary (CASE-009) is the read-only printable case view.

## Release slices

- R4 (M7, first usable): Rx print preview at A4/A5/letterhead with configurable
  margins (RX-005), Save PDF and WhatsApp share (RX-006), and case summary
  print (CASE-009). Preview renders in under 1 s (NFR-005). Doctor identity is
  taken from the doctor profile (SET-002). Acceptance flow 6 runs here.
- R5 (M8): the Receipt document type becomes selectable and prints the fee
  receipt with its financial-year number (BILL-003). Before R5 the receipt
  radio is behind a compile-time feature flag and not shown.
- R8 (M9): doctor identity switches from the editable profile to the locked
  licensed identity (LIC-006); the "TRIAL" mark prints while on trial and
  stops once a paid licence is imported.
- Internal evaluation builds (CONT-004) print an "EVALUATION" watermark on
  every document regardless of release; public builds never do.

## States

- Empty: if the target document has no content (e.g. an Rx with no remedies),
  the preview shows "Nothing to print yet" and Print/Save/Share are disabled.
- Loading: skeleton page frame after 150 ms while the document renders.
- Error: a render or PDF-write failure shows a plain-language message with one
  action ("Try again") and a Details expander for a support code; never a file
  path or stack trace (NFR-033).
- Read-only (LIC-020): print, Save PDF, export and WhatsApp share all stay
  enabled when the licence has expired; only creating new content is blocked
  (00-conventions section 4).
- Trial: the "TRIAL" mark appears on the printed document from R8; before R8
  the trial state is shown only by the nav badge (SUX-003).

## Keyboard

- Ctrl+P print, Esc close preview, Alt+Left back (00-conventions section 3).

## Commands used (proposed Tauri command names)

- `print_render` req { doc_type, id, paper, letterhead: { enabled, top_mm, side_mm } } resp { html, page_size, render_ms }
- `print_to_pdf` req { doc_type, id, paper, letterhead } resp { file_path }
- `print_layout_get` req { doc_type } resp { paper, letterhead: { enabled, top_mm, side_mm } }
- `print_layout_save` req { doc_type, paper, letterhead } resp { ok }
- `doc_identity_get` req {} resp { name, qualification, reg_no, reg_council, signature_present, source: "profile" | "licence", is_trial, is_eval }
- `rx_share_whatsapp` req { prescription_id } resp { wa_url, pdf_path }  (RX-006)

## Acceptance checks

- Rx preview on A5 renders in under 1 s on the reference PC (NFR-005;
  acceptance flow 6).
- A4, A5 and letterhead-with-margins each produce the layout in this spec
  (RX-005).
- With the S13 hide-name flag on, the printed Rx hides the true remedy name
  while the stored prescription keeps it (RX-002 via S13; verified on print).
- Save PDF writes a PDF and Share on WhatsApp opens the wa.me link and reveals
  the file (RX-006).
- Case summary prints read-only (CASE-009).
- R5 build: receipt prints with a financial-year sequential number (BILL-003).
- R8 build: the printed identity is the locked licensed name + registration
  number and is not editable in the app (LIC-006); pre-R8 it is the profile
  identity (SET-002).
- Internal build prints the EVALUATION watermark (CONT-004); public build does
  not.

## Open questions

- PRN-OQ-1: Default letterhead top/side margins (drawn as 45 mm / 12 mm) are
  placeholders; what are the real defaults for common Indian pre-printed
  letterheads? RX-005 says configurable but gives no default.
- PRN-OQ-2: Q1 (docs/design/06-review-questions.md) proposes legacy prints
  (certificate, referral letter, envelope, patient declaration) as P1. If
  accepted, are they new doc types in this screen or separate screens?
- PRN-OQ-3: Q3 (docs/design/06-review-questions.md) proposes Marathi advice/diet
  on the printed Rx. Is the Marathi block a fixed translated advice list, or
  free Marathi text entered by the doctor?
- PRN-OQ-4: Exact wording and placement of the "TRIAL" mark and the
  "EVALUATION" watermark are not specified (TRIAL plan note in 03 section 1;
  CONT-004).
