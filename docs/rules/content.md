# R-CONT: Content channels and packs

Family token `R-CONT`. These rules keep repertory and Materia Medica content
plug-and-play and legally safe: every pack declares its channel and licence,
two signing keys separate public from internal-eval, a public build can
never load eval content, the release gate enforces it, and the registry and
GPL limits are respected. They derive from
`docs/requirements/02-repertory-engine.md` (CONT-001 to CONT-010, PACK-001,
PACK-002, PACK-005, PACK-006, PACK-013, section 2 and 2b) and
`docs/requirements/00-overview.md` section 7 (copyright).

Default scope for this family: `crates/hc-repertory`, `tools/content-builder`,
`content-sources`, build profiles, CI.

---

### R-CONT-001 Every pack declares channel and licence
- Severity: defect
- Scope: `content-sources/**`, `crates/hc-repertory/**`, `tools/content-builder/**`
- Rule: each pack manifest declares `distribution` (`public` or `internal_eval`) and `licence_spdx`; a pack missing either is rejected by both the loader and the builder.
- Why: CONT-001; PACK-002.

### R-CONT-002 Two signing keys, one per channel
- Severity: defect
- Scope: `crates/hc-repertory/**`, `tools/content-builder/**`, `crates/hc-licence/**`
- Rule: public packs are signed with the public content key and internal-eval packs with the separate eval key; a pack opens only with the key that matches its declared channel.
- Why: CONT-002; PACK-001.

### R-CONT-003 A public build cannot load internal-eval content
- Severity: defect
- Scope: build profiles, `crates/hc-repertory/**`, CI
- Rule: the public build embeds only the public content key and must refuse to verify, install or open any `internal_eval` pack even if the file is copied in; removal is automatic and needs no code change.
- Why: CONT-003; review guideline `security/eval-content-public`; product rule 6.

### R-CONT-004 Release gate blocks eval content in public artifacts
- Severity: defect
- Scope: CI, `content-sources/**`
- Rule: public-release CI fails if any `internal_eval` pack, the eval content public key, or any `content-sources/internal-eval/` file is present in the installer or binary.
- Why: CONT-005 (extends TAM-012).

### R-CONT-005 A REGISTRY.md row is required to build a pack
- Severity: defect
- Scope: `content-sources/REGISTRY.md`, `tools/content-builder/**`
- Rule: `content-builder` refuses to build a pack whose source has no `REGISTRY.md` row (pack id, title, edition, origin plus commit/checksum, licence, channel, permission, date, owner).
- Why: CONT-006.

### R-CONT-006 Internal builds are clearly marked
- Severity: defect
- Scope: `apps/desktop/src/**`, `crates/hc-docs/**`, build profiles
- Rule: an internal build shows the permanent "Internal evaluation build" banner and prints "EVALUATION" on every prescription and report.
- Why: CONT-004.

### R-CONT-007 Adding or removing a repertory needs no app code change
- Severity: defect
- Scope: `crates/hc-repertory/**`, `tools/content-builder/**`
- Rule: adding a pack is source file plus a REGISTRY row plus `content-builder build`; the engine reads chapters, grade scale, display style and abbreviations from the pack, so no engine or UI code is edited per repertory.
- Why: CONT-007; PACK-006.

### R-CONT-008 Respect GPL and redistribution limits
- Severity: defect
- Scope: `content-sources/**`, `content-sources/REGISTRY.md`
- Rule: GPL-v3 OOREP-derived packs stay `internal_eval` until legal review; OOREP sources marked not for redistribution (English Kent, Boger, Boenninghausen, Hering, Clarke, Allen) are never imported without written permission recorded in `REGISTRY.md`.
- Why: CONT-006; repertory section 2 and 2b; overview section 7.

### R-CONT-009 Channel move is registry plus re-sign, ids stay stable
- Severity: advisory
- Scope: `content-sources/**`, `tools/content-builder/**`
- Rule: moving a pack from `internal_eval` to `public` is only a REGISTRY change plus re-signing with the public key; rubric ids stay stable (mapping table) so saved analyses keep working.
- Why: CONT-008; PACK-005.

### R-CONT-010 Pack format version is checked
- Severity: defect
- Scope: `crates/hc-repertory/**`
- Rule: the loader checks `format_version`; a newer major version is refused with a plain "update the app" message while other packs keep working.
- Why: PACK-013.
