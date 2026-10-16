# ADR 0009: Ed25519 licence file + offline QR activation

Date: 2026-10-17. Status: accepted.

Design ADR id: 007 (from `docs/design/02-architecture-overview.md` section 7).

## Context

Licensing must work on a PC with no reliable internet connection and must
resist tampering. Relying on a stored database date (the legacy approach) is
trivially manipulated, and an online-only check cannot run offline.

## Decision

Use an Ed25519-signed licence file plus QR-based offline activation. Licence
parse/verify, identity lock, clock guard and offline activation live in the
`hc-licence` crate (section 3), which is shared with the vendor tool and the
MVP2 server.

## Consequences

- Works offline and is tamper-proof.
- A database date (legacy) and an online-only check were rejected because they
  are manipulable or cannot run offline.
- Licence checks are layered through the application per the anti-tamper design
  (ADR 0013, section 6b).
