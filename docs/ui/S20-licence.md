# S20 Licence and Buy
Screen id: licence   Route: /licence   Module: apps/desktop/src/licence
Requirements: LIC-002, LIC-006, LIC-020, LIC-021, LIC-046, LIC-060, LIC-061, LIC-062, LIC-063, LIC-064, PAY-010, PAY-011, PAY-012, PAY-013, PAY-014, PAY-016, SUX-003, SUX-007, SUX-010, TAM-014   Milestone: M9  Release: R8

## Purpose

Show the licence state and let the doctor buy, renew and activate entirely
offline. The status page shows the current state (trial, active, grace,
read-only), the locked holder identity, the plan and the dates, the install_id
and expiry reminders (LIC-002, LIC-021). The Buy screen generates the offline
UPI Pay QR and the WhatsApp send-proof QR (PAY-010..016). Activation imports a
`.hclic` by drag-and-drop or double-click, scans the certificate QR with the
webcam, or accepts a typed 175-character key (LIC-046, LIC-060). The licensed
name and registration number lock onto every printout (LIC-006, TAM-014).

## Entry points

- Left nav trial / renew badge (the only routine licence UI in normal work,
  SUX-003) and the status-bar licence chip.
- The expiry reminders on Today (S03) with one-click Renew (LIC-021).
- The read-only banner shown after grace (LIC-020).
- File association: double-clicking a `.hclic` opens the app on this screen's
  import card (LIC-060).

## Layout (wireframe)

### Status page

```
+----------------------------------------------------------------------------------------------+
| Licence                                                                                       |
+----------------------------------------------------------------------------------------------+
| State: ACTIVE                                              Install ID: HC-7K3P9  [Copy]        |
|  Licensed to: Dr Asha Kulkarni   Reg. no: 12345 (MCH)   (prints on all documents, locked)     |
|  Plan: 1 year (CLINIC_1Y)     Valid until: 31-03-2027  (167 days left)   Key id: k1           |
|                                                                                               |
|  {reminder banner at 30/15/7/1 days before expiry: "Your licence expires in 7 days"}          |
|                                                                                               |
|                                         [ Buy / Renew ]      [ Import licence ]               |
+----------------------------------------------------------------------------------------------+
```

Trial state replaces the identity line with "Development trial - 9 days left"
and keeps Buy / Renew and Import. Read-only state shows a banner (below).

```
| State: READ-ONLY (licence expired)                                                            |
|  Your patient records are safe. You can view, search, print and export everything.            |
|  To add new visits again, renew your licence.                           [ Renew now ]         |
```

### Buy / Renew screen (offline, matches diagram 20)

```
+----------------------------------------------------------------------------------------------+
| Buy HomeoClinic licence (works offline)                              Install ID: HC-7K3P9     |
+---------------------------+---------------------------+---------------------------+-----------+
| 1. Choose plan            | 3. Pay (scan any UPI app) | 4. Send payment proof     |           |
|  (o) 1 year  - Rs 3,999   |   +-----------------+     |   +-----------------+     |           |
|  ( ) 6 months- Rs 2,299   |   |     PAY  QR     |     |   |  WHATSAPP  QR   |     |           |
|  Offer code [______][Apply]   +-----------------+     |   +-----------------+     |           |
|                           |  Pay to: HomeoClinic      |  Opens our WhatsApp with  |           |
| 2. Your details           |  (check this name)        |  your details pre-typed.  |           |
|  Full name* [ Dr Asha ... ]   UPI ID: homeoclinic@bank|  Attach screenshot, send. |           |
|  Reg. no* [ 12345 ][v MCH]|   [Copy]                  |   [Copy message]          |           |
|  Email  [ asha@... ]      |  Amount: Rs 3,999 [Copy]  |   WhatsApp +91 9xxxx xxxxx|           |
|  Mobile [ 98xxx xxxxx ]   |  Note: HC-7K3P9 1Y [Copy] |                           |           |
|  Name and Reg. no. print  |                           |                           |           |
|  on prescriptions and     |                           |                           |           |
|  cannot be changed later. |                           |                           |           |
|  [x] I agree to store     |                           |                           |           |
|      these details        |                           |                           |           |
+---------------------------+---------------------------+---------------------------+-----------+
| 5. After payment we email your licence within 1 hour (Mon-Sat 10:00-19:00 IST). Your trial    |
|    keeps working meanwhile.   [ Import licence file ]  [ Scan licence QR ]  [ Type licence key ]|
+----------------------------------------------------------------------------------------------+
```

### Import licence card (drag-drop / double-click / webcam / typed key)

```
+--------------------------------------------------+   +--------------------------------------------+
| Import licence                                   |   | Confirm licence                            |
|  Drag your .hclic file here, or                  |   |  Licensed to: Dr Asha Kulkarni             |
|   [ Choose file... ]  [ Scan QR with webcam ]    |   |  Reg. no: 12345 (MCH)                      |
|   [ Type licence key ]                           |   |  Plan: 1 year    Valid until: 31-03-2027   |
|  {inline error if signature/date/identity fails} |   |  Name and Reg. no. will print on all       |
|                                                  |   |  documents and lock after you apply.       |
+--------------------------------------------------+   |                   [Cancel]   [Apply]       |
                                                       +--------------------------------------------+
```

```
Type licence key (175 characters, 35 groups of 5)
[ABCDE]-[FGHIJ]-[KLMNP]-[QRSTU]-[VWXYZ]-[...]  ...
{inline per-group error: "Group 7 looks wrong"}            [Verify and apply]
```

## Fields and controls (element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| State line | text | Trial / Active / Grace / Read-only / Tampered (LIC-002, design 04 section 6) | licence-state |
| Holder identity | text read-only | licensed name + reg no, locked, prints on documents (LIC-006, TAM-014) | licence-holder |
| Plan and dates | text | sku, valid_from, valid_until, days left, key id (LIC-002) | licence-validity |
| Install ID | text + copy | short id shown for matching payments (PAY-014) | licence-installid |
| Reminder banner | banner | at 30/15/7/1 days, with Renew (LIC-021) | licence-reminder |
| Read-only banner | banner | plain language, states what still works, one action (LIC-020, SUX-007) | licence-readonly-banner |
| Buy / Renew | button | opens Buy screen with current plan preselected on renew (PAY-010, LIC-021) | licence-buy |
| Plan radio | radio group | 1 year / 6 months (PAY-010; MVP1 two plans) | licence-buy-plan |
| Offer code | text + Apply | signed offer code, verified offline, changes amount (PAY-012) | licence-offer-code |
| Full name | text | confirmed buyer name, printed and locked later (PAY-010, LIC-006) | licence-buy-name |
| Reg. no + council | text + dropdown | confirmed registration, printed and locked later (PAY-010) | licence-buy-regno |
| Email / Mobile | text | buyer contact (PAY-010) | licence-buy-email |
| Consent checkbox | checkbox | DPDP consent to store details (PAY-010) | licence-buy-consent |
| Pay QR | image | offline UPI QR from upi:// link (PAY-011) | licence-pay-qr |
| Payee-name hint | text | "check this name before paying" (PAY-011) | licence-pay-payee |
| UPI id / amount / note | text + copy | fallback copy buttons (PAY-011) | licence-pay-upiid |
| WhatsApp QR | image | wa.me click-to-chat QR with pre-typed message (PAY-013) | licence-wa-qr |
| Copy message | button | copies the WhatsApp message text (PAY-013) | licence-wa-copy |
| After-payment note | text | "licence by email within 1 hour (Mon-Sat 10:00-19:00 IST)" (PAY-016) | licence-after-note |
| Import file | button | file picker / drag-drop for `.hclic` (LIC-060) | licence-import-file |
| Scan QR (webcam) | button | reads the certificate QR via PC webcam (LIC-060) | licence-import-webcam |
| Type key | button | opens the 175-char grouped key entry (LIC-046, LIC-060) | licence-import-typed |
| Key group inputs | text x35 | 4 data chars + 1 check char each; per-group validation (LIC-046, LIC-062) | licence-key-group |
| Confirm card | panel | name, reg no, plan, valid-until before apply (LIC-061) | licence-confirm-card |
| Apply | button | applies the licence and locks identity (LIC-061, LIC-006) | licence-apply |

## Behaviour

- The status page reads the current licence state and shows the locked holder
  identity, plan and dates, and the install_id; during trial it shows days left;
  it never shows a verifying dialog during normal work (SUX-003, LIC-002,
  PAY-014).
- Reminders appear at 30, 15, 7 and 1 days before expiry with a one-click Renew
  that opens Buy with the current plan preselected (LIC-021). After expiry a
  15-day grace keeps full function with a daily reminder; after grace the app is
  read-only: view, search, print and export stay enabled, new visits and
  prescriptions are blocked, and an open visit can still be finished (LIC-020,
  SUX-008). Read-only messages say what still works and offer one action, never
  the words "piracy" or "cracked" (SUX-007).
- Buy builds both codes locally: the Pay QR from `upi://pay?pa=...&am=<plan or
  offer amount>&cu=INR&tn=<install_id> <plan>&tr=<install_id>` (PAY-011), and the
  WhatsApp QR from `https://wa.me/<our number>?text=<pre-typed message>`
  (PAY-013). A valid offer code replaces the amount; an invalid or expired code
  shows a friendly message (PAY-012). Copy buttons and the plain UPI id, amount,
  note and our number are shown as fallbacks (PAY-011, PAY-013). Nothing is sent
  from the app; it only renders QRs and hands the wa.me link to the OS when the
  doctor clicks (NFR-022).
- Buy step 2 states clearly that the name and registration number will print on
  prescriptions and cannot be changed later, with DPDP consent (PAY-010,
  LIC-006).
- Activation accepts four offline paths: drag-drop or file picker for `.hclic`,
  double-click file association, webcam scan of the certificate QR, and the typed
  175-character key (LIC-060, LIC-046). On any path the app verifies the Ed25519
  signature, the validity dates with the clock guard, and that the identity hash
  matches the name and registration number, then shows the confirmation card
  before applying; Apply locks the identity fields for prints (LIC-061, LIC-006,
  design 04 section 4-5).
- The typed key is validated per group; a bad group reports its number ("Group 7
  looks wrong") rather than a generic "invalid key" (LIC-062).
- Trial starts locally at first run from the signed trial seed and needs no
  contact with us (LIC-063). Re-installing or moving to a new PC re-imports the
  same `.hclic` and works offline until expiry (LIC-064).
- Identity binding means a shared licence prints the buyer's name on someone
  else's prescriptions; forging a licence is impossible without our signing key
  (LIC-006, TAM-014).

## Release slices

- Before R8 (dev trial, from R1): only the trial state of the status page is
  shown via the nav badge (SUX-003); the trial seed drives it (LIC-063). Buy and
  import are feature-flagged off because activation does not exist yet (ADR-0002:
  the wizard licence step is a dev trial until M9).
- R8 (M9, this release): the full status page with reminders and read-only
  behaviour, the offline Buy screen (Pay QR, WhatsApp QR, offer code, fallbacks),
  and all four activation paths with the confirm card and identity lock
  (PAY-010..016, LIC-002, LIC-006, LIC-020, LIC-021, LIC-046, LIC-060..064). This
  is the R8 demo and acceptance flow 10.
- R9 (M10): no new behaviour; the same screen runs on the hardened, signed build
  so the licence-string and key protections (TAM-003) and the tamper read-only
  response (TAM-005, LIC-020 rules) are exercised; covered by acceptance flow 12.
- MVP2 (out of scope here): online activation, device fingerprint binding,
  automatic renewal and the hosted purchase portal (LIC-003, LIC-010..014,
  PAY-001..009) are not on this screen.

## States (empty, loading, error, read-only, trial)

- Empty: before any licence and before trial (not expected, because trial starts
  at first run), the status page offers Buy / Renew and Import as primary actions.
- Loading: Buy renders the QRs locally in well under a second; webcam scanning
  shows a live frame with a "point the certificate QR at the camera" hint.
- Error: an invalid offer code, a failed signature, an out-of-range date or an
  identity mismatch shows a plain-language inline message with a Details expander
  for a support code; the app stays in its current state (two-check rule,
  SUX-005). A mistyped key names the wrong group (LIC-062).
- Read-only mode (LIC-020): this screen is fully usable in read-only mode so the
  doctor can renew and import; applying a valid renewal returns the app to active
  immediately.
- Trial: the status page shows "Development trial / Trial - N days left"; a
  "Trial" mark appears on the Rx (per plan table in requirements 03 section 1).

## Keyboard

- Tab order follows the Buy columns left to right: plan, details, then the
  activation row.
- In the typed-key entry, typing auto-advances between groups; Backspace at the
  start of a group moves to the previous group; Enter is Verify and apply.
- Esc closes the import card, the typed-key entry or the webcam scanner without
  changing the licence (00-conventions section 3).

## Commands used (proposed Tauri command names)

- `get_licence_status` req `{}` resp `{ state: "trial"|"active"|"grace"|"readonly"|"tampered", holder?: { name, reg_no, council }, sku?, valid_from?, valid_until?, days_left?, grace_days_left?, install_id, key_id?, reminders: [{ days_before }] }` (LIC-002, LIC-020, LIC-021, PAY-014)
- `get_buy_options` req `{}` resp `{ plans: [{ sku, label, amount_paise }], business_name, upi_id, our_whatsapp, support_hours }` (PAY-010, PAY-011, PAY-015, PAY-016)
- `apply_offer_code` req `{ code, sku }` resp `{ ok, amount_paise?, valid_until?, error?: { code, message } }` (PAY-012)
- `build_pay_qr` req `{ sku, offer_code?, holder: { name, reg_no, council, email, mobile } }` resp `{ upi_uri, qr_svg, payee_name, upi_id, amount_display, note }` (PAY-011, PAY-014)
- `build_whatsapp_qr` req `{ sku, offer_code?, holder, install_id, app_version }` resp `{ wa_url, qr_svg, message_text, our_number }` (PAY-013)
- `import_licence_file` req `{ file_path }` resp `{ ok, card?: { name, reg_no, council, sku, valid_until }, error?: { code, message } }` (LIC-060, LIC-061)
- `import_licence_webcam` req `{}` resp `{ ok, card?, error?: { code, message } }` (LIC-060)
- `import_licence_key` req `{ key_text }` resp `{ ok, card?, error?: { bad_group_index?, code, message } }` (LIC-046, LIC-062)
- `apply_licence` req `{ token }` resp `{ ok, state, holder, valid_until }` (LIC-061, LIC-006; locks identity)

## Acceptance checks

- AC1 (PAY-011, acceptance flow 10): with the network disabled the Pay QR scanned
  by GPay, PhonePe, Paytm and BHIM shows the business name, the exact plan amount
  and the install_id note.
- AC2 (PAY-013): the WhatsApp QR opens our chat with the full pre-typed message
  (plan, name, reg no, email, mobile, install_id, app version).
- AC3 (PAY-012): a valid offer code changes the Pay QR amount; an edited or
  expired code is rejected with a friendly message.
- AC4 (LIC-060, acceptance flow 10): importing via file, double-click, webcam QR
  and typed key each activates on a PC that has never been online.
- AC5 (LIC-062): a mistyped key reports the wrong group number rather than a
  generic error.
- AC6 (LIC-006, TAM-014): after activation the licensed name and registration
  number print on the Rx and receipt and are not editable; the same `.hclic`
  re-imported on another PC works (LIC-064).
- AC7 (LIC-020, SUX-008): on expiry the app enters read-only; viewing, search,
  print and export work and an open visit can be finished; a valid renewal
  restores active immediately.
- AC8 (LIC-005): setting the clock back one year still enforces expiry (clock
  guard).
- AC9 (SUX-010): a non-technical doctor completes buy and activate (pick plan,
  confirm details, scan both QRs, later import) in under the SUX-010 effort
  budget; measured in the usability test.
- AC10 (NFR-022 / SUX-003): no network call is made by the app and no verifying
  dialog appears during normal work; verified with the network disabled.

## Open questions

- OQ-S20-1 (Q14): plan prices Rs 2,299 / 6 months and Rs 3,999 / year are
  placeholders; the product owner must confirm final prices before R8
  (requirements 03 section 1, design 06 Q14).
- OQ-S20-2 (Q15): support hours Mon-Sat 10:00-19:00 IST and the 1-hour turnaround
  shown in PAY-016 are defaults; confirm the actual hours (design 06 Q15).
- OQ-S20-3 (Q11): the Licence Certificate PDF is not password protected (the
  signature protects it, LIC-045); confirm, or switch to the registered-mobile
  password alternative (design 06 Q11).
- OQ-S20-4 (Q12): identity (name + reg no) is locked per licence and a second
  doctor needs their own licence (LIC-006, LIC-007); confirm, versus allowing a
  named assistant doctor on one licence (design 06 Q12).
- OQ-S20-5 (Q13): no PC limit, unlimited reinstalls for the same doctor
  (LIC-064); confirm, versus a 2-PC cap (design 06 Q13).
- OQ-S20-6: LIC-046 and design 04 section 4 both describe the typed key but
  differ in wording (175 characters vs 35 groups of 5); the 35-groups-of-5 form
  is used here. Confirm the exact grouping and check-character scheme.
- OQ-S20-7: no requirement defines webcam-permission handling if the OS denies
  camera access during a certificate-QR scan. Proposed: fall back to file import
  or typed key with a plain message. Confirm.
