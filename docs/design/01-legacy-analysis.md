# 01. Legacy "Doctor Clinic" (2018) Analysis

Source: `~/Doctor-Clinic/DoctorClinic/` (jar dated Dec 2017, logs to Dec 2018). Only compiled classes are present; there is no Java source except one Eclipse WindowBuilder helper. Findings come from the jar class list, the MySQL schema (`Original Database/doctorclinic.sql`), Jasper report templates, folder layout and the error logs. Patient photos, PDFs and the SQL dumps contain real patient data and were not opened or copied.

Diagram: `diagrams/svg/13-legacy-architecture.svg`.

## 1. What it is

| Aspect | Legacy implementation |
|---|---|
| UI | Java Swing, JTattoo look and feel, ~66 screen/helper classes in the default package (Home, LoginPage, PatientDetailsPanel, CasePaper, FollowUp, GeneralPrescription, CustomerPayment, ViewAppointMent, BirthdayReminder, ReferLetter, ...) |
| Database | Separate MySQL server over JDBC (`DBConnect`, `SettingDatabase`), latin1 charset, 19 tables |
| Printing | JasperReports (17 `.jrxml` templates) + iText: case paper, follow-up, prescription, receipt, certificate, envelope, instruction, diet, declaration, referral letter |
| Reports | Daily collection, date-wise payment/ledger/follow-up, medicine report, Excel export via jxl |
| Photos | Webcam capture via OpenCV (`ImageCapture`), files in `Patient Photos/` |
| Local language | Marathi instructions printed using legacy Shivaji fonts (non-Unicode font hack) |
| Licence | `KeyGen`, `Encryptor`, `RenewalLicense`, `LicenseExpired`; `tbllicenceinfo(EndDate)` single row in the database; `GetComputerName` hints at machine binding |
| Backup | Manual `.sql` dump to `Backup/` |
| Packaging | Single 33 MB fat jar; needs a Java runtime and a MySQL server installed and running |

## 2. Legacy data model (19 tables)

| Group | Tables | Notes |
|---|---|---|
| Patient | `tblpatient` (CaseNo, name, address, contact, sex, dob, age, marital, education, referred by, occupation, weight, height) | Composite PK (Id, CaseNo); no mobile normalisation, no photo column (photo by file name) |
| Case | `tblchiefcomplaint` (Complaint1..3), `tblhistory` (past, family, desires, aversions, thirst, stools, thermals, urine, perspiration, sleep), `tblgeneralities` (sun, fasting, sleep loss, getting wet, ascending, BP, dream, pulse), `tblmentals`, `tblmenstrualhistory` | One row per case per table, fixed columns, free text |
| Visits | `tblfollowup` (date, weight, complaints, diagnosis, medicine, rubrics, charges, status) | Rubrics and medicines stored as free text, not linked to any repertory |
| Rx | `tblpriscription` | Copies patient name/address/age into the Rx row (denormalised), medicine as text |
| Money | `paymentcustomer` (total, paid, balance, now paid, mode, flags), `tblreceipt` | Money as `double` (rounding errors) |
| Other | `tblappointment`, `tbldiagnosis`, `tbldiet`, `tblinstruction` (with language), `tbldeclaration`, `tblreports` (file path), `tblclinicsetting`, `login`, `tbllicenceinfo` | Single clinic, single user |

## 3. Problems seen (what the new design must fix)

| # | Problem | Evidence | New design response |
|---|---|---|---|
| L1 | Needs a MySQL server; connection drops | 13 CommunicationsException, 11 connection-closed errors in logs | Embedded SQLite, no server (ADR-002) |
| L2 | SQL errors at runtime | 53 MySQLSyntaxErrorException, 148 SQLException traces; likely string-built SQL (also an SQL injection risk) | Parameterised queries only, compile-time checked SQL in Rust |
| L3 | No repertory at all; rubrics are typed as text | `tblfollowup.Rubrics` text column | Integrated repertory engine (doc 03) |
| L4 | Only 3 complaints, fixed case fields | `Complaint1..3`, fixed columns | Template-driven case JSON (CASE-004) |
| L5 | Licence is one editable date in the DB | `tbllicenceinfo(EndDate)` | Signed Ed25519 licence file (doc 04) |
| L6 | Plain-text or weakly protected passwords and no data encryption | `login.UserPassword text` | Argon2id PIN hash, SQLCipher DB |
| L7 | Non-Unicode Marathi via special fonts | Shivaji*.ttf, latin1 DB | UTF-8 everywhere, Noto Devanagari fonts |
| L8 | Money stored as `double` | `paymentcustomer` | Integer paise (`INTEGER`) |
| L9 | Manual SQL dump backups only | `Backup/backup.sql` | Automatic encrypted rotating backups (BAK) |
| L10 | Heavy install (Java + MySQL + 33 MB jar) | Folder layout | Single small installer, no runtime prerequisites |

## 4. Features to keep (doctors already rely on them)

Case paper print, follow-up history, general prescription, payment receipt with amount in words (`NumtoWord`), daily collection and date-wise reports, appointments, birthday reminders, diet and instruction sheets in Marathi, medical certificate, referral letter, envelope print, declaration print, patient report uploads, webcam photo, theme setting.

Gap against current requirements: certificate, referral letter, envelope, declaration and birthday reminder are not in 01-mvp1-requirements.md. Proposed as new IDs in `06-review-questions.md` (Q1).

## 5. Migration path (MVP5, de-prioritised)

Migration is built only after MVP1-MVP4 work end to end (requirement IMP-002). The design below is kept ready.


A one-time importer (`tools/legacy-import`, see 05-data-design.md section 6) reads either a live legacy MySQL database or a `.sql` dump and maps all 19 tables into the new schema, so existing users can switch without losing records.
