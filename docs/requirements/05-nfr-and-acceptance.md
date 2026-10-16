# Non-Functional Requirements and MVP1 Acceptance

## 1. Performance (measured on reference low-end PC: Intel i3 7th gen / 4 GB RAM / HDD, Windows 10)

| ID | Requirement |
|---|---|
| NFR-001 | Cold start to usable home screen < 4 s; warm < 1.5 s. |
| NFR-002 | Patient data at design baseline (50k patients, 500k visits; must also pass at 100k / 1M): global search results < 100 ms per keystroke (p95); open patient dashboard with full visit timeline < 300 ms; advanced filter query < 500 ms; full-text case-note search < 1 s; Today's follow-up list < 200 ms. Measured with the synthetic data generator (NFR-007). |
| NFR-007 | Synthetic data generator (`tools/seed`) creates realistic Indian patient data (names across regions, mobiles, visits, prescriptions, bills) at 50k and 100k scale. Performance tests run in CI against both and fail the build if NFR-002 budgets are missed. Database size at 50k baseline (excluding attachments) target < 1 GB. |
| NFR-003 | Rubric search < 100 ms per keystroke on 200,000 rubrics across all packs. |
| NFR-004 | Repertorisation recompute < 300 ms (30 rubrics). |
| NFR-005 | Rx print preview < 1 s. |
| NFR-006 | RAM < 300 MB typical use. Installer < 60 MB excluding content packs; full install with free packs < 400 MB. |

## 2. Reliability and data safety

| ID | Requirement |
|---|---|
| NFR-010 | SQLite WAL mode, `synchronous=NORMAL` minimum, foreign keys on. Power cut during write must never corrupt DB (test by killing process in loops). |
| NFR-011 | Schema migrations versioned, forward-only, auto-backup before migration, tested from every released version. |
| NFR-012 | Zero data loss on crash: auto-save (CASE-005) plus write-ahead. |
| NFR-013 | Crash reporting local log; optional anonymous crash upload with consent, no patient data. |

## 3. Security and privacy

| ID | Requirement |
|---|---|
| NFR-020 | DB encrypted (SQLCipher, AES-256). DB key derived from app PIN + per-install random secret stored in OS secure store (Windows DPAPI / Linux Secret Service, fallback to encrypted file). |
| NFR-021 | Attachments encrypted at rest with the same key hierarchy. |
| NFR-022 | MVP1 makes no network calls of its own (no servers exist). It only hands links to the OS when the doctor clicks: WhatsApp click-to-chat, mailto and the Rx share link. Optional update check reads a signed static manifest (e.g. on the download website) and can be disabled in settings. MVP2 adds licence activation/refresh. Document every outbound endpoint. |
| NFR-023 | No listening network ports in MVP1. (LAN server only in MVP2, see USR-002.) |
| NFR-024 | Dependency pinning (Cargo.lock, package-lock.json), `cargo audit` and `npm audit` in CI. |
| NFR-025 | Code-sign Windows binaries (EV or OV certificate) to avoid SmartScreen warnings; sign Linux packages and update manifests. |

## 3b. Tamper and crack protection (TAM)

Goal: every released build ships as a hardened native binary that is hard to reverse-engineer, patch or crack, and stops being useful to pirates even if the binary is cracked. Honest limit: no client software is uncrackable (heavily protected games are also cracked eventually). The design therefore stacks (a) a hardened binary, (b) runtime integrity checks, and (c) server-held value (paid content keys, updates, cloud), so cracking costs more effort than the licence price.

| ID | Pri | Requirement |
|---|---|---|
| TAM-001 | P0 | Single native binary: all UI assets (HTML/JS/CSS, templates, fonts) are compiled into the Rust executable (Tauri embedded assets), compressed and AES-encrypted at build time, decrypted only in memory. No loose `.js`, `.jar`, `.dll` of our own code on disk (unlike the legacy jar, which can be decompiled). |
| TAM-002 | P0 | Release build hardening: `opt-level=3`, fat LTO, `codegen-units=1`, `panic=abort`, symbols stripped, no debug info, release-only feature flags remove dev tools (webview devtools, debug commands, verbose logs). Frontend minified and mangled. |
| TAM-003 | P0 | String and constant protection: licence-related strings, public keys, endpoint URLs and error messages are encrypted at compile time (e.g. `obfstr`/`litcrypt`-style macros) so they cannot be found with `strings` or a hex editor. |
| TAM-004 | P0 | Licence checks are not a single `if`: verification logic is inlined in several independent places (startup, before new visit/Rx/bill creation, background timer; MVP2 adds before paid pack open), each computing results in a different way, so patching one jump does not unlock the app. |
| TAM-005 | P0 | Self-integrity check: at build time, a signed hash manifest of the binary's code sections is embedded; at runtime the app re-hashes itself (randomised timing) and verifies the signature. On mismatch: switch to Read-only mode (LIC-020 rules: patient data stays viewable and exportable, never deleted), show "This copy has been modified, please reinstall", and (MVP2) report once to the server when online. |
| TAM-006 | P0 | Code signing: Windows Authenticode (EV certificate) on the exe and installer, Linux AppImage/deb signed with GPG; app verifies its own Authenticode signature on Windows at start. Update packages signed with Ed25519 and verified before install (already NFR-025). |
| TAM-007 | P1 | Anti-debug and anti-hook: detect attached debuggers (IsDebuggerPresent / NtQueryInformationProcess on Windows, `TracerPid` in `/proc/self/status` on Linux), common hooking/injection tools and memory patching of the licence state; on detection, refuse paid-feature paths silently rather than crash. Must not trigger antivirus false positives (tested with Windows Defender and top 5 Indian AV products on every release). |
| TAM-008 | P1 | Control-flow and symbol obfuscation of the licence, entitlement and pack-decryption modules (e.g. LLVM-based obfuscation passes or a commercial Rust-compatible obfuscator), applied only to these modules to keep performance and AV safety. |
| TAM-009 | MVP2 | Server-held value (the strongest protection once paid content and servers exist): paid repertory/MM packs are encrypted per pack; the pack key is delivered only inside a signed licence bound to the device fingerprint (LIC-031). A cracked binary without a genuine licence cannot open paid content. Updates, cloud backup (MVP2), sync (MVP3) and SMS credits require a valid licence checked server-side. |
| TAM-014 | P0 | MVP1 anti-sharing without servers: identity binding (LIC-006) prints the licensed doctor's name and registration number on every document; licence edits are impossible without our signing key (LIC-001). |
| TAM-010 | P0 | Per-customer watermark: each issued licence embeds a unique id, and paid packs are lightly watermarked per licence (invisible ordering/marker variations), so leaked licences or packs can be traced and revoked. |
| TAM-011 | MVP2 | Server-side abuse detection: same licence on many fingerprints, impossible activation patterns, known leaked keys; automatic revocation on next refresh and block of updates. |
| TAM-012 | P0 | Release pipeline enforces all of the above: CI job fails if symbols, debug info, devtools, plain-text secrets or unsigned artifacts are found in the release binary (automated scan with `strings`, `objdump`/`dumpbin`, signature verification). Signing keys live in an HSM/KMS, never on developer PCs. |
| TAM-013 | P0 | Never punish genuine doctors: tamper responses only restrict new paid actions; they never delete, encrypt or hide patient data, never brick the PC, and false positives can be cleared by reinstalling, re-importing the licence, or (MVP2) an online re-check. |

Explicitly not done: kernel-level drivers or "rootkit" style DRM (antivirus conflicts, legal and trust risk), and runtime packers like UPX/VMProtect on the whole binary (frequent antivirus false positives on Indian clinic PCs).

## 3c. Security must never hurt the user experience (SUX)

Rule: every security, licence and anti-tamper feature (NFR-020..025, LIC, TAM, BAK encryption) must be invisible to a genuine doctor in daily use. If a protection makes the app slower, adds clicks, needs internet, or risks locking out a genuine user, the protection is changed, not the user experience. These are P0 release gates.

| ID | Pri | Requirement |
|---|---|---|
| SUX-001 | P0 | All performance budgets in section 1 (NFR-001..006) are measured on the fully protected release build (encrypted assets, obfuscation, integrity checks on), not on a dev build. Total protection overhead: <= 300 ms on cold start, <= 5% on any other budget. |
| SUX-002 | P0 | Integrity checks (TAM-005) and periodic licence checks (TAM-004) run in a low-priority background thread during idle time, in small chunks (< 5 ms each); never on the UI thread, never during typing, search, repertorisation or printing. |
| SUX-003 | P0 | Zero extra clicks: no licence, security or "verifying" dialogs during normal work. The only routine security interaction is the PIN unlock (SET-004), which must take one entry; Windows Hello / fingerprint unlock offered as P1 where the PC supports it. |
| SUX-004 | P0 | Never needs internet for daily use. From MVP2, licence refresh, abuse checks and integrity reports happen silently only when online; being offline for any length of time never blocks a genuine valid licence. |
| SUX-005 | P0 | No false lockouts: a single failed check never restricts the app. Restriction (TAM-005, TAM-007) needs confirmation by a second independent check; hardware changes never matter in MVP1 because licences are not bound to a PC (LIC-006, LIC-064); antivirus quarantining a file or a disk error triggers "Repair" (re-verify and restore files from the installer or a signed update), not Read-only mode. |
| SUX-006 | P0 | Self-heal first: on any licence or integrity problem the app first tries automatic recovery (reload licence from secure store, re-verify, repair install, online re-check from MVP2) before showing anything to the doctor. |
| SUX-007 | P0 | When a message is unavoidable it is in plain language, says what still works ("Your patient records are safe and you can view and print them"), offers one clear action button (Repair / Renew / Call support with phone number and WhatsApp), and never uses words like "piracy", "cracked" or "violation" toward the doctor. |
| SUX-008 | P0 | Emergency override: a doctor in the middle of consultation is never stopped. If restriction would start, the current visit, prescription and bill can always be completed and printed; restriction applies only to starting the next new visit, with a 7-day grace for integrity issues and the licence grace from LIC-020. |
| SUX-009 | P0 | Antivirus and OS friendliness: no SmartScreen "unknown publisher" warning (EV signing, TAM-006), no admin rights needed to install or run, no firewall prompt (no listening ports in MVP1), zero antivirus detections on Windows Defender and the top 5 AV products used in India on every release. |
| SUX-010 | P0 | The doctor's own effort to buy and activate is at most 3 minutes for a non-technical doctor: pick plan, confirm details, scan Pay QR, scan WhatsApp QR and attach screenshot, later import the emailed licence (PAY-010..016, LIC-060). Our turnaround (LIC-049) is separate. Measured in the usability test (NFR-031). |
| SUX-011 | P0 | Backup password and recovery key flows (BAK-002, NFR-020) default to remembered credentials on the same PC so scheduled backups never ask for a password; a password is asked only when restoring to a new PC. |
| SUX-012 | P1 | A hidden "Health check" screen for support (F12 from Help) shows licence state, integrity status, last backup and repair actions, so support can solve problems in one phone call. |

## 4. Usability (doctors are not technical)

| ID | Requirement |
|---|---|
| NFR-030 | Any core task (register patient, new visit, repertorise, print Rx, take fee) reachable in <= 3 clicks from home screen. |
| NFR-031 | Usability test: 5 doctors unfamiliar with the app complete "register patient, record acute case, repertorise 5 rubrics, print Rx, bill" in < 10 minutes without help after a 5-min intro video. |
| NFR-032 | Minimum font 14 px, high-contrast theme, WCAG 2.1 AA contrast, full keyboard operation, screen-reader labels. |
| NFR-033 | Plain-language error messages with a suggested action; never show stack traces. |
| NFR-034 | Works at 1366x768 resolution (common in Indian clinics) without horizontal scrolling. |
| NFR-035 | Undo for destructive actions (delete rubric from clipboard, delete Rx line). |

## 5. Platform and packaging

| ID | Requirement |
|---|---|
| NFR-040 | Windows 10 (21H2+) and 11, x64. Installer per-user (no admin needed) and per-machine options. Bundle WebView2 bootstrapper offline installer for PCs without internet. |
| NFR-041 | Linux x64: AppImage (any distro) and .deb (Ubuntu 20.04+/Debian 11+). WebKitGTK 4.1 dependency declared. |
| NFR-042 | Offline update: signed update file installable from USB via "Install update from file". |
| NFR-043 | Uninstall keeps patient data folder unless doctor explicitly ticks "delete data" (with PIN). |

## 6. Quality gates (CI must enforce)

- Unit tests: repertorisation algorithms with hand-computed fixtures, licence verify/identity lock/clock rollback, offline UPI and WhatsApp QR strings, offer-code verify, typed-key group check, backup encrypt/decrypt round trip, search ranking golden tests. Coverage >= 80% for `core` crate.
- Integration tests: DB migrations from every prior schema; end-to-end UI tests (Playwright via tauri-driver) for the 13 core flows below.
- Lint: clippy -D warnings, eslint, prettier, TypeScript strict.
- Build artifacts for Windows and Linux on every main-branch commit (GitHub Actions or equivalent).

## 7. MVP1 acceptance: 13 core flows (all must pass on Windows and Linux, network disabled)

1. First run wizard to home screen in < 3 minutes.
2. Register patient with photo; find via partial name, mobile, phonetic spelling. With 50k seeded patients: find by last 4 mobile digits, ID digits, and a misspelt name each within budget; filter "overdue follow-ups, given Sulphur" returns correct rows.
3. Record detailed chronic case using default template; close app mid-typing; reopen; nothing lost.
4. From case text, send 8 symptoms to repertory, pick rubrics, run each analysis method, results match fixture.
5. Open top remedy in Materia Medica, compare across 2 books.
6. Prescribe from analysis, add placebo, print on A5, save PDF, open WhatsApp share link.
7. Follow-up visit with complaint statuses and improvement %; progress chart shows it.
8. Bill with partial payment; dues show on dashboard; daily collection report correct.
9. Backup to USB with password; restore on a second clean machine; all data and attachments present.
10. Buy with the offline Pay QR and WhatsApp QR, then import the emailed `.hclic` on a never-online PC (03 section 8); expire it (test clock); read-only mode works; export patient PDF works.
11. (Internal build) publicum, kent-de and Boericke eval packs load, search and repertorise within budgets; the public build refuses the same pack files and its installer contains none of them (CONT-003, CONT-005). Install a new repertory pack from USB (different grade scale), search it, use it in an analysis together with Kent. Add a remedy to a Kent rubric with a book citation (title + page) and a clinical-experience citation linked to a patient; the marker shows on hover; analysis result changes only when "include my additions" is on; backup and restore keeps the citations.
12. Tamper tests on the release build: `strings` finds no licence strings or keys; patching one byte in the exe triggers TAM-005 read-only mode with data intact; editing the licensed name in the database or licence file is rejected; attaching a debugger disables paid paths without crash; Windows Defender scan clean.
13. Security UX on the release build (SUX): all 12 flows above run on the fully protected build within the NFR budgets (SUX-001); no security dialog appears during flows 1-9 (SUX-003); PC offline for 60 days with a valid licence works normally (SUX-004); simulated antivirus quarantine of one file leads to automatic Repair, not Read-only (SUX-005/006); triggering restriction mid-visit still lets the doctor finish and print that visit (SUX-008); 5 test doctors activate offline in under 2 minutes each (SUX-010).
