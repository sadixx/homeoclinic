# MVP1 screen specs

Read `00-conventions.md` first (shell, shortcuts, patterns, notation, template). Release order and demos: `../milestones/README.md`. Each spec has a `Release slices` section saying what works in each release and what stays behind a feature flag.

| Screen | Id | Route | Milestone | First usable in |
|---|---|---|---|---|
| [S01 First-run setup wizard](S01-first-run-setup.md) | `setup` | `/setup` | M1 | R1 |
| [S02 Lock / unlock](S02-lock-unlock.md) | `lock` | `/lock` | M1 | R1 |
| [S03 Today](S03-today.md) | `today` | `/today` | M0 | R0 |
| [S04 Global patient search](S04-global-search.md) | `search` | `overlay` | M2 | R2 |
| [S05 Patient list and filters](S05-patient-list.md) | `patient-list` | `/patients` | M2 | R2 |
| [S06 Patient register / edit form](S06-patient-form.md) | `patient-form` | `/patients/new` | M2 | R2 |
| [S07 Patient dashboard](S07-patient-dashboard.md) | `patient-dashboard` | `/patients/:id` | M2 | R2 |
| [S08 First (detailed) case form](S08-case-form.md) | `case-form` | `/patient/:patientId/case/:visitId` | M3 | R3 |
| [S09 Follow-up visit](S09-follow-up-visit.md) | `followup` | `/patient/:patientId/visit/:visitId/followup` | M3 | R3 |
| [S10 Repertory browser](S10-repertory-browser.md) | `repertory-browser` | `/repertory` | M5 | R6 |
| [S11 Repertorisation workspace](S11-repertorisation.md) | `repertorisation` | `/repertory/analysis` | M6 | R7 |
| [S12 Materia Medica reader](S12-materia-medica.md) | `materia-medica` | `/materia-medica` | M5 | R6 |
| [S13 Prescription](S13-prescription.md) | `rx` | `/visit/:visitId/prescription` | M7 | R4 |
| [S14 Print preview](S14-print-preview.md) | `print-preview` | `/print/:docType/:id` | M7 | R4 |
| [S15 Invoice](S15-invoice.md) | `invoice` | `/visit/:visitId/invoice` | M8 | R5 |
| [S16 Reports](S16-reports.md) | `reports` | `/reports` | M8 | R5 |
| [S17 Backup and restore](S17-backup-restore.md) | `backup` | `/backup` | M1 | R1 |
| [S18 Settings](S18-settings.md) | `settings` | `/settings` | M1 | R1 |
| [S19 Repertory pack manager](S19-pack-manager.md) | `pack-manager` | `/packs` | M5 | R6 |
| [S20 Licence and Buy](S20-licence.md) | `licence` | `/licence` | M9 | R8 |
| [S21 Help](S21-help.md) | `help` | `/help` | M10 | R9 |
| [S22 Citations](S22-citations.md) | `citations` | `/citations` | M6 | R7 |

Open questions from all specs: `OPEN-QUESTIONS.md`.
