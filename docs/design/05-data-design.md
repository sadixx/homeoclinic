# 05. Data Design

Requirements: `../requirements/06-architecture-data-model.md` sections 2-4b (schemas are defined there and not repeated here). This document adds the design decisions, indexes, backup format and legacy import.
Diagrams: `diagrams/svg/05-er-clinic.svg`, `diagrams/svg/06-er-content.svg`, `diagrams/svg/07-seq-patient-search.svg`, `diagrams/svg/11-seq-backup-restore.svg`.

## 1. Conventions

| Item | Rule |
|---|---|
| Keys | UUIDv7 text (sortable by time), patient `code` is the human ID |
| Money | INTEGER paise |
| Time | UTC ISO-8601 text; display in Asia/Kolkata |
| Soft delete | `deleted_at`; all queries filter it via views `v_patient`, `v_visit` |
| JSON | `data_json`, `vitals_json` validated against the template JSON schema in Rust before write |
| Text | UTF-8, NFC normalised |

## 2. Patient search storage (PSR, NFR-002)

Diagram: `diagrams/svg/07-seq-patient-search.svg`.
- `patient_fts` (unicode61, prefix 1-3) and `patient_trgm` (trigram on digits) as external-content FTS5 tables, kept in sync by triggers in the same transaction (PSR-012).
- Denormalised summary columns on `patient`: `last_visit_at`, `next_followup_on`, `balance_paise`, `visit_count`.
- Sizing at 50k patients / 500k visits: clinic.db about 400-700 MB without attachments; FTS indexes about 15 MB.

## 3. Content pack DB

Schema per requirements 06 section 4, plus `rubric.top5_json` precomputed and `remedy_index` (global position for bitsets). Measured from the OOREP dump (2026-10-15): publicum 74,667 rubrics / 735,566 remedy entries, kent-de 68,741 / 624,010, remedy master 2,432. Estimated pack size 40-60 MB each including FTS; to be confirmed when M4 builds the packs.

## 4. Migrations

`hc-storage/migrations/NNNN_name.sql`, forward-only, applied in one transaction after automatic pre-migration backup (NFR-011). Schema version in `PRAGMA user_version`. CI test migrates a DB from every released version.

## 5. Backup format `.hcbak` (BAK-002)

```
magic "HCBAK1" | header JSON (created_at, app_version, patient_count, last_visit_at, kdf params, salt, nonce)
| AES-256-GCM( tar( clinic.db snapshot, user_content.db snapshot, files/* ) ) streamed in 1 MB chunks, each chunk authenticated
```
Snapshot via SQLite online backup API, so backups run while the app is in use. Restore preview reads only the header (BAK-003).

## 6. Legacy import (`tools/legacy-import`, also an in-app wizard) - MVP5, de-prioritised

Not built for MVP1. Design kept ready for IMP-002.

Source: live legacy MySQL or a `.sql` dump (parsed without needing MySQL installed).

| Legacy table | New target | Notes |
|---|---|---|
| tblpatient | patient | CaseNo -> `code` with prefix kept; age-only -> `dob_is_estimated` |
| tblchiefcomplaint, tblhistory, tblgeneralities, tblmentals, tblmenstrualhistory | first `visit` (type First) `data_json` using the "Legacy case" template | Field-by-field mapping table in the tool |
| tblfollowup | visit (type Follow-up) | `Rubrics` text kept as note; optional fuzzy match to Kent rubrics offered for review |
| tblpriscription | prescription + prescription_item | Medicine text parsed to remedy + potency when confident, else kept as label |
| paymentcustomer, tblreceipt | invoice, invoice_line, payment | double -> paise rounding |
| tblappointment | appointment | |
| tbldiet, tblinstruction | advice library | Shivaji-font Marathi text converted to Unicode Devanagari using a glyph mapping table |
| tblreports | attachment | Files copied and encrypted |
| Patient Photos/ | attachment (photo) | Matched by case number in file name |
| tblclinicsetting | clinic, doctor | |
| login, tbllicenceinfo | not imported | New PIN and new licence |

Import is dry-run first (report of counts, unmapped values, conversion warnings), then committed in one transaction.
