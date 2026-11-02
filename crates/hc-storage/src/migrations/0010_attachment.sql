-- PAT-009 (HC-MVP1-M3ux3) migration 0010: attachment table for visit lab/
-- ultrasound/CT report uploads. Forward-only; never edited in place once
-- released (R-DATA-002). Produces user_version = 10 (set by the runner).
--
-- Design: docs/requirements/06 §3 `attachment(id, patient_id, visit_id NULL,
-- file_path, mime, sha256, caption)` + standard audit columns (R-DATA-005).
-- Forward-only SUPERSET of §3 (ADR 0017): `file_path` is realised as `blob_id`
-- (the opaque AttachmentStore id whose on-disk file is files/<blob_id>.bin,
-- R-PRIV-007), and `byte_size` + `original_name` are added for the list/open
-- contract. The blob bytes live encrypted in the AttachmentStore (AES-256-GCM,
-- M1-024); only metadata lives here. Parameterised SQL at the call sites
-- (R-SEC-001); this file is schema DDL with no values.

CREATE TABLE attachment (
  id            TEXT PRIMARY KEY,       -- UUIDv7 attachment-row id (R-DATA-005)
  patient_id    TEXT NOT NULL,          -- FK patient(id)
  visit_id      TEXT,                   -- FK visit(id); NULL allowed per §3
  blob_id       TEXT NOT NULL,          -- AttachmentStore id -> files/<blob_id>.bin (§3 file_path, opaque)
  mime          TEXT NOT NULL,          -- application/pdf | image/png | image/jpeg | image/webp
  sha256        TEXT NOT NULL,          -- sha256 of the plaintext (from AttachmentMeta)
  byte_size     INTEGER NOT NULL,       -- plaintext length in bytes
  original_name TEXT,                   -- chosen file base name (display only; never logged)
  caption       TEXT,                   -- optional doctor caption
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  created_by    TEXT,
  updated_by    TEXT,
  row_version   INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (patient_id) REFERENCES patient(id),
  FOREIGN KEY (visit_id)   REFERENCES visit(id)
);

-- Hot path: list a visit's attachments, stable order (R-DATA-008).
CREATE INDEX ix_attachment_visit   ON attachment (visit_id, created_at);
CREATE INDEX ix_attachment_patient ON attachment (patient_id);
