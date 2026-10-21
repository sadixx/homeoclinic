-- HC-MVP1-068..072 migration 0009: visit + visit_fts (VIS-001..005, CASE-005/
-- 009). Forward-only; never edited in place once released (R-DATA-002).
-- Produces user_version = 9 (set by the migration runner, not here).
--
-- Design: docs/requirements/06 §3 (visit, visit_fts, indexes). Standard UUIDv7
-- id + audit columns (R-DATA-005). The denormalised patient counters
-- (last_visit_at, next_followup_on, visit_count) already exist on `patient`
-- from migration 0004; this slice's visit writes maintain them IN the write
-- transaction (R-DATA-009), so the Today list needs no join.
--
-- Divergence from §3 (ADR 0015, D1): §3 lists a scalar `improvement_pct`; VIS-002
-- tracks improvement % PER complaint, so this slice stores
-- `improvement_pct_json TEXT` (a JSON object keyed by complaint key), a
-- forward-only superset of §3. Parameterised SQL only at the call sites
-- (R-SEC-001); this file is schema DDL with no values.

CREATE TABLE visit (
  id                    TEXT PRIMARY KEY,       -- UUIDv7 (R-DATA-005)
  patient_id            TEXT NOT NULL,
  visit_at              TEXT NOT NULL,          -- RFC3339 UTC instant
  type                  TEXT NOT NULL CHECK (type IN ('first','follow_up','acute','tele')),
  template_id           TEXT,                   -- FK case_template(id); NULL for follow-ups
  data_json             TEXT,                   -- case form answers (per schema_json)
  vitals_json           TEXT,                   -- { weightKg, heightCm, bmi, bp, pulse, temp, spo2 }
  complaint_status_json TEXT,                   -- VIS-002 per-complaint Better/Same/Worse/New/Resolved
  improvement_pct_json  TEXT,                   -- VIS-002 per-complaint improvement % (D1 / ADR 0015)
  remedy_response       TEXT,                   -- VIS-003 quick-pick value
  next_followup_on      TEXT,                   -- VIS-004 date (RFC3339 date)
  observations          TEXT,
  notes                 TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT,
  created_by            TEXT,
  updated_by            TEXT,
  row_version           INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (patient_id)  REFERENCES patient(id),
  FOREIGN KEY (template_id) REFERENCES case_template(id)
);

-- B-tree indexes for the per-patient timeline + the Today follow-up scan
-- (§3 index list, R-DATA-008).
CREATE INDEX ix_visit_patient_visit_at ON visit (patient_id, visit_at DESC);
CREATE INDEX ix_visit_next_followup    ON visit (next_followup_on);

-- visit_fts: external-content FTS5 over the visit free text (§3 "visit_fts(text)",
-- PSR-009). The indexed `text` is the concatenation of the searchable visit
-- columns; the base `visit` row is the source of truth (content = 'visit').
CREATE VIRTUAL TABLE visit_fts USING fts5(
  text,
  content = 'visit',
  content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 2"
);

-- Same-transaction sync triggers (R-DATA-006), standard FTS5 external-content
-- idiom: AFTER INSERT inserts the shadow row; AFTER DELETE / AFTER UPDATE issue
-- the 'delete' command (passing the OLD text) then re-insert the NEW text. They
-- run inside the caller's transaction, so a freshly-saved visit is findable
-- immediately. The indexed text =
--   COALESCE(data_json,'') || ' ' || COALESCE(observations,'') || ' ' || COALESCE(notes,'').
CREATE TRIGGER visit_ai AFTER INSERT ON visit BEGIN
  INSERT INTO visit_fts(rowid, text)
    VALUES (new.rowid, COALESCE(new.data_json,'') || ' ' || COALESCE(new.observations,'') || ' ' || COALESCE(new.notes,''));
END;

CREATE TRIGGER visit_ad AFTER DELETE ON visit BEGIN
  INSERT INTO visit_fts(visit_fts, rowid, text)
    VALUES ('delete', old.rowid, COALESCE(old.data_json,'') || ' ' || COALESCE(old.observations,'') || ' ' || COALESCE(old.notes,''));
END;

CREATE TRIGGER visit_au AFTER UPDATE ON visit BEGIN
  INSERT INTO visit_fts(visit_fts, rowid, text)
    VALUES ('delete', old.rowid, COALESCE(old.data_json,'') || ' ' || COALESCE(old.observations,'') || ' ' || COALESCE(old.notes,''));
  INSERT INTO visit_fts(rowid, text)
    VALUES (new.rowid, COALESCE(new.data_json,'') || ' ' || COALESCE(new.observations,'') || ' ' || COALESCE(new.notes,''));
END;
