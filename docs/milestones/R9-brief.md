# R9 Release candidate (milestone M10)

> Release-to-milestone grouping (per `docs/adr/0002-working-software-every-milestone.md`):
> this brief maps **R9 -> M10**. R9 is the hardened, signed release candidate on
> which all 13 acceptance flows must pass. Authoritative release table and demo
> scripts: `docs/milestones/README.md`.

## Doctor outcome

Use everything built so far on the hardened, signed build: all 13 acceptance
flows in `requirements/05` section 7 pass on the protected Windows and Linux
installers. The build adds help, settings, accessibility, anti-tamper and
proper installers without changing the doctor-facing feature set.

## Scope

R9 hardens and finishes the product: encrypted embedded UI assets, the hardened
release profile, compile-time string encryption, multi-site licence checks, a
signed self-integrity manifest, Authenticode EV and GPG signing in CI, a
per-licence watermark, the release scan job, anti-debug/anti-hook, the two-check
rule and self-repair, friendly restriction messages, the full perf suite on the
protected build, antivirus scanning, Windows NSIS/MSI and Linux AppImage/.deb
installers, USB update install, data-preserving uninstall, the settings and
help screens, a diagnostic report, accessibility pass, undo for destructive
actions, and automation of the 13 core flows.

## Task ids (milestone M10)

P0 tasks:
- HC-MVP1-180 Encrypted embedded UI assets decrypted in memory
- HC-MVP1-181 Hardened release profile (fat LTO, strip, no devtools)
- HC-MVP1-182 Compile-time string encryption for sensitive constants
- HC-MVP1-183 Multi-site licence checks (startup, write commands, timer)
- HC-MVP1-184 Self-integrity manifest signed at build and verified in background
- HC-MVP1-185 Authenticode EV signing and GPG signing in CI
- HC-MVP1-186 Per-licence watermark
- HC-MVP1-187 Release scan job (symbols, devtools, secrets, signatures, eval content)
- HC-MVP1-190 Two-check rule and self-repair before any restriction
- HC-MVP1-191 Friendly restriction messages with one action button
- HC-MVP1-196 Windows NSIS and MSI, per-user install, offline WebView2 bootstrapper
- HC-MVP1-197 Linux AppImage and .deb
- HC-MVP1-198 Install update from USB file with signature check; optional static manifest
- HC-MVP1-199 Uninstall keeps data unless ticked with PIN
- HC-MVP1-200 Settings screens for profile, print layouts, fees, ID prefix, auto-lock
- HC-MVP1-201 Bundled offline help pages and links to videos
- HC-MVP1-202 Diagnostic report zip without patient data
- HC-MVP1-205 Undo for destructive actions

P1 tasks (4): HC-MVP1-188 anti-debug/anti-hook, HC-MVP1-189 obfuscation of
hc-licence, HC-MVP1-195 support health-check screen, HC-MVP1-203 keyboard
shortcuts screen.
Test tasks (5): HC-MVP1-192 perf budgets on protected build, HC-MVP1-193
reference-PC perf suite, HC-MVP1-194 antivirus scan, HC-MVP1-204 accessibility
pass, HC-MVP1-206 automate 13 core flows on Windows and Linux (network disabled).
M10 has 28 tasks (18 P0 + 4 P1 + 5 test + HC-MVP1-207 usability test with 5 doctors).

Release / demo task:
- HC-MVP1-223 R9 release candidate: hardened build, all 13 acceptance flows

Upgrade-path harness: HC-MVP1-226.

## Screens (docs/ui)

- S18 Settings — `docs/ui/S18-settings.md` (full settings; introduced in R1, completed here)
- S21 Help — `docs/ui/S21-help.md` (new)
- All screens (S01-S22, shell) — carried over; "all" per the release table

## Demo script

> Copied verbatim from `docs/milestones/README.md` (R9). E2E regression gate
> (R-DEL-005).

R9
1. All 13 acceptance flows in requirements/05 section 7 pass on the
   protected, signed build on Windows and Linux.

## Requirement ids

Representative ids (fuller detail in `docs/requirements/05-nfr-and-acceptance.md`
section 7, `docs/requirements/03-licensing-upi.md` and `docs/requirements/00-overview.md`):
- NFR-001..NFR-012 performance budgets verified on the protected build (cold start, Rx preview, recompute, accessibility 14 px minimum)
- SUX-001..SUX-012 security is invisible, two-check rule, friendly restriction messages
- TAM-* / anti-tamper, self-integrity, release scan, signing
- The 13 core acceptance flows in `requirements/05` section 7

## Out of scope

- No new doctor-facing feature set beyond R0-R8; R9 hardens, signs and finishes
  what already exists.
- Online licence server, cloud backup, LAN multi-user, mobile and AI features
  are MVP2+ (see `docs/requirements/04-later-mvps.md`).
- The public release build and launch (HC-MVP1-211..213 under PILOT / launch)
  follow the release candidate and are tracked separately.
- Any remaining feature flag older than two releases is removed or justified
  (R-DEL-006).

## Entry / exit (Done when)

- Entry: R8 merged and its demo green.
- Exit: all 13 acceptance flows pass as an E2E run tagged `@tier regression` on
  the protected, signed build on Windows and Linux, every earlier demo
  (R0-R8) still passes, and an upgrade install over R8 opens its data
  (R-DEL-004 / R-DEL-005; harness HC-MVP1-226).
