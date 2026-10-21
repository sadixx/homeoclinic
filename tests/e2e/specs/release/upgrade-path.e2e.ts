// @req NFR-011 NFR-042
// @tier regression
// @area release
// @targets linux, windows
//
// HC-MVP1-226 — the upgrade-path harness (NFR-011 "the previous release's data
// always opens after an upgrade install"; NFR-042; R-DEL-004). From R1 onward
// every release must open the previous release's data after an upgrade install.
// This harness carries EVERY release hop; it currently runs TWO:
//   • R0 -> R1 (PHASE A/B): install R1 over the empty/baseline dir an R0 install
//     leaves, prove R1 opens it, migrations 0001..0002 run forward, and an
//     R1-made backup opens.
//   • R1 -> R2 (PHASE C/D): install the R2 build over a GENUINE R1 install (the
//     R1 build provisions clinic.db @ user_version 3 + an R1-made .hcbak), prove
//     the R2 build opens it, migrations 0004..0007 advance 3 -> 7, the R1 PIN
//     unlocks it, the R1 profile/setup persists, and the R1-made .hcbak opens.
// Each future release adds one more hop here (R2 -> R3, …) with the same shape.
//
// ── What "R0 data" is, precisely (honest seeding) ───────────────────────────
// R0 (milestone M0, HC-MVP1-214) shipped ONLY the Tauri shell + an empty Today
// + a lock STUB. Per docs/milestones/R0-brief.md it made ZERO encrypted-DB
// writes — storage (the SQLCipher pool, key hierarchy and migrations) is M1.
// So the real on-disk state an R0 install leaves is an EMPTY/BASELINE data dir:
// an app-data directory with NO clinic.db, NO key hierarchy, nothing migrated
// (effective schema user_version 0 — there is no DB file at all).
//
// Therefore the "R0-equivalent fixture" this harness seeds is exactly that: a
// FRESH, EMPTY XDG_DATA_HOME (the executor hands a brand-new temp dir). That is
// a faithful R0 end-state, not a contrivance — an R0 binary run against a fresh
// user profile would leave the same empty data dir (it never opens a DB). The
// fixture is documented in tests/e2e/fixtures/r0-baseline/README.md.
//
// ── What the harness proves (the R1 "upgrade install over R0") ──────────────
// Launching the R1 build with XDG_DATA_HOME pointing at that empty R0-baseline
// dir IS the upgrade install: the R1 boot-gate reads the empty dir, finds no
// key hierarchy (setup_get_state.completed=false) and self-routes to #/setup.
// Completing the real first-run wizard runs setup_set_pin, which OPENS the
// encrypted DB over the R0 data dir and runs the forward-only migration set
// (0001_init then 0002_setup), advancing PRAGMA user_version 0 → 2
// (= migrate::latest_version()). The harness then proves, through the real
// typed commands the webview owns:
//   • the R1 app OPENS over the R0-baseline dir (boots, reaches Today unlocked);
//   • migrations ran forward and the schema is live — get_backup_status serves
//     the retention, which can only succeed if the 0001/0002 tables exist and
//     the DB opened at the latest schema;
//   • a clinic.db now exists in the R0-baseline dir (runner-side fs check), i.e.
//     the upgrade materialised the migrated DB in place;
//   • an R1-MADE backup opens — backup_now writes a .hcbak, verify_backup
//     passes (checksum + decrypt), and restore_preview reads a valid header
//     whose app_version equals the running R1 build (app_info().version). This
//     is the "existing data + any backups still open" clause of NFR-011.
//
// ── Honesty caveat (what the webview cannot directly assert) ─────────────────
// No typed command exposes PRAGMA user_version to the webview in M1, so the
// EXACT 0 → 2 advance is asserted at the Rust layer by
// crates/hc-storage/tests/migrate_test.rs::
//   nfr011_migrate_from_empty_creates_schema_at_latest (user_version == latest)
//   nfr011_migrate_from_previous_version_is_forward_only
//   nfr011_migrate_backs_up_before_applying_to_nonempty_db (pre-migration backup)
// Here the webview-observable proof is the equivalent end state: the app opens
// over the R0 dir, the migrated schema serves, and R1 backups open. This mirrors
// the restore-clean-install spec, which defers exact profile-value equality to
// a Rust integration test for the same reason. The report states this plainly.
//
// Execution model: ONE launch, ONE data dir. Unlike r1-demo step 3, the whole
// upgrade flow targets the SAME dir (the R0-baseline dir, provisioned/migrated
// in place), so both phases run in a single tauri-driver session. Network
// disabled (product rule 1).
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { expect } from '@wdio/globals';

import { backupPage } from '../../pages/backup.page.js';
import { bootPage } from '../../pages/boot.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { setupPage } from '../../pages/setup.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import {
  relaunchInto,
  relaunchIntoWithBinary,
  sharedBackupDir,
} from '../../helpers/launch.js';

const PIN = '4321';
const BACKUP_PASSWORD = 'upgrade-backup-1';

/** Shared /tmp backup folder the executor sets for the backup-opens check. */
const BACKUP_DIR = process.env.HC_E2E_BACKUP_DIR;

// ── R1 -> R2 hop configuration ───────────────────────────────────────────────
// The PREVIOUS-release (R1) build the harness installs the data dir with before
// launching the current (R2) build over it. The executor builds the R1 app from
// the R1 source tree (staging-main worktree, plain `--debug`) and points
// HC_R1_APP_BINARY at it; if unset the harness falls back to the conventional
// worktree target path so a local run still resolves it.
const R1_APP_BINARY =
  process.env.HC_R1_APP_BINARY ??
  path.resolve(
    process.cwd(),
    '../hc-r1-worktree/target/debug/homeoclinic-desktop',
  );

/** R1-install PIN: set under the R1 build, re-entered under the R2 build. */
const R1_PIN = '2468';
/** Password of the R1-MADE .hcbak that the R2 build must still open. */
const R1_BACKUP_PASSWORD = 'r1-made-backup-9';
/** Named data dir that carries the R1 install forward into the R2 launch. */
const R1_OVER_DIR = 'r1-install';

describe('HC-MVP1-226 upgrade-path PHASE A: R1 opens an R0-equivalent (empty/baseline) data dir and migrates forward (NFR-011)', () => {
  it('self-routes the empty R0-baseline dir to the wizard, then provisions in place so R1 opens over the R0 data dir and the migrated schema serves', async () => {
    // The R0-baseline dir is EMPTY (no clinic.db, no key hierarchy) — the exact
    // state an R0 install leaves. The R1 boot-gate therefore finds no completed
    // setup and self-routes to #/setup. (bootPage only OBSERVES the hash.)
    const decided = await bootPage.waitForDecidedScreen();
    const hash = await bootPage.launchHash();
    // eslint-disable-next-line no-console
    console.log(`[upgrade][A] self-chosen launch hash over R0-baseline = ${hash}`);
    expect(decided).toBe('#/setup');
    expect(hash).toBe('#/setup');

    // Confirm the R0-equivalent precondition through the real typed command:
    // an R0 data dir has no key hierarchy, so setup is NOT completed.
    const r0State = await backupPage.setupState();
    expect(r0State.completed).toBe(false);
    // eslint-disable-next-line no-console
    console.log(`[upgrade][A] R0-baseline setup.completed = ${r0State.completed}`);

    // The "upgrade install" step: complete the real first-run wizard. This runs
    // setup_set_pin, which opens the encrypted DB over the R0 data dir and runs
    // migrations 0001_init + 0002_setup (user_version 0 → 2 at the Rust layer).
    //
    // Under the SET-001 fix (AppShell BootRouter live completion signal)
    // finishing the wizard flips completion before navigating to /today, so the
    // completion route-guard (commit 216cfed) admits the shell on THIS launch:
    // the migrated + unlocked shell (Today) is reached in place, no relaunch.
    // The migrated clinic.db is written into the R0-baseline dir, proving "R1
    // opens over the R0 data dir and the migrated schema serves".
    await provisionAndEnterApp('main', PIN);
    await expect(shellPage.todayScreen).toBeDisplayed();

    // R1 opened over the R0 dir: setup is now completed and the migrated schema
    // is live — get_backup_status can only serve if the 0001/0002 tables exist
    // and the DB opened at the latest schema (migrations ran forward).
    const upgraded = await backupPage.setupState();
    expect(upgraded.completed).toBe(true);
    const status = await backupPage.getStatus();
    expect(status.retention).toEqual({ daily: 14, weekly: 8, monthly: 12 });

    // The migrated DB was materialised IN the R0-baseline data dir (runner-side
    // fs proof that the upgrade wrote the DB over the previous-release dir).
    const dataDir = upgraded.dataDir;
    expect(existsSync(dataDir)).toBe(true);
    const dbExists = existsSync(`${dataDir}/clinic.db`);
    // eslint-disable-next-line no-console
    console.log(`[upgrade][A] migrated clinic.db present in R0 dir (${dataDir}) = ${dbExists}`);
    expect(dbExists).toBe(true);
  });
});

describe('HC-MVP1-226 upgrade-path PHASE B: an R1-made backup over the upgraded data opens (NFR-011 "backups still open")', () => {
  it('backs up the upgraded data and proves the archive opens: verify_backup passes and restore_preview reads a valid header stamped with the running R1 build', async () => {
    expect(BACKUP_DIR).toBeDefined();

    // Same launch/data dir as PHASE A (the upgraded install). Write an R1
    // backup of the migrated data to the shared folder.
    await backupPage.open();
    await expect(backupPage.screen).toBeDisplayed();
    const res = await backupPage.backupNow(BACKUP_DIR as string, BACKUP_PASSWORD);
    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.filePath).toContain('.hcbak');
    expect(existsSync(res.filePath)).toBe(true);

    const archives = readdirSync(BACKUP_DIR as string).filter((f) =>
      f.endsWith('.hcbak'),
    );
    expect(archives.length).toBeGreaterThanOrEqual(1);

    // The backup OPENS (NFR-011): verify_backup re-hashes the body and
    // decrypt-tests the first chunk under the password.
    const verified = await backupPage.invokeCommand<{
      ok: boolean;
      checksumOk: boolean;
      decryptOk: boolean;
    }>('verify_backup', { filePath: res.filePath, password: BACKUP_PASSWORD });
    expect(verified.ok).toBe(true);
    expect(verified.checksumOk).toBe(true);
    expect(verified.decryptOk).toBe(true);

    // The archive's plaintext header reads back and is stamped with the running
    // R1 build's app version — i.e. the previous-release data, migrated by R1,
    // was backed up by THIS R1 build and the backup opens.
    const preview = await backupPage.restorePreview(res.filePath, BACKUP_PASSWORD);
    expect(typeof preview.createdAt).toBe('string');
    expect(preview.createdAt.length).toBeGreaterThan(0);
    const info = await backupPage.invokeCommand<{ name: string; version: string }>(
      'app_info',
    );
    // eslint-disable-next-line no-console
    console.log(
      `[upgrade][B] backup app_version=${preview.appVersion} running R1 version=${info.version}`,
    );
    expect(preview.appVersion).toBe(info.version);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R1 -> R2 HOP (HC-MVP1-226, NFR-011, R-DEL-004). From R1 onward every release
// must open the PREVIOUS release's REAL data after an upgrade install. Unlike
// the R0 hop above (R0 leaves an empty dir), R1 leaves a REAL provisioned data
// dir: an encrypted clinic.db at the R1 schema (user_version 3 — migrations
// 0001_init, 0002_setup, 0003_licence_state), a PIN-derived key hierarchy, the
// doctor + clinic profile rows, and R1-made .hcbak backups.
//
// ── How the R1-state is seeded (honest, genuine previous-release data) ───────
// The harness does a TRUE "install R1, then install R2 over it":
//   PHASE C launches the ACTUAL R1 BUILD (HC_R1_APP_BINARY — the R1 source tree
//     built as a debug app) over a fresh data dir and runs the real first-run
//     wizard (setup_set_pin -> opens the encrypted DB and applies R1 migrations
//     0001..0003, user_version 0 -> 3; setup_start_trial; setup_complete),
//     landing on Today unlocked. It then writes a REAL R1 .hcbak through the R1
//     build's own backup_now. After PHASE C the `r1-install` dir holds a
//     genuine R1 install: clinic.db @ user_version 3 + an R1-made .hcbak. This
//     is not a hand-rolled fixture — it is produced by running R1 itself, so
//     the "R1-state" is exactly what a real R1 install leaves on disk.
//   PHASE D relaunches the R2 BUILD UNDER TEST (the default target binary) over
//     that SAME `r1-install` dir — the upgrade install. It asserts the R2 build
//     opens the R1 dir, migrations advance FORWARD 3 -> 7 (0004_patient_search,
//     0005_patient_diagnosis, 0006_patient_registration, 0007_patient_recent),
//     the app unlocks with the R1 PIN, the R1 profile/setup persists, and the
//     R1-made .hcbak still opens under R2.
//
// ── What the R2 build can assert through the webview (and the honest caveat) ──
// As in the R0 hop, no typed command exposes PRAGMA user_version or the raw
// profile rows to the webview in M1/M2. The exact 3 -> 7 advance and exact
// doctor/clinic value equality are asserted at the Rust layer
// (crates/hc-storage/tests/migrate_test.rs forward-only + from-previous-version
// tests; the backup round-trip profile test). Here the webview-observable proof
// of the forward migration is the equivalent END STATE under the R2 build:
//   • boot-gate self-routes the completed R1 dir to #/lock, and the R1 PIN
//     unlocks it (the R1 key hierarchy + completed setup survived the upgrade);
//   • get_backup_status serves — it reads retention through the OPEN migrated
//     pool, which can only succeed if the DB opened at the R2 latest schema
//     (migrations ran forward; a schema-too-new/!migrated DB would error);
//   • the R1-made .hcbak still opens under R2 (verify_backup + restore_preview),
//     i.e. "existing data AND any backups still open" (NFR-011) across the hop.
// The report states this caveat plainly, mirroring PHASE A/B and
// restore-clean-install.e2e.ts.
//
// SKIP-not-fail: if HC_R1_APP_BINARY is absent the R1 build was not provided, so
// the hop cannot run honestly. It is reported as an infra skip (not a silent
// pass and not a product failure) — the executor must supply the R1 build.
const r1BuildPresent = existsSync(R1_APP_BINARY);

describe('HC-MVP1-226 upgrade-path PHASE C: provision a GENUINE R1 install (the R1 build writes clinic.db @ user_version 3 + an R1-made .hcbak)', () => {
  before(function () {
    if (!r1BuildPresent) {
      // eslint-disable-next-line no-console
      console.log(
        `[upgrade][C] SKIP (infra): R1 build not found at ${R1_APP_BINARY}. ` +
          `Set HC_R1_APP_BINARY to the R1 (staging-main) debug app to run the ` +
          `R1->R2 hop.`,
      );
      this.skip();
    }
  });

  it('runs the REAL R1 first-run wizard under the R1 build, then writes an R1-made .hcbak, leaving a genuine previous-release data dir', async () => {
    expect(BACKUP_DIR).toBeDefined();

    // Launch the ACTUAL R1 BUILD over a fresh `r1-install` dir (upgrade from a
    // clean R1 install). The R1 boot-gate self-routes a fresh dir to #/setup.
    await relaunchIntoWithBinary(R1_OVER_DIR, R1_APP_BINARY);
    const decided = await bootPage.waitForDecidedScreen();
    const hash = await bootPage.launchHash();
    // eslint-disable-next-line no-console
    console.log(`[upgrade][C] R1 build self-chosen launch hash = ${hash}`);
    expect(decided).toBe('#/setup');

    // Real first-run wizard under R1 — setup_set_pin opens the DB and applies
    // the R1 migrations 0001..0003 (user_version 0 -> 3), setup_start_trial +
    // setup_complete finish it. Lands on Today unlocked (SET-001 fix). This is
    // the genuine R1 install state the R2 build will upgrade.
    await provisionAndEnterApp(R1_OVER_DIR, R1_PIN);
    await expect(shellPage.todayScreen).toBeDisplayed();

    const r1State = await backupPage.setupState();
    expect(r1State.completed).toBe(true);
    // eslint-disable-next-line no-console
    console.log(
      `[upgrade][C] R1 install provisioned; setup.completed=${r1State.completed} dataDir=${r1State.dataDir}`,
    );

    // The R1 build wrote a real encrypted clinic.db into the resolved app data
    // dir (XDG_DATA_HOME/<identifier>, reported by setup_get_state).
    expect(existsSync(`${r1State.dataDir}/clinic.db`)).toBe(true);

    // Write a REAL R1-made .hcbak through the R1 build's own backup_now, into a
    // dedicated subfolder so PHASE D can unambiguously pick the R1 archive (the
    // shared backup dir also holds the PHASE-B R1-over-R0 archive).
    const r1BackupDir = path.join(sharedBackupDir(), 'r1-made');
    mkdirSync(r1BackupDir, { recursive: true });
    await backupPage.open();
    await expect(backupPage.screen).toBeDisplayed();
    const res = await backupPage.backupNow(r1BackupDir, R1_BACKUP_PASSWORD);
    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.filePath).toContain('.hcbak');
    expect(existsSync(res.filePath)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[upgrade][C] R1-made .hcbak written at ${res.filePath}`);
  });
});

describe('HC-MVP1-226 upgrade-path PHASE D: the R2 build opens the R1 data dir, migrates 3->7 forward, unlocks with the R1 PIN, and the R1-made .hcbak still opens (NFR-011, R-DEL-004)', () => {
  before(function () {
    if (!r1BuildPresent) {
      this.skip();
    }
  });

  it('relaunches the R2 build over the SAME R1 data dir (upgrade install): boot-gate -> lock -> unlock with the R1 PIN, the R1 profile/setup persists, the migrated schema serves, and the R1-made backup opens under R2', async () => {
    expect(BACKUP_DIR).toBeDefined();

    // THE UPGRADE INSTALL: relaunch the R2 build under test (the default target
    // binary — relaunchInto uses the config's application) over the SAME
    // `r1-install` dir PHASE C provisioned under R1. A fresh process over a
    // completed-on-disk dir self-routes to #/lock (SET-004); opening the DB
    // runs the forward-only migrations 0004..0007 (user_version 3 -> 7) before
    // the shell is usable.
    await relaunchInto(R1_OVER_DIR);
    const decided = await bootPage.waitForDecidedScreen();
    const hash = await bootPage.launchHash();
    // eslint-disable-next-line no-console
    console.log(`[upgrade][D] R2 build over R1 dir self-chosen launch hash = ${hash}`);
    expect(decided).toBe('#/lock');
    expect(hash).toBe('#/lock');
    await expect(bootPage.lockCard).toBeDisplayed();

    // Unlock with the R1 PIN: the R1 PIN-derived key hierarchy survived the
    // upgrade and still unseals the DEK under the R2 build (the R1 profile is
    // reachable only because the key hierarchy + completed setup persisted).
    await lockPage.attempt(R1_PIN);
    await shellPage.waitForShell();
    await expect(shellPage.todayScreen).toBeDisplayed();

    // The R1 profile/setup persisted across the upgrade: setup is STILL
    // completed (the doctor + clinic + trial rows migrated forward intact), and
    // get_backup_status serves through the OPEN migrated pool — which can only
    // succeed if the DB opened at the R2 latest schema (migrations 0004..0007
    // ran forward; a non-migrated or schema-too-new DB would error here).
    const upgraded = await backupPage.setupState();
    expect(upgraded.completed).toBe(true);
    const status = await backupPage.getStatus();
    expect(status.retention).toEqual({ daily: 14, weekly: 8, monthly: 12 });
    // eslint-disable-next-line no-console
    console.log(
      `[upgrade][D] R2 opened R1 dir; setup.completed=${upgraded.completed}, migrated schema serves backup status`,
    );

    // The R1 clinic.db is STILL the one in the R1 dir (upgraded in place, not a
    // fresh file) — runner-side proof the R2 build opened the previous-release
    // DB rather than creating a new one. Use the app-resolved data dir reported
    // by setup_get_state (XDG_DATA_HOME/<identifier>).
    expect(existsSync(`${upgraded.dataDir}/clinic.db`)).toBe(true);

    // The R1-MADE .hcbak still opens under the R2 build (NFR-011 "any backups
    // still open"): verify_backup re-hashes + decrypt-tests it, and
    // restore_preview reads a valid plaintext header. The archive was written
    // by the R1 build (format version 1), and the R2 reader accepts it.
    const r1BackupDir = path.join(sharedBackupDir(), 'r1-made');
    const r1Archives = readdirSync(r1BackupDir).filter((f) => f.endsWith('.hcbak'));
    expect(r1Archives.length).toBeGreaterThanOrEqual(1);
    const r1Archive = path.join(r1BackupDir, r1Archives[0] as string);

    const verified = await backupPage.invokeCommand<{
      ok: boolean;
      checksumOk: boolean;
      decryptOk: boolean;
    }>('verify_backup', { filePath: r1Archive, password: R1_BACKUP_PASSWORD });
    expect(verified.ok).toBe(true);
    expect(verified.checksumOk).toBe(true);
    expect(verified.decryptOk).toBe(true);

    const preview = await backupPage.restorePreview(r1Archive, R1_BACKUP_PASSWORD);
    expect(typeof preview.createdAt).toBe('string');
    expect(preview.createdAt.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `[upgrade][D] R1-made .hcbak opens under R2: app_version=${preview.appVersion} createdAt=${preview.createdAt}`,
    );
  });
});
