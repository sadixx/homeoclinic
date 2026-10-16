# ADR 0011: Money as integer paise

Date: 2026-10-17. Status: accepted.

Design ADR id: 009 (from `docs/design/02-architecture-overview.md` section 7).

## Context

Billing amounts must be exact. Representing money as a floating-point
`double` (the legacy approach) introduces rounding errors.

## Decision

Represent money as an integer number of paise. `Money` is a value type in the
IO-free `hc-domain` crate (section 3).

## Consequences

- No rounding errors in monetary calculations.
- `double` (legacy) was rejected because floating-point arithmetic is not exact
  for currency.
- All amount formatting and amount-in-words conversion operate on the integer
  paise value.
