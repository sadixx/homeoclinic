# ADR 0020: Data-folder relocation (SET-006) by copy, verify and live switch

Date: 2026-11-04. Status: proposed (MS milestone design,
`.worklog/HC-MVP1-dev-r5-settings/handoffs/MS-design.md`).

Relates to: SET-006, OQ-S18-3, BAK-003 (safety-copy discipline), ADR 0014,
`docs/design/02-architecture-overview.md` section 5 (data folder layout),
`docs/CODE-LAYOUT.md` "Data on disk".

## Context

Before MS the data directory is the Tauri `app_data_dir()` and is fixed for
the life of the process: `AppState.data_dir` is a plain `PathBuf` and the
file keystore (`<data>/licence/`) is opened once at startup. The logs
(`<data>/logs/`) are initialised in the same folder. SET-006 asks for a data
folder chooser; S18 asks that the data is moved, transactionally, with a
safety copy, and that the app keeps working from the new location.

The location of the data cannot live inside the encrypted database (the DB
cannot be found before its location is known) and must not depend on the PIN.

## Decision

1. **Fixed home vs movable data.** The OS app data dir becomes the fixed
   *home*. It keeps `logs/` and one new small, non-secret pointer file
   `data-location.json` (`{"version":1,"dataDir":"<absolute path>"}`). Only
   an explicit ALLOWLIST of HomeoClinic's own entries is *data* and moves
   (`hc_storage::relocate::CLINIC_ENTRIES` + `is_clinic_entry`):
   `clinic.db` with its `-wal` / `-shm` / `-journal` sidecars, pre-migration
   copies `clinic.db.pre-migration.v<N>.bak`, `pre-restore-<stamp>/`,
   `files/` (attachments), `licence/` (keystore), `backups/` and `exports/`.
   Everything else stays where it is. On Linux the default data folder is
   also the WebKitGTK data folder (`CacheStorage/`, `WebKitCache/`,
   `storage/`, `mediakeys/`, `hsts-storage.sqlite`, ...): those files belong
   to the running webview and are neither copied nor retired. A new data
   entry (e.g. future `content/`, `user_content.db`) must be added to the
   allowlist when it is introduced. No pointer file = data lives in home (all
   existing installs, R-DEL-004: nothing to migrate).
2. **Target folder.** The doctor picks a parent folder `P`; the data goes to
   `P/HomeoClinic`, which must not exist or be empty, must not equal, contain,
   or be inside the current data folder, must be writable, and must not be a
   UNC/network path.
3. **Copy, verify, then switch (never move in place).** Holding the app-state
   lock for the whole operation (same discipline as `restore_apply_in_state`):
   close the pool (WAL checkpoint), copy every data item into
   `P/HomeoClinic.partial-<uuid>`, verify every file by SHA-256 against the
   source, open the copied `clinic.db` with the retained DEK and require
   `PRAGMA quick_check = ok` and an identical `user_version`, require the
   copied keystore record to load, then rename the partial folder to
   `P/HomeoClinic`. Any failure up to here deletes the partial copy, reopens
   the pool on the untouched old folder and returns `data_folder_move_failed`.
4. **Commit point = atomic pointer write** (`data-location.json.tmp` then
   rename) in home.
5. **Live switch, no relaunch.** `AppState` keeps the data dir and keystore
   behind a `RwLock`; after the pointer is written, the state is switched to
   the new folder and a fresh pool is opened and migrated there with the
   retained DEK. If that reopen fails the app is locked
   (`data_folder_reopen_failed`) and PIN unlock opens the new folder, exactly
   like the restore reopen failure.
6. **Safety copy.** Only after the switch, the old data items (the
   allowlisted entries only) are renamed (same
   volume, cheap) into `<old>/moved-out-<stamp>/`. They stay encrypted and are
   never auto-deleted in MS. Renaming them away (instead of leaving them in
   place) means a lost pointer can never silently boot the app on stale data.
7. **Missing folder at boot.** If the pointer names a folder that is not
   present (e.g. an unplugged drive), the shell never creates directories
   there; it starts on home with `dataFolderMissing` set, and the UI shows a
   blocking "data folder not available" screen with *Try again* (re-check and
   switch) and *Use the default folder* (clear the pointer; the data on the
   drive is not touched).

## Consequences

- No relaunch is needed, so E2E keeps one webdriver session.
- 12 `state.data_dir` / `state.keystore` call sites in `hc-app` change to
  accessor calls (`state.data_dir()`, `state.keystore()`); lock order is
  `AppState.lock` then `AppState.location`.
- The data folder layout in `design/02` section 5 and `CODE-LAYOUT.md` "Data
  on disk" must note that `logs/` and `data-location.json` stay in the OS app
  data dir while the rest may live elsewhere (doc edit flagged to the
  orchestrator).
- A move needs free space for one full copy; there is no pre-check, the copy
  failure path rolls back. Large attachment folders make the move take
  seconds to minutes; the UI shows a blocking busy state.
- No network, no new capability (the folder picker reuses `dialog:allow-open`).
- R-ARCH-009 exception (recorded here): the small pointer helpers
  (`data-location.json` read, atomic write with fsync + rename, remove) and
  the removal of a just-created target copy after a failed commit live in
  `hc-app::data_folder`, next to the state switch they commit, per design
  §3.4. They touch only the fixed home's pointer file and the target folder
  the move itself created; all data-folder file IO (copy, verify, retire)
  stays in `hc-storage::relocate`.
