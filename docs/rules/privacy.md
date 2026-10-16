# R-PRIV: Privacy and patient-data protection

Family token `R-PRIV`. These rules keep patient data on the doctor's PC,
out of logs and diagnostics, and under the doctor's control, with no network
of our own in MVP1. They derive from `docs/requirements/00-overview.md`
(principles 1, 2, 5 and the DPDP checklist in section 7),
`docs/requirements/05-nfr-and-acceptance.md` (NFR-013, NFR-022, NFR-023),
`docs/design/02-architecture-overview.md` section 8 and
`hc-agents/skills/hc-project-context` non-negotiable rules 1 and 2.

Default scope for this family: all Rust crates, `apps/desktop/src`, CI.

---

### R-PRIV-001 No patient data in logs, errors or crash reports
- Severity: defect
- Scope: `crates/**/*.rs`, `apps/desktop/src-tauri/**`, `apps/desktop/src/**`
- Rule: patient name, mobile, address, case text, prescription or any other identifier must never appear in a log line, error message, panic message or crash report; log a hashed id instead.
- Why: NFR-013; design section 8 (identifiers hashed); product rule 2.

```rust
// bad
log::info!("saved visit for {}", patient.name);
// good
log::info!("saved visit for patient {}", hash_id(&patient.id));
```

### R-PRIV-002 MVP1 makes no network calls of its own
- Severity: defect
- Scope: `crates/**`, `apps/desktop/src-tauri/**`, `apps/desktop/src/**`
- Rule: no HTTP client, socket, DNS lookup or URL fetch is allowed except handing `wa.me` and `mailto:` links to the OS and the optional signed update-manifest fetch; no listening ports, ever.
- Why: NFR-022, NFR-023; product rule 1.

```rust
// bad
reqwest::get("https://api.example.com/track").await?;
// good
tauri_plugin_opener::open_url(wa_me_link)?; // OS opens WhatsApp, app makes no call
```

### R-PRIV-003 Consent is captured before patient details are stored
- Severity: defect
- Scope: `crates/hc-app/**`, `apps/desktop/src/patients/**`, `apps/desktop/src/licence/**`
- Rule: creating or editing a patient records `consent_at`, and the Buy screen stores name, registration number, email and mobile only after the DPDP consent text is shown and accepted.
- Why: DPDP Act (overview section 7); PAY-010.

### R-PRIV-004 Diagnostics and crash upload are scrubbed
- Severity: defect
- Scope: `apps/desktop/src/settings/**`, `crates/hc-app/**`
- Rule: the support Health-check screen (SUX-012) and any optional crash upload contain only licence state, integrity status, counts and hashed ids, never patient identifiers; crash upload is off unless the doctor consents.
- Why: SUX-012; NFR-013.

### R-PRIV-005 Share links and clipboard carry only intended content
- Severity: defect
- Scope: `apps/desktop/src/**`, `crates/hc-docs/**`
- Rule: `wa.me`/`mailto:`/Rx-share text and clipboard copies contain only what the doctor sees and chooses to send; the app never silently appends patient identifiers to a link or clipboard payload.
- Why: NFR-022; product rule 2.

### R-PRIV-006 Patient data is always exportable and erasable
- Severity: defect
- Scope: `crates/hc-app/**`, `apps/desktop/src/**`
- Rule: the app provides patient-data export (CSV/JSON/PDF) and a DPDP erase path; neither is blocked by licence expiry, read-only mode or tamper response.
- Why: overview principle 3 and section 7 (right to export and erase); LIC-020.

### R-PRIV-007 On-disk files use opaque names
- Severity: advisory
- Scope: `crates/hc-storage/**`, `crates/hc-app/**`
- Rule: stored attachments and backups use opaque uuid names (`<uuid>.bin`); patient name or mobile never appears in a file or backup name.
- Why: CODE-LAYOUT data-on-disk layout (`files/ <uuid>.bin`); product rule 2.
