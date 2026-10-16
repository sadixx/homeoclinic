# ADR 0005: Rust core holds all business logic

Date: 2026-10-17. Status: accepted.

Design ADR id: 003 (from `docs/design/02-architecture-overview.md` section 7).

## Context

Search and repertorisation scoring must stay fast on low-end PCs, memory
safety matters for a long-running local app, and the licence logic is shared
with the MVP2 server. The alternative was to keep business logic in
TypeScript in the webview.

## Decision

Keep all business logic in a Rust core. The workspace is split into
hexagonal crates — `hc-domain` (IO-free), `hc-storage`, `hc-search`,
`hc-repertory`, `hc-licence`, `hc-docs` and `hc-app` (the only API the UI can
call) — as described in section 3. The TypeScript side renders only.

## Consequences

- Performance for search and scoring, memory safety, and a licence crate
  (`hc-licence`) that is shared with the Vendor Licence Tool and the MVP2
  server.
- Logic in TypeScript was rejected because it cannot meet the performance and
  safety goals or be reused server-side.
- The UI calls typed commands generated with `tauri-specta`; it never sees SQL
  or file paths (section 3).
