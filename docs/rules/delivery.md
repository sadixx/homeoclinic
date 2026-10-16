# R-DEL: Delivery (working software at every milestone)

Family token `R-DEL`. These rules make every milestone end in a usable,
installable release. They derive from `docs/adr/0002-working-software-every-milestone.md`
and `docs/milestones/README.md`.

Default scope for this family: whole repository.

---

### R-DEL-001 Main is always releasable
- Severity: defect
- Scope: `**/*`
- Rule: a change merged to `main` must leave the CI build, all tests and every passed release demo green.
- Why: ADR 0002 decision 5.

### R-DEL-002 No dead ends in the UI
- Severity: defect
- Scope: `apps/desktop/src/**`
- Rule: no visible button, menu item or route may lead to an unimplemented screen or a "coming soon" message; unfinished features are hidden behind a compile-time feature flag.
- Why: ADR 0002 decision 5; SUX-003.

```tsx
// bad
<NavItem to="/repertory" label="Repertory" />   // screen not built yet
// good
{features.repertory && <NavItem to="/repertory" label="Repertory" />}
```

### R-DEL-003 Backend work ships with its UI slice
- Severity: defect
- Scope: `crates/hc-app/**`, `apps/desktop/src/**`
- Rule: a new Tauri command is merged together with the screen or control that calls it in the same milestone, unless the command is internal (startup, background job) and that is stated in the MR.
- Why: ADR 0002 decision 1.

### R-DEL-004 Previous release data always opens
- Severity: defect
- Scope: `crates/hc-storage/migrations/**`, `crates/hc-storage/src/**`
- Rule: from R1 on, every schema or file-format change comes with a migration and an upgrade-path test that opens data created by the previous release.
- Why: ADR 0002 decision 4; NFR-011.

### R-DEL-005 A milestone is closed by its release demo
- Severity: defect
- Scope: `docs/milestones/**`, `tests/e2e/**`
- Rule: a milestone counts as done only when its release demo script runs as an E2E spec tagged `@tier regression` and passes on Windows and Linux, together with every earlier demo.
- Why: ADR 0002 decision 1.

### R-DEL-006 Feature flags are temporary
- Severity: advisory
- Scope: `apps/desktop/src/**`, `crates/**/Cargo.toml`
- Rule: each feature flag names the release that removes it; flags older than two releases are removed or justified in the MR.
- Why: ADR 0002 decision 5.
