# ADR 0001: Code layout and crate names

Date: 2026-10-16. Status: accepted.

## Context

`requirements/06` section 1 named crates `core`, `repertory`, `licence`,
`storage`. `design/02` section 3 named seven `hc-*` crates and separated
search, docs and app services. Agents treated this as a blocking gap.

## Decision

Use the `design/02` crate split with `hc-` prefixes, placed in the
`requirements/06` tree (`apps/desktop`, `crates/`, `tools/`, `services/`,
`web/`). `tools/vendor-licence` is named `tools/vendor-licence-tool`;
`tools/seed` is kept. `content-sources/` stays at repo root with
`internal-eval/` data git-ignored. Docs move into `docs/`.

## Consequences

- `hc-search` and `hc-docs` can be tested and benchmarked on their own.
- `hc-licence` stays free of storage so the vendor tool and the MVP2
  server reuse it.
- `docs/CODE-LAYOUT.md` is authoritative; requirements/06 and design/02
  section 3 are historical for layout purposes.
