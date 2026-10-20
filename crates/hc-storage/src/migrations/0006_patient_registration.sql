-- HC-MVP1-036..043 migration 0006: patient registration, family links and the
-- never-reused patient code sequence (PAT-001/002/005/006/008).
-- Forward-only; never edited in place once released (R-DATA-002).
-- Produces user_version = 6 (set by the migration runner, not here).
--
-- Additive only: migration 0004 (patient + patient_fts + patient_trgm + sync
-- triggers) and 0005 (diagnosis) are NOT edited. None of the columns added here
-- is a search field this slice, so the 0004 FTS/trigram sync triggers keep
-- working unchanged. Parameterised SQL only at the call sites (R-SEC-001);
-- this file is schema DDL with no values except the fixed seed counter row.

-- PAT-001 / PAT-005 demographic columns absent from migration 0004.
-- SQLite ADD COLUMN cannot carry NOT NULL without a default; all are nullable
-- (no production data yet; the writer sets what the form provides).
ALTER TABLE patient ADD COLUMN marital_status TEXT;
ALTER TABLE patient ADD COLUMN blood_group    TEXT;
ALTER TABLE patient ADD COLUMN photo_path     TEXT;   -- opaque attachment ref (R-PRIV-007)
ALTER TABLE patient ADD COLUMN allergies      TEXT;   -- alerts banner (PAT-005)
ALTER TABLE patient ADD COLUMN alerts         TEXT;
ALTER TABLE patient ADD COLUMN consent_at     TEXT;   -- DPDP consent instant (R-PRIV-003)

-- family_link (data model section 3; PAT-006): link a patient to a related
-- patient with a relation. Soft-deletable, standard UUIDv7 id + audit columns
-- (R-DATA-005). FKs reference patient(id) (foreign_keys=ON, R-DATA-010).
CREATE TABLE family_link (
  id                 TEXT PRIMARY KEY,            -- UUIDv7
  patient_id         TEXT NOT NULL,
  related_patient_id TEXT NOT NULL,
  relation           TEXT NOT NULL,               -- Wife/Husband/Son/... free text
  share_address      INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  deleted_at         TEXT,
  created_by         TEXT,
  updated_by         TEXT,
  row_version        INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (patient_id)         REFERENCES patient(id),
  FOREIGN KEY (related_patient_id) REFERENCES patient(id)
);
CREATE INDEX ix_family_link_patient ON family_link (patient_id);
CREATE INDEX ix_family_link_related ON family_link (related_patient_id);

-- patient_sequence (PAT-002): the monotonic patient-code counter. A dedicated
-- single-row table (NOT max(code), NOT clinic_profile which setup REPLACEs) so
-- the number is NEVER reused across soft delete, restore or the PIN-gated hard
-- delete: none of those paths touch this table, and the counter only ever
-- increases. The configurable prefix (ADM-001) lives next to it so the assigned
-- code is {prefix}{next_seq:06}. One row, id fixed to 1.
CREATE TABLE patient_sequence (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  prefix     TEXT NOT NULL DEFAULT 'HC-',
  next_seq   INTEGER NOT NULL DEFAULT 1,          -- next number to assign; monotonic
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO patient_sequence (id, prefix, next_seq, created_at, updated_at)
  VALUES (1, 'HC-', 1, '1970-01-01T00:00:00Z', '1970-01-01T00:00:00Z');
