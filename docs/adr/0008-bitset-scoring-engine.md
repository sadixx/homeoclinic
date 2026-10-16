# ADR 0008: Bitset repertorisation scoring engine

Date: 2026-10-17. Status: accepted.

Design ADR id: 006 (from `docs/design/02-architecture-overview.md` section 7).

## Context

Repertorisation must recompute in under 300 ms (NFR-004) even on low-end PCs.
Computing scores with SQL `GROUP BY` queries cannot reliably meet that budget.

## Decision

Use an in-memory bitset scoring engine in the `hc-repertory` crate. Pack data
is memory-mapped and rubric bitsets are cached in an LRU with a 64 MB cap
(section 4).

## Consequences

- Recompute stays under 300 ms (NFR-004) on low-end PCs.
- SQL `GROUP BY` scoring was rejected because it cannot meet the performance
  budget.
- Memory use is bounded by the 64 MB LRU cap on cached rubric bitsets
  (section 4).
