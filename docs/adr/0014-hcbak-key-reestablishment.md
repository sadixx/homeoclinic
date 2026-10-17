# ADR 0014: `.hcbak` key re-establishment on restore to a clean install

Date: 2026-10-17. Status: accepted.

Supersedes the "ADR 0003" placeholder in the Slice D design handoff: ADR ids
0003..0013 are already reserved for the eleven architecture decisions from
`docs/design/02-architecture-overview.md` section 7, so this decision takes the
next free number (0014). Requirements: BAK-002, BAK-003, NFR-011, NFR-020,
NFR-022. Screen: S17.

## Context

`clinic.db` is encrypted at rest with SQLCipher under a per-install Data
Encryption Key (DEK). The DEK is wrapped by a PIN-derived KEK (Argon2id) and
stored in that install's keystore (OS secure store, or the encrypted-file
fallback on headless Linux — ADR 0004, HC-MVP1-021). The DEK never leaves the
install.

A backup (`.hcbak`, HC-MVP1-030) must be restorable on a **different, clean
install** (restore wizard flow 9, R1 demo step 3) where neither the source DEK
nor the source PIN exists. So the archive cannot simply carry the
SQLCipher-encrypted `clinic.db` bytes: a fresh install has no key to open them.
The backup is instead protected by a **backup password**, which is independent
of the PIN/DEK (SUX-011, OQ-S17-2: minimum 8 characters).

Two key domains therefore meet at restore time and must be bridged:

- the **backup password** (Argon2id) that seals the archive body, and
- the **target install's own DEK** that the restored `clinic.db` must open under.

## Decision

The `.hcbak` body carries a **portable, UNENCRYPTED SQLite snapshot** of
`clinic.db`, produced online via SQLCipher's `sqlcipher_export` into an attached
plaintext database (`KEY ''`). That portable snapshot is serialized together
with the attachment blobs into the body payload, which is then sealed with
**AES-256-GCM under a key derived from the backup password** (`Argon2id(backup_
password, per-archive salt)`, reusing the Slice B `derive_backup_key` /
`wrap`/`open` helpers — no reinvented crypto). The plaintext snapshot never
touches the disk in the clear beyond a short-lived temp file inside the data dir
that is deleted immediately, and the decrypted payload is held only in a
`Zeroizing` buffer in memory (R-PRIV-002, R-SEC-006).

On **restore**, the engine:

1. reads the plaintext header (no password) for the preview, then decrypts the
   body with the backup password (a wrong password fails the first chunk's GCM
   tag → `WrongBackupPassword`, distinct from a damaged file → `BadArchive`);
2. writes the portable plaintext snapshot to a temp file and **re-imports it
   into a brand-new `clinic.db` keyed with the TARGET install's own DEK** (again
   via `sqlcipher_export`, now plaintext → encrypted-under-target-key). This is
   the key re-establishment step: the restored DB is encrypted under the fresh
   install's DEK, so that install opens it under its own keystore with no
   knowledge of the source install's key material;
3. takes a pre-restore safety copy of the current data (DB + its `-wal`/`-shm`
   sidecars + `files/`) so a failure is recoverable, performs an atomic rename
   swap, and runs forward-only migrations if the snapshot is older (NFR-011);
4. restores attachment blobs verbatim — they are already AES-256-GCM-sealed
   opaque files under `files/` (R-PRIV-007).

The backup password domain and the install-DEK domain stay fully independent:
the archive is portable across installs, and the DEK never leaves either
install. No network is involved at any step (NFR-022, S17 AC7).

## Consequences

- A backup restores onto any clean install given only the backup password; the
  doctor+clinic profiles (and, later, all patient data and attachments) come
  back and open under the new install's own keystore (R1 demo step 3).
- The portable snapshot is briefly plaintext on disk (a temp file in the data
  dir, deleted right after). This is an accepted, documented window: the data
  dir is the same directory that already holds the live DB and the DEK-wrap
  keystore, and the file is removed on every exit path. A future hardening can
  stream the export through memory if a stricter threat model demands it.
- Restore must relocate the live DB's `-wal`/`-shm` sidecars with the DB during
  the swap; a stale WAL left beside a replaced file makes SQLCipher replay the
  old WAL against the new file and fail page decryption. The engine handles this
  explicitly.
- The archive header is readable without the password (format version, dates,
  Argon2id params, aggregate counts — no patient data, no key material), so the
  restore wizard can preview before the doctor types anything (S17 step 2 / AC4,
  R-PRIV-001).
- BAK-005 "move to new computer" (carrying the keystore so the PIN also moves)
  is a distinct, larger flow and is **deferred** past R1 (OQ-S17-4); it is NOT
  implemented by this decision.
