# ADR 0012: UUIDv7 primary keys + row_version

Date: 2026-10-17. Status: accepted.

Design ADR id: 010 (from `docs/design/02-architecture-overview.md` section 7).

## Context

MVP2 adds LAN operation and MVP3 adds sync. Auto-increment integer primary
keys clash when rows are created independently on multiple devices and then
merged.

## Decision

Use UUIDv7 primary keys together with a `row_version` column on each row. The
`hc-storage` crate owns the schema and repositories (section 3).

## Consequences

- Ready for MVP2 LAN and MVP3 sync without key clashes.
- Auto-increment keys were rejected because they collide across devices during
  merge/sync.
- `row_version` supports optimistic concurrency for conflicting edits.
