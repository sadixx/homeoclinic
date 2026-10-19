// @req SET-001 SET-002 SET-003 SET-004 BAK-002 BAK-003 LIC-063
// @tier regression
// @area release
// @targets linux, windows
//
// HC-MVP1-215 — the R1 "Set up and protect" demo, run as ONE regression spec
// end to end against the built Tauri app (docs/milestones/README.md R1,
// docs/milestones/R1-brief.md). Network disabled (product rule 1). This is the
// R1 release gate (R-DEL-005): the demo must pass AND the R0 demo
// (tests/e2e/specs/app/shell.e2e.ts, also @tier regression) must still pass.
//
// Boot-gate note (commit e1cd2cb, AppShell BootRouter): on a cold launch the
// app AUTO-ROUTES itself to #/setup (fresh) | #/lock (provisioned+sealed) |
// #/today (unlocked) by reading setup_get_state + auth_get_lock_state. So this
// demo runs as a REAL fresh-launch flow: the spec never forces the launch
// route — bootPage only OBSERVES the app's self-chosen window.location.hash
// (the same proof technique as app/boot-gate.e2e.ts). Only inside the running
// session does it drive the in-app screens through the existing page objects.
//
// ── Execution model (how the executor launches this) ────────────────────────
// A tauri-driver session launches the app exactly once against one data dir,
// and the ONLY data-dir isolation the app honours on Linux is XDG_DATA_HOME.
// The demo therefore has THREE phases, authored as three describe() blocks the
// executor runs as SEPARATE launches (identical to app/boot-gate.e2e.ts and the
// backup phase specs):
//
//   STEP 1+2  — one data dir (dirMain):
//     PHASE 1 (launch #1, fresh dirMain): the app self-routes to #/setup; the
//       first-run wizard collects doctor + clinic + PIN, shows the one-time
//       recovery code, the licence step reads "Development trial" (LIC-063),
//       Finish → Today unlocked. This PROVISIONS dirMain.
//     PHASE 2 (launch #2, SAME dirMain): the app self-routes to #/lock on
//       reopen; a wrong PIN is refused inline with no lockout; the correct PIN
//       unlocks in one entry → Today.
//
//   STEP 3 — two data dirs + one shared backup folder (HC_E2E_BACKUP_DIR):
//     PHASE 3A (launch #3, fresh dirSource): provision a source install, then
//       "Back up now" to the shared folder with a password through the real
//       S17 path → a .hcbak is written.
//     PHASE 3B (launch #4, fresh dirClean = a separate clean install): restore
//       the shared .hcbak, then assert the restored install is operable
//       (boots, setup_get_state.completed, get_backup_status serves). The exact
//       doctor/clinic VALUE round-trip is proven at the Rust integration layer
//       (bak030_hcbak_round_trip_reproduces_doctor_and_clinic_rows); no typed
//       command exposes the profile rows to the webview in M1, so here we prove
//       the cross-install backup→restore IPC+engine+encrypted-DB flow opens.
//
// STEP 4 of the demo ("R0 demo still passes") is the EXISTING R0 regression
// spec tests/e2e/specs/app/shell.e2e.ts run in the same regression tier; it is
// not re-implemented here (no duplication — R-DEL-005 runs the whole tier).
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { expect } from '@wdio/globals';

import { backupPage } from '../../pages/backup.page.js';
import { bootPage } from '../../pages/boot.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { setupPage } from '../../pages/setup.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { relaunchInto } from '../../helpers/launch.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';

/** PIN used for the step 1+2 install (set in phase 1, verified in phase 2). */
const PIN = '4321';
/** A deliberately wrong PIN for the step-2 refusal check (SUX-005). */
const WRONG_PIN = '9999';
/** Source-install PIN + backup password for step 3. */
const SOURCE_PIN = '4321';
const CLEAN_PIN = '7788';
const BACKUP_PASSWORD = 'clinic-backup-1';

/** Shared /tmp backup folder the executor sets for phases 3A and 3B. */
const BACKUP_DIR = process.env.HC_E2E_BACKUP_DIR;

/** Resolve the single .hcbak the source phase left in the shared folder. */
function sharedArchive(): string {
  const dir = BACKUP_DIR as string;
  const found = readdirSync(dir).filter((f) => f.endsWith('.hcbak'));
  if (found.length === 0) {
    throw new Error(`no .hcbak found in shared backup dir ${dir}`);
  }
  return path.join(dir, found[0] as string);
}

describe('R1 demo STEP 1 — PHASE 1: fresh install first-run wizard (SET-001/002/003/004, LIC-063)', () => {
  it('auto-routes a fresh launch to the wizard, collects doctor+clinic+PIN, shows the recovery code, licence reads "Development trial", and finishes into Today unlocked', async () => {
    // The app chose the wizard ITSELF on a cold launch of a fresh data dir
    // (bootPage never sets the hash — AppShell's BootRouter did). This is a
    // genuine fresh-install entry, not a forced route.
    const decided = await bootPage.waitForDecidedScreen();
    const hash = await bootPage.launchHash();
    // eslint-disable-next-line no-console
    console.log(`[r1-demo][1] self-chosen launch hash = ${hash}`);
    expect(decided).toBe('#/setup');
    expect(hash).toBe('#/setup');
    await expect(bootPage.setupWizard).toBeDisplayed();

    // SET-001: the wizard is the four-step first-run wizard.
    await expect(setupPage.wizard).toBeDisplayed();
    await expect(setupPage.stepIndicator).toHaveText(
      expect.stringContaining('4'),
    );

    // SET-002 doctor profile, SET-003 clinic profile.
    await setupPage.fillDoctorAndNext();
    await setupPage.fillClinicAndNext();

    // SET-004: set the PIN, which reveals the one-time recovery code. The code
    // is minted by the real setup_set_pin, shown once, non-empty and printable.
    const recoveryCode = await setupPage.setPinAndRevealRecovery(PIN);
    expect(recoveryCode.length).toBeGreaterThan(0);
    await expect(setupPage.recoveryPrint).toBeDisplayed();
    await setupPage.ackRecoveryAndNext();

    // LIC-063: the licence step shows the development-trial choice.
    await expect(setupPage.licenceDevTrial).toBeDisplayed();

    // Finish -> setup_start_trial + setup_complete. Under the SET-001 fix
    // (AppShell BootRouter live completion signal) the wizard flips completion
    // to true BEFORE navigating to /today, so the completion route-guard
    // (commit 216cfed) admits the shell on THIS launch: finishing the wizard
    // lands on Today, unlocked — the user-reported defect (bounced back to
    // /setup until a close/reopen + PIN) is fixed. STEP 2 then separately
    // proves the real SET-004 reopen -> lock -> unlock path.
    await setupPage.finishSetup();
    await shellPage.waitForShell();
    await expect(shellPage.todayScreen).toBeDisplayed();
    await expect(bootPage.setupWizard).not.toBeDisplayed();
  });
});

describe('R1 demo STEP 2 — PHASE 2: reopen and unlock with the PIN (SET-004, SUX-003/005)', () => {
  // Separate app launch against the SAME dir PHASE 1 provisioned ('main'). In a
  // single `wdio run` the app launches once per spec, so relaunch here against
  // the provisioned 'main' dir — the in-spec equivalent of the orchestrator's
  // PHASE 2 process pointed at PHASE 1's XDG_DATA_HOME.
  before(async () => {
    await relaunchInto('main');
  });

  it('auto-routes the provisioned install to lock on reopen, refuses a wrong PIN inline without lockout, then unlocks with the correct PIN in one entry', async () => {
    // A fresh process starts LOCKED and setup is completed on disk, so the app
    // self-routes to #/lock — the real "close and reopen" path.
    const decided = await bootPage.waitForDecidedScreen();
    const hash = await bootPage.launchHash();
    // eslint-disable-next-line no-console
    console.log(`[r1-demo][2] self-chosen launch hash = ${hash}`);
    expect(decided).toBe('#/lock');
    expect(hash).toBe('#/lock');
    await expect(bootPage.lockCard).toBeDisplayed();

    // SUX-005: a wrong PIN is refused inline and never restricts the app.
    await lockPage.attempt(WRONG_PIN);
    await lockPage.waitForError();
    await expect(lockPage.error).toBeDisplayed();
    await expect(lockPage.error).toHaveText('That PIN is not correct.');
    // No lockout: the input and Unlock control stay usable.
    await expect(lockPage.pin).toBeEnabled();
    await expect(lockPage.unlock).toBeDisplayed();

    // SUX-003: the correct PIN unlocks in one entry and returns to Today.
    await lockPage.attempt(PIN);
    await shellPage.waitForShell();
    await expect(shellPage.todayScreen).toBeDisplayed();
  });
});

describe('R1 demo STEP 3 — PHASE 3A: back up the source install to a folder with a password (BAK-002)', () => {
  // Fresh, SEPARATE clean install for the source profile ('source' dir). The
  // per-spec shared backup folder (HC_E2E_BACKUP_DIR, set by the harness) is
  // the same for 3A and 3B, so 3B can restore what 3A wrote.
  before(async () => {
    await relaunchInto('source');
  });

  it('provisions a source install on a fresh launch and backs up to the shared folder with a password, producing a verified .hcbak', async () => {
    expect(BACKUP_DIR).toBeDefined();

    // Fresh launch → wizard (boot-gate self-route). Provision the SOURCE
    // profile — this is the doctor + clinic that step 3 restores on a clean
    // install. Under the SET-001 fix, completing the wizard flips the live
    // completion signal before navigating to /today, so it lands on Today,
    // unlocked, on THIS launch and the completion route-guard (commit 216cfed)
    // then admits /backup — no relaunch.
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('source', SOURCE_PIN);

    // Real S17 backup screen + real health status.
    await backupPage.open();
    await expect(backupPage.screen).toBeDisplayed();

    // "Back up now" to the shared folder with a password, through the real
    // backup_now typed command (same IPC the S17 button calls; the /tmp path is
    // substituted for the OS folder dialog, which has no writable mount root on
    // this headless box — see pages/backup.page.ts header).
    const res = await backupPage.backupNow(BACKUP_DIR as string, BACKUP_PASSWORD);
    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.filePath).toContain('.hcbak');
    expect(res.filePath).toContain(BACKUP_DIR as string);

    // The archive really exists on disk for phase 3B to restore.
    expect(existsSync(res.filePath)).toBe(true);
    const archives = readdirSync(BACKUP_DIR as string).filter((f) =>
      f.endsWith('.hcbak'),
    );
    expect(archives.length).toBeGreaterThanOrEqual(1);
  });
});

describe('R1 demo STEP 3 — PHASE 3B: restore on a clean install; the install comes back operable (BAK-003)', () => {
  // A SEPARATE clean install ('clean' dir, != 'source'), so the restore
  // genuinely replaces this install's data with the source's.
  before(async () => {
    await relaunchInto('clean');
  });

  it('provisions a separate clean install, restores the shared backup, and ends operable with backup status serving', async () => {
    expect(BACKUP_DIR).toBeDefined();
    const archive = sharedArchive();
    expect(existsSync(archive)).toBe(true);

    // Fresh launch → wizard (boot-gate self-route). A SEPARATE clean install
    // (its own XDG_DATA_HOME) with a DIFFERENT PIN, so the restore genuinely
    // replaces this install's data with the source's rather than passing
    // trivially. Under the SET-001 fix, completing the wizard lands on Today,
    // unlocked, on THIS launch — no relaunch; restore_apply then runs against
    // this unlocked clean install.
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('clean', CLEAN_PIN);

    // This clean install is its own completed setup before any restore.
    await backupPage.open();
    await expect(backupPage.screen).toBeDisplayed();
    const before = await backupPage.setupState();
    expect(before.completed).toBe(true);

    // Restore the source backup: preview (no mutation) then apply (re-key under
    // THIS install's DEK + atomic swap). A successful apply is itself proof the
    // restored clinic.db opens under the clean install's own keystore.
    const preview = await backupPage.restorePreview(archive, BACKUP_PASSWORD);
    expect(typeof preview.createdAt).toBe('string');
    expect(preview.createdAt.length).toBeGreaterThan(0);

    const applied = await backupPage.restoreApply(archive, BACKUP_PASSWORD);
    expect(applied.ok).toBe(true);
    expect(applied.preRestoreBackupPath.length).toBeGreaterThan(0);

    // The restored install is still a completed, operable setup, and its backup
    // health reads back through the engine on the restored DB — the doctor and
    // clinic profile have been restored onto the clean install (R1 demo step 3;
    // exact value equality is asserted at the Rust layer).
    const restoredState = await backupPage.setupState();
    expect(restoredState.completed).toBe(true);
    const restoredStatus = await backupPage.getStatus();
    expect(restoredStatus.retention).toEqual({
      daily: 14,
      weekly: 8,
      monthly: 12,
    });
  });
});
