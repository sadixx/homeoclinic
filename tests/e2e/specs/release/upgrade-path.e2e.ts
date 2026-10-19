// @req NFR-011 NFR-042
// @tier regression
// @area release
// @targets linux, windows
//
// HC-MVP1-226 — the upgrade-path harness (NFR-011 "the previous release's data
// always opens after an upgrade install"; NFR-042; R-DEL-004). From R1 onward
// every release must open the previous release's data after an upgrade install.
// This is the R1 instance of that harness: install R1 over R0 and prove R0's
// data opens, migrations run forward, and an R1-made backup opens.
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
import { existsSync, readdirSync } from 'node:fs';

import { expect } from '@wdio/globals';

import { backupPage } from '../../pages/backup.page.js';
import { bootPage } from '../../pages/boot.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';

const PIN = '4321';
const BACKUP_PASSWORD = 'upgrade-backup-1';

/** Shared /tmp backup folder the executor sets for the backup-opens check. */
const BACKUP_DIR = process.env.HC_E2E_BACKUP_DIR;

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
