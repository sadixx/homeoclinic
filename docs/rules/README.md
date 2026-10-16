# HomeoClinic coding and review rules

This directory is the project's coding and review rule set. It is the first
guideline source for `hc-code-reviewer` and `hc-guidelines-reviewer` (see
`hc-agents/skills/hc-review-guidelines`), and the authority behind the lint
policy for `hc-lint-fixer`. Rules are grounded in the requirements, design,
CODE-LAYOUT and ADRs; every rule cites the requirement id it comes from.

## How a rule is written

Each family lives in one file that starts with `# R-XXX: <Family>`, the
family token, a one-sentence derivation, a default scope and a `---`. Each
rule then follows this exact shape:

```
### R-XXX-NNN Short title
- Severity: defect | advisory
- Scope: `glob`, `glob`
- Rule: one or two testable sentences.
- Why: the requirement ids this enforces.
```

optionally followed by short `// bad` and `// good` code blocks.

- **Id scheme:** `R-<FAMILY>-NNN`, `NNN` zero-padded and never reused inside a
  family. `<FAMILY>` is the family token (for example `PRIV`, `SEC`, `DEL`).
- **Severity:** `defect` blocks a merge until fixed or waived in writing;
  `advisory` is a strong recommendation a reviewer may accept with a reason.
- **Scope:** glob(s) relative to the repo root. A rule is tested only against
  changed files whose path matches its scope.

## How rules are used

1. A reviewer or `hc-guidelines-reviewer` reads every file here.
2. For each changed hunk, the rules whose scope matches the file are checked.
3. A finding uses the check-result format from `hc-review-guidelines` with
   `problem_id` set to the rule id (for example `R-SEC-001`).
4. Only lines in the diff are flagged; unchanged lines are never cited.

## Adding or retiring a rule

- **Add:** append the next free `NNN` in the right family file; give it a
  testable Rule and a real `Why` requirement id; add a row to the index below
  and bump that family's count and the total. If it needs a new family, add a
  file `# R-XXX: <Family>`, a Families row, and an index section.
- **Retire:** do not renumber. Mark the rule `Status: retired (reason)` under
  its title, keep the id reserved, and strike its index row. This keeps old
  findings and commit references readable.

## Families

| Token | Family | File | Rules |
|---|---|---|---|
| R-DEL | Delivery (working software at every milestone) | `delivery.md` | 6 |
| R-PRIV | Privacy and patient-data protection | `privacy.md` | 7 |
| R-SEC | Security | `security.md` | 9 |
| R-DATA | Data and persistence | `data.md` | 10 |
| R-ARCH | Architecture and boundaries | `architecture.md` | 9 |
| R-RUST | Rust code | `rust.md` | 7 |
| R-UI | TypeScript and UI | `typescript-ui.md` | 9 |
| R-TEST | Testing | `testing.md` | 9 |
| R-PERF | Performance | `performance.md` | 8 |
| R-SUX | Security user experience | `ux-security.md` | 11 |
| R-CONT | Content channels and packs | `content.md` | 10 |
| R-LIC | Licensing | `licence.md` | 10 |
| R-GIT | Git and review | `git-and-review.md` | 9 |
| R-LINT | Lint policy | `lint-policy.md` | 7 |

## Index of all rules

### R-DEL: Delivery (`delivery.md`)
- R-DEL-001 Main is always releasable
- R-DEL-002 No dead ends in the UI
- R-DEL-003 Backend work ships with its UI slice
- R-DEL-004 Previous release data always opens
- R-DEL-005 A milestone is closed by its release demo
- R-DEL-006 Feature flags are temporary

### R-PRIV: Privacy (`privacy.md`)
- R-PRIV-001 No patient data in logs, errors or crash reports
- R-PRIV-002 MVP1 makes no network calls of its own
- R-PRIV-003 Consent is captured before patient details are stored
- R-PRIV-004 Diagnostics and crash upload are scrubbed
- R-PRIV-005 Share links and clipboard carry only intended content
- R-PRIV-006 Patient data is always exportable and erasable
- R-PRIV-007 On-disk files use opaque names

### R-SEC: Security (`security.md`)
- R-SEC-001 Parameterised SQL only
- R-SEC-002 Tauri capabilities are least privilege
- R-SEC-003 No shell plugin and no arbitrary filesystem scope
- R-SEC-004 Content Security Policy is locked down
- R-SEC-005 No secrets in source or plaintext in the binary
- R-SEC-006 Key material is zeroized
- R-SEC-007 Verify signatures before trusting input
- R-SEC-008 Dependencies are pinned and audited
- R-SEC-009 The one allowed fetch is TLS and still signature-checked

### R-DATA: Data and persistence (`data.md`)
- R-DATA-001 Every write is one transaction with an audit row
- R-DATA-002 Migrations are forward-only and back up first
- R-DATA-003 Soft delete, never hard delete clinical rows
- R-DATA-004 Money is integer paise
- R-DATA-005 UUIDv7 keys and standard audit columns on every table
- R-DATA-006 Full-text indexes update in the same transaction
- R-DATA-007 Queries are bounded
- R-DATA-008 Hot access paths have their indexes
- R-DATA-009 Denormalised counters are maintained in the write transaction
- R-DATA-010 Crash-safe connection settings

### R-ARCH: Architecture and boundaries (`architecture.md`)
- R-ARCH-001 Crate dependencies follow the one-way graph
- R-ARCH-002 hc-domain performs no IO
- R-ARCH-003 No backend logic in the UI
- R-ARCH-004 bindings.ts is generated, never hand-edited
- R-ARCH-005 One Tauri command per use case
- R-ARCH-006 Typed domain errors are mapped before they reach the UI
- R-ARCH-007 Patient data and content live in separate stores
- R-ARCH-008 hc-licence stays desktop and server agnostic
- R-ARCH-009 SQL and filesystem paths stay in the storage layer

### R-RUST: Rust code (`rust.md`)
- R-RUST-001 Fallible errors are thiserror enums
- R-RUST-002 No unwrap or expect on fallible input
- R-RUST-003 No blocking work in async
- R-RUST-004 unsafe is forbidden
- R-RUST-005 Public items are documented
- R-RUST-006 Fix clippy footguns, do not allow them
- R-RUST-007 Invariants live in hc-domain value types

### R-UI: TypeScript and UI (`typescript-ui.md`)
- R-UI-001 Strict TypeScript, no any
- R-UI-002 Call generated bindings, never raw invoke
- R-UI-003 Interactive elements have stable data-testids
- R-UI-004 Keyboard-first operation
- R-UI-005 Accessibility: labels, contrast, font, 1366x768
- R-UI-006 Indian formats come from shared helpers only
- R-UI-007 User-facing text comes from the strings file
- R-UI-008 Errors shown in plain language, never a stack trace
- R-UI-009 Destructive actions are undoable

### R-TEST: Testing (`testing.md`)
- R-TEST-001 Red before green
- R-TEST-002 Never fake the code under test
- R-TEST-003 Assert data effects, not just status
- R-TEST-004 Synthetic data only
- R-TEST-005 Test signing keys only
- R-TEST-006 Deterministic: no sleeps, no wall clock, no shared DB
- R-TEST-007 Scoring and search use hand-computed golden fixtures
- R-TEST-008 Test names carry the requirement id
- R-TEST-009 Tests use public APIs, not private internals

### R-PERF: Performance (`performance.md`)
- R-PERF-001 Meet the NFR latency budgets
- R-PERF-002 Heavy work runs off the UI thread
- R-PERF-003 No OFFSET scans or leading-wildcard LIKE on large tables
- R-PERF-004 Perf is gated on the protected build at scale
- R-PERF-005 Bounded memory
- R-PERF-006 No N+1 queries in lists
- R-PERF-007 Cancel superseded work
- R-PERF-008 SQLite tuning pragmas are set and maintained

### R-SUX: Security user experience (`ux-security.md`)
- R-SUX-001 Protection must not break the speed budgets
- R-SUX-002 Integrity and licence checks run in idle background chunks
- R-SUX-003 Zero extra clicks and no security dialogs in normal work
- R-SUX-004 Never needs internet; offline never blocks a valid licence
- R-SUX-005 One failed check never restricts the app
- R-SUX-006 Self-heal before telling the doctor
- R-SUX-007 Friendly, non-accusatory messages with one action
- R-SUX-008 Never interrupt an ongoing consultation
- R-SUX-009 Tamper and expiry responses never harm patient data
- R-SUX-010 OS-friendly install and run
- R-SUX-011 Backup credentials remembered on the same PC

### R-CONT: Content channels and packs (`content.md`)
- R-CONT-001 Every pack declares channel and licence
- R-CONT-002 Two signing keys, one per channel
- R-CONT-003 A public build cannot load internal-eval content
- R-CONT-004 Release gate blocks eval content in public artifacts
- R-CONT-005 A REGISTRY.md row is required to build a pack
- R-CONT-006 Internal builds are clearly marked
- R-CONT-007 Adding or removing a repertory needs no app code change
- R-CONT-008 Respect GPL and redistribution limits
- R-CONT-009 Channel move is registry plus re-sign, ids stay stable
- R-CONT-010 Pack format version is checked

### R-LIC: Licensing (`licence.md`)
- R-LIC-001 Only our key signs; the app verifies offline with two embedded keys
- R-LIC-002 Identity fields lock after activation
- R-LIC-003 Constant-time comparison of secrets
- R-LIC-004 Graceful clock-rollback guard
- R-LIC-005 Expiry goes read-only, never destructive
- R-LIC-006 Typed-key errors are reported per group
- R-LIC-007 Trial and reinstall work with no contact
- R-LIC-008 UPI and WhatsApp QR match the offline spec
- R-LIC-009 The Vendor tool verifies money and refuses a duplicate UTR
- R-LIC-010 The signing key never touches a shared or online machine

### R-GIT: Git and review (`git-and-review.md`)
- R-GIT-001 Feature branches only, never commit on main
- R-GIT-002 Commit subject format
- R-GIT-003 Commit body has Problem, Solution, Requirements, Test
- R-GIT-004 Never commit secrets
- R-GIT-005 Never bypass hooks or disable checks
- R-GIT-006 Small, single-purpose MRs
- R-GIT-007 Reference requirement ids in commits and tests
- R-GIT-008 MRs carry real validation evidence
- R-GIT-009 Updating an MR reuses the same branch

### R-LINT: Lint policy (`lint-policy.md`)
- R-LINT-001 clippy with -D warnings across the workspace
- R-LINT-002 rustfmt clean
- R-LINT-003 ESLint clean
- R-LINT-004 Prettier clean
- R-LINT-005 TypeScript strict with no errors
- R-LINT-006 Fix the code, not the linter
- R-LINT-007 Suppressions are allowed only from the list below

## Total

14 families, 121 rules (R-DEL 6, R-PRIV 7, R-SEC 9, R-DATA 10, R-ARCH 9,
R-RUST 7, R-UI 9, R-TEST 9, R-PERF 8, R-SUX 11, R-CONT 10, R-LIC 10,
R-GIT 9, R-LINT 7).
