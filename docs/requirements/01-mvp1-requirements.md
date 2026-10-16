# MVP1 Functional Requirements (offline desktop)

Priority: P0 = must ship, P1 = should ship in MVP1, P2 = can slip to MVP2.

## 1. First-run setup (SET)

| ID | Pri | Requirement |
|---|---|---|
| SET-001 | P0 | First launch wizard (max 4 screens): language (English in MVP1, i18n-ready), doctor profile, clinic profile, licence (trial or activate). |
| SET-002 | P0 | Doctor profile: name, qualification (BHMS/MD Hom/etc.), registration number + council, phone, email, signature image (optional), clinic logo (optional). Name and registration number are pre-filled during trial and become locked to the licensed values on activation (LIC-006). |
| SET-003 | P0 | Clinic profile: name, address, phone, timings, default consultation fee, default follow-up fee, GSTIN (optional). |
| SET-004 | P0 | App PIN/password set at first run. Locks app after N minutes idle (default 15, configurable). Forgot-PIN recovery via recovery code shown once at setup and printed. |
| SET-005 | P1 | Font size setting (Normal / Large / Extra large) applied globally. |
| SET-006 | P1 | Data folder location chooser (default per OS app data dir). |

## 2. Patients (PAT)

| ID | Pri | Requirement |
|---|---|---|
| PAT-001 | P0 | Register patient: name (required), sex, DOB or age (either; age auto-computes approx DOB), mobile, alternate mobile, address, city, occupation, marital status, referred by, blood group, photo (webcam or file). |
| PAT-002 | P0 | Auto patient ID: configurable prefix + running number (e.g. HC-000123). Unique, never reused. |
| PAT-003 | P0 | Global patient search; full requirements in section 2b (PSR-001..013). |
| PAT-004 | P0 | Duplicate warning when name + mobile or name + DOB match an existing patient. Offer merge (P1). |
| PAT-005 | P0 | Patient dashboard: photo, demographics, allergies/alerts banner, timeline of visits (newest first), last prescription, outstanding dues, quick buttons (New visit, Repertorise, Prescribe, Bill). |
| PAT-006 | P0 | Family linking: link patients as family members; shared address; quick switch. |
| PAT-007 | P1 | Tags (e.g. "chronic", "skin", "VIP") with filter. |
| PAT-008 | P0 | Soft delete with 30-day recycle bin; permanent delete requires PIN. |
| PAT-009 | P1 | Attachments per patient/visit: images, PDF lab reports, scanned papers; stored inside data folder, encrypted. Thumbnail viewer. |
| PAT-010 | MVP5 | Import patients from CSV/Excel with column mapping wizard (moved to MVP5 migration, see IMP-001). |
| PAT-011 | P0 | Export single patient full record as PDF and JSON. |
| PAT-012 | P1 | Consent record: checkbox + date "Patient consented to digital record keeping" (DPDP). Printable consent form. |

## 2b. Patient search and lookup (PSR)

Design baseline: 50,000 patients, 500,000 visits, 600,000 prescription items, 50,000 attachments on the reference low-end PC (05 section 1). Must stay within budget up to 100,000 patients (2x headroom). Speed targets are in NFR-002.

| ID | Pri | Requirement |
|---|---|---|
| PSR-001 | P0 | One global search box (Ctrl+K / F2), available on every screen. Search starts from the first character typed and updates as you type (input debounce 80 ms). |
| PSR-002 | P0 | The single box matches, without the doctor choosing a field: name (prefix of any word, e.g. "ram ku" finds "Ramesh Kumar"), patient ID (full or last digits, "123" finds HC-000123), mobile (any 4+ consecutive digits, ignoring +91/spaces), city, family member name. |
| PSR-003 | P0 | Indian-name tolerance: phonetic and spelling-variant matching (Sharma/Sarma, Mohd/Mohammad/Muhammad, Lakshmi/Laxmi, Shree/Sri, Vijay/Wijay), case and diacritic insensitive. Exact matches always rank above phonetic matches. |
| PSR-004 | P0 | Ranking: exact ID or mobile > exact full name > name prefix > phonetic > other fields; ties broken by most recent visit first. |
| PSR-005 | P0 | Result row shows: photo thumbnail, name, ID, age/sex, mobile (masked except last 4 if receptionist role in MVP2), city, last visit date, dues badge. Top 20 shown instantly; scroll loads more (virtualised list, no full result load). |
| PSR-006 | P0 | Keyboard-only flow: type, arrow keys, Enter opens patient dashboard. Enter on an exact ID/mobile match opens it directly. |
| PSR-007 | P0 | Recent patients list (last 20 opened) shown when the search box is empty. |
| PSR-008 | P0 | Advanced filter panel (patient list screen): visit date range, last visit older than N days, next follow-up due (today / overdue / range), age range, sex, city, tags, diagnosis text, remedy prescribed (e.g. all patients given Sulphur), potency, dues > 0. Filters combine with AND; results sortable by name, ID, last visit, next follow-up. |
| PSR-009 | P1 | Full-text search inside case notes and visit text (e.g. "migraine", "psoriasis"), with highlighted snippets and link to the exact visit. |
| PSR-010 | P1 | Saved filters (e.g. "Overdue chronic skin cases") one click from home screen. |
| PSR-011 | P0 | Export current filtered list to CSV/Excel. |
| PSR-012 | P0 | Search indexes update in the same database transaction as the data change, so a newly registered patient is findable immediately. |
| PSR-013 | P0 | Index rebuild tool in Settings (and automatic after restore/import) with progress bar; full rebuild for 50k patients < 60 s. |

## 3. Case taking (CASE)

Homoeopathic case taking is the core. It must feel like writing on paper but structured.

| ID | Pri | Requirement |
|---|---|---|
| CASE-001 | P0 | First (detailed) case form with sections: Chief complaints (multiple, each with Location, Sensation, Modalities aggravation/amelioration, Concomitants, Duration, Onset), History of present illness, Past history, Family history, Personal history, Physical generals (appetite, thirst, cravings, aversions, stool, urine, sweat, sleep, dreams, thermal state), Mental generals, Menstrual/obstetric history (shown for female), Child development (shown for age < 14), Examination findings (BP, pulse, weight, height, BMI auto, temp, SpO2), Investigations, Provisional diagnosis (free text + ICD-10 search optional P2), Doctor's analysis/notes. |
| CASE-002 | P0 | Every section is optional and collapsible. Doctor can hide sections they never use (per-doctor template). |
| CASE-003 | P0 | Pick lists for common values (e.g. Thermal: Chilly / Hot / Ambithermal; Thirst: Thirstless / Small sips / Large quantities) with free text allowed. |
| CASE-004 | P1 | Custom templates: doctor can create/edit case templates (add/remove/reorder fields, field types: text, long text, single choice, multi choice, number, date, scale 0-10). Ships with 3 templates: Chronic detailed, Acute quick, Child. |
| CASE-005 | P0 | Auto-save every 2 seconds and on field blur; no Save button required. Visible "Saved" indicator. |
| CASE-006 | P0 | "Send to repertory" action on any selected text or symptom line: opens rubric search pre-filled with that text (links symptom to rubric, see REP-030). |
| CASE-007 | P1 | Voice dictation into any text field using OS speech input where available (Windows built-in dictation works with plain text fields; no custom engine in MVP1). |
| CASE-008 | P1 | Body diagram (front/back) to mark lesion/pain locations, saved as annotation on visit. |
| CASE-009 | P0 | Read-only "Case summary" printable view. |

## 4. Visits and follow-ups (VIS)

| ID | Pri | Requirement |
|---|---|---|
| VIS-001 | P0 | Each consultation is a Visit: date/time, type (First / Follow-up / Acute / Tele), complaints update, observations, vitals, prescription, fee. |
| VIS-002 | P0 | Follow-up form pre-loads previous visit's complaints with a status per complaint: Better / Same / Worse / New / Resolved, plus percentage improvement slider (0-100) and free text. |
| VIS-003 | P0 | Remedy response quick-pick (Hering's law aware wording): Amelioration, Aggravation then amelioration, No change, Aggravation, New symptoms, Old symptoms returned. |
| VIS-004 | P0 | Next follow-up date (quick buttons: 7d, 15d, 1m, 2m, custom). |
| VIS-005 | P0 | Today's list screen: patients with follow-up due today, overdue follow-ups, today's registered visits. Default home screen. |
| VIS-006 | P1 | Simple appointment book (day view, 15-min slots, drag to reschedule, walk-in queue with token number). |
| VIS-007 | P1 | Progress chart per complaint across visits (improvement % over time) and vitals chart (weight, BP). |

## 5. Prescription (RX)

| ID | Pri | Requirement |
|---|---|---|
| RX-001 | P0 | Add one or more remedies: remedy (autocomplete from remedy master, abbreviation or full name, e.g. "sulph" -> Sulphur), potency (3X, 6X, 6C, 30C, 200C, 1M, 10M, 50M, CM, LM/Q 0/1..0/30, Mother tincture Q), form (globules, pills, liquid dilution, tablets, mother tincture, biochemic, ointment), dose (e.g. 4 pills), frequency (OD, BD, TDS, QID, SOS, weekly, single dose, custom), duration, instructions. |
| RX-002 | P0 | Placebo/SL entries (Sac lac, Phytum, Placebo) with option to hide true remedy name on printed Rx (common practice). Real remedy always stored. |
| RX-003 | P0 | Favourites and saved Rx templates (e.g. "Acute fever kit") insertable in one click. |
| RX-004 | P0 | Repeat last prescription in one click. |
| RX-005 | P0 | Print Rx on A4/A5/letterhead (configurable margins to print on pre-printed letterhead), with doctor/clinic details, registration number, patient details, date, remedies, advice, diet/avoid list, next visit date, signature. |
| RX-006 | P0 | Save Rx as PDF; "Share on WhatsApp" opens `https://wa.me/<mobile>` with message text and reveals PDF file in folder for drag-drop (no WhatsApp API in MVP1). |
| RX-007 | P1 | Standard advice library (diet do/don't, "avoid coffee, camphor, mint" etc.) editable by doctor, multi-select into Rx. |
| RX-008 | P1 | Warning when prescribing a remedy listed as inimical to the previous remedy (data from remedy relationships table, see 02). |

## 6. Billing (BILL)

| ID | Pri | Requirement |
|---|---|---|
| BILL-001 | P0 | Invoice per visit: consultation fee + medicine charges + other line items, discount (amount or %), total, paid amount, mode (Cash, UPI, Card, Other), balance. |
| BILL-002 | P0 | Running patient balance (dues / advance) shown on patient dashboard. |
| BILL-003 | P0 | Print/PDF receipt with sequential receipt number per financial year (Apr-Mar). |
| BILL-004 | P0 | Daily collection report (by mode) and monthly summary; export to Excel/CSV. |
| BILL-005 | P1 | Clinic UPI QR on receipt/screen: generate a static UPI QR from the doctor's own UPI ID (`upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR`) so patients pay the doctor directly. No gateway needed; doctor marks as paid. |
| BILL-006 | P2 | Optional GST invoice fields if GSTIN set. |

## 7. Repertory and Materia Medica

See 02-repertory-engine.md (REP-* and MM-* IDs). All REP/MM P0 items are in MVP1.

## 8. Backup and restore (BAK)

| ID | Pri | Requirement |
|---|---|---|
| BAK-001 | P0 | Automatic daily local backup on app close (or first launch of the day), keeping last 14 daily + 8 weekly + 12 monthly. Uses SQLite online backup API (safe while app runs). |
| BAK-002 | P0 | Manual "Backup now" to any folder or USB drive. Backup file = single encrypted archive `.hcbak` (DB + attachments), encrypted with a backup password (Argon2id key derivation, AES-256-GCM). |
| BAK-003 | P0 | Restore wizard: choose file, enter password, preview (patient count, last visit date), confirm. Current DB is backed up before restore. |
| BAK-004 | P0 | Backup integrity check (checksum + decrypt test) after each backup; warning banner if last successful backup > 7 days. |
| BAK-005 | P1 | "Move to new computer" guided flow = backup + restore + licence re-import (LIC-064). |

## 9. Settings and admin (ADM)

| ID | Pri | Requirement |
|---|---|---|
| ADM-001 | P0 | Edit doctor/clinic profile, print layouts, fees, ID prefix, auto-lock time. |
| ADM-002 | P0 | Audit log of create/update/delete on patients, visits, prescriptions, bills (who, when, what changed). Viewable, not editable. |
| ADM-003 | P1 | Keyboard shortcuts screen (F1 help, F2 search, F5 new visit, F6 repertory, F7 prescribe, F8 bill, Ctrl+P print). |
| ADM-004 | P0 | In-app help: short how-to videos linked (online) and bundled illustrated help pages (offline). |
| ADM-005 | P0 | "Send diagnostic report" creates a zip of logs (no patient data) the doctor can email/WhatsApp to support. |
