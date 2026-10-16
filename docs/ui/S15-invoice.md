# S15 Invoice
Screen id: invoice   Route: /visit/:visitId/invoice   Module: apps/desktop/src/billing
Requirements: BILL-001, BILL-002, BILL-003, BILL-005, BILL-006   Milestone: M8  Release: R5

## Purpose

Bill a visit: consultation fee, medicine charges and other lines, a discount,
the total, the amount paid and the payment mode, leaving a running balance on
the patient. Prints or saves a numbered receipt and can show a UPI QR so the
patient pays the doctor directly.

## Entry points

- Follow-up (S09) or patient dashboard (S05) Bill button.
- Global shortcut F8 (bill the current visit).

## Layout (wireframe)

```
+--------------------------------------------------------------------------------------------------------+
| Invoice  Ramesh Kumar  HC-000123   Visit 16-10-2026        Receipt No: 2026-27/0142     {Saved 11:03}   |
+--------------------------------------------------------------------------------------------------------+
| Lines                                                                                   [+ Add line]    |
| +----------------------------------------------------------------------------------------------------+  |
| | Description               | Qty | Rate (Rs) | Amount (Rs) | [x] |                                   |  |
| | Consultation (follow-up)  |  1  |   200.00  |    200.00   | [x] |                                   |  |
| | Medicines                 |  1  |   150.00  |    150.00   | [x] |                                   |  |
| +----------------------------------------------------------------------------------------------------+  |
|                                                                                                         |
| Subtotal            Rs    350.00                                                                        |
| Discount  [ 50 ] ( ) Rs  (o) %   ->  Rs 17.50                                                           |
| Total               Rs    332.50                                                                        |
|                                                                                                         |
| Payment:  Paid [ 200.00 ]  Mode (o) Cash ( ) UPI ( ) Card ( ) Other   Ref [________]   [Add payment]    |
| Balance (dues)      Rs    132.50                                     {UPI QR (R5, BILL-005)}  [ ][ ]     |
| {GST fields when GSTIN set (BILL-006)}                                                                   |
|                                                              [ Save ]  [ Print receipt (Ctrl+P) ]       |
+--------------------------------------------------------------------------------------------------------+
```

## Fields and controls (element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Add line | button | appends an invoice line (BILL-001) | invoice-add-line |
| Line description | text input | free text; consultation/medicine/other (BILL-001) | invoice-line-desc-<n> |
| Line qty | number | integer >= 1 (BILL-001) | invoice-line-qty-<n> |
| Line rate | money input | paise internally; Indian grouping display (BILL-001) | invoice-line-rate-<n> |
| Line amount | read-only money | qty x rate (BILL-001) | invoice-line-amount-<n> |
| Remove line | button | undo via toast (NFR-035) | invoice-remove-line-<n> |
| Discount value | number | with type toggle | invoice-discount-value |
| Discount type | radio | amount (Rs) or percent (BILL-001) | invoice-discount-type |
| Total | read-only money | subtotal minus discount (BILL-001) | invoice-total |
| Paid amount | money input | <= total; partial allowed (BILL-001) | invoice-paid |
| Payment mode | radio group | Cash / UPI / Card / Other (BILL-001) | invoice-mode |
| Payment reference | text input | optional, e.g. UPI ref/UTR (BILL-001) | invoice-ref |
| Add payment | button | records a payment, reduces balance (BILL-001/002) | invoice-add-payment |
| Balance | read-only money | total minus paid; feeds dashboard dues (BILL-002) | invoice-balance |
| UPI QR | panel | static QR from doctor's own UPI ID (BILL-005, P1) | invoice-upi-qr |
| GST fields | fields | shown only when clinic GSTIN set (BILL-006, P2) | invoice-gst |
| Save | button | admin form: explicit Save (not a clinical autosave form) | invoice-save |
| Print receipt | button | opens S14 receipt (BILL-003) | invoice-print |

## Behaviour

- One invoice per visit; lines default to the clinic's consultation/follow-up
  fee where configured, then free lines for medicines and other items
  (BILL-001).
- Money is integer paise internally and displayed with Indian grouping; inputs
  accept "1250" or "1,250.50" (00-conventions section 4).
- Discount can be an amount or a percent; the total and balance recompute live
  (BILL-001).
- A partial payment is allowed; the remaining balance becomes the patient's
  running dues shown on the dashboard (BILL-002).
- Multiple payments can be added over time against the same invoice (BILL-001,
  payment table in data model).
- Print receipt opens S14 with a sequential receipt number per financial year
  (Apr-Mar) (BILL-003).
- Unlike clinical forms, billing is an admin-style form with an explicit Save;
  a finalised invoice locks its receipt number.

## Release slices

- R5 (M8, first usable): full invoice - lines, discount, total, partial
  payment, mode, running balance/dues (BILL-001, BILL-002), and receipt print
  through S14 (BILL-003). Acceptance flow 8 runs here. This build goes to the
  early pilot.
- R5 also: the clinic UPI QR on the invoice/receipt (BILL-005, P1) generated
  from the doctor's own UPI ID; the doctor marks the invoice paid manually. If
  BILL-005 slips as a P1, the QR panel stays behind a compile-time feature
  flag and is not shown (no dead-end control, per ADR 0002).
- GST invoice fields (BILL-006, P2) appear only when the clinic GSTIN is set;
  as a P2 item they may slip past MVP1 and are flagged off until implemented.

## States

- Empty: a visit with no invoice shows the consultation line pre-filled from
  the clinic fee and an empty state hint "Add medicine or other charges".
- Loading: skeleton line rows after 150 ms.
- Error: a save failure shows a plain-language message with a Details expander
  for a support code; no stack traces or SQL (NFR-033). Amounts entered are
  preserved in the form.
- Read-only (LIC-020): an invoice for an open/ongoing visit can be completed
  and its receipt printed (SUX-008); creating a new invoice on a new visit is
  disabled with the renew tooltip. Viewing, printing and export stay enabled.
- Trial: unchanged; trial badge in nav only (SUX-003).

## Keyboard

- F8 bill, Ctrl+P print receipt, Ctrl+S save, Esc close dialog, Alt+Left back
  (00-conventions section 3).

## Commands used (proposed Tauri command names)

- `invoice_get_or_create` req { visit_id } resp { invoice_id, number, fy, lines: [{ id, description, qty, rate, amount }], subtotal, discount, total, paid, balance }
- `invoice_save` req { invoice_id, lines, discount: { value, type } } resp { subtotal, total, balance }
- `payment_add` req { invoice_id, amount, mode, reference } resp { paid, balance }
- `invoice_finalize` req { invoice_id } resp { number, fy }
- `invoice_upi_qr` req { invoice_id } resp { upi_url, qr_svg }  (R5, BILL-005)

## Acceptance checks

- Bill a visit with a consultation line and a medicine line, apply a percent
  discount; total is correct (BILL-001).
- Take a partial payment; the balance equals total minus paid and shows as
  dues on the patient dashboard (BILL-002; acceptance flow 8).
- Print a receipt; it carries a sequential number scoped to the financial year
  (BILL-003).
- Money displays with Indian grouping and accepts grouped input
  (00-conventions section 4).
- R5 build: the UPI QR renders from the doctor's own UPI ID and the doctor can
  mark the invoice paid (BILL-005).
- When a GSTIN is set, GST fields are available (BILL-006).

## Open questions

- INV-OQ-1: Can the receipt number be configured (prefix, reset point) or is
  the FY scope fixed Apr-Mar with a running sequence? BILL-003 fixes the FY
  scope but not a prefix.
- INV-OQ-2: Should a discount be allowed to exceed the subtotal (credit), or
  be capped at the total? BILL-001 does not say.
- INV-OQ-3: Does marking a UPI-QR payment as paid require the UTR/reference, or
  is it optional? BILL-005 says the doctor marks it paid but does not require a
  reference.
- INV-OQ-4: GST breakdown detail for BILL-006 (CGST/SGST split, HSN/SAC codes)
  is not specified; a P2 item, to confirm with a CA (06 open question 4).
