# ADR 0004: Embedded SQLite with SQLCipher

Date: 2026-10-17. Status: accepted.

Design ADR id: 002 (from `docs/design/02-architecture-overview.md` section 7).

## Context

The clinic application runs on a single doctor's PC with no IT support. A
local database server (MySQL/PostgreSQL) — the legacy approach — must be
installed and can crash, and it complicates backup. Data at rest must be
encrypted (section 6).

## Decision

Use embedded SQLite with SQLCipher for `clinic.db` and `user_content.db`.
Access is through a dedicated writer connection plus reader connections
(section 3/4), and encryption uses a DEK wrapped per section 6.

## Consequences

- No separate server to install or crash (the legacy L1 failure mode), and a
  single-file backup is possible.
- A local MySQL/PostgreSQL server (legacy) was rejected for its install and
  reliability burden.
- The database is encrypted at rest via SQLCipher, aligning with the
  security architecture in section 6.
