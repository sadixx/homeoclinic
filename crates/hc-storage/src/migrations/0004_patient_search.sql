-- HC-MVP1-047 migration 0004: patient table + FTS5 prefix + trigram search.
-- Forward-only; never edited in place once released (R-DATA-002).
-- Produces user_version = 4 (set by the migration runner, not here).
--
-- Design: docs/requirements/06 §3 (patient search). FTS5 external-content
-- tables kept in sync with the base `patient` row by triggers that run in the
-- SAME transaction as the write (PSR-012, R-DATA-006). Parameterised SQL only
-- at the call sites (R-SEC-001); this file is schema DDL with no values.

-- patient: the registered patient. Standard UUIDv7 id + audit columns
-- (R-DATA-005). Only the columns search needs this slice; visit/Rx/bill tables
-- land in later milestones. Normalised search columns (name_norm,
-- name_phonetic, mobile_digits, code_digits) are computed by the writer before
-- insert and mirrored into the FTS tables by the triggers below.
CREATE TABLE patient (
  id               TEXT PRIMARY KEY,            -- UUIDv7
  code             TEXT NOT NULL UNIQUE,        -- e.g. 'HC-000123' (PSR-002)
  name             TEXT NOT NULL,               -- display name as entered
  name_norm        TEXT NOT NULL,               -- lowercase, no dots, single spaces (PSR-003)
  name_phonetic    TEXT NOT NULL,               -- one phonetic key per word, space-joined (PSR-003)
  sex              TEXT,
  dob              TEXT,                         -- RFC3339 date or NULL
  dob_is_estimated INTEGER NOT NULL DEFAULT 0,
  age_years        INTEGER,                      -- when only age is known
  mobile           TEXT,                         -- as entered (may hold +91/spaces)
  mobile_digits    TEXT,                         -- digits only, +91 stripped (PSR-002)
  mobile_alt       TEXT,
  code_digits      TEXT NOT NULL,                -- digits only of code (PSR-002)
  city             TEXT,
  address          TEXT,
  occupation       TEXT,
  referred_by      TEXT,
  tags_json        TEXT,
  -- denormalised counters (data-model §3); maintained by later slices' write
  -- transactions. This slice only reads last_visit_at for ranking ties.
  last_visit_at    TEXT,                         -- RFC3339 of most recent visit
  next_followup_on TEXT,
  balance_paise    INTEGER NOT NULL DEFAULT 0,   -- integer paise (R-DATA-004)
  visit_count      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT,
  created_by       TEXT,
  updated_by       TEXT,
  row_version      INTEGER NOT NULL DEFAULT 0
);

-- B-tree indexes for the patient-side hot paths (data-model §3, R-DATA-008).
-- (visit/invoice/payment/appointment indexes ship with those tables later.)
CREATE INDEX ix_patient_last_visit    ON patient (last_visit_at);
CREATE INDEX ix_patient_next_followup ON patient (next_followup_on);
CREATE INDEX ix_patient_city          ON patient (city);
CREATE INDEX ix_patient_mobile_digits ON patient (mobile_digits);
CREATE INDEX ix_patient_code_digits   ON patient (code_digits);
CREATE INDEX ix_patient_name_norm     ON patient (name_norm);

-- patient_fts: prefix FTS over the human-visible text (PSR-001/002/003).
-- unicode61 + remove_diacritics 2 => case + diacritic insensitive.
-- prefix='1 2 3' => 1/2/3-char prefix indexes so "ram ku" matches as typed.
-- External content (content='patient') so the base row is the source of truth.
CREATE VIRTUAL TABLE patient_fts USING fts5(
  name,
  name_norm,
  name_phonetic,
  code,
  city,
  content = 'patient',
  content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 2",
  prefix = '1 2 3'
);

-- patient_trgm: trigram FTS over digit strings for partial mobile / ID digit
-- matching (PSR-002: any 4+ consecutive digits; '123' finds HC-000123) without
-- LIKE '%x%' on a base table (R-SEC-001). External content.
CREATE VIRTUAL TABLE patient_trgm USING fts5(
  mobile_digits,
  code_digits,
  content = 'patient',
  content_rowid = 'rowid',
  tokenize = 'trigram'
);

-- Same-transaction sync triggers (PSR-012, R-DATA-006). Standard FTS5
-- external-content idiom: AFTER INSERT inserts the shadow row; AFTER DELETE and
-- AFTER UPDATE issue the 'delete' command then re-insert. They run inside the
-- caller's transaction, so a newly inserted patient is findable immediately.
CREATE TRIGGER patient_ai AFTER INSERT ON patient BEGIN
  INSERT INTO patient_fts(rowid, name, name_norm, name_phonetic, code, city)
    VALUES (new.rowid, new.name, new.name_norm, new.name_phonetic, new.code, new.city);
  INSERT INTO patient_trgm(rowid, mobile_digits, code_digits)
    VALUES (new.rowid, new.mobile_digits, new.code_digits);
END;

CREATE TRIGGER patient_ad AFTER DELETE ON patient BEGIN
  INSERT INTO patient_fts(patient_fts, rowid, name, name_norm, name_phonetic, code, city)
    VALUES ('delete', old.rowid, old.name, old.name_norm, old.name_phonetic, old.code, old.city);
  INSERT INTO patient_trgm(patient_trgm, rowid, mobile_digits, code_digits)
    VALUES ('delete', old.rowid, old.mobile_digits, old.code_digits);
END;

CREATE TRIGGER patient_au AFTER UPDATE ON patient BEGIN
  INSERT INTO patient_fts(patient_fts, rowid, name, name_norm, name_phonetic, code, city)
    VALUES ('delete', old.rowid, old.name, old.name_norm, old.name_phonetic, old.code, old.city);
  INSERT INTO patient_fts(rowid, name, name_norm, name_phonetic, code, city)
    VALUES (new.rowid, new.name, new.name_norm, new.name_phonetic, new.code, new.city);
  INSERT INTO patient_trgm(patient_trgm, rowid, mobile_digits, code_digits)
    VALUES ('delete', old.rowid, old.mobile_digits, old.code_digits);
  INSERT INTO patient_trgm(rowid, mobile_digits, code_digits)
    VALUES (new.rowid, new.mobile_digits, new.code_digits);
END;
