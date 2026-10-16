# R-LIC: Licensing

Family token `R-LIC`. These rules keep the offline Ed25519 licence safe and
fair: only our key signs, identity locks on activation, secret comparisons
are constant-time, the clock guard is graceful, expiry is read-only not
destructive, and the offline UPI and WhatsApp flows follow the exact spec.
They derive from `docs/requirements/03-licensing-upi.md` (LIC-001 to LIC-064,
PAY-010 to PAY-016) and `docs/requirements/05-nfr-and-acceptance.md` (SUX-004,
SUX-008, TAM-014).

Default scope for this family: `crates/hc-licence`, `tools/vendor-licence-tool`,
`apps/desktop/src/licence`.

---

### R-LIC-001 Only our key signs; the app verifies offline with two embedded keys
- Severity: defect
- Scope: `crates/hc-licence/**`, `tools/vendor-licence-tool/**`
- Rule: a licence or offer code is created only with our Ed25519 private key; the app verifies against the two embedded public keys offline and treats any signature failure as unlicensed, under the two-check rule.
- Why: LIC-001, LIC-002, LIC-004; SUX-005.

### R-LIC-002 Identity fields lock after activation
- Severity: defect
- Scope: `crates/hc-licence/**`, `apps/desktop/src/settings/**`, `crates/hc-docs/**`
- Rule: the licensed name and registration number are printed on every document and cannot be edited in-app without a new licence; clinic name, address, logo and timings stay editable.
- Why: LIC-006; TAM-014.

### R-LIC-003 Constant-time comparison of secrets
- Severity: defect
- Scope: `crates/hc-licence/**`
- Rule: signatures, key hashes, identity hashes, offer-code checks and UTR-hash comparisons use constant-time equality; never `==` on secret bytes.
- Why: LIC-001; LIC-046.

```rust
// bad
if computed_hash == stored_hash { grant(); }
// good
if computed_hash.ct_eq(&stored_hash).into() { grant(); }
```

### R-LIC-004 Graceful clock-rollback guard
- Severity: defect
- Scope: `crates/hc-licence/**`
- Rule: store an HMAC-protected max-seen time; if the clock goes back more than 48 h, use max-seen time for expiry; a clock change never deletes data or hard-locks the app.
- Why: LIC-005; LIC-020.

### R-LIC-005 Expiry goes read-only, never destructive
- Severity: defect
- Scope: `crates/hc-licence/**`, `crates/hc-app/**`
- Rule: after the 15-day grace, expiry enters read-only mode (view, search, print and export still work, an ongoing visit can finish) and blocks only new visits and prescriptions; patient data is never locked or deleted.
- Why: LIC-020; SUX-008.

### R-LIC-006 Typed-key errors are reported per group
- Severity: advisory
- Scope: `crates/hc-licence/**`, `apps/desktop/src/licence/**`
- Rule: a mistyped licence key reports which Crockford group or check character is wrong ("Group 7 looks wrong"), never a generic "invalid key".
- Why: LIC-062; LIC-046.

### R-LIC-007 Trial and reinstall work with no contact
- Severity: defect
- Scope: `crates/hc-licence/**`
- Rule: the 30-day trial starts locally from the signed seed with no network, and re-importing the same `.hclic` on a new PC activates offline until it expires.
- Why: LIC-063, LIC-064; SUX-004.

### R-LIC-008 UPI and WhatsApp QR match the offline spec
- Severity: defect
- Scope: `crates/hc-licence/**`, `apps/desktop/src/licence/**`
- Rule: the Pay QR uses `upi://pay` with our business UPI id, plan amount, INR and the install id; the proof QR uses the `wa.me` link with the full pre-typed message; both are generated offline, unit-tested against fixtures, and show the business name and amount note.
- Why: PAY-011, PAY-013; section 8.

### R-LIC-009 The Vendor tool verifies money and refuses a duplicate UTR
- Severity: defect
- Scope: `tools/vendor-licence-tool/**`
- Rule: the Vendor Licence Tool issues a licence only after the operator confirms the UTR, amount and date in the business UPI dashboard, and it refuses any UTR already used.
- Why: LIC-041, LIC-042.

### R-LIC-010 The signing key never touches a shared or online machine
- Severity: defect
- Scope: `tools/vendor-licence-tool/**`, CI, docs
- Rule: the private signing key lives only on a hardware key or offline laptop (MVP2: HSM/KMS), never in the repo, CI or a networked machine; tests use throwaway keys (R-TEST-005).
- Why: LIC-047; TAM-012.
