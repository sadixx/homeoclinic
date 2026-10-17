-- HC-MVP1-026/027 migration 0002: first-run setup schema.
-- Forward-only; never edited in place once released (R-DATA-002).
-- Produces user_version = 2 (set by the migration runner, not here).

-- doctor_profile: the practising doctor (SET-002). Standard UUIDv7 id + audit
-- columns (R-DATA-005). One logical row in MVP1.
CREATE TABLE doctor_profile (
  id            TEXT PRIMARY KEY,          -- UUIDv7
  name          TEXT NOT NULL,
  qualification TEXT NOT NULL,
  reg_no        TEXT NOT NULL,
  reg_council   TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  signature_ref TEXT,                      -- opaque attachment uuid (R-PRIV-007)
  logo_ref      TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  created_by    TEXT,
  updated_by    TEXT,
  row_version   INTEGER NOT NULL DEFAULT 0
);

-- clinic_profile: the clinic (SET-003). Fees are INTEGER paise (R-DATA-004).
CREATE TABLE clinic_profile (
  id                 TEXT PRIMARY KEY,     -- UUIDv7
  name               TEXT NOT NULL,
  address            TEXT NOT NULL,
  phone              TEXT,
  timings            TEXT,
  fee_first_paise    INTEGER NOT NULL,     -- integer paise, never float
  fee_followup_paise INTEGER NOT NULL,
  gstin              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  created_by         TEXT,
  updated_by         TEXT,
  row_version        INTEGER NOT NULL DEFAULT 0
);

-- app_setting: wizard/lock config (autolock minutes, font size, data dir,
-- setup_complete). Key/value JSON; configuration, not a clinical entity, so it
-- follows the migration-0001 `setting` precedent (R-DATA-005 exemption).
CREATE TABLE app_setting (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

-- trial: the local 30-day trial seed (LIC-063). One row; standard id + audit.
CREATE TABLE trial (
  id          TEXT PRIMARY KEY,            -- UUIDv7
  started_at  TEXT NOT NULL,               -- RFC3339 UTC
  valid_until TEXT NOT NULL,               -- started_at + 30 days
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  created_by  TEXT,
  updated_by  TEXT,
  row_version INTEGER NOT NULL DEFAULT 0
);
