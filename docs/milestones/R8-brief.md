# R8 Licence and purchase (milestone M9)

> Release-to-milestone grouping (per `docs/adr/0002-working-software-every-milestone.md`):
> this brief maps **R8 -> M9**. Until this release the wizard's licence step is a
> development trial; R8 replaces it with the real trial / Buy / activation flow.
> Authoritative release table and demo scripts: `docs/milestones/README.md`.

## Doctor outcome

Start on a local 30-day trial with a trial banner, open the Buy screen with an
offline UPI QR and a WhatsApp QR, and import a `.hclic` licence that locks the
doctor's identity on prints. When the licence expires the app drops to
read-only mode that still allows viewing, search, printing and export.

## Scope

R8 delivers offline licensing and purchase: the signed licence payload with
Ed25519 verification and two embedded keys, licence storage in the data folder
and OS secure store, clock-rollback guard, identity lock, the licence state
machine, the local signed-seed trial, the Buy screen with offline UPI and
WhatsApp QR codes, signed offer codes, install-id, encrypted constants, licence
import by drag-drop / picker / file association / QR scan / typed key, grace
period and read-only mode, renewal reminders, the WhatsApp message parser, the
signing register DB and outputs (`.hclic`, certificate PDF, GST invoice), and
register export/backup.

## Task ids (milestone M9)

P0 tasks:
- HC-MVP1-154 Licence payload (CBOR), Ed25519 verify with 2 embedded keys, key_id
- HC-MVP1-155 Licence storage in data folder and OS secure store
- HC-MVP1-156 Clock-rollback guard
- HC-MVP1-157 Identity lock of name and reg no; one licensed doctor per install
- HC-MVP1-158 Licence state machine (Unlicensed, Trial, Active, Grace, ReadOnly, Tampered)
- HC-MVP1-159 Local 30-day trial from signed seed
- HC-MVP1-160 Buy screen per wireframe: plan, details, consent, identity warning
- HC-MVP1-161 Offline UPI QR (upi://pay with UPI ID, payee, amount, note, tr) plus copy
- HC-MVP1-162 WhatsApp click-to-chat QR with pre-typed message plus copy fallback
- HC-MVP1-163 Signed offer codes changing QR amount
- HC-MVP1-164 install_id generation and display
- HC-MVP1-165 Encrypted constants for UPI ID, WhatsApp number, keys
- HC-MVP1-166 Import .hclic by drag-drop, file picker and double-click file association
- HC-MVP1-167 Scan certificate QR with webcam
- HC-MVP1-168 Typed licence key with per-group check and identity hash match
- HC-MVP1-169 Confirmation card and apply
- HC-MVP1-170 Grace period, read-only mode, ongoing visit can finish
- HC-MVP1-171 Reminders at 30, 15, 7, 1 days with Renew opening Buy screen
- HC-MVP1-172 WhatsApp message parser for the fixed message format
- HC-MVP1-173 Register DB (SQLCipher) with unique UTR, customers, licences, invoices
- HC-MVP1-174 Plan from amount, under and over payment handling, renewal stacking
- HC-MVP1-175 Signing on hardware key
- HC-MVP1-176 Outputs: .hclic, certificate PDF with QR and key text, GST invoice, email
- HC-MVP1-177 Register export to Excel and daily encrypted backup

P1 task (1): HC-MVP1-178 dealer tagging.
Test task: HC-MVP1-179 end-to-end purchase with clinic PC offline in under 30 minutes.
M9 has 26 tasks (24 P0 + 1 P1 + 1 test).

Release / demo task:
- HC-MVP1-222 R8 licence and purchase: trial, Buy screen, import .hclic, expiry read-only

Upgrade-path harness: HC-MVP1-226.

## Screens (docs/ui)

- S20 Licence and Buy — `docs/ui/S20-licence.md` (new)
- S01 First-run setup wizard — carried over from R1; its licence step now uses
  the real trial / activation flow instead of the development trial.
- All earlier screens — carried over

## Demo script

> Copied verbatim from `docs/milestones/README.md` (R8). E2E regression gate
> (R-DEL-005).

R8
1. Trial banner, Buy screen offline UPI QR and WhatsApp QR render.
2. Import a test `.hclic`; identity locks on prints.
3. Expire it with the test clock; read-only mode keeps viewing, search,
   print and export working.
4. Acceptance flow 10 passes.

## Requirement ids

Representative ids (fuller detail in `docs/requirements/03-licensing-upi.md`
and the acceptance flows in `docs/requirements/05-nfr-and-acceptance.md` section 7):
- LIC-001..LIC-006 signed payload, offline verify, storage, clock-rollback guard, identity lock
- LIC-020 read-only mode never locks the doctor out of their own data (view/search/print/export)
- PAY-* offline UPI QR, WhatsApp QR, signed offer codes, register and outputs
- Acceptance flow 10

## Out of scope

- No hardening, EV/GPG signing, watermark, anti-tamper or full 13-flow
  acceptance suite — R9.
- The register signing uses the hardware key on the Vendor Licence Tool;
  no online licence server (that is MVP2).
- Not-yet-built features stay behind a compile-time feature flag; no dead-end
  buttons (R-DEL-002 / R-DEL-006).

## Entry / exit (Done when)

- Entry: R7 merged and its demo green.
- Exit: the R8 demo passes as an E2E run tagged `@tier regression` on Windows
  and Linux, the R0-R7 demos still pass, and an upgrade install over R7 opens
  its data (R-DEL-004 / R-DEL-005; harness HC-MVP1-226).
