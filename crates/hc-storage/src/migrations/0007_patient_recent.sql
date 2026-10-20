-- HC-MVP1-050 migration 0007: the "recently opened" patient list (PSR-007).
-- Forward-only; never edited in place once released (R-DATA-002).
-- Produces user_version = 7 (set by the migration runner, not here).
--
-- Additive only: migrations 0004 (patient + FTS/trigram + triggers), 0005 and
-- 0006 are NOT edited. This table is a NON-CLINICAL UI convenience list (the
-- "recent patients" shown when the S04 search box is empty), so it follows the
-- migration-0001 `setting` / migration-0002 `app_setting` precedent and is
-- EXEMPT from the clinical UUIDv7 + audit-column convention (R-DATA-005). It
-- carries no patient free-text (only the patient id + an opened-at instant), so
-- it holds no avoidable PII (R-PRIV-001). The touch writer bounds it to the
-- last 20 rows; reads are keyset-ordered by opened_at. Parameterised SQL only
-- at the call sites (R-SEC-001); this file is schema DDL with no values.

CREATE TABLE patient_recent (
  patient_id TEXT PRIMARY KEY,                 -- the opened patient (one row each)
  opened_at  TEXT NOT NULL,                    -- RFC3339 UTC of the most recent open
  FOREIGN KEY (patient_id) REFERENCES patient(id)
);

-- Most-recent-first reads are ordered by opened_at DESC; the index makes the
-- bounded "top 20" read and the prune "keep newest 20" cheap (R-DATA-008).
CREATE INDEX ix_patient_recent_opened ON patient_recent (opened_at DESC);
