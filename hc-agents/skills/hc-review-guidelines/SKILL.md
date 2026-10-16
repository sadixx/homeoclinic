---
name: hc-review-guidelines
description: HomeoClinic review guidelines, finding format, severity rules, test-quality definitions and the check-result format shared by hc-code-reviewer and hc-guidelines-reviewer. Use when reviewing a diff or producing review findings.
---

# HomeoClinic Review Guidelines

Mirror of RBKS `review-guidelines`.

## Guideline sources (in priority order)

1. `$HC_REPO/docs/rules/*.md` (project rules; one file per rule family)
2. `hc-project-context` "Non-negotiable product rules"
3. `$HC_REPO/docs/design/02-architecture-overview.md` section 6 (security)
4. Built-in checklist below, used when no rules files exist yet

## Built-in checklist

| problem_id | Defect when |
|---|---|
| `privacy/patient-data-in-log` | patient name, phone, case text, Rx in any log / error string / panic message |
| `privacy/network-call` | any HTTP client, socket, or URL fetch outside the signed update manifest path |
| `security/sql-concat` | SQL built with `format!` / string concatenation |
| `security/capability-widen` | Tauri capability `*`, shell plugin, or arbitrary FS scope added |
| `security/secret-in-code` | private key, PIN, recovery code, real UPI credentials in source |
| `security/eval-content-public` | code path that lets an `internal_eval` pack load in a public build |
| `data/write-without-audit` | write path not in one transaction with an audit row |
| `data/migration-irreversible` | migration with no documented rollback / backup-before-migrate |
| `data/money-float` | money stored or computed as float |
| `arch/ui-sees-sql` | UI code constructs SQL, file paths, or calls non-command APIs |
| `arch/domain-io` | `hc-domain` performs IO |
| `rust/unwrap-in-prod` | `unwrap()` / `expect()` on fallible input outside tests or proven invariants |
| `rust/blocking-in-async` | blocking DB/IO inside an async command without `spawn_blocking` / worker |
| `ux/sux-violation` | security step adds clicks, delay, internet need, or lockout of a genuine doctor |
| `perf/nfr-risk` | obvious O(n) scan on a 50k table in a hot path, missing index, unbounded query |
| `i18n/hardcoded-string` | user-facing text not in the strings file (when strings file exists) |

Advisory: naming, readability, small duplication, missing doc-comments on
public items, style beyond rustfmt/prettier.

## Test quality definitions

| problem_id | Defect when |
|---|---|
| `test/tests-fake-cut` | assertions run against a fake/mock of the code under test |
| `test/status-only` | test checks only `is_ok()` / status, not the data effect |
| `test/private-state` | test reaches into private fields or internals |
| `test/no-real-bug` | no plausible bug would make it fail |
| `test/real-data` | uses real-looking patient data or the real signing key |
| `test/flaky` | sleeps, wall clock, ordering, shared global DB |

## Finding format

```json
{
  "id": "<guideline>-<n>",
  "severity": "defect | advisory",
  "problem_id": "<from tables above or the rules file>",
  "message": "what is wrong and why, one or two sentences",
  "file": "path",
  "line": 123
}
```

Only flag lines that are in the diff. Never cite an unchanged line.

## Re-review verdicts

Every prior finding gets exactly one: `resolve` (one sentence why) or
`insist` (one sentence why). New issues get new ids.

## Check-result format (guidelines phase)

```json
{
  "checker": "hc-guidelines-reviewer",
  "pass": 1,
  "rules_dir": "docs/rules",
  "findings": [ <finding>, ... ],
  "summary": "N defects, M advisories"
}
```
