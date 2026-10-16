# HomeoClinic - Product Requirements: Overview

Working name: HomeoClinic (rename freely). Read files in order 00 to 06. Requirement IDs (e.g. PAT-001) are stable and must be referenced in code comments, tests and commits.

## 1. Vision

A cheaper, faster, simpler alternative to Zomeo / RadarOpus / Complete Dynamics for Indian homoeopathic physicians.

- Works 100% offline. Internet is never required for daily clinical work.
- Built for non-technical doctors: few clicks, big fonts, keyboard + mouse friendly, no jargon.
- Repertory and Materia Medica are built in and tightly linked to the patient case.
- Runs on Windows 10/11 and Linux (Ubuntu 20.04+). Mobile (Android/iOS) later.
- Licence can be activated offline. Purchase and renewal via UPI.

## 2. Users (personas)

| Persona | Description | Main needs |
|---|---|---|
| Solo doctor (primary) | 1 clinic, 20-60 patients/day, low tech comfort, often uses a 4-8 GB RAM laptop | Fast case entry, repertorise in < 2 min, print/WhatsApp Rx |
| Receptionist / assistant | Registers patients, takes fees, books follow-ups | Simple patient search, billing, no access to case notes (MVP2) |
| Student / intern (secondary) | Learning repertory | Repertory + Materia Medica browsing, cheap licence tier |
| Multi-doctor clinic (MVP2+) | 2-5 doctors on LAN | Shared database, per-user roles |

## 3. Guiding principles (apply to every feature)

1. Offline first. Every MVP1 feature must work with network cable unplugged.
2. Do basics right before fancy features. A slow or confusing patient screen is a P0 bug.
3. Data belongs to the doctor. Always exportable (CSV/JSON/PDF), never locked by licence expiry (read-only mode, see LIC-020).
4. No data loss. Auto-save every field, daily automatic local backup, crash-safe database writes.
5. Privacy by default. Local database encrypted at rest; cloud backup end-to-end encrypted (MVP2).
6. Speed budgets (see 05-nfr-and-acceptance.md) are acceptance criteria, not wishes.
7. Security is invisible. Protection (encryption, licence, anti-tamper) must never slow the app, add clicks, need internet, or lock out a genuine doctor (SUX-001..012). If it does, the protection is redesigned.

## 4. Release staging

| Release | Theme | Scope summary |
|---|---|---|
| MVP1 | Complete offline desktop clinic + repertory (no hosted servers) | Patients, case taking, follow-ups, repertory + MM browser, repertorisation, prescription, simple billing, local backup/restore, offline licence with offline UPI QR purchase and emailed signed licence (03 section 3), tamper-protected single-binary release (TAM), Win + Linux installers |
| MVP2 | Clinic grows + our first servers (funded by MVP1 revenue) | Hosted licence server + portal + automated UPI and AutoPay on AWS, encrypted cloud backup, LAN multi-user + roles, dispensary/stock, SMS/WhatsApp reminders, reports, Hindi + regional UI, more repertories |
| MVP3 | Anywhere access | Android + iOS apps with sync, appointment booking link, teleconsult notes, patient-facing Rx share portal |
| MVP4 | Smart assistant | Free-text to rubric suggestion (on-device), case similarity search, remedy outcome analytics, ABDM integration, plugin repertory marketplace |
| MVP5 | Migration (de-prioritised) | Legacy Doctor Clinic importer, competitor software import (CSV/Excel/Access), migration guides and assisted migration service |

Funding gate: MVP1 is self-contained; anything needing our servers or cloud (MVP2+) starts only once MVP1 generates enough revenue. Designs for all MVPs are kept ready.

Detail: MVP1 in 01, repertory engine in 02, licensing and UPI in 03, MVP2-5 in 04, NFRs and acceptance in 05, architecture and data model in 06.

## 5. Recommended technology (binding unless the coding agent documents a better reason)

| Concern | Choice | Why |
|---|---|---|
| Desktop shell | Tauri 2 (Rust backend) | ~10 MB installer vs 100+ MB Electron, low RAM, same codebase targets Android/iOS in MVP3 |
| UI | React 18 + TypeScript + Vite, Tailwind, shadcn/ui components | Large ecosystem, easy hiring |
| Local database | SQLite via SQLCipher (rusqlite `bundled-sqlcipher`) | Single file, zero admin, encrypted, easy backup |
| Search | SQLite FTS5 with trigram tokenizer + custom synonym table | Offline, fast fuzzy rubric search |
| PDF/print | Rust `printpdf` or HTML-to-PDF via Tauri webview print | Prescription and invoice printing |
| Licence crypto | Ed25519 signatures (`ed25519-dalek`) | Small, offline-verifiable licence files |
| Backend (only for licence + payments, later cloud) | Rust (axum) or Node (Fastify) + PostgreSQL, hosted in India region | Minimal, stateless where possible |
| Payments | MVP1: offline-generated UPI QR to our business UPI ID + WhatsApp proof + offline Vendor Licence Tool. MVP2: Razorpay (UPI Intent, QR, AutoPay), Cashfree fallback | MVP1 needs no gateway, no server, near-zero fees; MVP2 automates |
| Installers | Windows: MSI + NSIS (code-signed). Linux: AppImage + .deb | Double-click install, no admin knowledge needed |
| Auto-update | Tauri updater with signed update manifests; optional, works from USB file too | Offline clinics can update from a pen drive |

## 6. Out of scope (all releases unless stated)

- Allopathic drug interaction databases.
- Insurance claims processing.
- Diagnosis by AI without doctor confirmation. All smart features are suggestions only.

## 7. Legal / compliance checklist (India)

- Digital Personal Data Protection Act 2023: consent capture (PAT-012), right to erase/export, breach notice process.
- Telemedicine Practice Guidelines 2020 (relevant from MVP3).
- Prescription must show doctor name, qualification, NCH/state council registration number, clinic address, date, patient name/age/sex.
- GST invoice format for paid subscriptions (issued by backend, 18% GST on software).
- Repertory/Materia Medica content copyright: see 02 section 2. Do not ship copyrighted modern repertories without a signed licence.
