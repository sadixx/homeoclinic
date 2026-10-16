# R-PERF: Performance

Family token `R-PERF`. These rules hold the speed budgets that are
acceptance criteria: meet the NFR latencies, keep heavy work off the UI
thread, avoid OFFSET and leading-wildcard scans, and gate performance in CI
on the protected build at scale. They derive from
`docs/requirements/05-nfr-and-acceptance.md` (NFR-001 to NFR-007, section 6),
`docs/requirements/06-architecture-data-model.md` section 3 (query plan and
pragmas) and `docs/design/02-architecture-overview.md` section 4.

Default scope for this family: `crates/hc-storage`, `crates/hc-search`,
`crates/hc-repertory`, `crates/hc-app`, `apps/desktop/src`, `tests/perf`.

---

### R-PERF-001 Meet the NFR latency budgets
- Severity: defect
- Scope: hot paths in `crates/**` and `apps/desktop/src/**`
- Rule: a change must not regress these p95 budgets: cold start < 4 s, patient search < 100 ms, open patient < 300 ms, filter < 500 ms, rubric search < 100 ms on 200k rubrics, recompute < 300 ms for 30 rubrics, Rx print preview < 1 s.
- Why: NFR-001 to NFR-005; overview principle 6.

### R-PERF-002 Heavy work runs off the UI thread
- Severity: defect
- Scope: `apps/desktop/src/**`, `crates/hc-app/**`
- Rule: search, analysis, backup, pack install and integrity/licence checks run on worker or reader threads; they never run on the UI/webview thread or during typing.
- Why: SUX-002; design section 4.

### R-PERF-003 No OFFSET scans or leading-wildcard LIKE on large tables
- Severity: defect
- Scope: `crates/hc-storage/**`, `crates/hc-search/**`
- Rule: queries over patient and visit scale tables use indexed predicates, FTS and keyset pagination; `OFFSET` paging and `LIKE '%x%'` on base columns are forbidden.
- Why: data model section 3 (query plan); NFR-002.

```sql
-- bad
SELECT * FROM patient WHERE name LIKE '%sharma%' LIMIT 20 OFFSET 2000;
-- good
SELECT p.* FROM patient_fts f JOIN patient p ON p.id = f.rowid
WHERE f.name MATCH 'sharma*' AND p.id > ?1 ORDER BY p.id LIMIT 20;
```

### R-PERF-004 Perf is gated on the protected build at scale
- Severity: defect
- Scope: `tests/perf/**`, CI
- Rule: performance tests run against the fully protected release build at 50k and 100k seeded data and fail CI if any budget, or the SUX overhead caps, is missed.
- Why: NFR-007; SUX-001.

### R-PERF-005 Bounded memory
- Severity: advisory
- Scope: `crates/hc-repertory/**`, `crates/hc-storage/**`
- Rule: typical RAM stays under 300 MB; rubric bitsets use the 64 MB LRU cap and packs open lazily (metadata only at startup).
- Why: NFR-006; design section 4.

### R-PERF-006 No N+1 queries in lists
- Severity: defect
- Scope: `crates/hc-storage/**`, `crates/hc-app/**`
- Rule: list and Today screens read denormalised columns in one query; no per-row follow-up query in a hot path.
- Why: data model section 3 (denormalise so rows need no joins); NFR-002.

### R-PERF-007 Cancel superseded work
- Severity: advisory
- Scope: `crates/hc-app/**`, `crates/hc-search/**`, `crates/hc-repertory/**`
- Rule: a new keystroke or parameter change cancels the superseded search or analysis instead of queuing it.
- Why: data model section 3 (stale queries cancelled); REP-036.

### R-PERF-008 SQLite tuning pragmas are set and maintained
- Severity: advisory
- Scope: `crates/hc-storage/**`
- Rule: connections set `page_size=4096`, `cache_size` 64 MB, `mmap_size` 256 MB, `temp_store=MEMORY`; the app runs `PRAGMA optimize` on close and `ANALYZE` after bulk import.
- Why: data model section 3.
