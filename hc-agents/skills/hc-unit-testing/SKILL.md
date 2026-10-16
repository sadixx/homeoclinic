---
name: hc-unit-testing
description: HomeoClinic unit testing conventions and the write-unit-tests procedure for Rust (cargo test) and React/TypeScript (Vitest + Testing Library). Fakes, fixtures, naming, red-green gate. Use when writing or reviewing unit tests.
---

# HomeoClinic Unit Testing

Mirror of RBKS `unit-testing` + `write-unit-tests` SOP.

## Framework by path

| Path | Framework | Location |
|---|---|---|
| `crates/*` | Rust built-in tests (`#[test]`, `#[tokio::test]`) | unit: `#[cfg(test)] mod tests` in the same file; cross-module: `crates/<c>/tests/*.rs` |
| `apps/desktop/src-tauri` | Rust tests | same as above |
| `apps/desktop/src` | Vitest + @testing-library/react + user-event | `*.test.ts(x)` next to the component |
| `tests/e2e` | NOT unit tests (hc-e2e-editor owns) | |

Never mix: no Jest APIs in Vitest files, no `mockall` in UI.

## Allowed fakes (dependencies only)

| Dependency | Fake |
|---|---|
| SQLCipher DB | in-memory SQLite with the real migrations applied (`hc-storage::testing::memory_db()`) |
| Clock | `FakeClock` implementing the domain `Clock` trait |
| Pack store | small fixture `.hcpack` built by a test helper, signed with a TEST key |
| Licence keys | test Ed25519 key pair in `crates/hc-licence/tests/fixtures/`, never the real public key |
| Filesystem | `tempfile::TempDir` |
| Tauri `invoke` in UI | `vi.mock('../bindings')` returning typed results |

If a helper above does not exist yet, create it in a `testing` module
behind `#[cfg(any(test, feature = "testing"))]` and report that you did.

Never fake the CUT. Never copy production code into tests.

## Naming

- Rust: `fn <behavior>_<condition>()` e.g. `search_finds_patient_by_phonetic_name()`.
- Vitest: `it('shows an error when the PIN is wrong')`.
- The name states the behavior in one sentence.

## Data rules

- Synthetic names only (e.g. "Test Patient 001"), never real patient data.
- Money in paise as integers.
- Indian locale formatting asserted explicitly where it matters.

## write-unit-tests procedure

1. Read `original-prompt.md`, the architect's API / stub, and existing tests
   of the component.
2. Write a test plan in `<output-dir>/test-plan.md`: one row per test with
   "real bug this catches".
3. Write the tests.
4. Build and run ONLY the affected crate / file
   (`cargo test -p <crate>` or `vitest run <file>`), logs captured per
   `hc-build`.
5. Gate: compiles, executes, FAILS on assertions (red). Record the failing
   assertion lines in the report.
6. After implementation (re-spawn): same tests pass (green). Report actual
   output; never estimate coverage.

## Test depth

- Bug fix / modification: one regression test that fails before the fix.
- New module / screen: behavior tests for happy path, each documented error
  path, boundaries named in the requirement (e.g. 50k, empty, unicode
  Devanagari names), and state transitions (licence states, backup states).
