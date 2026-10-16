# R-SUX: Security user experience

Family token `R-SUX`. These rules make every security, licence and
anti-tamper feature invisible to a genuine doctor: no slowdown, no extra
clicks, no internet need, no false lockout, self-heal first, friendly
messages, never interrupt a consultation, and never harm patient data.
They derive from `docs/requirements/05-nfr-and-acceptance.md` (SUX-001 to
SUX-012, TAM-013), `docs/requirements/03-licensing-upi.md` (LIC-020) and
`docs/design/02-architecture-overview.md` section 6b.

Default scope for this family: `crates/hc-licence`, tamper/integrity code,
`crates/hc-app`, `apps/desktop/src`, installers.

---

### R-SUX-001 Protection must not break the speed budgets
- Severity: defect
- Scope: `crates/hc-licence/**`, TAM/integrity code, `apps/desktop/src-tauri/**`
- Rule: total protection overhead is at most 300 ms on cold start and at most 5% on any other budget, measured on the protected build; a protection that breaks a budget is redesigned, not the UX.
- Why: SUX-001.

### R-SUX-002 Integrity and licence checks run in idle background chunks
- Severity: defect
- Scope: `crates/hc-licence/**`, TAM/integrity code
- Rule: integrity and periodic licence checks run on a low-priority background thread in chunks under 5 ms, with randomised timing, never during typing, search, repertorisation or printing.
- Why: SUX-002; TAM-004; TAM-005.

### R-SUX-003 Zero extra clicks and no security dialogs in normal work
- Severity: defect
- Scope: `apps/desktop/src/**`, `crates/hc-app/**`
- Rule: no licence, verifying or security dialog appears during normal clinical work; the only routine security interaction is a single PIN entry at unlock.
- Why: SUX-003.

### R-SUX-004 Never needs internet; offline never blocks a valid licence
- Severity: defect
- Scope: `crates/hc-licence/**`, `crates/hc-app/**`
- Rule: no daily action requires internet, and a valid licence keeps working after any length offline (tested at 60 days).
- Why: SUX-004; product rule 7.

### R-SUX-005 One failed check never restricts the app
- Severity: defect
- Scope: `crates/hc-licence/**`, TAM/integrity code
- Rule: a single failed integrity or licence check never restricts the app; restriction needs a second independent confirming check, and antivirus quarantine or disk errors trigger Repair, not read-only mode.
- Why: SUX-005.

### R-SUX-006 Self-heal before telling the doctor
- Severity: defect
- Scope: `crates/hc-licence/**`, `crates/hc-app/**`
- Rule: on any licence or integrity problem the app first attempts automatic recovery (reload from secure store, re-verify, repair install) before showing any message.
- Why: SUX-006.

### R-SUX-007 Friendly, non-accusatory messages with one action
- Severity: defect
- Scope: `apps/desktop/src/**`, `locales/en.json`
- Rule: an unavoidable security message is plain language, says what still works, offers one clear action (Repair / Renew / Call support), and never uses words like piracy, cracked or violation toward the doctor.
- Why: SUX-007.

### R-SUX-008 Never interrupt an ongoing consultation
- Severity: defect
- Scope: `crates/hc-app/**`, `crates/hc-licence/**`
- Rule: a restriction may only block starting the next new visit; the current visit, prescription and bill can always be finished and printed, within the integrity and licence grace periods.
- Why: SUX-008; LIC-020.

### R-SUX-009 Tamper and expiry responses never harm patient data
- Severity: defect
- Scope: `crates/hc-licence/**`, TAM/integrity code, `crates/hc-storage/**`
- Rule: a tamper or licence response only restricts new paid actions; it never deletes, encrypts, hides or locks patient data and never bricks the PC; read-only mode keeps data viewable and exportable.
- Why: TAM-013; LIC-020; product rule 7.

### R-SUX-010 OS-friendly install and run
- Severity: advisory
- Scope: installers, CI, `apps/desktop/src-tauri/**`
- Rule: install and run need no admin rights, raise no firewall prompt (no listening ports), and produce no SmartScreen or antivirus detection on the signed release.
- Why: SUX-009; NFR-023; TAM-006.

### R-SUX-011 Backup credentials remembered on the same PC
- Severity: advisory
- Scope: `apps/desktop/src/backup/**`, `crates/hc-storage/**`
- Rule: scheduled backups use remembered credentials on the same PC and ask for a password only when restoring to a new PC.
- Why: SUX-011.
