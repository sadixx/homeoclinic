-- HC-MVP1-022 migration 0001: initial schema (audit_log + setting).
-- Forward-only; never edited in place once released (R-DATA-002).
-- Produces user_version = 1 (set by the migration runner, not here).

-- audit_log: standard UUIDv7 id + standard audit columns (R-DATA-005).
-- Every write command commits exactly one row here, in the same transaction
-- as its row change (R-DATA-001, ADM-002).
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,          -- UUIDv7
  at          TEXT NOT NULL,             -- RFC3339 UTC event time
  user_id     TEXT,                      -- actor; NULL for a system write
  entity      TEXT NOT NULL,             -- e.g. 'setting', 'patient'
  entity_id   TEXT NOT NULL,             -- affected row id / key
  action      TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  diff_json   TEXT NOT NULL,             -- JSON diff {field:{old,new}} / snapshot
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  created_by  TEXT,
  updated_by  TEXT,
  row_version INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX ix_audit_entity ON audit_log (entity, entity_id);

-- setting: config key/value (data model section 3). Exempt from the clinical
-- UUIDv7/audit-column convention: it is configuration, not a clinical entity
-- (R-DATA-005 applies to clinical tables).
CREATE TABLE setting (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
