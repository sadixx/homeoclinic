# 04. Licensing and Payments Design

Requirements: LIC-*, PAY-*, LSRV-* in `../requirements/03-licensing-upi.md`.
MVP1 diagrams: `diagrams/svg/19-seq-mvp1-licence-issue.svg`, `diagrams/svg/20-wireframe-buy-screen.svg`, `diagrams/svg/12-state-licence.svg`. MVP2 diagrams: `diagrams/svg/09-seq-offline-activation.svg`, `diagrams/svg/10-seq-upi-purchase.svg`.

## 1. MVP1 flow at a glance

| Step | Who | Where | What happens |
|---|---|---|---|
| 1 | Doctor | App Buy screen (offline) | Picks 6 months / 1 year, optional offer code, confirms name, registration number, email, mobile |
| 2 | Doctor | Phone | Scans Pay QR (amount and install_id prefilled), pays with UPI PIN |
| 3 | Doctor | Phone | Scans WhatsApp QR (message pre-typed), attaches payment screenshot, sends |
| 4 | Operator | Business UPI dashboard | Finds payment by UTR / install_id, confirms amount and date |
| 5 | Operator | Vendor Licence Tool (offline laptop) | Pastes message, enters UTR; tool checks duplicate UTR, derives plan and validity, signs licence |
| 6 | Operator | Email + WhatsApp | Sends `.hclic`, Licence Certificate PDF and invoice; WhatsApp reply "sent to your email" |
| 7 | Doctor | App (offline) | Imports `.hclic` (drag-drop / double-click), or scans certificate QR, or types key |

Target: steps 4-6 within 1 hour in support hours (LIC-049). Trial or current licence keeps working throughout (PAY-016).

## 2. Offline Pay QR (PAY-011, PAY-012)

```
upi://pay?pa=<business UPI ID>&pn=<business name>&am=3999.00&cu=INR&tn=HC-7K3P9%201Y&tr=HC-7K3P9
```
- Built by `hc-licence::payqr` from constants stored encrypted in the binary (PAY-015) and the plan price table compiled into the release. QR rendered locally (error correction level M, size fits 1366x768 screens).
- Offer code: base32 string = {code id, sku, amount_paise, valid_until} + Ed25519 signature from a separate offer-signing key. Verified offline; replaces `am`.
- Matching keys: `tn`/`tr` carry install_id; UTR is the authoritative match (some apps drop notes).
- Fallback text with Copy buttons; payee-name check hint.

## 3. WhatsApp send-proof QR (PAY-013)

`https://wa.me/91XXXXXXXXXX?text=` + URL-encoded message:
```
HomeoClinic licence request
Plan: 1 year (Rs 3,999)
Name: Dr <full name>
Reg no: <number> (<council>)
Email: <email>
Mobile: <mobile>
Install ID: HC-7K3P9
App: 1.0.3
Please find payment screenshot attached.
```
The Vendor Licence Tool parses this exact format (labels are fixed, values after the colon).

## 4. Licence formats

Full licence (`.hclic` file and certificate QR), CBOR payload + signature, base64url:
```json
{
  "v": 1, "key_id": "k1",
  "licence_id": "L-2611-000123",
  "sku": "CLINIC_1Y",
  "holder": { "name": "DR ASHA KULKARNI", "reg_no": "12345", "council": "MCH", "email": "...", "mobile": "+91..." },
  "install_id": "HC-7K3P9",
  "issued_at": "2026-11-01", "valid_from": "2026-11-01", "valid_until": "2027-10-31",
  "entitlements": ["core"],
  "utr_hash": "sha256:..."
}
```
Typed key (LIC-046): 22-byte compact payload (licence_id, sku, valid_from/until as day numbers, 8-byte hash of normalised name + reg no, key_id) + 64-byte signature = 86 bytes -> 138 base32 data chars, split into 35 groups of 4 data chars + 1 check char = 175 characters shown as 35 groups of 5. Normalisation: uppercase, collapse spaces, strip "DR."/punctuation.

Verification on import and on each check site (TAM-004): signature with embedded key, `valid_from <= today_guarded <= valid_until (+15 d grace)`, identity hash matches the locked profile.

## 5. Identity binding (LIC-006)

- On first activation, `doctor.name` and `doctor.reg_no` are overwritten with licence values and marked locked; print templates read the identity only from the verified licence, not from editable settings, so editing the database does not change prints.
- Re-import on another PC: same licence, same identity, no limit. A different doctor's licence on the same install is rejected unless the profile is reset (which starts a new clinic profile, MVP1 = one licensed doctor per install).

## 6. Licence states

Diagram: `diagrams/svg/12-state-licence.svg`.

`Unlicensed -> Trial(30d) -> Active -> Grace(15d) -> ReadOnly`, `Any -> Tampered` (signature fail confirmed twice, treated as ReadOnly with banner and Repair). `Active -> Revoked` exists only from MVP2 (online refresh). ReadOnly always allows view, search, print and export.

Clock guard: `state.bin` stores max seen UTC time, HMAC-ed with a key derived from the DEK. If now < max_seen - 48 h, use max_seen for expiry checks (LIC-005).

## 7. Vendor Licence Tool (LIC-040..050)

| Part | Design |
|---|---|
| Platform | Same Tauri + Rust stack, internal build, runs on an offline operator laptop |
| Signing | Ed25519 key on a hardware security key (PIV/OpenPGP card); separate offer-code key; sealed paper backup |
| Input | Paste WhatsApp message (parser for section 3 format) + UTR + amount + date from UPI dashboard |
| Checks | Duplicate UTR (unique index), amount to plan mapping incl. offer codes, under/over payment handling, renewal stacking from current expiry |
| Output | `.hclic`, Licence Certificate PDF (name, reg no, plan, validity, licence id, QR, key text), GST invoice PDF, mailto/SMTP draft with attachments, WhatsApp reply text |
| Register | SQLCipher DB: customer, licence, payment(utr unique), invoice, offer_code, dealer, audit; Excel export; daily encrypted backup; MVP2 import format |

## 8. Backend services (MVP2)

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /v1/activate` | licence key | Online activation |
| `POST /v1/activate/offline` | portal session (OTP) | Request code -> response code |
| `POST /v1/deactivate` | signed deactivation code | Free a device seat |
| `GET /v1/licence/refresh` | device token | Renewals, revocation |
| `POST /v1/orders` | portal session | Create Razorpay order / subscription |
| `POST /v1/payments/webhook` | Razorpay HMAC signature | Only source of truth for payment |
| `/portal/*` | phone OTP session | Customer self-service |
| `/admin/*` | SSO + 2FA, IP allowlist | Issue/extend/revoke, refunds, dealers |

Tables: `customer`, `order`, `payment`, `subscription`, `licence`, `device`, `invoice`, `dealer`, `audit`. Webhook handler is idempotent on `razorpay_payment_id` (unique index) and issues the licence in the same transaction as marking the order paid.

## 9. Hosted UPI flows (MVP2, PAY-002, PAY-006)

- One-time purchase: Razorpay Order -> Checkout with UPI Intent (mobile) or UPI QR (desktop browser) -> webhook `payment.captured` -> licence issued -> SMS + email with key, response code and GST invoice.
- Subscription: Razorpay Subscription with UPI AutoPay mandate -> webhook `subscription.charged` each cycle extends `valid_until` -> desktop picks up on next online refresh, or doctor imports new response code. Pre-debit notification handled by Razorpay per RBI rules.

## 10. Crack resistance of the licence path (TAM)

- `hc-licence` is built with control-flow obfuscation (TAM-008); its public key and messages are compile-time encrypted (TAM-003).
- Verification is not one function call. Four independent check sites (startup, write commands, pack open, 20-60 min random timer) each re-verify the signature and derive the licence state differently, and the results feed the encryption key path of paid packs, so a patched "return true" still cannot decrypt paid content (TAM-004, TAM-009).
- MVP1: no paid packs; sharing is deterred by identity binding (section 5, TAM-014) and forging is impossible without our signing key.
- MVP2 paid pack key flow: server generates `pack_key` once per pack; for each licence it adds `wrapped_key = AES-KW(KDF(licence_secret, device_fp), pack_key)` to the signed licence (LIC-031). The app unwraps in memory at pack open and zeroises after use.
- Watermark: `licence_id` is folded into the per-licence wrapped keys and into invisible ordering markers in paid pack exports, so a leaked pack or key traces back to the buyer (TAM-010).
- MVP2 server signals: activation count per key, fingerprint churn, geographic spread, refresh from known cracked builds (integrity report from TAM-005) -> automatic revocation and update block (TAM-011).
