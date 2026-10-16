# MVP2, MVP3, MVP4 Requirements

Start MVP2 only after MVP1 acceptance (05) passes, at least 20 pilot doctors use MVP1 for 4 weeks, and MVP1 revenue covers the hosting and operations cost of our first servers. Designs for MVP2-5 are ready but not built until then.

## MVP2: Clinic grows

### Hosted licence and payments (SRV)
| ID | Requirement |
|---|---|
| SRV-001 | Build and host the licence server, customer portal and admin dashboard (03 sections 5-7: LIC-010..014, PAY, LSRV) on AWS ap-south-1, replacing the manual WhatsApp + Vendor Licence Tool flow (03 section 3). |
| SRV-002 | Import the Vendor Licence Tool register (LIC-048); existing licences keep working unchanged. |
| SRV-003 | Turn on online activation, automatic issuance after UPI payment, UPI AutoPay subscriptions, weekly silent refresh and revocation, abuse detection (TAM-011), pack catalogue (PACK-010). |

### Cloud backup (CLD)
| ID | Requirement |
|---|---|
| CLD-001 | Opt-in encrypted cloud backup. Encryption happens on device (AES-256-GCM, key from backup password via Argon2id). Server never sees plaintext or password (zero-knowledge). |
| CLD-002 | Schedule: daily incremental (changed rows + new attachments), weekly full. Works on slow 3G/4G: resumable chunked upload (e.g. 4 MB chunks), pause/resume. |
| CLD-003 | Restore from cloud to a new PC with licence login + backup password. Clear warning: lost password = unrecoverable backup; offer printable recovery key at setup. |
| CLD-004 | Storage: S3-compatible object storage in India region; per-customer prefix; server-side encryption on top. |
| CLD-005 | Backup status widget on home screen (last cloud backup time, size). |

### LAN multi-user and roles (USR)
| ID | Requirement |
|---|---|
| USR-001 | One PC acts as "Main computer" hosting the DB; other PCs on the same LAN connect as clients (embedded HTTPS server on the main PC, auto-discovery via mDNS, pairing by 6-digit code shown on main PC). |
| USR-002 | Server binds to LAN interface only, TLS with self-signed cert pinned at pairing, every request authenticated with per-device token. |
| USR-003 | Roles: Doctor (all), Assistant doctor (all except settings/licence), Receptionist (registration, appointments, billing; no case notes or analyses), Dispenser (prescriptions view, stock). |
| USR-004 | Per-user login with PIN; audit log records user. |
| USR-005 | Licence counts seats (Main + N clients). |

### Dispensary and stock (STK)
| ID | Requirement |
|---|---|
| STK-001 | Medicine inventory: remedy, potency, form, quantity, unit, batch, expiry, supplier, purchase price, MRP. |
| STK-002 | Auto-deduct on prescription dispense; low-stock and expiry alerts. |
| STK-003 | Purchase entry and simple supplier ledger. |
| STK-004 | "Only in stock" filter in repertory results (REP-040). |

### Communication (COM)
| ID | Requirement |
|---|---|
| COM-001 | Follow-up reminders and Rx sharing via WhatsApp Business API (through a provider like Gupshup/Interakt) and SMS (DLT-registered templates, TRAI rules). Paid credit packs. Queue messages offline, send when online. |
| COM-002 | Birthday/festival greeting campaigns (opt-in patients only). |

### Reports (RPT)
| ID | Requirement |
|---|---|
| RPT-001 | Patient statistics (new vs follow-up, by age/sex/city/diagnosis), revenue trends, top remedies prescribed, follow-up adherence. |
| RPT-002 | Remedy outcome summary: per remedy, % of follow-ups marked Better (from VIS-002). |

### Other MVP2
| ID | Requirement |
|---|---|
| I18N-001 | UI in Hindi, Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam (string files; repertory content stays English, synonyms gain language mappings, REP-016). Rx printing in patient's language for advice text. |
| CPK-001 | Additional free repertories (Boger-Boenninghausen, Clarke MM) and first licensed paid pack. |

## MVP3: Anywhere access (mobile)

| ID | Requirement |
|---|---|
| MOB-001 | Android (8+) and iOS (15+) apps from the same Tauri 2 + React codebase (mobile layout). |
| MOB-002 | Sync: desktop remains source of truth. Sync via cloud relay with end-to-end encryption (same key as CLD). Conflict policy: per-field last-writer-wins with audit history; visits/prescriptions are append-only so conflicts are rare. Use a CRDT-friendly change log table (row id, column, value, hybrid logical clock, device id). |
| MOB-003 | Mobile offline: full repertory + MM packs downloadable for offline use; recent 6 months of patients cached; full search when online. |
| MOB-004 | Mobile features: patient lookup, view history, add quick visit, repertorise, prescribe, share Rx PDF on WhatsApp, today's follow-ups, app lock with biometrics. |
| MOB-005 | Online appointment booking link (clinic page) with slots, booking flows into desktop appointment book on next sync. |
| MOB-006 | Teleconsult: notes + Rx compliant with Telemedicine Practice Guidelines 2020 (consent, identification, Rx format). Video via external link (Meet/WhatsApp) in MVP3, no built-in video. |
| MOB-007 | Lost phone: remote revoke device from portal; local data wiped on next contact. |

## MVP4: Smart assistant

All smart features run on-device where possible and are suggestions only, shown with source and confidence.

| ID | Requirement |
|---|---|
| AI-001 | Free-text case to rubrics: small on-device model (e.g. embeddings model ~100 MB, ONNX runtime) maps each symptom sentence to top 5 rubrics using vector search over rubric text + synonyms. Doctor accepts/rejects; accept/reject logged to improve ranking locally. |
| AI-002 | Similar cases: find past patients with similar rubric sets and show what remedy worked (from VIS outcomes). |
| AI-003 | Voice case taking in English/Hindi with on-device speech-to-text (e.g. Whisper small) where hardware allows. |
| AI-004 | Optional cloud LLM features only with explicit opt-in per use, de-identified text, and a clear on-screen notice. |
| ABDM-001 | ABHA ID linking and health record sharing per ABDM (National Health Authority) specs, as an optional module. |
| MKT-001 | Content marketplace: publishers sell repertory/MM packs through the app; revenue share; packs encrypted with per-licence keys. |

## MVP5: Migration (de-prioritised)

Built only after MVP1-MVP4 are working end to end. Design is ready in `design/05-data-design.md` section 6.

| ID | Requirement |
|---|---|
| IMP-001 | Import from competitor software exports (CSV/Excel/Access) with mapping wizard; publish migration guides. |
| IMP-002 | Legacy Doctor Clinic (2018, Java + MySQL) importer: reads a live MySQL DB or `.sql` dump and maps all 19 tables (patients, case history, follow-ups, prescriptions, payments, appointments, diet/instructions incl. Shivaji-font Marathi to Unicode, reports, photos). Dry-run report first, then single-transaction commit. |
| IMP-003 | Assisted migration service: support team runs the import remotely or on site for paying clinics. |
