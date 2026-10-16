# R-TEST: Testing

Family token `R-TEST`. These rules make tests honest: red before green, the
real code under test, data effects asserted, synthetic data and test keys
only, deterministic (no sleeps), and named by requirement. They derive from
`docs/requirements/05-nfr-and-acceptance.md` (section 6, NFR-007),
`docs/requirements/06-architecture-data-model.md` (section 5, instruction 2),
`docs/requirements/02-repertory-engine.md` (REP-033) and
`hc-agents/skills/hc-review-guidelines` (test quality).

Default scope for this family: all test files and `tools/seed`.

---

### R-TEST-001 Red before green
- Severity: defect
- Scope: `**/*test*`, `tests/**`
- Rule: a bug fix or feature adds a test that fails before the change and passes after; the failing run is shown in the MR.
- Why: review test-quality practice; requirements/06 section 6.

### R-TEST-002 Never fake the code under test
- Severity: defect
- Scope: `**/*test*`, `tests/**`
- Rule: tests assert against the real code under test; fakes and mocks are only for its dependencies, never for the module being tested.
- Why: review guideline `test/tests-fake-cut`.

### R-TEST-003 Assert data effects, not just status
- Severity: defect
- Scope: `**/*test*`, `tests/**`
- Rule: a test checks the resulting data or state (rows written, score value, file bytes), not only `is_ok()` or a status flag.
- Why: review guideline `test/status-only`.

### R-TEST-004 Synthetic data only
- Severity: defect
- Scope: `**/*test*`, `tests/**`, `tools/seed/**`
- Rule: tests and fixtures use the synthetic generator (`tools/seed`) or clearly fake data; no real patient data and no real-looking PII.
- Why: review guideline `test/real-data`; NFR-007; product rule 2.

### R-TEST-005 Test signing keys only
- Severity: defect
- Scope: `crates/hc-licence/tests/**`, `crates/hc-repertory/tests/**`, `tests/**`
- Rule: licence, pack and update tests generate and use throwaway test keypairs; the real signing key, and its production public key, is never embedded in a test.
- Why: review guideline `test/real-data`; LIC-047; TAM-012.

### R-TEST-006 Deterministic: no sleeps, no wall clock, no shared DB
- Severity: defect
- Scope: `**/*test*`, `tests/**`
- Rule: no `thread::sleep` for timing; inject the clock for expiry and clock-guard tests; each test uses its own temporary database.
- Why: review guideline `test/flaky`; LIC-005.

### R-TEST-007 Scoring and search use hand-computed golden fixtures
- Severity: defect
- Scope: `crates/hc-repertory/tests/**`, `crates/hc-search/tests/**`
- Rule: repertorisation methods and search ranking are tested against hand-computed fixtures (the small 5-rubric by 6-remedy pack, and ranking goldens), not against values the code itself produced.
- Why: REP-033; data model section 5; requirements/06 section 6.

### R-TEST-008 Test names carry the requirement id
- Severity: advisory
- Scope: `**/*test*`, `tests/**`
- Rule: test names reference the requirement id and the behaviour (for example `rep033_kent_weights_mentals`).
- Why: requirements/06 instruction 2.

### R-TEST-009 Tests use public APIs, not private internals
- Severity: advisory
- Scope: `**/*test*`, `tests/**`
- Rule: tests exercise public functions and commands; they do not reach into private fields or internal state.
- Why: review guideline `test/private-state`.
