# S16 Reports
Screen id: reports   Route: /reports   Module: apps/desktop/src/reports
Requirements: BILL-004   Milestone: M8  Release: R5

## Purpose

The clinic's money report: a daily collection total broken down by payment
mode and a monthly summary, both exportable to CSV/Excel. It answers "how much
did I collect today, and by what mode" for the doctor or assistant.

## Entry points

- Left nav "Reports".
- Patient dashboard / billing follow-through after taking a payment (S15).

## Layout (wireframe)

```
+--------------------------------------------------------------------------------------------------------+
| Reports                                                                                                 |
+--------------------------------------------------------------------------------------------------------+
| Report: (o) Daily collection  ( ) Monthly summary        Date [16-10-2026] (Daily)  Month [Oct 2026](Mon)|
|                                                                                       [ Export CSV ]    |
+--------------------------------------------------------------------------------------------------------+
| Daily collection - 16-10-2026                                                                           |
| +-----------------------------------------------+        +----------------------------------------+     |
| | Mode     | Payments | Amount (Rs)             |        | Total collected   Rs  4,250.00         |     |
| | Cash     |    7     |   2,100.00              |        | Payments count         12               |     |
| | UPI      |    4     |   1,800.00              |        | Outstanding (today)   Rs    132.50      |     |
| | Card     |    1     |     350.00              |        +----------------------------------------+     |
| | Other    |    0     |       0.00              |                                                       |
| | TOTAL    |   12     |   4,250.00              |                                                       |
| +-----------------------------------------------+                                                       |
|                                                                                                         |
| {Monthly summary shows per-day rows and a month total when that report is selected}                     |
+--------------------------------------------------------------------------------------------------------+
```

## Fields and controls (element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Report type | radio group | Daily collection / Monthly summary (BILL-004) | reports-type |
| Date picker | date input | for daily; DD-MM-YYYY (BILL-004) | reports-date |
| Month picker | month input | for monthly summary (BILL-004) | reports-month |
| Collection-by-mode table | table | rows per mode with count and amount (BILL-004) | reports-mode-row-<mode> |
| Totals card | panel | total collected, payment count, outstanding (BILL-004) | reports-totals |
| Monthly per-day table | table | one row per day with totals (BILL-004) | reports-day-row-<date> |
| Export CSV | button | exports the current report to CSV/Excel (BILL-004) | reports-export-csv |

## Behaviour

- Daily collection sums payments made on the chosen date, grouped by mode
  (Cash/UPI/Card/Other), with a grand total (BILL-004).
- Monthly summary lists per-day totals for the chosen month and a month total
  (BILL-004).
- Export CSV writes the currently shown report to a CSV/Excel file in a chosen
  folder (BILL-004).
- Money uses Indian grouping (00-conventions section 4). Dates use
  DD-MM-YYYY. Figures are read directly from the payment records created in
  S15 (payment table in the data model).

## Release slices

- R5 (M8, first usable): the daily collection report by mode, the monthly
  summary, and CSV/Excel export (BILL-004). Acceptance flow 8's reporting half
  runs here. This is the only release in which this screen changes for MVP1.
- No part of this screen is deferred or feature-flagged: BILL-004 is a single
  P0 item delivered whole at R5. (Richer analytics such as outcome and remedy
  reports are MVP2+ and out of MVP1 scope.)

## States

- Empty: a date/month with no payments shows "No collections for this date"
  and a zeroed totals card; Export CSV stays enabled (exports an empty report
  with headers).
- Loading: skeleton table rows after 150 ms.
- Error: a query failure shows a plain-language message with a Details
  expander for a support code; no SQL or file paths (NFR-033).
- Read-only (LIC-020): reporting and export stay fully enabled on an expired
  licence (data is always viewable and exportable, 00-conventions section 4).
- Trial: unchanged; trial badge in nav only (SUX-003).

## Keyboard

- Alt+Left back, Esc close any dialog (00-conventions section 3). Up/Down move
  table rows; Home/End jump (00-conventions section 4).

## Commands used (proposed Tauri command names)

- `report_daily_collection` req { date } resp { by_mode: [{ mode, count, amount }], total_amount, total_count, outstanding }
- `report_monthly_summary` req { month } resp { days: [{ date, count, amount }], total_amount, total_count }
- `report_export_csv` req { report_type, params: { date | month }, out_path } resp { file_path, row_count }

## Acceptance checks

- Daily collection totals by mode match the payments recorded that day and the
  grand total is correct (BILL-004; acceptance flow 8).
- Monthly summary per-day rows sum to the month total (BILL-004).
- Export CSV produces a file that opens in Excel with the shown rows
  (BILL-004).
- Money is shown with Indian grouping and dates as DD-MM-YYYY
  (00-conventions section 4).

## Open questions

- REP16-OQ-1: Does "daily collection" group by payment date (when money was
  received) or by invoice/visit date? They differ when a due is cleared on a
  later day. BILL-004 does not disambiguate.
- REP16-OQ-2: Should the monthly summary also break each day down by mode, or
  only show per-day totals with an overall by-mode total? BILL-004 says "by
  mode" for daily and "monthly summary" without mode detail.
- REP16-OQ-3: Is a date-range (custom from/to) collection report wanted in
  MVP1, or only single-day and single-month? BILL-004 names only daily and
  monthly.
