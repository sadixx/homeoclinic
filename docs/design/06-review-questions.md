# 06. Review Questions and Proposed Changes

Please mark each item Accept / Reject / Change in the review.

## Proposed requirement additions (from legacy analysis)

| Q | Proposal | Reason |
|---|---|---|
| Q1 | Add DOC-001..005 to MVP1 as P1: medical certificate, referral letter, envelope print, patient declaration, birthday reminder list | Legacy users print these today (Prints/Certificate, Envelope, Letter, Declaration; BirthdayReminder class). Dropping them would block migration. |
| Q2 | RESOLVED: legacy Doctor Clinic importer moved to MVP5 (IMP-002) with IMP-001; design kept ready | Owner decision 2026-10-14: focus on complete offline MVP1 first |
| Q3 | Add Marathi advice/diet print in MVP1 (UI stays English) | Legacy prints Marathi instruction and diet sheets; current spec puts languages in MVP2. |

## Owner decisions (2026-10-14)

- 2026-10-15: MVP1 integrates every repertory/MM we can obtain (OOREP publicum, kent-de, Boericke) as plug-and-play internal-eval packs for testing only; they are excluded from public builds automatically (requirements 02 sections 2b-2c, CONT-001..010).

- MVP1 is a complete offline product with no hosted servers; payment by offline-generated UPI QR to our business UPI ID, proof via pre-typed WhatsApp QR with screenshot, signed licence + certificate PDF emailed from the offline Vendor Licence Tool, doctor imports it offline (requirements 03 section 3).
- Products for MVP1: 6-month and 1-year licences only.
- AWS backend, portal, cloud backup and mobile apps start from MVP2 only once MVP1 revenue funds them; designs stay ready.
- Migration (legacy and competitor import) is MVP5.

## Defaults chosen for licensing (please confirm or change)

| Q | Default used in requirements | Alternative |
|---|---|---|
| Q11 | Licence certificate PDF is not password protected; the Ed25519 signature makes it tamper-proof (LIC-045) | Password = registered mobile number |
| Q12 | Licensed name + registration number are locked and printed on all documents (LIC-006); second doctor needs own licence (LIC-007) | Allow a named assistant doctor on the same licence |
| Q13 | No PC limit: unlimited reinstalls for the same doctor (LIC-064); install_id recorded only | Cap at 2 PCs using install_id or fingerprints (needs re-issue on PC change) |
| Q14 | Placeholder prices Rs 2,299 / 6 months and Rs 3,999 / year; UPI only, no cards in MVP1 | Final prices from you |
| Q15 | Support hours Mon-Sat 10:00-19:00 IST, licence within 1 hour (LIC-049) | Your actual hours |

## Content questions

| Q | Question | Proposed default |
|---|---|---|
| Q16 | Ask OOREP author (Andreas Bauer) for permission to use his English Kent, Boger, Boenninghausen and Boericke conversions in a closed-source product? | Yes, ask now; it could remove months of OCR work |
| Q17 | Who may receive internal builds (team only, or also pilot doctors under a written evaluation agreement)? | Team only until legal review of GPL content |

## Design decisions needing confirmation

| Q | Question | Proposed default |
|---|---|---|
| Q4 | Tauri 2 + React + Rust (ADR-001, 003) instead of staying on Java | Tauri; legacy Java code has no source and is not reusable |
| Q5 | Rx printing from HTML templates via webview (ADR-008) replacing Jasper | HTML templates; doctor can adjust letterhead margins |
| Q6 | Backend on AWS ap-south-1 (ECS Fargate + RDS + KMS) from MVP2 | Yes when funded; start MVP2 on a single small VM if cost matters |
| Q7 | Build plan of about 3.5 months with 3 developers + 1 content person (diagram 17) | Indicative; Kent digitisation (M4) is the critical path |
| Q8 | Is the legacy "Doctor Clinic" our own product (so its users and data format are ours to migrate), or a third-party product used as reference? | Assumed ours |
| Q9 | Keep a single PIN per clinic in MVP1 (no separate receptionist login until MVP2) | Yes |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Kent digitisation quality | Wrong remedies in results | Proofreading targets, golden checks against printed book samples |
| Low-end Windows PCs without WebView2 | App will not start | Bundle offline WebView2 installer (NFR-040) |
| Doctors forget backup password | Backup unusable | Printed recovery key at setup, local backups also keyed by DEK |
| Licence cracking | Revenue loss | Layered anti-tamper (02 section 6b, TAM-001..013): hardened single binary, integrity checks, many licence checks, paid packs encrypted with device-bound keys, watermark tracing. Cannot be made 100% uncrackable, but a cracked copy gets no paid content, updates or cloud |
| Eval content leaks into a public release | GPL / copyright exposure | Separate eval signing key, public build cannot open eval packs, CI release gate (CONT-003, CONT-005), registry with permission status |
| No public repertory ready at launch | Public MVP1 has nothing useful to repertorise | Start OCR of public-domain Kent early (M4 critical path) and ask OOREP author for permission in parallel (Q16) |
| Anti-tamper false positives | Genuine doctor locked out or antivirus flags app | Only Read-only response (TAM-013), no packers, AV scan on every release, reinstall/online re-check clears it |
| Security slows or annoys doctors | Doctors abandon the app | SUX-001..012 as release gates: budgets measured on protected build, no dialogs, offline forever, two-check confirmation, self-repair, never interrupt a visit |

## Added question

| Q | Question | Proposed default |
|---|---|---|
| Q10 | Budget for an EV code-signing certificate (about Rs 25-40k/year) and an optional commercial obfuscator for the licence module | EV cert yes (also removes SmartScreen warnings); start with open-source obfuscation, buy commercial only if cracks appear |
