# ADR 0017 — Visit lab-report attachments: in-app preview open, typed file picker

Status: accepted (M3 ux3, PAT-009)
Date: 2026-10-22
Supersedes / extends: requirements/06 §3 `attachment` row (adds `blob_id`,
`byte_size`, `original_name`), like ADR 0016 widened a §3 line forward-only.

## Context

PAT-009 lets the doctor attach PDF / image (png/jpg/jpeg/webp) lab, ultrasound
and CT reports to a visit, in the S08 case form Investigations section. The
encrypted blob store already exists (HC-MVP1-024,
`crates/hc-storage/src/attachment.rs`: AES-256-GCM, unique nonce, HKDF
attachment subkey of the DEK, opaque `files/<uuid>.bin` names — R-PRIV-007,
NFR-021). This slice adds the per-visit metadata table, typed commands, and the
upload UI. Three cross-cutting decisions need recording.

## Decision 1 — Open = in-app preview via decrypted bytes, NOT decrypt-to-temp + OS open

`visit_open_attachment` returns the decrypted bytes (base64 + mime) to the UI
for in-app preview; the UI renders images via a `data:<mime>;base64,...` URL
(the CSP already allows `img-src 'self' asset: data:`) and offers a save/open
affordance for PDFs.

Rationale (most least-privilege option, R-SEC-002/003/004, product rule 5):
- Adds NO opener/shell plugin and NO new filesystem capability scope.
- Writes NO plaintext temp file to disk — the blob stays encrypted at rest; the
  decrypted plaintext exists only transiently in the webview for the preview.
- Leaves the webview CSP untouched.

Rejected alternative — decrypt to a temp file then open with the OS
(`tauri-plugin-opener`): it leaks plaintext to a temp path (a privacy/cleanup
burden under R-PRIV-002/007) and requires either the opener plugin (new dep +
capability) or a broadened `fs` scope, both worse against R-SEC-003 (no broad
fs, no shell).

## Decision 2 — Typed file picker via tauri-plugin-dialog, `dialog:allow-open` only

The UI must never construct a filesystem path (architecture rule, R-ARCH-003).
It obtains the `source_path` for `visit_attach_report` from a typed command
`visit_pick_report_file` that opens the OS file dialog filtered to
pdf/png/jpg/jpeg/webp and returns the chosen absolute path (or `None` on
cancel). Implemented with `tauri-plugin-dialog`'s blocking file picker in the
Rust command.

The dialog returns ONLY a chosen path; it grants NO filesystem read permission
— the backend reads the bytes itself in `visit_attach_report`. The capability
`apps/desktop/src-tauri/capabilities/main.json` gains exactly `dialog:allow-open`
(not `dialog:default`, which also permits save/message/ask). No `fs` scope, no
shell plugin, no opener plugin (R-SEC-002/003). CSP unchanged (R-SEC-004).

Dependency (R-SEC-008): `tauri-plugin-dialog` is a first-party Tauri 2 plugin,
pinned to the 2.x the workspace `tauri = 2` resolves; `Cargo.lock` is committed
and `cargo audit` must stay clean. It is the ONLY new runtime dependency this
slice introduces (the open path adds none).

Determinism seam (DEV/E2E ONLY): the native GTK file chooser cannot be clicked
by webdriver, so `visit_pick_report_file` carries an E2E-only file-source seam
gated by the `e2e-test-keys` build feature (exactly like `patient_import_fixture`
and mirroring the webcam `window.__HC_E2E_CAMERA__` precedent). Under that
feature the command first reads the `HC_E2E_REPORT_FILE` env var; if it names an
existing path, that path is returned and the native dialog is skipped. The seam
is compiled OUT of the release/public build (feature off), so production opens
the native picker only — behaviour unchanged for real doctors. No new capability,
dependency, network call or filesystem scope; the chosen path is never logged
(R-PRIV-001).

## Decision 3 — Attachment delete is a hard delete of row + blob

R-DATA-003 forbids hard-deleting the four CORE clinical entities (patient,
visit, prescription, invoice). An attachment is a doctor-removable artifact, not
a core clinical record; "remove" must physically delete the encrypted blob so no
orphan ciphertext is retained, mirroring the store's physical `delete`. The use
case runs the row delete + one audit row in one transaction, then deletes the
blob after commit (so a crash between the two leaves at worst an unreferenced,
opaque ciphertext — never a row pointing at a missing blob). The table still
carries `deleted_at` for schema uniformity (R-DATA-005). If a later review
prefers soft delete, the delete use case can set `deleted_at` and keep the blob
without a schema change.

## Consequences

- Patient data at rest stays encrypted; original file names are display-only and
  never logged or written to the audit diff (R-PRIV-001). The audit diff carries
  only mime + sha256 + byte_size on attach, and the sha256 on delete.
- One new pinned first-party dependency and one new narrow capability permission.
- PDFs do not get an embedded in-app viewer under the locked CSP (object/frame
  are `'none'`); the UI offers save/open for PDFs while images preview inline.
  Acceptable for R3; a dedicated viewer is out of scope.
