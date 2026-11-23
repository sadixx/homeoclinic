# ADR 0021: R5 billing: issue-time FY receipt numbers, webview print, offline CSV/xlsx export

Date: 2026-11-05. Status: proposed (R5 milestone design,
`.worklog/HC-MVP1-dev-r5-settings/handoffs/R5-design.md`).

Relates to: BILL-001..006, HC-MVP1-148..153, ADR 0010 (HTML templates to PDF
via webview), ADR 0011 (money as integer paise), R-DATA-001/003/004/009,
`docs/requirements/06-architecture-data-model.md` section 3 (invoice,
invoice_line, payment), `docs/ui/S14`, `S15`, `S16`.

## Context

R5 ships billing to the early pilot. R4 has not been built, which means the
`hc-docs` HTML-to-PDF engine that ADR 0010 assumes does not exist. Receipts
need a receipt number that is sequential per Indian financial year (April to
March), with no gaps and no reuse. Reports must export to CSV and Excel with
no network access. The webview CSP forbids frames (`frame-src 'none'`).
Stored instants are UTC, but the clinic thinks in local (IST) calendar days.

## Decision

1. **Numbering at issue.** Only issued invoices are stored. There is no
   draft row. The first Save takes the next number from
   `receipt_sequence(fy)` inside the same write transaction as the invoice.
   The number has the form `<FY>/<seq:04>`, for example `2026-27/0142`. A
   rollback therefore leaves no gap. Invoices are never deleted. A void
   keeps its number and status, and `UNIQUE(fy, seq)` is the backstop.
   S15's separate `invoice_finalize` step is dropped.
2. **Local business dates.** `invoice.issued_on` and `payment.paid_on` are
   clinic-local `YYYY-MM-DD` dates. The UI supplies them, as it already does
   for the Today `today` value, and the service range-checks them against the
   clock with ±1 day of slack. The FY and the collection reports key on these
   dates. UTC instants are kept for the audit trail. This is a superset of
   06 §3 (`payment.paid_at` becomes `paid_on` + `recorded_at`, and
   `invoice.fy/seq/status/discount_*`, `gstin_snapshot` and the void columns
   are added).
3. **Corrections.** An issued invoice can be edited with a row-version check
   and one audit row, as long as the total stays at or above the amount
   paid. Payment void corrects a mistaken entry and removes it from reports.
   Invoice void also voids that invoice's live payments in the same
   transaction. Patient dues (`patient.balance_paise`) are recomputed from
   source inside every billing transaction (R-DATA-009).
4. **Print without the R4 engine.** The receipt is a React route in the main
   document, styled with `@media print` / `@page` CSS and printed with
   `window.print()`. Tauri 2 documents that this works on all platforms, and
   wry 0.57 implements native print on both WebKitGTK and WebView2. PDF comes
   from the OS print dialog. An in-app "Save PDF" waits for the R4 hc-docs
   engine. ADR 0010 stays the long-term direction; this ADR narrows it for R5.
5. **Offline export libraries, pinned exactly.**
   - `rust_xlsxwriter = "=0.102.0"` (`default-features = false`; pure Rust;
     MIT/Apache-2.0) builds the xlsx bytes in `hc-docs`.
   - CSV is hand-written to RFC 4180, with a UTF-8 BOM and CRLF line endings
     so Excel opens it correctly.
   - `qrcode = "=0.14.1"` (`default-features = false, features = ["svg"]`)
     generates the clinic UPI QR offline. It is shown as a `data:` image,
     which the CSP already allows.
6. **Sanctioned f64 boundary.** All money is `i64` paise (ADR 0011). The
   only `f64` is the paise/100 conversion when an xlsx cell is written. It
   is exact for every value below 2^53.
7. **GST (BILL-006).** The clinic GSTIN is snapshotted at issue and printed
   when it is set. The tax breakdown (CGST/SGST, HSN/SAC) is deferred until a
   CA confirms the treatment (INV-OQ-4).

## Consequences

- Receipt numbers have no gaps by construction. A mistaken Save is voided,
  not deleted, so voids appear in the sequence, as they would in a paper
  receipt book.
- The pilot has no in-app PDF file for receipts. Doctors use the OS
  "Save as PDF". Printing on Windows must be verified on a Windows build.
- Erasing a billed patient (DPDP) is blocked by the invoice foreign key, in
  the same way that existing visits already block it. A retention-aware
  erase design is a follow-up.
- Docs that need follow-up edits: the S15 route and command names, the S16
  export command, the S07/S03 Clear-dues behaviour, the S18 UPI ID field,
  the 00-conventions nav (Reports added, no Billing screen), and the
  06 §3 column superset.

## Alternatives rejected

- **Draft invoices numbered at print or finalize.** This leaves unnumbered
  invoices that still carry dues, and it adds a click.
- **A numeric `AUTOINCREMENT` counter.** It breaks the per-FY reset and
  R-DATA-005.
- **Iframe or HTML-injection receipt rendering.** CSP `frame-src 'none'`
  rules out the iframe, and injecting HTML is an XSS risk.
- **CSV only, labelled as Excel.** BILL-004 asks for Excel. A `.xls` that
  is really HTML triggers Excel warnings.
- **The UTC date as the business day.** It misfiles payments taken between
  00:00 and 05:30 IST into the wrong day, and around 1 April into the wrong
  FY.
