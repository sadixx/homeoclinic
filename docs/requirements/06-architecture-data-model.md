# Architecture, Data Model and Build Plan for the Coding Agent

## 1. Repository layout (monorepo)

> Authoritative layout: `docs/CODE-LAYOUT.md` (decision: `docs/adr/0001-code-layout.md`).
> The tree below is kept in sync with it. Earlier revisions of this section
> named the crates `core`, `repertory`, `licence`, `storage`; that naming is
> superseded by the `hc-*` crate split below.

```
homeoclinic/
  apps/desktop/            # Tauri 2 app: src-tauri (Rust) + src (React/TS)
  crates/hc-domain/        # Entities, value types, validation; no IO
  crates/hc-storage/       # SQLCipher access, migrations, repositories, audit, backup/restore
  crates/hc-search/        # Patient search, phonetic keys, ranking, filters
  crates/hc-repertory/     # Packs, channels, rubric search, bitset scoring, citations, MM
  crates/hc-licence/       # Licence verify, identity lock, clock guard, UPI/WhatsApp QR, offer codes (shared with vendor tool and MVP2 server)
  crates/hc-docs/          # Print/PDF rendering
  crates/hc-app/           # Use-case services + typed Tauri commands
  tools/vendor-licence-tool/ # MVP1: offline licence issuing tool (internal)
  services/licence-server/ # MVP2: axum + PostgreSQL: activation, payments webhook, portal API
  web/portal/              # MVP2: purchase + customer portal (mobile first)
  tools/content-builder/   # CLI: import (OOREP dump, CSV, OCR) -> proofread -> build signed .hcpack
  tools/seed/              # Synthetic data generator
  content-sources/         # source files + REGISTRY.md (internal-eval/ never ships in public builds)
  docs/                    # requirements/, design/, ui/, rules/, milestones/, adr/, task-tracker/
```

Rule: UI calls Rust only via typed Tauri commands (generate TS types with `specta`/`tauri-specta`). No SQL in the UI.

## 2. Databases

Two encrypted patient-side SQLite files per install, plus read-only content
packs, so content updates never touch patient data:
- `clinic.db` (SQLCipher encrypted): patient and clinic data.
- `user_content.db` (SQLCipher encrypted): "My repertory" additions, bookmarks, notes, custom synonyms.
- `content/*.db` (one per pack, read-only, signed): repertory and MM data, attached read-only at runtime; shipped as `.hcpack`, not part of the two patient DBs.

## 3. Core schema (clinic.db), minimum columns

All tables: `id TEXT PRIMARY KEY` (UUIDv7), `created_at`, `updated_at`, `deleted_at` (soft delete), `created_by`, `updated_by`, `row_version INTEGER` (for MVP3 sync).

```
doctor(id, name, qualification, reg_no, reg_council, phone, email, signature_blob)
clinic(id, name, address, phone, gstin, timings_json, fee_first, fee_followup, patient_id_prefix, next_patient_seq)
user(id, name, role, pin_hash)                      -- MVP1 single doctor; table present for MVP2
patient(id, code UNIQUE, name, name_phonetic, sex, dob, dob_is_estimated, mobile, mobile_alt,
        address, city, occupation, marital_status, blood_group, referred_by, photo_path,
        allergies, alerts, consent_at, tags_json)
family_link(id, patient_id, related_patient_id, relation)
case_template(id, name, schema_json, is_default)
visit(id, patient_id, visit_at, type, template_id, data_json, vitals_json, complaint_status_json,
      improvement_pct, remedy_response, next_followup_on, notes)
attachment(id, patient_id, visit_id NULL, file_path, mime, sha256, caption)
analysis(id, visit_id, method, settings_json, result_snapshot_json)
analysis_rubric(id, analysis_id, clipboard_no, pack_id, rubric_id, weight, is_eliminative,
                is_causation, is_excluded, source_text, sort_order)
prescription(id, visit_id, advice_text, diet_json, hide_remedy_names, printed_at)
prescription_item(id, prescription_id, remedy_id, remedy_label, potency, form, dose,
                  frequency, duration, instructions, is_placebo, sort_order)
rx_template(id, name, items_json)
invoice(id, patient_id, visit_id NULL, number, fy, issued_at, subtotal, discount, total, paid, balance)
invoice_line(id, invoice_id, description, qty, rate, amount)
payment(id, invoice_id, paid_at, amount, mode, reference)
appointment(id, patient_id NULL, name, mobile, start_at, duration_min, status, token_no)
audit_log(id, at, user_id, entity, entity_id, action, diff_json)
setting(key PRIMARY KEY, value_json)
licence_state(id, licence_blob, last_seen_at, last_seen_mac)
```

FTS5 virtual table `patient_fts(name, name_phonetic, code, mobile, city)` kept in sync with triggers. Phonetic key: implement an Indian-name-tuned Double Metaphone variant (normalise sh/s, v/w, ph/f, aa/a, ee/i, double letters).

Patient search design (PSR, NFR-002):
- `patient_fts` uses `tokenize='unicode61 remove_diacritics 2'` with `prefix='1 2 3'` indexes for instant prefix matching; a second table `patient_trgm USING fts5(mobile_digits, code_digits, tokenize='trigram')` handles partial digits of mobile and ID.
- Store normalised columns: `mobile_digits` (digits only, no +91), `code_digits`, `name_norm` (lowercase, no dots/extra spaces), `name_phonetic` (one key per name word, space separated).
- Query plan: run exact (ID/mobile), prefix and phonetic queries as one UNION with a rank column (PSR-004), `LIMIT 20` with keyset pagination; never `OFFSET` scans or `LIKE '%x%'` on base tables.
- Denormalise into `patient`: `last_visit_at`, `next_followup_on`, `balance`, `visit_count`, updated by triggers, so result rows and the Today list need no joins.
- B-tree indexes: `visit(patient_id, visit_at DESC)`, `visit(next_followup_on)`, `patient(last_visit_at)`, `patient(next_followup_on)`, `patient(city)`, `prescription_item(remedy_id)`, `invoice(patient_id, issued_at)`, `payment(paid_at)`, `appointment(start_at)`.
- `visit_fts(text)` (external-content FTS5 over visit `data_json` text fields) for PSR-009.
- Run `PRAGMA optimize` on app close and `ANALYZE` after bulk import; page size 4096, `cache_size` 64 MB, `mmap_size` 256 MB, `temp_store=MEMORY`.
- Search runs on a dedicated read connection (WAL allows reads during writes) off the UI thread; stale queries are cancelled when a new keystroke arrives.

## 4. Content pack schema (content/*.db)

```
pack_meta(key, value)
chapter(id, pack_id, name, sort_order)
rubric(id INTEGER, chapter_id, parent_id NULL, text, full_path, depth, remedy_count, sort_order)
rubric_remedy(rubric_id, remedy_id, grade)               -- PRIMARY KEY(rubric_id, remedy_id)
rubric_xref(rubric_id, target_rubric_id, kind)
remedy(id, abbrev, name, common_name, kingdom, family, synonyms_json)   -- master list, shared IDs
mm_book(id, title, author, edition)
mm_section(id, book_id, remedy_id, section, text, sort_order)
remedy_relation(remedy_id, related_remedy_id, kind, source)
synonym(term, lang, maps_to, kind)                       -- kind: word|rubric|chapter
glossary(term, meaning)
rubric_id_map(old_pack_version, old_rubric_id, new_rubric_id)   -- PACK-005
grade_scale(grade, label, normalised_grade, display_style_json)  -- PACK-007, per pack
rubric_page_ref(rubric_id, page, column)                         -- PACK-007, optional
rubric_remedy_author(rubric_id, remedy_id, author_code)          -- PACK-007, optional
rubric_fts USING fts5(full_path, tokenize='trigram')
mm_fts USING fts5(text, tokenize='unicode61')
```

`pack_meta` must include `format_version`, `grade_max`, `language`, `source_id` (PACK-006, PACK-013).

## 4b. User content schema (user_content.db, encrypted)

```
user_repertory(id, name, description, is_shared_import, origin_pack_id NULL)        -- PACK-011
user_rubric(id, user_repertory_id NULL, base_pack_id NULL, base_rubric_id NULL,
            parent_user_rubric_id NULL, chapter, text, full_path)                     -- personal rubric
user_rubric_remedy(id, pack_id NULL, rubric_id NULL, user_rubric_id NULL, remedy_id,
                   grade, citation_id)                                                -- REP-024, citation required
source(id, type, title, author, edition, year, publisher, url, pack_id NULL)          -- CIT-003
citation(id, source_id NULL, page_ref, quote, comment, confidence, patient_id NULL,
         visit_ids_json NULL, created_at)                                             -- CIT-002/004
citation_link(id, citation_id, target_type, target_id, pack_id NULL)                  -- CIT-001
        -- target_type: rubric | rubric_remedy | user_rubric | mm_section | analysis_rubric | prescription
```

The engine merges `user_rubric_remedy` rows into the in-memory bitsets when "include my additions" is on (CIT-008).

Repertorisation engine loads `rubric_remedy` for selected rubrics into memory (bitsets per rubric over remedy index) so scoring is a tight loop. 2,500 remedies fit in 40 u64 words per rubric.

## 5. Scoring formulas (REP-033), reference implementation

For selected rubrics R (excluding is_excluded), remedy m, grade g(r,m) in 0..G_r normalised to 1..3 by `ceil(3*g/G_r)`, weight w(r):

- Sum of grades: S(m) = sum over r of g(r,m) * w(r)
- Totality: sort by C(m) = count of r with g(r,m) > 0, then S(m)
- Elimination: candidate set = remedies with g>0 in every eliminative rubric; then apply chosen method
- Kent: w(r) multiplied by chapter weight (MIND 3, GENERALITIES 2, others 1; configurable)
- Small rubric bonus: if remedy_count(r) < threshold (default 10), add bonus b (default 1) per hit
- Boenninghausen: for each rubric, also include remedies of its parent rubric at grade-1 (generalisation); sum grades
- Tie-break always by C(m) then alphabetical abbrev

Ship fixture tests with a tiny 5-rubric x 6-remedy pack where expected rankings are computed by hand.

## 6. Build order (milestones the coding agent follows)

| M | Deliverable | Done when |
|---|---|---|
| M0 | Monorepo, CI, Tauri shell launches on Win + Linux, signed dev builds | CI artifacts install and open on both OS |
| M1 | storage crate: SQLCipher, migrations, PIN unlock, backup/restore (BAK-001..004) | Round-trip and kill-during-write tests pass |
| M2 | Patients + search + lookup + dashboard (PAT P0, PSR P0) + `tools/seed` generator | Acceptance flow 2 passes; NFR-002 budgets met at 50k and 100k seeded data |
| M3 | Case templates + visits + follow-ups + Today screen (CASE, VIS P0) | Flows 3 and 7 pass |
| M4 | content-builder with `import-oorep` and CSV importers, content registry, internal-eval packs (publicum, kent-de, Boericke MM, remedy master), sample public pack, pack verifier/loader, internal and public build profiles (CONT-001..010, PACK-001..005) | Internal build installs all eval packs; public build rejects them; tampered pack rejected; CONT-005 gate green on a public build |
| M5 | Rubric search, browser, MM reader, repertory manager (REP-010..024, MM-001..003, PACK-006..009, PACK-013) | Perf NFR-003 met on full Kent; a second test repertory with a 1-4 grade scale installs from file and works with no code change |
| M6 | Repertorisation workspace + results grid/list + citations (REP-030..038, CIT-001..006) | Flow 4 fixtures pass, NFR-004 met, flow 11 passes |
| M7 | Prescription + printing + WhatsApp link (RX P0) | Flow 6 passes |
| M8 | Billing + reports (BILL P0) | Flow 8 passes |
| M9 | Licence crate + Buy screen (offline UPI QR, WhatsApp QR, offer codes) + import paths + Vendor Licence Tool (verification, register, PDF certificate, invoice, email) (LIC-001..064, PAY-010..016) | 03 section 8 MVP1 tests pass; no hosted server needed |
| M10 | Polish: help, shortcuts, audit log, P1 items, installers, code signing, tamper hardening (TAM P0) in the release pipeline | All 13 flows pass on the protected release build (SUX); usability test NFR-031; release scan job (TAM-012) green |

## 7. Instructions to the coding agent

1. Implement milestone by milestone; do not start M(n+1) until M(n) "Done when" passes.
2. Reference requirement IDs in commit messages and test names.
3. Where a requirement is ambiguous, record the decision in `docs/adr/NNN-title.md` and continue with the simplest option that satisfies the principles in 00.
4. Never ship real copyrighted repertory content; use public-domain sources or clearly marked sample data until licences are confirmed (02 section 2).
5. Never commit secrets (signing keys, offer-code keys, payment credentials). Use environment variables and a secrets manager.

## 8. Open questions for the product owner

1. Final product name, pricing and trial length.
2. Which licensed repertory (Synthesis, Complete, Phatak, Murphy) to pursue first, and budget for the licence.
3. Source of digitised Kent: in-house OCR and proofreading (cost/time) or purchase a verified dataset.
4. Business entity, business UPI ID and WhatsApp Business number for MVP1 payments (gateway such as Razorpay only from MVP2); GST registration need to be confirmed with a CA.
5. Is a dealer/distributor channel needed at launch (PAY-008)?
6. Pilot group: which 20 doctors, which cities, which languages.
