-- HC-MVP1-148..153 migration 0012: billing (BILL-001..006). Forward-only; never
-- edited in place once released (R-DATA-002). Produces user_version = 12 (set by
-- the runner). Purely additive: 4 new tables + indexes, no ALTER of existing
-- tables. Rollback = the automatic pre-migration backup (NFR-011).
--
-- Design: .worklog R5-design §2, ADR 0021. Money is INTEGER paise (R-DATA-004).
-- Dates `*_on` are clinic-LOCAL calendar dates 'YYYY-MM-DD' supplied by the UI
-- and range-checked by the service; `*_at` are UTC instants. Forward-only
-- superset of requirements/06 §3 (payment.paid_at -> paid_on + recorded_at).
-- Parameterised SQL at the call sites (R-SEC-001); this file is DDL only.

CREATE TABLE receipt_sequence (
  id          TEXT PRIMARY KEY,                 -- UUIDv7 (R-DATA-005)
  fy          TEXT NOT NULL UNIQUE,             -- '2026-27'
  last_seq    INTEGER NOT NULL CHECK (last_seq >= 0),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  created_by  TEXT,
  updated_by  TEXT,
  row_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE invoice (
  id              TEXT PRIMARY KEY,             -- UUIDv7
  patient_id      TEXT NOT NULL,
  visit_id        TEXT,                         -- R5 always sets it (06 §3 allows NULL)
  fy              TEXT NOT NULL,                -- '2026-27'
  seq             INTEGER NOT NULL CHECK (seq >= 1),
  number          TEXT NOT NULL,                -- '2026-27/0142'
  issued_on       TEXT NOT NULL,                -- local date of first Save
  issued_at       TEXT NOT NULL,                -- UTC instant
  status          TEXT NOT NULL CHECK (status IN ('issued','void')),
  discount_kind   TEXT NOT NULL CHECK (discount_kind IN ('none','amount','percent')),
  discount_value  INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0), -- paise | basis points
  subtotal_paise  INTEGER NOT NULL CHECK (subtotal_paise >= 0),
  discount_paise  INTEGER NOT NULL CHECK (discount_paise >= 0 AND discount_paise <= subtotal_paise),
  total_paise     INTEGER NOT NULL CHECK (total_paise = subtotal_paise - discount_paise),
  paid_paise      INTEGER NOT NULL DEFAULT 0 CHECK (paid_paise >= 0 AND paid_paise <= total_paise),
  balance_paise   INTEGER NOT NULL CHECK (balance_paise = total_paise - paid_paise),
  gstin_snapshot  TEXT,                         -- clinic GSTIN at issue (BILL-006)
  voided_at       TEXT,
  void_reason     TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT,
  created_by      TEXT,
  updated_by      TEXT,
  row_version     INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (patient_id) REFERENCES patient(id),
  FOREIGN KEY (visit_id)   REFERENCES visit(id)
);
CREATE UNIQUE INDEX ux_invoice_fy_seq         ON invoice (fy, seq);
CREATE UNIQUE INDEX ux_invoice_visit_live     ON invoice (visit_id) WHERE status = 'issued';
CREATE INDEX        ix_invoice_patient_issued ON invoice (patient_id, issued_on);
CREATE INDEX        ix_invoice_issued_on      ON invoice (issued_on);

CREATE TABLE invoice_line (
  id            TEXT PRIMARY KEY,               -- UUIDv7
  invoice_id    TEXT NOT NULL,
  position      INTEGER NOT NULL CHECK (position >= 0),
  kind          TEXT NOT NULL CHECK (kind IN ('consultation','medicine','other')),
  description   TEXT NOT NULL,
  qty           INTEGER NOT NULL CHECK (qty >= 1),
  rate_paise    INTEGER NOT NULL CHECK (rate_paise >= 0),
  amount_paise  INTEGER NOT NULL CHECK (amount_paise = qty * rate_paise),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,                           -- removed line = soft delete
  created_by    TEXT,
  updated_by    TEXT,
  row_version   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES invoice(id)
);
CREATE INDEX ix_invoice_line_invoice ON invoice_line (invoice_id, position);

CREATE TABLE payment (
  id            TEXT PRIMARY KEY,               -- UUIDv7
  invoice_id    TEXT NOT NULL,
  patient_id    TEXT NOT NULL,                  -- denormalised for dues/allocation reads
  batch_id      TEXT,                           -- Clear-dues allocation group, else NULL
  paid_on       TEXT NOT NULL,                  -- local date money was received (report key)
  recorded_at   TEXT NOT NULL,                  -- UTC instant of entry
  amount_paise  INTEGER NOT NULL CHECK (amount_paise > 0),
  mode          TEXT NOT NULL CHECK (mode IN ('cash','upi','card','other')),
  reference     TEXT,                           -- UTR / card slip, optional (INV-OQ-3)
  voided_at     TEXT,
  void_reason   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  created_by    TEXT,
  updated_by    TEXT,
  row_version   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES invoice(id),
  FOREIGN KEY (patient_id) REFERENCES patient(id)
);
CREATE INDEX ix_payment_paid_on ON payment (paid_on) WHERE voided_at IS NULL;
CREATE INDEX ix_payment_invoice ON payment (invoice_id);
