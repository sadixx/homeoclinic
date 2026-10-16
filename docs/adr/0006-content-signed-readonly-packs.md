# ADR 0006: Content as signed read-only packs

Date: 2026-10-17. Status: accepted.

Design ADR id: 004 (from `docs/design/02-architecture-overview.md` section 7).

## Context

Repertories and other reference content must be added and updated
independently of the application and of the doctor's patient data (PACK-006).
The alternative was to store content inside `clinic.db` alongside patient
data.

## Decision

Ship content as signed, read-only packs (`.hcpack`) kept under the data
folder's `content/` directory. Ed25519 signatures are verified before use,
with two embedded public keys for rotation (section 6).

## Consequences

- Repertories can be added without app updates (PACK-006), and patient data is
  untouched by content updates.
- Storing content in `clinic.db` was rejected because it couples content
  updates to patient data and to app releases.
- Packs are verified by signature before use, consistent with the packs-and-
  updates row of the security architecture (section 6).
