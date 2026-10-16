# ADR 0013: Layered anti-tamper protection

Date: 2026-10-17. Status: accepted.

Design ADR id: 011 (from `docs/design/02-architecture-overview.md` sections 7
and 6b).

## Context

No client binary is truly uncrackable. The goal is to make cracking expensive
and a cracked copy of little value, without triggering antivirus false
positives and without ever harming patient data. Whole-binary packers /
VMProtect, kernel-level DRM and doing nothing were all considered.

## Decision

Apply layered anti-tamper protection: a hardened single native binary, runtime
integrity checks, and server-held value (paid packs encrypted, key only inside
the device-bound licence for MVP2). The full layer list and release pipeline
are in section 6b (TAM-001..013); obfuscation is applied only to `hc-licence`
and pack-decrypt code so hot paths keep full speed. Tamper detection only
blocks new paid actions (Read-only mode); patient data is never deleted,
encrypted or hidden.

## Consequences

- Strong enough to make cracking uneconomic, with no antivirus false positives,
  and patient data is never harmed.
- A whole-binary packer/VMProtect, kernel DRM, and no protection at all were
  rejected: the first two cause antivirus false positives and erode doctor
  trust, and no protection leaves the product defenceless.
- Each protection layer is designed to stay invisible to a genuine doctor
  (SUX-001..012, section 6b).
