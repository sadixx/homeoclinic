-- HC-MVP1-056 migration 0005: primary diagnosis on patient.
-- Forward-only; never edited in place once released (R-DATA-002).
-- Produces user_version = 5 (set by the migration runner, not here).
--
-- Adds a first-class `diagnosis` column used by the synthetic data generator
-- (tools/seed, NFR-007) so the functional-regression fixture spans a
-- representative homeopathy-clinic disease spread, and by later M2 slices'
-- dashboard / "overdue follow-ups, given X" disease filters. The FTS/trigram
-- tables (migration 0004) are NOT changed: diagnosis is not a search field this
-- slice, so the 0004 sync triggers keep working unchanged.

-- Nullable (SQLite ADD COLUMN on an existing table takes no NOT NULL without a
-- default); the generator always sets it, and there is no production data yet.
ALTER TABLE patient ADD COLUMN diagnosis TEXT;

-- Supports the later disease-filter hot path (data-model section 3, R-DATA-008).
CREATE INDEX ix_patient_diagnosis ON patient (diagnosis);
