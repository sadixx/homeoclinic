# S21 Help
Screen id: help   Route: /help   Module: apps/desktop/src/help
Requirements: ADM-003, ADM-004, ADM-005, SUX-012   Milestone: M10  Release: R9

## Purpose

In-app help the doctor can use with no internet: illustrated how-to pages
bundled in the app (ADM-004), a keyboard-shortcuts reference (ADM-003), and an
About page with the app version and build. Optional short how-to videos are
linked out to the browser when online (ADM-004). A hidden Health check for
support opens with F12 (SUX-012), and the diagnostic report (ADM-005) is
reachable from here.

## Entry points

- `[?]` in the top bar and F1 anywhere (00-conventions section 2 and 3).
- "Learn more" / help links from empty states on other screens.
- F12 from Help opens the support Health check (SUX-012).

## Layout (wireframe)

```
+----------------------------------------------------------------------------------------------+
| Help                                        [ Search help...                               ]  |
+------------------------+---------------------------------------------------------------------+
| Topics                 | {selected topic}                                                    |
|  Getting started       |  Register a patient                                                 |
|  Register a patient    |  --------------------------------------------------------------      |
|  Take a case           |  1. Press F4 or click New patient.                                  |
|  Repertorise           |  2. Type the name; add mobile and age.                              |
|  Prescribe and print   |  {illustration}                                                     |
|  Billing               |  3. Save is automatic.                                              |
|  Backup and restore    |  [ Watch 60-sec video (opens browser, needs internet) ]             |
|  Keyboard shortcuts    |                                                                     |
|  About HomeoClinic     |                                                                     |
+------------------------+---------------------------------------------------------------------+
| For support: [ Create diagnostic report ]    Health check: press F12                          |
+----------------------------------------------------------------------------------------------+
```

### Keyboard shortcuts topic (ADM-003)

```
+----------------------------------------------------------------------------------------------+
| Keyboard shortcuts                                                                            |
|  F1  Help                 F2 / Ctrl+K  Search patients      F3  Today                         |
|  F4  New patient          F5  New visit (open patient)      F6  Repertory                     |
|  F7  Prescribe            F8  Bill                          Ctrl+P  Print preview             |
|  Ctrl+S  Save now         Ctrl+L  Lock                      Ctrl+B  Collapse nav              |
|  Esc  Close dialog        Alt+Left  Back                                                      |
+----------------------------------------------------------------------------------------------+
```

### About topic

```
+----------------------------------------------------------------------------------------------+
| About HomeoClinic                                                                             |
|  Version 1.0.3 (build 2026-10-16, release)          Platform: Windows 10 x64                  |
|  Licensed to: Dr Asha Kulkarni (12345, MCH)         Licence: Active till 31-03-2027           |
|  This app works fully offline.                                                                |
|  [ Open-source licences ]   [ Create diagnostic report ]   [ Health check (F12) ]            |
+----------------------------------------------------------------------------------------------+
```

## Fields and controls (element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Help search | text | filters bundled topics by title and body; offline (ADM-004) | help-search |
| Topic list | list | bundled offline help topics (ADM-004) | help-topic-list |
| Topic item | list row | opens the topic content (ADM-004) | help-topic-item |
| Topic content | panel | illustrated how-to page, rendered from bundled content (ADM-004) | help-topic-content |
| Watch video link | button | opens the how-to video in the OS browser; shown only when a video exists; labelled as needing internet (ADM-004) | help-video-link |
| Shortcuts table | table | all global shortcuts from 00-conventions section 3 (ADM-003) | help-shortcuts |
| About panel | panel | version, build, platform, licence holder and state (ADM-004 about/version) | help-about |
| Open-source licences | button | shows bundled third-party licence notices (offline) | help-oss-licences |
| Create diagnostic report | button | writes a logs-only zip for support (ADM-005) | help-diag-report |
| Health check (F12) | button / F12 | opens the hidden support Health check (SUX-012) | help-health-check |

## Behaviour

- Help topics and their illustrations are bundled in the app and open with the
  network disabled (ADM-004); help search filters the bundled topics by title and
  body text with no internet.
- A topic may carry an optional link to a short how-to video; the link opens the
  video in the OS browser and is clearly marked as needing internet, so the
  offline pages are always sufficient on their own (ADM-004).
- The keyboard-shortcuts topic lists every global shortcut defined in
  00-conventions section 3 (ADM-003); it is reference only and fires nothing.
- About shows the app version and build, the platform, and the licensed holder
  and licence state read from S20's status (ADM-004 about/version); it also links
  to the bundled open-source licence notices.
- Create diagnostic report writes the same logs-only zip as the Settings
  Maintenance tab (ADM-005); no patient data is included.
- F12 (or the Health check button) opens the hidden support screen showing
  licence state, integrity status, last backup and repair actions, so support can
  solve a problem in one call (SUX-012).

## Release slices

- R9 (M10, this release): the full Help screen, bundled offline how-to pages and
  help search (ADM-004), the shortcuts reference (ADM-003), About with version
  and build, the diagnostic report link (ADM-005) and the F12 Health check
  (SUX-012). The release plan places Help at R9 with the hardened build.
- Earlier releases: `[?]` and F1 are present in the shell from R0 as the help
  entry point, but they open a minimal placeholder until the bundled content and
  the screen ship at R9 (00-conventions section 2). The diagnostic report itself
  is usable earlier from Settings Maintenance (S18, R1) even though this screen's
  copy of the button arrives at R9.
- Nothing here is MVP2: online how-to videos are optional links only, and the
  Health check is local (SUX-012). No part is removed in a later release.

## States (empty, loading, error, read-only, trial)

- Empty: a help search with no match shows "No help page matches. Try a shorter
  word" with the full topic list still visible (00-conventions empty-state rule).
- Loading: topics render instantly from bundled content; the diagnostic report
  shows per-step progress while zipping.
- Error: a video link with no internet simply reports that the video needs
  internet and points to the offline page; a diagnostic-report failure shows a
  plain message with a Details expander for a support code (NFR-033).
- Read-only mode (LIC-020): Help, shortcuts, About, the diagnostic report and the
  Health check all stay fully enabled; none are clinical create/edit actions.
- Trial: unchanged; About shows the trial state and days left from S20.

## Keyboard

- F1 opens Help from anywhere; Esc closes it (00-conventions section 3).
- Up/Down move the topic list; Enter opens a topic; the in-topic video link is
  reachable by Tab.
- F12 opens the Health check from the Help screen (SUX-012).
- Ctrl+P is not used here.

## Commands used (proposed Tauri command names)

- `list_help_topics` req `{}` resp `{ topics: [{ id, title, category, has_video }] }` (ADM-004)
- `get_help_topic` req `{ id }` resp `{ title, html_body, images: [path], video_url? }` (ADM-004; html_body is bundled, no remote fetch)
- `search_help` req `{ query }` resp `{ topics: [{ id, title, snippet }] }` (ADM-004)
- `get_shortcuts` req `{}` resp `{ groups: [{ section, items: [{ key, action }] }] }` (ADM-003)
- `get_about_info` req `{}` resp `{ app_version, build_id, build_kind: "release"|"dev", platform, licence_holder?, licence_state, offline: true, third_party_licences_path }` (ADM-004)
- `open_help_video` req `{ id }` resp `{ ok, opened_url }` (ADM-004; hands the URL to the OS browser)
- `create_diagnostic_report` req `{ out_dir }` resp `{ file_path }` (ADM-005; shared with S18)
- `open_health_check` req `{}` resp `{ licence_state, integrity_ok, last_backup_at, repair_actions: [string] }` (SUX-012)

## Acceptance checks

- AC1 (ADM-004): help topics and illustrations open with the network disabled;
  help search filters topics offline.
- AC2 (ADM-004): a topic's "Watch video" link opens the video in the OS browser
  and is marked as needing internet; the offline page is complete without it.
- AC3 (ADM-003): the shortcuts topic lists every global shortcut in
  00-conventions section 3 and matches the actual bindings.
- AC4 (ADM-004): About shows the app version and build and the current licence
  holder and state.
- AC5 (ADM-005): Create diagnostic report produces a zip of logs only, with no
  patient data (checked by scanning the archive); it is the same report as S18.
- AC6 (SUX-012): F12 opens the Health check showing licence state, integrity
  status, last backup and repair actions.
- AC7 (NFR-022 / SUX-004): opening Help, shortcuts, About and the Health check
  makes no network call; verified with the network disabled.

## Open questions

- OQ-S21-1: ADM-004 pairs "short how-to videos linked (online)" with "bundled
  illustrated help pages (offline)" but does not say whether videos must also be
  bundled for a fully offline clinic. Proposed default: videos are online-only
  optional links and every task has a complete offline page. Confirm.
- OQ-S21-2: No requirement lists which help topics must ship or who authors the
  content. Proposed starter set: the core-flow tasks (register, case,
  repertorise, prescribe and print, bill, backup). Confirm the topic list.
- OQ-S21-3: SUX-012 names a Health check opened by F12 "from Help" but does not
  define whether it is a separate screen or an overlay; this spec treats it as an
  overlay launched from Help and About. Confirm, and confirm whether it needs its
  own screen spec.
- OQ-S21-4: ADM-003 is P1; confirm the shortcuts reference ships at R9 rather
  than slipping to MVP2, given the shortcuts themselves are active from R0.
