# R-ARCH: Architecture and boundaries

Family token `R-ARCH`. These rules hold the hexagonal layering: a pure
domain, a one-way crate dependency graph, a UI that only crosses the
boundary through generated bindings, one command per use case, typed errors,
and patient data kept separate from content packs. They derive from
`docs/CODE-LAYOUT.md` (crate dependency rule and UI modules),
`docs/design/02-architecture-overview.md` sections 3 and 4 and
`docs/requirements/06-architecture-data-model.md` section 1.

Default scope for this family: all crates, `apps/desktop`.

---

### R-ARCH-001 Crate dependencies follow the one-way graph
- Severity: defect
- Scope: `crates/**/Cargo.toml`, `apps/desktop/src-tauri/Cargo.toml`
- Rule: dependencies match CODE-LAYOUT (`hc-domain` <- `hc-storage` <- `hc-search`; `hc-domain` <- `hc-repertory`/`hc-licence`/`hc-docs`; all of those <- `hc-app` <- `src-tauri`); no other edges and no cycles.
- Why: CODE-LAYOUT crate dependency rule; design section 3.

### R-ARCH-002 hc-domain performs no IO
- Severity: defect
- Scope: `crates/hc-domain/**`
- Rule: `hc-domain` holds only entities, value types and validation; it has no database, filesystem, network, wall-clock or Tauri dependency.
- Why: CODE-LAYOUT; design section 3 (domain has no IO).

```rust
// bad  (in hc-domain)
let rows = conn.query("SELECT ...")?;
// good  (in hc-domain)
impl Visit { pub fn validate(&self) -> Result<(), DomainError> { ... } }
```

### R-ARCH-003 No backend logic in the UI
- Severity: defect
- Scope: `apps/desktop/src/**`
- Rule: UI code contains no SQL, file paths, money arithmetic, crypto or other business/domain logic; all of that lives behind commands.
- Why: requirements/06 section 1 rule; design section 3; product rule 4.

### R-ARCH-004 bindings.ts is generated, never hand-edited
- Severity: defect
- Scope: `apps/desktop/src/bindings.ts`
- Rule: `bindings.ts` is produced by `tauri-specta`; hand edits are forbidden and are overwritten by the build.
- Why: CODE-LAYOUT (UI modules table); design section 3.

### R-ARCH-005 One Tauri command per use case
- Severity: defect
- Scope: `crates/hc-app/**`
- Rule: each user action maps to one typed command that orchestrates the whole use case and owns its transaction; the UI does not chain several commands to emulate one write.
- Why: design section 3 (every write is a single use-case command); requirements/06 section 1.

### R-ARCH-006 Typed domain errors are mapped before they reach the UI
- Severity: defect
- Scope: `crates/hc-app/**`, `crates/hc-domain/**`
- Rule: commands return typed error enums; `hc-app` maps them to plain-language user messages; a raw error, debug string or stack trace never crosses the command boundary to the UI.
- Why: NFR-033; design section 8.

### R-ARCH-007 Patient data and content live in separate stores
- Severity: defect
- Scope: `crates/hc-storage/**`, `crates/hc-repertory/**`
- Rule: patient and clinic data live in `clinic.db` and `user_content.db` (encrypted); repertory and MM content lives in read-only signed `content/*.hcpack` attached read-only; content code never writes the patient DBs and the patient layer never writes packs.
- Why: data model section 2; ADR 004; design section 2.

### R-ARCH-008 hc-licence stays desktop and server agnostic
- Severity: advisory
- Scope: `crates/hc-licence/**`
- Rule: `hc-licence` depends only on `hc-domain` and stays usable by the Vendor Licence Tool and the MVP2 server; no Tauri, UI or desktop-only code lives in it.
- Why: design section 3 (shared licence crate); CODE-LAYOUT.

### R-ARCH-009 SQL and filesystem paths stay in the storage layer
- Severity: defect
- Scope: `crates/hc-app/**`, `crates/hc-repertory/**`, `crates/hc-docs/**`, `apps/desktop/src-tauri/**`
- Rule: only `hc-storage` (and the pack loader in `hc-repertory`) builds SQL or resolves filesystem paths; higher layers call repository and command APIs instead.
- Why: design section 3; product rule 4.
