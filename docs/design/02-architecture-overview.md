# 02. MVP1 Architecture Overview

Scope: MVP1 from `../requirements/`: a complete offline desktop app for Windows and Linux with no hosted servers. Doctors pay to our business UPI ID through a QR the app generates offline, send proof on WhatsApp, and receive a signed licence by email from our offline Vendor Licence Tool (requirements 03 section 3, design 04). The hosted backend shown in the diagrams is MVP2 (built when MVP1 revenue funds it); it is designed now so MVP1 choices do not block it. Migration is MVP5.

## 1. System context

Diagram: `diagrams/svg/01-system-context.svg`

| Actor / system | Interaction with MVP1 |
|---|---|
| Doctor | Uses the desktop app all day, fully offline |
| Receptionist | Uses the same PC (separate login only from MVP2) |
| Patient | Receives printed or WhatsApp-shared Rx and receipts; pays the doctor by the doctor's own UPI QR |
| HomeoClinic Desktop | The product. Everything clinical runs here |
| Vendor Licence Tool (MVP1) | Internal offline tool; operator issues signed licence codes |
| Licence & Payment Service (MVP2) | Our hosted backend. Issues signed licences automatically; never receives patient data |
| Business UPI ID / bank (MVP1) | Receives payments from the offline Pay QR; dashboard shows UTRs for verification |
| WhatsApp Business (MVP1) | Doctor sends payment proof via pre-typed click-to-chat QR |
| Email (MVP1) | Licence file, certificate PDF and invoice to the doctor |
| Razorpay (MVP2) | Orders, webhooks, AutoPay |
| SMS / Email provider (MVP2) | Sends licence keys and GST invoices automatically |
| WhatsApp (wa.me link) | Opened on the doctor's PC for sharing a Rx; no API in MVP1 |
| USB drive / folder | Backup target, offline update files, content packs |

## 2. Containers

Diagram: `diagrams/svg/02-containers.svg`

| Container | Tech | Responsibility |
|---|---|---|
| Desktop UI | React 18 + TypeScript in Tauri webview | Screens, forms, keyboard flows, print preview |
| Desktop Core | Rust (Tauri 2 backend) | All business logic, storage, search, repertory engine, licence check, backup, PDF |
| clinic.db | SQLite + SQLCipher | Patients, visits, Rx, bills, audit, settings |
| user_content.db | SQLite + SQLCipher | Doctor's repertory additions, citations, bookmarks, synonyms |
| content/*.hcpack | Signed read-only SQLite packs | Repertories, Materia Medica, synonyms, relationships |
| files/ | Encrypted blobs | Photos, attachments, generated PDFs |
| Vendor Licence Tool (MVP1) | Rust + Tauri, offline, hardware signing key | Verify UTR, sign licences, certificate PDF, invoice, register, register, GST invoices |
| Licence API (MVP2) | Rust axum, stateless | Activate, offline activate, deactivate, refresh, webhook |
| Portal web (MVP2) | React (mobile first) | Buy, renew, manage devices, invoices |
| Licence DB (MVP2) | PostgreSQL | Customers, orders, licences, devices, invoices |
| Signing key | MVP1: hardware key (YubiKey/smart card); MVP2: Cloud KMS (ap-south-1) | Ed25519 private key; never leaves KMS |

## 3. Desktop component design

Diagram: `diagrams/svg/03-desktop-components.svg`

Rust workspace crates (hexagonal style: domain has no IO, adapters at the edges):

| Crate | Contains | Depends on |
|---|---|---|
| `hc-domain` | Entities, value types (Money in paise, PatientCode, Potency), validation rules | nothing |
| `hc-storage` | SQLCipher pool (1 writer + N readers), migrations, repositories, FTS triggers, backup/restore | domain |
| `hc-search` | Patient search query builder, phonetic keys, ranking | storage |
| `hc-repertory` | Pack loader/verifier, rubric search, bitset scoring engine, analysis methods, citations merge | domain |
| `hc-licence` | Licence parse/verify, identity lock, clock guard, entitlements, offline UPI and WhatsApp QR, offer codes | domain (shared with Vendor Licence Tool and MVP2 server) |
| `hc-docs` | Print/PDF rendering from HTML templates, amount in words, Indian number format | domain |
| `hc-app` | Tauri commands (the only API the UI can call), app services orchestrating use cases, event bus to UI | all above |

UI modules mirror use cases: `home/today`, `patients`, `case`, `visit`, `repertory`, `materia-medica`, `prescription`, `billing`, `reports`, `backup`, `settings`, `licence`.

Rules:
- UI never sees SQL or file paths; it calls typed commands generated with `tauri-specta`.
- Every write is a single use-case command in one DB transaction, with an audit row.
- Long work (search, analysis, backup, pack install) runs on worker threads; UI gets progress events and can cancel.

## 4. Runtime and threading

| Thread / pool | Work |
|---|---|
| UI (webview) | Rendering only |
| Tauri async runtime (tokio) | Command dispatch |
| DB writer (1 dedicated connection) | All writes, serialised, WAL mode |
| DB readers (4 connections) | Searches, lists, reports; run in parallel with writes |
| Repertory engine | Pack data memory-mapped; rubric bitsets cached in an LRU (64 MB cap) |
| Background jobs | Auto-backup, index optimise, periodic licence re-check (local), optional update check (signed static manifest); MVP2 adds online licence refresh |

Startup sequence: `diagrams/svg/14-seq-startup.svg`. Target cold start < 4 s (NFR-001): unlock DB, verify licence, open packs lazily (only metadata at start), render Today screen.

## 5. Deployment

Diagram: `diagrams/svg/04-deployment.svg`

| Target | Artifact | Install location | Data location |
|---|---|---|---|
| Windows 10/11 x64 | Signed NSIS `.exe` and `.msi`, offline WebView2 bundled | `%LOCALAPPDATA%\Programs\HomeoClinic` (per-user, no admin) | `%APPDATA%\HomeoClinic\` |
| Linux x64 | AppImage and `.deb` | `/opt/homeoclinic` or AppImage anywhere | `~/.local/share/homeoclinic/` |
| Backend (MVP2) | Containers on AWS ap-south-1 (ECS Fargate or a small VM), RDS PostgreSQL, KMS | | India region only |

Data folder layout:
```
HomeoClinic/
  clinic.db  user_content.db  settings.json(non-secret)
  content/   kent-1.0.hcpack  boericke-1.0.hcpack ...
  files/     <uuid>.bin (encrypted)
  backups/   daily/ weekly/ monthly/
  logs/      app.log (no patient data)
  licence/   licence.json  state.bin
```

## 6. Security architecture

Diagram: key hierarchy in `diagrams/svg/12-state-licence.svg` (licence) and `diagrams/svg/11-seq-backup-restore.svg` (backup keys).

| Concern | Design |
|---|---|
| At rest | Data Encryption Key (DEK, random 256-bit) encrypts clinic.db, user_content.db (SQLCipher) and files (AES-256-GCM). DEK is wrapped by a Key Encryption Key derived from the PIN (Argon2id) and also by the OS store (Windows DPAPI / Linux Secret Service). Recovery code wraps a third copy. |
| Backups | Separate backup key from backup password (Argon2id); `.hcbak` = header + encrypted tar of DB snapshot and files |
| Network | MVP1 desktop opens no listening ports and has no server to call; it only hands wa.me / mailto links to the OS and optionally reads a signed update manifest over TLS 1.2+. MVP2: licence API with certificate pinning |
| Packs and updates | Ed25519 signatures verified before use; two embedded public keys for rotation |
| Backend (MVP2) | Auth on every non-public endpoint, admin behind SSO + 2FA, webhook HMAC check, rate limits, KMS signing, no patient data |
| Code | Parameterised SQL only, `cargo audit`/`npm audit` in CI, pinned dependencies, Content Security Policy in webview, Tauri capability allowlist (no shell, no arbitrary FS) |
| Tamper / crack protection (TAM-001..013) | Layered, see section 6b |

## 6b. Tamper-proof release build

Diagram: `diagrams/svg/18-secure-release-pipeline.svg`.

No client binary is truly uncrackable, so protection is layered so that cracking is expensive and a cracked copy is still of little value:

| Layer | What it does | Requirement |
|---|---|---|
| 1. Single native blob | Rust compiles to machine code (not decompilable like the legacy Java jar). UI assets are embedded in the exe, encrypted at build time, decrypted in memory only | TAM-001 |
| 2. Hardened compile | Fat LTO, stripped symbols, no debug info, devtools and debug commands compiled out, minified/mangled frontend | TAM-002 |
| 3. Hidden secrets | Compile-time string encryption for keys, URLs, licence messages | TAM-003 |
| 4. Many licence checks | Licence logic inlined at startup, new-visit/Rx/bill, background timer (MVP2: also pack open); each verifies differently | TAM-004 |
| 5. Self-integrity | Signed hash manifest of code sections embedded at build; randomised runtime re-hash; Authenticode self-check on Windows | TAM-005, TAM-006 |
| 6. Anti-debug / anti-hook | Debugger and injection detection; silently disables paid paths | TAM-007 |
| 7. Targeted obfuscation | Control-flow obfuscation only on `hc-licence` and pack-decrypt code | TAM-008 |
| 8. Server-held value (MVP2) | Paid packs encrypted, key only inside device-bound licence; updates, cloud, sync, SMS require server-checked licence | TAM-009, LIC-031 |
| 9. Traceability | Per-licence watermark and identity printed on every document (MVP1, TAM-014); server abuse detection and revocation (MVP2) | TAM-010, TAM-011, TAM-014 |

Release pipeline (TAM-012): build on a locked CI runner -> embed and encrypt assets -> compile hardened -> obfuscate licence modules -> compute and sign code-section manifest -> inject manifest -> Authenticode/GPG sign via hardware key / HSM (MVP2: KMS) -> automated release scan (no symbols, no devtools, no plain secrets, signatures valid, Defender scan clean) -> publish. Any failed step blocks the release.

Response policy (TAM-013): tamper detection only blocks new paid actions (Read-only mode). Patient data is never deleted, encrypted or hidden, and the PC is never affected.

UX guardrails (SUX-001..012): every layer above is designed to be invisible to a genuine doctor.

| Layer | How it stays invisible |
|---|---|
| Encrypted embedded assets | Decrypted once at startup into memory (about 20 MB, < 150 ms), counted in the 4 s cold-start budget |
| Obfuscation | Applied only to `hc-licence` and pack-decrypt, never to search, scoring, DB or UI code, so hot paths keep full speed |
| Licence checks | Run in background or piggyback on write commands (< 1 ms each); no dialogs |
| Self-integrity | Background idle-time hashing in < 5 ms chunks; restriction needs 2 independent failures; first response is automatic Repair |
| Anti-debug | Silent, only affects paid paths, never crashes or shows warnings |
| Paid pack keys (MVP2) | Unwrapped once per session at first pack open (< 50 ms) |
| Signing | EV certificate so no SmartScreen warning; per-user install, no admin, no firewall prompt |
| Restriction | Never interrupts an ongoing visit (SUX-008); friendly message with one action button (SUX-007) |

Verification: performance and usability tests run on the fully protected release build (SUX-001, acceptance flow 13).

Not used: kernel drivers / rootkit-style DRM and whole-binary packers (UPX, VMProtect) because they cause antivirus false positives and erode doctor trust.

## 7. Architecture decisions (ADR summary)

| ADR | Decision | Alternatives rejected | Reason |
|---|---|---|---|
| 001 | Tauri 2 + React | Electron, Flutter, Java Swing (legacy), .NET | Small installer, low RAM, Win+Linux+mobile from one codebase |
| 002 | Embedded SQLite (SQLCipher) | MySQL/PostgreSQL local server (legacy) | No server to install or crash (legacy L1); single-file backup |
| 003 | Rust core with all logic | Logic in TypeScript | Performance for search/scoring, memory safety, shared licence crate with server |
| 004 | Content as signed read-only packs | Content in clinic.db | Add repertories without app updates (PACK-006); patient data untouched by content updates |
| 005 | Case data as template-driven JSON in `visit.data_json` + FTS | Fixed columns per field (legacy) | Templates are doctor-editable (CASE-004) |
| 006 | Bitset scoring engine | SQL GROUP BY scoring | < 300 ms recompute (NFR-004) on low-end PCs |
| 007 | Ed25519 licence file + QR offline activation | DB date (legacy), online-only check | Works offline, tamper-proof |
| 008 | HTML templates rendered to PDF by the webview | JasperReports (legacy), native PDF lib | Doctor-editable layouts, Unicode Indian scripts |
| 009 | Money as integer paise | double (legacy) | No rounding errors |
| 010 | UUIDv7 primary keys + `row_version` | Auto-increment | Ready for MVP2 LAN and MVP3 sync without key clashes |
| 011 | Layered anti-tamper: hardened single native binary + integrity checks + server-held value (encrypted paid packs) | Whole-binary packer/VMProtect, kernel DRM, no protection | Strong enough to make cracking uneconomic, no antivirus false positives, never harms patient data |

## 8. Cross-cutting

- Logging: structured JSON logs, patient identifiers never logged (IDs hashed), 10 MB x 5 rotation.
- Errors: domain errors mapped to friendly messages with a suggested action (NFR-033).
- i18n: all UI strings in `locales/en.json` from day one; Noto Sans / Noto Sans Devanagari bundled for print.
- Accessibility: keyboard-first, focus rings, min font 14 px, WCAG AA contrast.
- Testing: unit tests per crate, golden tests for scoring and search ranking, WebdriverIO + tauri-driver E2E for the 13 core flows (requirements/05 section 7), perf tests with 50k/100k seeded data.

## 9. How MVP1 prepares for MVP2/MVP3

| Later need | MVP1 hook |
|---|---|
| LAN multi-user | All UI calls go through `hc-app` commands, which can be exposed over an authenticated LAN API later without UI change |
| Cloud backup | `.hcbak` format and backup key already end-to-end encrypted |
| Mobile sync | UUIDv7 keys, `row_version`, `updated_at`, append-only visits, audit log as change feed |
| Roles | `user` table and `created_by/updated_by` exist from MVP1 |
| Languages | i18n strings and synonym `lang` column exist |
