# Licensing, Activation and UPI Payments

MVP1 runs with no servers of ours: the app generates the UPI payment QR offline, the doctor sends proof on WhatsApp, we issue a signed licence with the offline Vendor Licence Tool and email it, and the doctor activates offline (section 3). The hosted, automated flow is MVP2 (sections 6 and 7).

## 1. Plans (prices are placeholders, product owner to finalise)

| SKU | Release | Who | Price idea | Entitlements |
|---|---|---|---|---|
| TRIAL | MVP1 | Everyone | Free, 30 days, starts locally | All MVP1 features, "Trial" mark on Rx |
| CLINIC_6M | MVP1 | Doctor | Rs 2,299 / 6 months | All MVP1 features, 6 months |
| CLINIC_1Y | MVP1 | Doctor | Rs 3,999 / year | All MVP1 features, 12 months |
| STUDENT | MVP2 | Verified students | Rs 999 / year | Repertory + MM only |
| CLINIC_LIFETIME | MVP2 | Doctor | Rs 14,999 one-time (2 years updates) | Perpetual use of purchased version |
| ADDON_PACK_x | MVP2 | Any | per pack | Licensed repertory/MM packs |
| CLOUD_BACKUP | MVP2 | Any paid | Rs 999 / year | Encrypted cloud backup 10 GB |

Competitor desktop suites cost far more, so pricing must stay clearly cheaper. Base prices are compiled into each app version; discounts use signed offer codes (PAY-012).

## 2. Licence file (LIC)

| ID | Pri | Requirement |
|---|---|---|
| LIC-001 | P0 | Licence = compact payload signed with an Ed25519 private key held only by us (MVP1: hardware key on the Vendor Licence Tool laptop; MVP2: KMS). The app embeds 2 public keys (current + next) and verifies offline. Nobody can create or edit a licence without our private key. |
| LIC-002 | P0 | Payload fields: format version, licence_id, sku, holder full name, registration number + council, email, mobile, install_id (from the purchase message, informational in MVP1), issued_at, valid_from, valid_until, entitlements[], payment UTR hash, key_id. |
| LIC-003 | MVP2 | Device fingerprint binding (Windows: MachineGuid + SMBIOS UUID + disk serial; Linux: machine-id + DMI uuid + disk serial; match 2 of 3) and device limits. MVP1 licences are not bound to a PC (LIC-006). |
| LIC-004 | P0 | Licence stored in the data folder and the OS secure store (Windows DPAPI / Linux Secret Service); included in backups. Signature failure -> treated as unlicensed (SUX-005 two-check rule applies). |
| LIC-005 | P0 | Clock rollback protection: store max-seen time (HMAC with a key derived from the DEK); if the clock goes back > 48 h, use max-seen time for expiry. |
| LIC-006 | P0 | Identity binding (anti-sharing, fully offline): the licensed full name and registration number become the doctor identity printed on every prescription, receipt, certificate and letter, and cannot be edited in the app without a new licence. Clinic name, address, logo and timings stay editable. Sharing a licence would print the buyer's name on someone else's prescriptions. Unlimited reinstalls and PC changes are allowed for the same doctor. |
| LIC-007 | P0 | A second doctor in the same clinic needs their own licence (MVP1: one licensed doctor per installation; multi-doctor licences arrive with MVP2 roles). |

## 3. MVP1 purchase and activation (no hosted servers)

### 3.1 In-app Buy / Renew screen (all offline)

| ID | Pri | Requirement |
|---|---|---|
| PAY-010 | P0 | Buy screen, reachable from the trial banner, the licence page and expiry reminders. Step 1: choose plan (6 months / 1 year) and optionally enter an offer code. Step 2: enter or confirm full name (as on registration certificate), registration number + council, email, mobile; shown clearly that name and registration number will be printed on prescriptions and cannot be changed later (LIC-006). Consent text for storing these details (DPDP). |
| PAY-011 | P0 | Pay QR generated offline from the standard UPI payment link: `upi://pay?pa=<our business UPI ID>&pn=<business name>&am=<plan amount>&cu=INR&tn=<install_id> <plan>&tr=<install_id>`, rendered as a QR by the app. Below it, plain text UPI ID, amount and note with Copy buttons for manual payment, and the line "Check that your UPI app shows <business name> before paying". |
| PAY-012 | P0 | Offer codes: a short code signed with our key (sku, new amount, valid_until, max uses advisory) verified offline; the Pay QR then uses the discounted amount. Invalid or expired codes show a friendly message. |
| PAY-013 | P0 | Send-proof QR: a WhatsApp click-to-chat QR (`https://wa.me/<our number>?text=<url-encoded message>`) opening our WhatsApp Business chat with the message pre-typed: product, plan, amount, full name, registration number, email, mobile, install_id, app version. Doctor scans with phone, attaches the payment screenshot, sends. A "Copy message" button and our number in text are shown as fallback. |
| PAY-014 | P0 | `install_id`: short random id (e.g. `HC-7K3P9`, Crockford base32) created at first run and shown on the licence page; used only to match payments and messages. |
| PAY-015 | P0 | Our UPI ID, business name, WhatsApp number and public keys are stored encrypted in the binary (TAM-003). |
| PAY-016 | P0 | After sending, the screen shows "We will email your licence within 1 hour during support hours (Mon-Sat 10:00-19:00 IST)" and how to import it. The trial or current licence keeps working meanwhile. |

### 3.2 Our side: verification and issuance

| ID | Pri | Requirement |
|---|---|---|
| LIC-040 | P0 | Vendor Licence Tool (internal offline desktop app, same Rust `hc-licence` crate). Operator pastes the WhatsApp message (fields auto-parsed), enters the UTR and amount seen in our business UPI dashboard, and the tool derives plan and validity. |
| LIC-041 | P0 | Verify money, not the screenshot: a licence is issued only after the operator confirms the UTR, amount and date in our business UPI or bank dashboard. The screenshot is used only to find the payment. |
| LIC-042 | P0 | Duplicate protection: the tool stores every UTR and refuses a UTR already used. |
| LIC-043 | P0 | Plan from amount: exact plan amount (or valid offer amount) -> that plan. Underpayment -> tool drafts a WhatsApp reply asking for the balance. Overpayment -> tool records it for refund or offers to extend validity proportionally. |
| LIC-044 | P0 | Validity: new purchase valid from issue date; renewal adds the new period on top of the current valid_until (no lost days), for 6 or 12 months. |
| LIC-045 | P0 | Outputs per licence: (a) signed licence file `<name>.hclic`, (b) Licence Certificate PDF with doctor name, registration number, plan, validity, licence id, QR of the full licence and the licence key text, (c) GST tax invoice PDF if applicable, (d) a pre-filled email (mailto or local SMTP) to the doctor with all three attached, and (e) a short WhatsApp reply text "Licence sent to <email>". The PDF is not password protected (the signature, not encryption, protects the licence). |
| LIC-046 | P0 | Licence key text (typing fallback): a compact form = licence_id, sku, valid_from, valid_until, hash of normalised name + registration number, key_id, plus the 64-byte Ed25519 signature, encoded in Crockford base32 in groups of 5 (4 data characters + 1 check character, about 175 characters). The app verifies it against the name and registration number entered on that PC (pre-filled from the Buy screen or typed from the certificate). The `.hclic` file and certificate QR carry the full licence, so typing is only a fallback. |
| LIC-047 | P0 | Signing key on a hardware security key (YubiKey/smart card) or an encrypted file on an offline laptop, with a sealed paper backup in a safe place. Never on a shared or online machine. |
| LIC-048 | P0 | Register: encrypted local database of customers, licences, payments (UTR, amount, date), invoices and offer codes; search, export to Excel, daily backup; importable into the MVP2 licence server without reissuing licences. |
| LIC-049 | P0 | Turnaround target: licence emailed within 1 hour during support hours (Mon-Sat 10:00-19:00 IST), shown in the app (PAY-016). |
| LIC-050 | P1 | Dealer sales: dealer collects payment and forwards the WhatsApp message; tool tags licence and invoice by dealer. |

### 3.3 Doctor activates by themselves (offline)

| ID | Pri | Requirement |
|---|---|---|
| LIC-060 | P0 | "Import licence" accepts any of: (a) drag-and-drop or file picker for `.hclic` (doctor opened the email on the PC), (b) scan the QR on the Licence Certificate PDF with the PC webcam, (c) paste or type the licence key, (d) open the `.hclic` file by double-click (file association). |
| LIC-061 | P0 | On import: verify signature, check validity dates and clock guard, show a confirmation card (name, registration number, plan, valid until) and apply. Identity fields in Settings become locked (LIC-006). |
| LIC-062 | P0 | Typed key errors are shown per group ("Group 7 looks wrong"); no generic "invalid key" message. |
| LIC-063 | P0 | Trial needs no contact with us: 30-day trial starts locally at first run (signed trial seed in the installer). |
| LIC-064 | P0 | Re-install or new PC: import the same `.hclic` again; works without contacting us until it expires. |

## 4. Expiry behaviour

| ID | Pri | Requirement |
|---|---|---|
| LIC-020 | P0 | On expiry: 15-day grace period with daily reminder. After grace, app enters Read-only mode: view/search/print/export all patient data and existing analyses; cannot create new visits/prescriptions. Patient data is never locked or deleted. An ongoing visit can always be finished (SUX-008). |
| LIC-021 | P0 | Reminders at 30, 15, 7, 1 days before expiry on the home screen, each with a one-click "Renew" that opens the Buy screen (PAY-010) with the current plan preselected. |
| LIC-022 | MVP2 | Perpetual licence: updates released after updates_until are refused with a clear message; current version keeps working. |
| LIC-030 | MVP2 | Pack entitlements: licence `entitlements[]` lists paid pack ids; a paid pack opens only if entitled. MVP1 ships free packs only. |
| LIC-031 | MVP2 | Paid pack encryption: pack key wrapped per licence and device, unwrapped in memory only (TAM-009). |

## 5. MVP2: automated online activation (needs our server)

| ID | Pri | Requirement |
|---|---|---|
| LIC-010 | MVP2 | Online activation with licence key; server returns the signed licence, adds device fingerprint. |
| LIC-011 | MVP2 | Offline activation with Activation Request / Response codes and QR via the portal (design 04 section 3). |
| LIC-012 | MVP2 | Device transfer via portal or signed deactivation code. |
| LIC-013 | MVP2 | Renewal pushed automatically to the app when online. |
| LIC-014 | MVP2 | When online, silent weekly refresh (revocation, renewals); never required for operation. |

## 6. MVP2: hosted UPI purchase (PAY)

| ID | Pri | Requirement |
|---|---|---|
| PAY-001 | MVP2 | "Buy / Renew" opens the purchase portal (or a QR to it) pre-filled with install_id. |
| PAY-002 | MVP2 | Portal: plan, phone OTP, email, GSTIN; Razorpay Checkout (UPI Intent, QR, collect, cards, netbanking). |
| PAY-003 | MVP2 | Payment confirmed only via verified gateway webhook; idempotent order handling. |
| PAY-004 | MVP2 | Licence issued and delivered automatically (email, SMS, WhatsApp). |
| PAY-005 | MVP2 | GST invoice generated and emailed automatically. |
| PAY-006 | MVP2 | Subscriptions via UPI AutoPay. |
| PAY-007 | MVP2 | Referral discounts. |
| PAY-008 | MVP2 | Dealer portal. |
| PAY-009 | MVP2 | Refunds and revocation via admin dashboard. |

## 7. MVP2: licence server (LSRV)

Built once MVP1 revenue justifies hosting costs.

| ID | Pri | Requirement |
|---|---|---|
| LSRV-001 | MVP2 | Endpoints: activate, activate-offline, deactivate, refresh, payments webhook, customer portal (phone OTP). |
| LSRV-002 | MVP2 | Admin dashboard: customers, issue/extend/revoke, payments, manual licences; imports the MVP1 register (LIC-048). |
| LSRV-003 | MVP2 | Signing key in KMS/HSM; key rotation with 2 embedded public keys. |
| LSRV-004 | MVP2 | Rate limiting and abuse detection. |
| LSRV-005 | MVP2 | No patient data; hosted in India. |
| LSRV-006 | MVP2 | Auth on every non-public endpoint; admin behind SSO/2FA. |

## 8. Acceptance tests (must exist)

MVP1:
- Buy screen with network disabled: Pay QR scanned by GPay, PhonePe, Paytm and BHIM shows our business name, exact plan amount and the install_id note; WhatsApp QR opens our chat with the full pre-typed message.
- Offer code: valid code changes the QR amount; edited or expired code rejected.
- Vendor Licence Tool: same UTR twice is refused; underpayment produces a balance request; renewal extends from current expiry.
- Import via each path (file, double-click, webcam QR, typed key) on a PC that has never been online; a mistyped key reports the wrong group.
- Licensed name and registration number print on Rx/receipt and are not editable; reinstall on another PC with the same `.hclic` works.
- Set clock back 1 year: expiry still enforced.
- Edit one byte in the licence file: rejected, app stays in current state (two-check rule), data intact.
- Expired licence: all data viewable, printable and exportable; ongoing visit can be finished.
- End to end (pay, WhatsApp, verify, email, import) completes in under 30 minutes in support hours with the clinic PC offline throughout.

MVP2:
- Webhook replayed twice: one licence issued.
- Device fingerprint: one hardware change tolerated, two require re-activation.
