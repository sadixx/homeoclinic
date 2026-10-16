# ADR 0007: Case data as template-driven JSON + FTS

Date: 2026-10-17. Status: accepted.

Design ADR id: 005 (from `docs/design/02-architecture-overview.md` section 7).

## Context

Case templates are doctor-editable (CASE-004), so the set of fields captured
per visit is not fixed in advance. Modelling each field as a fixed database
column (the legacy approach) cannot accommodate doctor-defined templates.

## Decision

Store case data as template-driven JSON in `visit.data_json`, with full-text
search (FTS) over that content. The `hc-storage` crate owns the FTS triggers
(section 3).

## Consequences

- Templates are doctor-editable (CASE-004) without schema changes.
- Fixed columns per field (legacy) were rejected because they cannot represent
  editable templates.
- Search over case content is served through FTS rather than per-column
  queries.
