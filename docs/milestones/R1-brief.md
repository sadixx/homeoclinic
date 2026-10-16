# R1 Set up and protect (milestone M1)

> Release-to-milestone grouping (per `docs/adr/0002-working-software-every-milestone.md`):
> this brief maps **R1 -> M1**. Authoritative release table and demo scripts:
> `docs/milestones/README.md`.

## Doctor outcome

Run the first-run wizard to enter the doctor profile, clinic profile and PIN,
and print the one-time recovery code; the licence step shows "Development
trial". Close and reopen the app and unlock it with the PIN (a wrong PIN is
refused, and the app auto-locks when idle). Back up the encrypted data to a
folder or USB with a password, and restore it on a clean install so the
doctor and clinic profile come back.

## Scope

R1 builds the encrypted storage foundation and the thin UI slice that makes it
usable: the SQLCipher pool with WAL and foreign keys, the PIN-derived key
hierarchy, forward-only migrations with automatic pre-migration backups, the
encrypted attachment store, the audit-log writer, the first-run wizard, the
PIN lock/unlock screen with idle auto-lock and recovery code, and the full
backup / restore story (.hcbak format, automatic rotation, manual backup to
USB, restore wizard, integrity check). From this release on, every release
must open the previous release's data after an upgrade install.

## Task ids (milestone M1)

P0 tasks:
- HC-MVP1-020 SQLCipher pool: 1 writer and 4 reader connections, WAL, foreign keys
- HC-MVP1-021 Key hierarchy: random DEK wrapped by PIN-derived KEK (Argon2id), OS store
- HC-MVP1-022 Forward-only migrations with user_version and automatic pre-migration backup
- HC-MVP1-024 Encrypted attachment store (AES-256-GCM blobs in files/)
- HC-MVP1-025 Audit log writer used by every write command
- HC-MVP1-026 First-run wizard: language, doctor profile, clinic profile, licence (trial)
- HC-MVP1-027 PIN set, unlock screen, idle auto-lock, printed recovery code
- HC-MVP1-030 .hcbak format: header, Argon2id key, AES-256-GCM chunked stream of DB
- HC-MVP1-031 Automatic daily backup with 14 daily, 8 weekly, 12 monthly rotation
- HC-MVP1-032 Manual backup to any folder or USB
- HC-MVP1-033 Restore wizard with preview, safety backup of current data, atomic swap
- HC-MVP1-034 Post-backup integrity check and banner if last good backup older than threshold

P1 tasks (3): HC-MVP1-028 global font size, HC-MVP1-029 data-folder chooser,
HC-MVP1-035 move-to-new-computer guided flow.
Test task: HC-MVP1-023 crash-safety test (killed during writes, DB never corrupt).
M1 has 16 tasks (12 P0 + 3 P1 + 1 test).

Release / demo task:
- HC-MVP1-215 R1 set up and protect: first-run wizard (trial-dev licence step), PIN, backup

Upgrade-path harness (from R1 onward): HC-MVP1-226 installs release N over
release N-1 with seeded data and verifies it opens.

## Screens (docs/ui)

- S01 First-run setup wizard — `docs/ui/S01-first-run-setup.md` (new; licence step = dev trial)
- S02 Lock / unlock — `docs/ui/S02-lock-unlock.md` (new; was a stub in R0)
- S17 Backup and restore — `docs/ui/S17-backup-restore.md` (new)
- S18 Settings — `docs/ui/S18-settings.md` (new; profile, data folder, font size)
- shell, S03 Today — carried over from R0

## Demo script

> Copied verbatim from `docs/milestones/README.md` (R1). E2E regression gate
> (R-DEL-005).

R1
1. Fresh install: wizard collects doctor profile, clinic profile, PIN and
   shows the recovery code; licence step shows "Development trial".
2. Close and reopen: unlock with PIN; wrong PIN is refused.
3. Backup now to a folder with a password; restore it on a clean install;
   doctor and clinic profile come back.
4. R0 demo still passes.

## Requirement ids

Representative ids (fuller detail in `docs/requirements/01-mvp1-requirements.md`
and `docs/requirements/05-nfr-and-acceptance.md`):
- SET-001..SET-006 first-run wizard, doctor/clinic profile, PIN + recovery, font size, data folder
- BAK-001 automatic daily local backup with daily/weekly/monthly rotation (plus manual + restore)
- Encrypted storage, key hierarchy and migrations per `docs/requirements/06-architecture-data-model.md`
- NFR-011 previous-release data always opens (upgrade migrations)

## Out of scope

- No patient register, search, cases, follow-ups, prescriptions, printing,
  billing, repertory or purchase flow — all later releases.
- The licence step is a development trial only; the real Buy / activation flow
  does not ship until R8 (M9).
- Any not-yet-built feature stays behind a compile-time feature flag; no
  visible button leads to a dead end (R-DEL-002 / R-DEL-006).

## Entry / exit (Done when)

- Entry: R0 merged and its demo green.
- Exit: the R1 demo passes as an E2E run tagged `@tier regression` on Windows
  and Linux, the R0 demo still passes, and an upgrade install over R0 opens its
  data (R-DEL-004 / R-DEL-005; harness HC-MVP1-226).
