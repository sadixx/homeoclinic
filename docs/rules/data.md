# R-DATA: Data and persistence

Family token `R-DATA`. These rules protect clinical data: every write is one
audited transaction, migrations are forward-only with a backup, money is
integer paise, keys are UUIDv7, full-text indexes stay in sync, and queries
are bounded and indexed. They derive from
`docs/requirements/06-architecture-data-model.md` section 3,
`docs/requirements/05-nfr-and-acceptance.md` (NFR-010, NFR-011, NFR-012) and
the ADR summary in `docs/design/02-architecture-overview.md` section 7
(ADR 004, 009, 010).

Default scope for this family: `crates/hc-storage`, `crates/hc-search`,
`crates/hc-app`, `crates/hc-domain`.

---

### R-DATA-001 Every write is one transaction with an audit row
- Severity: defect
- Scope: `crates/hc-app/**`, `crates/hc-storage/**`
- Rule: a use-case write commits all of its row changes and exactly one `audit_log` row in a single transaction; a partial write must be impossible.
- Why: data model section 3 (`audit_log`); design section 3; product rule 3.

```rust
// good
let tx = conn.transaction()?;
upsert_visit(&tx, &visit)?;
insert_audit(&tx, user, "visit", &visit.id, "create", &diff)?;
tx.commit()?;
```

### R-DATA-002 Migrations are forward-only and back up first
- Severity: defect
- Scope: `crates/hc-storage/migrations/**`, `crates/hc-storage/src/**`
- Rule: migrations are versioned and forward-only (a released migration is never edited in place); the app takes an automatic backup of the DB before running any migration.
- Why: NFR-011.

### R-DATA-003 Soft delete, never hard delete clinical rows
- Severity: defect
- Scope: `crates/hc-storage/**`, `crates/hc-app/**`
- Rule: clinical rows are soft-deleted via `deleted_at` and recoverable from the recycle bin; a hard `DELETE` of patient, visit, prescription or invoice rows is forbidden outside the explicit DPDP erase path.
- Why: data model section 3 (soft delete); overview principle 4 (no data loss); NFR-035.

### R-DATA-004 Money is integer paise
- Severity: defect
- Scope: `crates/**`, `apps/desktop/src/**`
- Rule: all amounts are stored and computed as integer paise through the `Money` value type; never `f32`/`f64`/`double`.
- Why: ADR 009; data model `Money` value type; product rule 8.

```rust
// bad
let total: f64 = subtotal - discount;
// good
let total = Money::paise(subtotal.paise() - discount.paise());
```

### R-DATA-005 UUIDv7 keys and standard audit columns on every table
- Severity: defect
- Scope: `crates/hc-storage/migrations/**`, `crates/hc-domain/**`
- Rule: every table uses a `TEXT` UUIDv7 `id` and carries `created_at`, `updated_at`, `deleted_at`, `created_by`, `updated_by` and `row_version`; no auto-increment primary keys.
- Why: ADR 010; data model section 3.

### R-DATA-006 Full-text indexes update in the same transaction
- Severity: defect
- Scope: `crates/hc-storage/migrations/**`, `crates/hc-storage/src/**`
- Rule: `patient_fts`, `patient_trgm` and `visit_fts` rows are written in the same transaction as the base row (by trigger or explicit statement), so search never reads a stale or missing index row.
- Why: PSR-012; data model section 3 (FTS kept in sync with triggers).

### R-DATA-007 Queries are bounded
- Severity: defect
- Scope: `crates/hc-storage/**`, `crates/hc-search/**`
- Rule: every list and search query has an explicit `LIMIT` and returns results through keyset pagination; an unbounded `SELECT` over a clinical table is a defect.
- Why: data model section 3 (query plan, `LIMIT 20` keyset); NFR-002.

### R-DATA-008 Hot access paths have their indexes
- Severity: defect
- Scope: `crates/hc-storage/migrations/**`
- Rule: the B-tree and FTS indexes listed in data model section 3 exist via migration for every hot query; a new hot query ships its index in the same MR.
- Why: data model section 3 (index list); NFR-002.

### R-DATA-009 Denormalised counters are maintained in the write transaction
- Severity: advisory
- Scope: `crates/hc-storage/**`
- Rule: `last_visit_at`, `next_followup_on`, `balance` and `visit_count` on `patient` are kept correct by triggers inside the write transaction, not recomputed ad hoc by UI queries.
- Why: data model section 3 (denormalise into `patient`).

### R-DATA-010 Crash-safe connection settings
- Severity: defect
- Scope: `crates/hc-storage/src/**`
- Rule: connections open with WAL mode, `synchronous` at least `NORMAL` and `foreign_keys=ON`; a process kill during a write must never corrupt the DB.
- Why: NFR-010, NFR-012.
