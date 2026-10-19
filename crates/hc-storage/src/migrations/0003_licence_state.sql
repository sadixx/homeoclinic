-- HC-MVP1-M1a migration 0003: LIC-005 clock-rollback guard state.
-- Forward-only; never edited in place once released (R-DATA-002).
-- Produces user_version = 3 (set by the migration runner, not here).

-- licence_state: the clock-guard max-seen anchor (LIC-005) and a reserved slot
-- for the imported .hclic blob (M9). Per requirements/06 data model:
-- licence_state(id, licence_blob, last_seen_at, last_seen_mac). Single logical
-- row (id = 'singleton'). `last_seen_at` is the monotonic max-seen UTC instant;
-- `last_seen_mac` is its HMAC-SHA256 tag keyed from an HKDF subkey of the DEK
-- (hc-storage::licence), so tampering with `last_seen_at` is detectable and is
-- treated as a rollback. Standard audit columns (R-DATA-005).
CREATE TABLE licence_state (
  id            TEXT PRIMARY KEY,          -- 'singleton'
  licence_blob  BLOB,                      -- reserved for imported .hclic (M9); NULL in R1
  last_seen_at  TEXT NOT NULL,             -- RFC3339 UTC, monotonic max-seen
  last_seen_mac TEXT NOT NULL,             -- lowercase hex HMAC-SHA256 tag over last_seen_at
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  created_by    TEXT,
  updated_by    TEXT,
  row_version   INTEGER NOT NULL DEFAULT 0
);
