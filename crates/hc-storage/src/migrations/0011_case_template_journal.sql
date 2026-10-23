-- M3-RW Slice A1 migration 0011: migrate the 3 seeded case_template
-- schema_json rows to the doctor-journal side-section schema (ADR 0018 /
-- M3-RW-data-json-schema.md §5, M3-RW-template-migration-and-slice-plan.md §2).
-- Forward-only; never edited in place once released (R-DATA-002). Produces
-- user_version = 11 (set by the migration runner).
--
-- In the doctor-journal model the case BODY is the free-form journal
-- (top-level complaints[] inside the opaque visit.data_json, ADR 0007) and is
-- NO LONGER schema-driven. The template schema now describes ONLY the
-- structured SIDE sections. This migration therefore:
--   * REMOVES chief_complaints + hpi (folded into the journal) and
--     personal_history (removed entirely, ADR 0018 #5), plus examination
--     (vitals move into the journal "Record vitals" popup -> vitals table
--     block + visit.vitals_json).
--   * REWRITES physical_generals to gain Constitution, Diet, a yes/no
--     Sun-aggravation (single-choice, no free text) and Notes.
--   * REWRITES family_history to two independent Maternal / Paternal fields
--     (rendered as tabs by S08) in place of the single narrative.
--   * REWRITES investigations to Suggested / Submitted (the Submitted tab hosts
--     the PAT-009 uploads) in place of the single narrative.
--   * bumps the schema `version` 1 -> 2 so a consumer can tell journal-era
--     templates apart, and bumps each row's updated_at + row_version.
--
-- It writes NO visit rows and does NOT touch visit.data_json (old visits are
-- upcast read-time in the UI slice, schema §7). Parameter-free DDL/UPDATE with
-- fixed JSON values; no external input (R-SEC-001). The three ids are the fixed
-- UUIDv7 seeds from migration 0008 referenced via hc_storage::case_template.

-- Chronic detailed (default): the full journal side panel.
UPDATE case_template
SET schema_json = '{"version":2,"sections":[{"key":"physical_generals","title":"Physical generals","collapsible":true,"hideable":true,"fields":[{"key":"appetite","label":"Appetite","type":"text"},{"key":"thirst","label":"Thirst","type":"single-choice","allowFreeText":true,"options":["Thirstless","Small sips","Large quantities"]},{"key":"cravings","label":"Cravings","type":"long-text"},{"key":"aversions","label":"Aversions","type":"long-text"},{"key":"stool","label":"Stool","type":"text"},{"key":"urine","label":"Urine","type":"text"},{"key":"sweat","label":"Sweat","type":"text"},{"key":"sleep","label":"Sleep","type":"text"},{"key":"dreams","label":"Dreams","type":"long-text"},{"key":"thermal","label":"Thermal state","type":"single-choice","allowFreeText":true,"options":["Chilly","Hot","Ambithermal"]},{"key":"constitution","label":"Constitution","type":"text"},{"key":"diet","label":"Diet","type":"text"},{"key":"sun_aggravation","label":"Sun aggravation","type":"single-choice","allowFreeText":false,"options":["yes","no"]},{"key":"notes","label":"Notes","type":"long-text"}]},{"key":"mental_generals","title":"Mental generals","collapsible":true,"hideable":true,"fields":[{"key":"narrative","label":"Mental generals","type":"long-text"}]},{"key":"past_history","title":"Past history","collapsible":true,"hideable":true,"fields":[{"key":"narrative","label":"Past history","type":"long-text"}]},{"key":"family_history","title":"Family history","collapsible":true,"hideable":true,"fields":[{"key":"maternal","label":"Maternal","type":"long-text"},{"key":"paternal","label":"Paternal","type":"long-text"}]},{"key":"menstrual_obstetric","title":"Menstrual / obstetric history","collapsible":true,"hideable":true,"showIf":{"sex":"female"},"fields":[{"key":"menses","label":"Menses","type":"long-text"},{"key":"obstetric","label":"Obstetric history","type":"long-text"},{"key":"leucorrhoea","label":"Leucorrhoea","type":"text"}]},{"key":"investigations","title":"Investigations","collapsible":true,"hideable":true,"fields":[{"key":"suggested","label":"Suggested","type":"long-text"},{"key":"submitted","label":"Submitted","type":"long-text"}]},{"key":"provisional_diagnosis","title":"Provisional diagnosis","collapsible":true,"hideable":true,"fields":[{"key":"dx","label":"Provisional diagnosis","type":"long-text"}]},{"key":"analysis","title":"Doctor analysis / notes","collapsible":true,"hideable":true,"fields":[{"key":"notes","label":"Analysis / notes","type":"long-text"}]}]}',
    updated_at = '2026-10-23T00:00:00Z',
    row_version = row_version + 1
WHERE id = '01920000-0008-7000-8000-000000000001';

-- Acute quick: minimal side panel (provisional_diagnosis + analysis only).
UPDATE case_template
SET schema_json = '{"version":2,"sections":[{"key":"provisional_diagnosis","title":"Provisional diagnosis","collapsible":true,"hideable":true,"fields":[{"key":"dx","label":"Provisional diagnosis","type":"long-text"}]},{"key":"analysis","title":"Doctor analysis / notes","collapsible":true,"hideable":true,"fields":[{"key":"notes","label":"Analysis / notes","type":"long-text"}]}]}',
    updated_at = '2026-10-23T00:00:00Z',
    row_version = row_version + 1
WHERE id = '01920000-0008-7000-8000-000000000002';

-- Child: as chronic but keeps child_development.
UPDATE case_template
SET schema_json = '{"version":2,"sections":[{"key":"child_development","title":"Child development","collapsible":true,"hideable":true,"fields":[{"key":"milestones","label":"Developmental milestones","type":"long-text"},{"key":"birth_history","label":"Birth history","type":"long-text"},{"key":"vaccination","label":"Vaccination","type":"text"},{"key":"schooling","label":"Schooling / behaviour","type":"long-text"}]},{"key":"physical_generals","title":"Physical generals","collapsible":true,"hideable":true,"fields":[{"key":"appetite","label":"Appetite","type":"text"},{"key":"thirst","label":"Thirst","type":"single-choice","allowFreeText":true,"options":["Thirstless","Small sips","Large quantities"]},{"key":"cravings","label":"Cravings","type":"long-text"},{"key":"aversions","label":"Aversions","type":"long-text"},{"key":"stool","label":"Stool","type":"text"},{"key":"urine","label":"Urine","type":"text"},{"key":"sweat","label":"Sweat","type":"text"},{"key":"sleep","label":"Sleep","type":"text"},{"key":"dreams","label":"Dreams","type":"long-text"},{"key":"thermal","label":"Thermal state","type":"single-choice","allowFreeText":true,"options":["Chilly","Hot","Ambithermal"]},{"key":"constitution","label":"Constitution","type":"text"},{"key":"diet","label":"Diet","type":"text"},{"key":"sun_aggravation","label":"Sun aggravation","type":"single-choice","allowFreeText":false,"options":["yes","no"]},{"key":"notes","label":"Notes","type":"long-text"}]},{"key":"mental_generals","title":"Mental generals","collapsible":true,"hideable":true,"fields":[{"key":"narrative","label":"Mental generals","type":"long-text"}]},{"key":"family_history","title":"Family history","collapsible":true,"hideable":true,"fields":[{"key":"maternal","label":"Maternal","type":"long-text"},{"key":"paternal","label":"Paternal","type":"long-text"}]},{"key":"menstrual_obstetric","title":"Menstrual / obstetric history","collapsible":true,"hideable":true,"showIf":{"sex":"female"},"fields":[{"key":"menses","label":"Menses","type":"long-text"},{"key":"obstetric","label":"Obstetric history","type":"long-text"},{"key":"leucorrhoea","label":"Leucorrhoea","type":"text"}]},{"key":"investigations","title":"Investigations","collapsible":true,"hideable":true,"fields":[{"key":"suggested","label":"Suggested","type":"long-text"},{"key":"submitted","label":"Submitted","type":"long-text"}]},{"key":"provisional_diagnosis","title":"Provisional diagnosis","collapsible":true,"hideable":true,"fields":[{"key":"dx","label":"Provisional diagnosis","type":"long-text"}]},{"key":"analysis","title":"Doctor analysis / notes","collapsible":true,"hideable":true,"fields":[{"key":"notes","label":"Analysis / notes","type":"long-text"}]}]}',
    updated_at = '2026-10-23T00:00:00Z',
    row_version = row_version + 1
WHERE id = '01920000-0008-7000-8000-000000000003';
