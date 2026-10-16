# Preparation and decisions

Everything that blocks or must run alongside MVP1 but is not code

Stage code: `PREP`. Tasks: 30. Rough effort: P0 26.5 days, P1 2.5 days.

Legend: `[type/priority/estimate days]`, Req = requirement ids in `requirements/`, Done = acceptance check.

## Epics

| Epic | Milestone | Depends on | Tasks | Days |
|---|---|---|---|---|
| HC-PREP-E01 Business setup | PREP | - | 8 | 8 |
| HC-PREP-E02 Product decisions | PREP | - | 9 | 4.5 |
| HC-PREP-E03 Legal and compliance | PREP | - | 6 | 7 |
| HC-PREP-E04 Signing keys and certificates | PREP | - | 4 | 4.5 |
| HC-PREP-E05 Pilot recruitment | PREP | - | 3 | 5 |

## HC-PREP-E01: Business setup

Milestone: PREP. Depends on: -.

### HC-PREP-E01-F01: Legal entity and money

- [ ] **HC-PREP-001** Choose and register business entity (sole proprietorship, LLP or Pvt Ltd) `[biz/P0/2d]`
  - Done: Registration certificate and PAN available
- [ ] **HC-PREP-002** Open current account in business name `[biz/P0/1d]`
  - Done: Account active, cheque book and net banking working
- [ ] **HC-PREP-003** Set up business UPI ID (PhonePe Business, Paytm for Business, BharatPe or bank merchant UPI) with dashboard showing UTRs `[biz/P0/1d]`
  - Req: PAY-011, LIC-041. Done: Test payment of Rs 1 visible in dashboard with UTR and note
- [ ] **HC-PREP-004** Consult CA on GST registration need and tax invoice format for software licences `[biz/P0/1d]`
  - Req: LIC-045. Done: Written CA advice saved; invoice template fields agreed
- [ ] **HC-PREP-005** Decide refund policy and write it for website and invoice `[biz/P1/1d]`
  - Req: LIC-043. Done: Policy text approved

### HC-PREP-E01-F02: Support channels

- [ ] **HC-PREP-006** Get WhatsApp Business number, profile, business hours and quick-reply templates (payment received, balance due, licence sent) `[biz/P0/1d]`
  - Req: PAY-013, LIC-049. Done: Number active; 3 quick replies saved
- [ ] **HC-PREP-007** Create business email for licence delivery and support `[biz/P0/0.5d]`
  - Req: LIC-045. Done: Mailbox working; SPF and DKIM set so licence mails do not land in spam
- [ ] **HC-PREP-008** Confirm support hours and licence turnaround promise (Q15) `[decision/P0/0.5d]`
  - Req: LIC-049, PAY-016. Done: Hours written in 03-licensing-upi.md and app strings

## HC-PREP-E02: Product decisions

Milestone: PREP. Depends on: -.

### HC-PREP-E02-F01: Open questions from design review

- [ ] **HC-PREP-009** Final product name and logo brief `[decision/P0/0.5d]`
  - Done: Name chosen; domain availability checked
- [ ] **HC-PREP-010** Final prices for 6-month and 1-year plans, UPI only or also cards (Q14) `[decision/P0/0.5d]`
  - Req: PAY-010, PAY-011. Done: Prices written in requirements 03 section 1
- [ ] **HC-PREP-011** Confirm Q11 (certificate PDF without password) `[decision/P0/0.5d]`
  - Req: LIC-045. Done: Decision recorded in design/06-review-questions.md
- [ ] **HC-PREP-012** Confirm Q12 (licensed name and reg no locked on prints, one doctor per licence) `[decision/P0/0.5d]`
  - Req: LIC-006, LIC-007. Done: Decision recorded
- [ ] **HC-PREP-013** Confirm Q13 (no PC limit) `[decision/P0/0.5d]`
  - Req: LIC-064. Done: Decision recorded
- [ ] **HC-PREP-014** Decide Q1: legacy prints in MVP1 (certificate, referral letter, envelope, declaration, birthday list) `[decision/P0/0.5d]`
  - Done: If yes, DOC requirements added to 01-mvp1-requirements.md
- [ ] **HC-PREP-015** Decide Q3: Marathi advice and diet print in MVP1 `[decision/P0/0.5d]`
  - Req: RX-007. Done: If yes, requirement added to 01-mvp1-requirements.md
- [ ] **HC-PREP-016** Decide Q17: who receives internal evaluation builds `[decision/P0/0.5d]`
  - Req: CONT-003, CONT-004. Done: Decision recorded
- [ ] **HC-PREP-017** Decide Q10: EV code-signing certificate budget and optional commercial obfuscator `[decision/P1/0.5d]`
  - Req: TAM-006, TAM-008. Done: Budget approved

## HC-PREP-E03: Legal and compliance

Milestone: PREP. Depends on: -.

### HC-PREP-E03-F01: Content licensing

- [ ] **HC-PREP-018** IP lawyer opinion on public-domain status of Kent 1897, Boericke 1906, Boenninghausen TPB 1891, Allen Keynotes in India `[legal/P0/2d]`
  - Req: REP-001. Done: Written opinion stored with registry
- [ ] **HC-PREP-019** GPL v3 review: may OOREP publicum and kent-de be used in internal evaluation builds given to pilot doctors `[legal/P0/1d]`
  - Req: CONT-003, CONT-006. Done: Written opinion; registry permission status updated
- [ ] **HC-PREP-020** Email OOREP author (Andreas Bauer) asking permission to use English Kent, Boger, Boenninghausen and Boericke conversions in a closed-source product (Q16) `[content/P0/0.5d]`
  - Req: CONT-008. Done: Reply received and stored; registry updated

### HC-PREP-E03-F02: Privacy and terms

- [ ] **HC-PREP-021** Privacy policy and consent text compliant with DPDP Act 2023 `[legal/P0/2d]`
  - Req: PAT-012, PAY-010. Done: Text approved and placed in app strings and website
- [ ] **HC-PREP-022** End-user licence agreement and terms of sale `[legal/P0/1d]`
  - Req: LIC-001. Done: EULA shown in installer and Buy screen
- [ ] **HC-PREP-023** Medical disclaimer for repertorisation results (suggestion only) `[legal/P0/0.5d]`
  - Req: REP-033. Done: Disclaimer text shown in result panel and help

## HC-PREP-E04: Signing keys and certificates

Milestone: PREP. Depends on: -.

### HC-PREP-E04-F01: Keys

Requirements: TAM-006, LIC-047, CONT-002

- [ ] **HC-PREP-024** Buy 2 hardware security keys (primary and backup) supporting Ed25519 `[ops/P0/1d]`
  - Req: LIC-047. Done: Keys received and tested
- [ ] **HC-PREP-025** Generate keys: licence signing, offer-code signing, public content, eval content, update manifest; record key ids `[ops/P0/1d]`
  - Req: LIC-001, PAY-012, CONT-002, NFR-042. Done: 5 public keys exported for embedding; private keys only on hardware or offline media
- [ ] **HC-PREP-026** Sealed paper backup of private keys stored in a safe place `[ops/P0/0.5d]`
  - Req: LIC-047. Done: Backup envelope stored; recovery tested once
- [ ] **HC-PREP-027** Buy EV code-signing certificate (Windows Authenticode) `[ops/P0/2d]`
  - Req: TAM-006, SUX-009. Done: Certificate on token; test signature verifies on Windows

## HC-PREP-E05: Pilot recruitment

Milestone: PREP. Depends on: -.

### HC-PREP-E05-F01: Pilot doctors

Requirements: NFR-031

- [ ] **HC-PREP-028** Recruit 20 pilot doctors across at least 3 cities and 2 languages `[biz/P0/3d]`
  - Req: NFR-031. Done: Signed-up list with contact, PC specs and preferred language
- [ ] **HC-PREP-029** Pilot evaluation agreement (free use, feedback, data stays on their PC, evaluation content not for redistribution) `[legal/P0/1d]`
  - Req: CONT-004. Done: Agreement template signed by each pilot doctor
- [ ] **HC-PREP-030** Collect sample paper prescriptions, case papers and letterheads from pilot doctors `[biz/P1/1d]`
  - Req: RX-005. Done: At least 10 samples to guide print layouts
