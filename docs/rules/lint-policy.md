# R-LINT: Lint policy

Family token `R-LINT`. These rules state the exact static-analysis gates the
code must pass and the single permitted-suppression list (kept empty). They
derive from `docs/requirements/05-nfr-and-acceptance.md` section 6 and
`hc-agents/agents/hc-lint-fixer`, which treats this file as the authority for
any allowed suppression.

Default scope for this family: all Rust crates and `apps/desktop`.

---

### R-LINT-001 clippy with -D warnings across the workspace
- Severity: defect
- Scope: `crates/**`, `apps/desktop/src-tauri/**`
- Rule: `cargo clippy --workspace --all-targets -- -D warnings` passes with zero warnings.
- Why: requirements/06 section 6 (clippy -D warnings); hc-lint-fixer.

### R-LINT-002 rustfmt clean
- Severity: defect
- Scope: `crates/**`, `apps/desktop/src-tauri/**`
- Rule: `cargo fmt --all -- --check` reports no diff.
- Why: requirements/06 section 6; hc-commit-message.

### R-LINT-003 ESLint clean
- Severity: defect
- Scope: `apps/desktop/src/**`
- Rule: `npm --prefix apps/desktop run lint` passes with no errors.
- Why: requirements/06 section 6 (eslint).

### R-LINT-004 Prettier clean
- Severity: defect
- Scope: `apps/desktop/**`
- Rule: `npm --prefix apps/desktop run format` leaves no diff.
- Why: requirements/06 section 6 (prettier).

### R-LINT-005 TypeScript strict with no errors
- Severity: defect
- Scope: `apps/desktop/src/**`
- Rule: `npm --prefix apps/desktop run typecheck` (`tsc --noEmit`, strict) passes.
- Why: requirements/06 section 6 (TypeScript strict); R-UI-001.

### R-LINT-006 Fix the code, not the linter
- Severity: defect
- Scope: `**/*`
- Rule: never add `#[allow(...)]`, `// eslint-disable`, `@ts-ignore`, `@ts-expect-error` or `as any`, and never weaken `clippy.toml`, `.eslintrc*` or `tsconfig` strictness to pass a check.
- Why: hc-lint-fixer policy.

### R-LINT-007 Suppressions are allowed only from the list below
- Severity: defect
- Scope: `**/*`
- Rule: the only permitted lint suppressions are those in the table below, each with a reason and an owning rule. The list is empty today, so any suppression is a defect until it is added here with review approval.
- Why: hc-lint-fixer exception clause.

| Suppression | File / scope | Reason | Owning rule | Approved by |
|---|---|---|---|---|
| (none) | | | | |
