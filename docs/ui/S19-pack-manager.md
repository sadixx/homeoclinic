# S19 Repertory pack manager
Screen id: pack-manager   Route: /packs   Module: apps/desktop/src/packs
Requirements: PACK-009, PACK-001, PACK-002, PACK-006, PACK-007, PACK-008, PACK-013, CONT-001, CONT-003, CONT-004, CONT-007, REP-038   Milestone: M5  Release: R6

## Purpose

Manage installed repertory and Materia Medica content packs: list what is
installed with title, edition, version, size, type, source and channel; install
a new pack from a file; enable or disable a pack; set the default repertory; and
uninstall a pack (PACK-009). Installing is signature-and-checksum verified
against this build profile's content keys, so a public build refuses an
internal-eval pack (CONT-003). Adding or removing a repertory needs only a pack
file, never an app code change (PACK-006, CONT-007).

## Entry points

- Left nav Settings, then "Repertory packs", or the "Install a repertory" empty
  state links from S10 and S12.
- First use of the repertory before any non-bundled pack is installed.

## Layout (wireframe)

```
+----------------------------------------------------------------------------------------------+
| Repertory packs                                            [Install from file...]            |
+----------------------------------------------------------------------------------------------+
| Internal evaluation build: contains content not licensed for distribution   (internal only)  |
+----------------------------------------------------------------------------------------------+
| Default repertory: [Repertorium Publicum v]                                                  |
|----------------------------------------------------------------------------------------------|
| On | Pack                         | Type        | Edition/Ver  | Channel        | Size  | ... |
|----|------------------------------|-------------|--------------|----------------|-------|-----|
|[x] | Repertorium Publicum         | repertory   | 2008 / 1.0   | [internal_eval]| 41 MB |[...]|
|[x] | Kent Repertory (German)      | repertory   | 2012 / 1.0   | [internal_eval]| 38 MB |[...]|
|[x] | Boericke Pocket Manual       | materia med | 1906 / 1.0   | [internal_eval]| 6 MB  |[...]|
|[x] | Remedy master (OOREP)        | remedy_list | - / 1.0      | [internal_eval]| 1 MB  |[...]|
|[x] | Starter sample (default rep) | repertory   | - / 1.0      | [public]       | <1 MB |[...]|
|----------------------------------------------------------------------------------------------|
| Row menu [...]: Set default | Disable | Uninstall | Import report                             |
+----------------------------------------------------------------------------------------------+
```

### Install result dialog

```
+--------------------------------------------------+
| Install repertory                                |
|  File: eval-kent-de-1.0.hcpack                   |
|  Verifying signature... OK                        |
|  Checksum... OK                                   |
|  Format version 1 supported... OK                 |
|  Title: Kent Repertory (German) 2012             |
|  Channel: internal_eval   Licence: GPL-3.0-only  |
|  68,741 rubrics, 624,010 remedy entries          |
|  [Install]  [Cancel]                             |
+--------------------------------------------------+
```

## Fields and controls (table: element | type | rules | testid)

| Element | Type | Rules | testid |
|---|---|---|---|
| Install from file | button | File picker for `.hcpack`; starts verify-then-install flow (PACK-001, PACK-009) | packs-install |
| Internal banner | banner | Shown only on internal build (CONT-004); absent on public build | packs-eval-banner |
| Default repertory | dropdown | One of the enabled repertory packs; sets the search default (PACK-009) | packs-default-select |
| Pack row | table row | Title, type, edition/version, channel, size, source (PACK-002, PACK-009) | packs-row |
| Enable toggle | checkbox | Enable/disable per pack (PACK-009); disabled packs are excluded from search and analysis | packs-enable |
| Channel badge | chip | `public` or `internal_eval` with text, not colour alone (CONT-001, conventions 5) | packs-channel-badge |
| Row menu | menu | Set default, Disable, Uninstall, Import report | packs-row-menu |
| Set default | menu item | Sets this repertory as default (PACK-009) | packs-set-default |
| Uninstall | menu item | Removes pack; blocked if saved analyses use it unless confirmed (PACK-009) | packs-uninstall |
| Import report | menu item | Opens the per-pack import report if present (CONT-010, P1) | packs-import-report |
| Install dialog | dialog | Shows each verify step and manifest summary before the final Install (PACK-001, PACK-002) | packs-install-dialog |
| Install confirm | button | Commits the install after verification passes | packs-install-confirm |
| Uninstall confirm | dialog | Names the pack and states the saved-analysis impact (conventions 4, PACK-009) | packs-uninstall-dialog |

## Behaviour

- The list shows every installed pack from the `content/` folder with title,
  type, edition, version, channel, size and source (PACK-009, PACK-002).
- Install from file copies the pack to a temp location, verifies the Ed25519
  signature with the content keys embedded in this build profile, verifies the
  sha256 checksum, checks `format_version` and entitlement, then moves it into
  `content/` and builds the remedy mapping to the shared master (design 03
  section 4, PACK-001, PACK-008). Any failure leaves existing packs untouched.
- On a public build an internal_eval pack fails at the signature step because the
  eval content key is not embedded; the dialog says the pack is not accepted by
  this build (CONT-003). The reason is shown in plain language without jargon.
- A pack with a newer major `format_version` is refused with "update the app",
  and the other packs keep working (PACK-013).
- Enable/disable toggles whether a pack is used by search, browser and analysis
  (PACK-009). Set default marks the repertory used first in S10 search.
- Uninstall is blocked if saved analyses reference the pack, unless the doctor
  confirms; saved analyses keep their snapshot and show "repertory not installed"
  for a live re-run (PACK-009, CONT-007, REP-038).
- Adding or removing a pack needs no app code change (PACK-006).

## Release slices

- R6 (this release, M5): list, install-from-file with full verification, channel
  badge, enable/disable, set default, and uninstall with the saved-analysis rule.
  The internal build bundles all four eval packs plus the starter sample; the
  public build bundles only public packs and refuses eval packs copied in by hand
  (CONT-003, demo R6).
- Deferred past this release (not built in R6): the import report detail view is
  driven by CONT-010 (P1) and shown only if the pack carries a report; the online
  catalogue install path (PACK-010, MVP2) and paid-pack entitlement (PACK-004,
  MVP2) are not in MVP1; doctor-built and CSV-imported packs (PACK-011, P1) are
  not created from this screen in R6.

## States (empty, loading, error, read-only, trial)

- Empty (only bundled packs): the bundled packs still list; there is no "no
  packs" state because a build always bundles its profile's packs (PACK-003).
- Loading: install dialog shows each verify step as it completes; large packs
  show progress while the remedy mapping builds.
- Error (signature fail): "This file was not accepted by this build" with a
  Details expander for the support code; no pack is changed (design 03 section 4).
- Error (checksum/format): plain message naming the cause (corrupt file, or app
  update needed for a newer format, PACK-013).
- Read-only mode (LIC-020): install, enable/disable, set default and uninstall
  are administrative and remain usable; they are not clinical create/edit actions
  blocked by expiry.
- Trial / internal build: internal build shows the permanent evaluation banner
  (CONT-004) above the list.

## Keyboard

- Up/Down move pack rows; Enter opens the row menu; the row menu is keyboard
  navigable. Esc cancels the install or uninstall dialog without changing
  anything (conventions 3). Ctrl+P is not used here.

## Commands used (Tauri commands this screen calls, proposed names)

- `list_installed_packs` -> req `{}`; res `{ build_profile: "internal"|"public", packs: [{ pack_id, title, type, edition, version, format_version, distribution, licence_spdx, size_bytes, source_title, enabled, is_default, used_by_analyses_count }] }` (PACK-009, PACK-002, CONT-001)
- `inspect_pack_file` -> req `{ file_path }`; res `{ ok, manifest?: { pack_id, title, type, edition, version, format_version, distribution, licence_spdx, counts: { chapters, rubrics, remedy_entries, remedies } }, error?: { code, message } }` (PACK-001, PACK-002; verify before commit)
- `install_pack_from_file` -> req `{ file_path }`; res `{ ok, pack_id?, error?: { code, message } }` (design 03 section 4; error codes include signature, checksum, format, entitlement)
- `set_pack_enabled` -> req `{ pack_id, enabled }`; res `{ ok }` (PACK-009)
- `set_default_repertory` -> req `{ pack_id }`; res `{ ok }` (PACK-009)
- `uninstall_pack` -> req `{ pack_id, confirm_used_by_analyses }`; res `{ ok, blocked?: true, used_by_analyses_count? }` (PACK-009, CONT-007)
- `get_pack_import_report` -> req `{ pack_id }`; res `{ report?: { chapters, rubrics, remedy_entries, remedies, unmapped_abbrevs, rubrics_without_remedies, grade_distribution } }` (CONT-010, P1)

## Acceptance checks

- AC1 (PACK-009, PACK-002): the list shows each installed pack with title, type,
  edition, version, size, channel and source.
- AC2 (PACK-001, design 03 section 4): installing a correctly signed pack
  verifies signature, checksum and format, then adds it; a tampered pack is
  rejected and no existing pack changes.
- AC3 (CONT-003, demo R6): on a public build an internal_eval pack file is
  refused at the signature check; on an internal build the same file installs.
- AC4 (PACK-013): a pack with a newer major format version is refused with an
  "update the app" message and other packs keep working.
- AC5 (PACK-009): disabling a pack removes it from search and analysis; setting a
  default changes the repertory used first in S10.
- AC6 (PACK-009, CONT-007, REP-038): uninstalling a pack used by a saved analysis
  is blocked until confirmed; after confirming, the saved analysis still opens
  from its snapshot and shows "repertory not installed" for a live re-run.
- AC7 (PACK-008): after install, pack remedies map to the shared remedy master so
  the pack can be used in analysis together with other packs.
- AC8 (CONT-004): the internal build shows the evaluation banner; the public
  build does not.

## Open questions

- OQ-S19-1: The online catalogue install path (PACK-010) is MVP2; confirm R6
  shows only "Install from file" and no catalogue tab.
- OQ-S19-2: PACK-009 lists size as a column but no requirement defines whether
  size is the `.hcpack` file size or the attached DB size; using installed DB
  size is assumed.
- OQ-S19-3: Whether a disabled pack still counts as "used by analyses" for the
  uninstall block (PACK-009) is not stated; treated as still counting.
- OQ-S19-4: The exact plain-language wording for the public-build rejection of an
  eval pack (must avoid "piracy"/"violation", SUX-007) is not drafted.
