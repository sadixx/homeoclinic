# R0-baseline fixture (HC-MVP1-226 upgrade-path harness)

This directory documents the **R0-equivalent data-dir state** the upgrade-path
harness (`tests/e2e/specs/release/upgrade-path.e2e.ts`, NFR-011 / NFR-042 /
R-DEL-004) installs the R1 build *over*.

## What R0 actually leaves on disk

R0 (milestone M0, `HC-MVP1-214`, see `docs/milestones/R0-brief.md`) shipped
**only** the Tauri shell, an empty Today screen and a lock **stub**. Storage —
the SQLCipher pool, the PIN-derived key hierarchy, and the forward-only
migrations — is **M1**. R0 made **zero encrypted-DB writes**.

So the real on-disk end state of an R0 install is an **empty / baseline data
directory**:

- no `clinic.db` (and no `-wal` / `-shm` sidecars),
- no `licence/`, no `files/`, no `backups/`,
- no key hierarchy initialised (so `setup_get_state.completed == false`),
- effective schema `user_version` **0** — there is no DB file to hold a version.

## How the fixture is "seeded"

The faithful R0-equivalent fixture is therefore a **fresh, empty
`XDG_DATA_HOME`**: the executor hands the harness a brand-new temp dir (e.g.
`/tmp/hc-upgrade-r0.XXXX`) with nothing under
`<XDG_DATA_HOME>/dev.homeoclinic.desktop/`. Running an actual R0 binary against
a fresh user profile would leave exactly this — it never opens a DB — so the
empty dir is a true R0 end-state, not a contrivance. No binary fixture file is
checked in; the "seed" is the *absence* of any provisioned state, which the
harness asserts up front (`setup_get_state.completed == false`, no `clinic.db`).

## What the R1 "upgrade install over R0" then proves

Launching the **R1** build with `XDG_DATA_HOME` pointed at that empty dir is the
upgrade install. The R1 boot-gate finds no completed setup and self-routes to
`#/setup`; completing the first-run wizard runs `setup_set_pin`, which opens the
encrypted DB over the R0 data dir and applies the forward-only migrations
`0001_init` then `0002_setup`, advancing `PRAGMA user_version` **0 → 2**
(`migrate::latest_version()`). The harness then proves the R1 app **opens** over
the R0 dir, the migrated schema **serves** (`get_backup_status`), the migrated
`clinic.db` now **exists** in the R0 dir, and an **R1-made backup opens**
(`verify_backup` + `restore_preview` header stamped with the running R1
version).

## Honesty caveat

No typed command exposes `PRAGMA user_version` to the webview in M1, so the
exact `0 → 2` advance is asserted at the Rust layer
(`crates/hc-storage/tests/migrate_test.rs::nfr011_migrate_from_empty_creates_schema_at_latest`,
which asserts `user_version == latest`). The E2E harness asserts the equivalent
webview-observable end state (app opens, migrated schema serves, R1 backups
open). This mirrors how `restore-clean-install.e2e.ts` defers exact
profile-value equality to a Rust integration test.

## Future releases (R2 onward)

From R2 the previous release *does* write real data. This same harness slot
(`tests/e2e/specs/release/upgrade-path.e2e.ts`) should then seed the actual
previous-release data dir (patients, cases, backups) and assert the new build
migrates it forward and opens it — the NFR-011 contract is unchanged; only the
seeded `user_version` and row counts grow.
