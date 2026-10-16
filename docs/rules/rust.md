# R-RUST: Rust code

Family token `R-RUST`. These rules keep the Rust core safe and predictable:
typed errors, no panics on fallible input, no blocking in async, no unsafe,
documented public items, domain-enforced invariants, and a clean clippy.
They derive from `docs/requirements/05-nfr-and-acceptance.md` (NFR-012,
NFR-033, section 6 lint gate), `docs/design/02-architecture-overview.md`
sections 3, 4 and 8 (ADR 003), `hc-agents/skills/hc-review-guidelines` and
`hc-agents/agents/hc-lint-fixer`.

Default scope for this family: all Rust crates and `apps/desktop/src-tauri`.

---

### R-RUST-001 Fallible errors are thiserror enums
- Severity: defect
- Scope: `crates/**`
- Rule: crate and library errors are typed enums defined with `thiserror`; avoid `anyhow` in library crates and avoid stringly-typed errors.
- Why: NFR-033; design section 8.

### R-RUST-002 No unwrap or expect on fallible input
- Severity: defect
- Scope: `crates/**`, `apps/desktop/src-tauri/**`
- Rule: `unwrap()`, `expect()` and `panic!` are forbidden on anything derived from user input, DB rows, files, packs or licences; use `?` and typed errors. `expect` is allowed only on a proven invariant with a comment.
- Why: NFR-012; review guideline `rust/unwrap-in-prod`.

```rust
// bad
let v: Visit = serde_json::from_str(&data_json).unwrap();
// good
let v: Visit = serde_json::from_str(&data_json)?;
```

### R-RUST-003 No blocking work in async
- Severity: defect
- Scope: `crates/hc-app/**`, `apps/desktop/src-tauri/**`
- Rule: blocking DB, filesystem or crypto work inside an async command runs on `spawn_blocking` or a worker pool; never block the tokio runtime.
- Why: design section 4; review guideline `rust/blocking-in-async`; SUX-002.

### R-RUST-004 unsafe is forbidden
- Severity: defect
- Scope: `crates/**`, `apps/desktop/src-tauri/**`
- Rule: every crate declares `#![forbid(unsafe_code)]`; any genuinely required `unsafe` needs an ADR and a reviewed justification.
- Why: ADR 003 (memory safety); reliability basis in SUX.

### R-RUST-005 Public items are documented
- Severity: advisory
- Scope: `crates/**`
- Rule: every `pub` fn, struct, enum and trait carries a `///` line stating its purpose; public `hc-domain` types and `hc-app` commands also state units and invariants.
- Why: review advisory (missing doc-comments on public items); requirements/06 instruction 2.

### R-RUST-006 Fix clippy footguns, do not allow them
- Severity: defect
- Scope: `crates/**`
- Rule: these are always fixed, never suppressed: `unwrap_used`/`expect_used` on fallible paths, needless clones in hot loops, oversized `Result` errors (box them), and `dbg!`/`println!`/`eprintln!` in shipped code.
- Why: requirements/06 section 6 lint gate; SUX-002; TAM-002 (verbose logs removed).

### R-RUST-007 Invariants live in hc-domain value types
- Severity: defect
- Scope: `crates/hc-domain/**`, `crates/hc-app/**`
- Rule: invariants (`Money`, `PatientCode`, `Potency`, mobile, registration number) are enforced by constructors and newtypes in `hc-domain`, not re-checked ad hoc in commands or the UI.
- Why: design section 3; data model (`Money` in paise, `PatientCode`, `Potency`).
