# R-GIT: Git and review

Family token `R-GIT`. These rules keep history clean and reviewable: branch
naming, the commit subject and body format, no secrets, small single-purpose
MRs, requirement ids referenced, and hooks never bypassed. They derive from
`hc-agents/skills/hc-commit-message`, `docs/requirements/06-architecture-data-model.md`
instruction 2, `docs/requirements/05-nfr-and-acceptance.md` section 6 and
`docs/requirements/03-licensing-upi.md` (LIC-047).

Default scope for this family: whole repository.

---

### R-GIT-001 Feature branches only, never commit on main
- Severity: defect
- Scope: `**/*`
- Rule: work on a `<task-id>-<short-slug>` branch; never commit or push to `main` or `release/*`, and never force-push a protected branch.
- Why: hc-commit-message branch rule.

### R-GIT-002 Commit subject format
- Severity: defect
- Scope: `**/*`
- Rule: the subject is `<task-id>: <imperative summary, max 60 chars> [M/N]`, using `[1/1]` for the normal single-repo change.
- Why: hc-commit-message subject.

### R-GIT-003 Commit body has Problem, Solution, Requirements, Test
- Severity: defect
- Scope: `**/*`
- Rule: the body uses the `[Problem]`, `[Solution]`, `[Requirements]`, `[Test]` sections wrapped at 72 columns, cites the requirement ids, and never invents tests.
- Why: hc-commit-message body; requirements/06 instruction 2.

### R-GIT-004 Never commit secrets
- Severity: defect
- Scope: `**/*`
- Rule: signing keys, offer-code keys, payment credentials, PINs and real patient data are never committed; they come from env or the secure store.
- Why: requirements/06 instruction 7.5; LIC-047.

### R-GIT-005 Never bypass hooks or disable checks
- Severity: defect
- Scope: `**/*`
- Rule: no `git commit --no-verify` and no disabling of pre-commit hooks; run `cargo fmt` and Prettier before committing.
- Why: hc-commit-message pre-commit cleanup.

### R-GIT-006 Small, single-purpose MRs
- Severity: advisory
- Scope: `**/*`
- Rule: an MR covers one task or use-case slice; unrelated refactors go in a separate MR.
- Why: hc-commit-message; delivery slice principle (cross-reference R-DEL-003).

### R-GIT-007 Reference requirement ids in commits and tests
- Severity: advisory
- Scope: `**/*`
- Rule: every commit and every new test names the requirement ids it implements.
- Why: requirements/06 instruction 2.

### R-GIT-008 MRs carry real validation evidence
- Severity: advisory
- Scope: `**/*`, `.worklog/**`
- Rule: the MR description lists validation (build, lint, tests, perf numbers, E2E paths) with real evidence; anything not actually run is marked UNVERIFIED.
- Why: hc-commit-message MR; requirements/06 section 6.

### R-GIT-009 Updating an MR reuses the same branch
- Severity: advisory
- Scope: `**/*`
- Rule: revisions commit on the same feature branch and push it again; never open a parallel MR for the same task.
- Why: hc-commit-message MR.
