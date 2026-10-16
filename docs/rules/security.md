# R-SEC: Security

Family token `R-SEC`. These rules enforce the code-level security design:
parameterised SQL, a least-privilege Tauri surface, locked-down webview,
protected secrets and keys, signature-before-trust, and audited pinned
dependencies. They derive from `docs/design/02-architecture-overview.md`
section 6, `docs/requirements/05-nfr-and-acceptance.md` (NFR-020, NFR-024,
NFR-025, TAM-003) and `docs/requirements/02-repertory-engine.md` (PACK-001)
and `docs/requirements/03-licensing-upi.md` (LIC-001).

Default scope for this family: all Rust crates, `apps/desktop/src-tauri`, CI.

---

### R-SEC-001 Parameterised SQL only
- Severity: defect
- Scope: `crates/hc-storage/**`, `crates/hc-search/**`, `crates/hc-storage/migrations/**`
- Rule: every SQL statement binds its values as parameters; SQL text is never built with `format!`, `+` or any string interpolation of a value.
- Why: design section 6 (code); product rule 3.

```rust
// bad
let sql = format!("SELECT * FROM patient WHERE mobile = '{mobile}'");
// good
conn.prepare("SELECT * FROM patient WHERE mobile = ?1")?.query([mobile])?;
```

### R-SEC-002 Tauri capabilities are least privilege
- Severity: defect
- Scope: `apps/desktop/src-tauri/capabilities/**`, `apps/desktop/src-tauri/tauri.conf.json`
- Rule: a capability grants only the specific commands a window needs; no wildcard command or path scope.
- Why: design section 6 (Tauri capability allowlist); product rule 5.

### R-SEC-003 No shell plugin and no arbitrary filesystem scope
- Severity: defect
- Scope: `apps/desktop/src-tauri/**`, `apps/desktop/src-tauri/Cargo.toml`
- Rule: `tauri-plugin-shell` and broad/arbitrary `fs` scopes are forbidden; file access goes through typed commands bound to fixed app-data paths.
- Why: product rule 5; design section 6.

### R-SEC-004 Content Security Policy is locked down
- Severity: defect
- Scope: `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/index.html`
- Rule: the webview CSP forbids remote origins, inline `eval` and remote scripts; assets load only from the embedded bundle.
- Why: design section 6; TAM-001.

### R-SEC-005 No secrets in source or plaintext in the binary
- Severity: defect
- Scope: `**/*`
- Rule: private keys, PINs, recovery codes, real UPI credentials and signing keys are never in source or config; licence strings, public keys and URLs are compile-time encrypted (TAM-003) and runtime secrets come from env, the OS secure store or an HSM.
- Why: TAM-003, PAY-015; design section 6; instructions 7.5 in requirements/06.

### R-SEC-006 Key material is zeroized
- Severity: defect
- Scope: `crates/hc-licence/**`, `crates/hc-storage/**`
- Rule: DEK, KEK, PIN-derived keys, recovery codes and pack keys live in zeroizing buffers and are wiped after use; they are never logged or copied into long-lived `String`s.
- Why: NFR-020; design section 6 (key hierarchy).

### R-SEC-007 Verify signatures before trusting input
- Severity: defect
- Scope: `crates/hc-repertory/**`, `crates/hc-licence/**`, updater code
- Rule: a pack, update manifest or licence is parsed, opened or applied only after its Ed25519 signature verifies against an embedded public key; no "open now, verify later".
- Why: PACK-001, LIC-001, NFR-025; design section 6.

### R-SEC-008 Dependencies are pinned and audited
- Severity: defect
- Scope: `Cargo.lock`, `apps/desktop/package-lock.json`, CI
- Rule: lockfiles are committed and CI runs `cargo audit` and `npm audit`; a new dependency is pinned and justified in the MR.
- Why: NFR-024.

### R-SEC-009 The one allowed fetch is TLS and still signature-checked
- Severity: advisory
- Scope: updater code in `apps/desktop/src-tauri/**` or `crates/hc-app/**`
- Rule: the optional update-manifest fetch uses TLS 1.2 or higher, still verifies the Ed25519 signature (R-SEC-007), and can be disabled in settings.
- Why: NFR-022; design section 6.
