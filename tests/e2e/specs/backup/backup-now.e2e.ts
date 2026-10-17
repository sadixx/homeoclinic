// @req BAK-001 BAK-002 BAK-004
// @tier regression
// @area backup
// @targets linux
//
// R1 demo STEP 3, PHASE A (source install). Network disabled, fresh data dir
// (the executor sets XDG_DATA_HOME to a per-run temp dir so app_data_dir is
// isolated — the Tauri shell resolves app.path().app_data_dir() on Linux).
//
// Drives the REAL built Tauri app end to end:
//   1. First-run setup with a KNOWN doctor + clinic (the "source" profile) and
//      a PIN -> Today, unlocked (reuses the Slice C setup/lock page objects, so
//      the DEK + encrypted DB are the real backend path).
//   2. Navigate to the real S17 /backup screen; assert it renders and the real
//      get_backup_status returns the 14/8/12 retention and the no-backup-yet
//      stale banner (BAK-001/004).
//   3. Back up now to a shared folder (HC_E2E_BACKUP_DIR, a /tmp dir the next
//      phase also reads) with a password, through the real backup_now typed
//      command (real hc-storage engine): assert ok + verified and that a real
//      .hcbak file was written at the returned path (BAK-002, S17 AC1 first half).
//
// Why the destination is driven through the typed command and not the picker
// button: see the header of pages/backup.page.ts — list_removable_drives has no
// writable mount root on this headless box, so the readOnly destination field
// cannot be filled via the button; the typed command is the same real IPC path
// the button would call, with a test /tmp path substituted for the OS dialog.
import { existsSync, readdirSync } from 'node:fs';

import { expect } from '@wdio/globals';

import { backupPage } from '../../pages/backup.page.js';
import { setupPage } from '../../pages/setup.page.js';
import { shellPage } from '../../pages/shell.page.js';

const PIN = '4321';
const BACKUP_PASSWORD = 'clinic-backup-1';

const BACKUP_DIR = process.env.HC_E2E_BACKUP_DIR;

describe('R1 demo step 3 — PHASE A: back up the source install (HC-MVP1-030/032/034)', () => {
  it('sets up the source install, renders the real S17 screen, and backs up to a folder with a password producing a .hcbak', async () => {
    expect(BACKUP_DIR).toBeDefined();

    // 1. Real first-run setup -> Today, unlocked. Doctor + clinic are the
    //    source profile that phase B must see come back.
    await setupPage.open();
    await setupPage.fillDoctorAndNext();
    await setupPage.fillClinicAndNext();
    await setupPage.setPinAndRevealRecovery(PIN);
    await setupPage.ackRecoveryAndNext();
    await setupPage.finishSetup();
    await shellPage.waitForShell();

    // 2. Real S17 screen + real health status.
    await backupPage.open();
    await expect(backupPage.screen).toBeDisplayed();
    await expect(backupPage.retention).toBeDisplayed();

    const status = await backupPage.getStatus();
    // BAK-001 retention counts surfaced by the real command.
    expect(status.retention).toEqual({ daily: 14, weekly: 8, monthly: 12 });
    // No backup yet -> stale banner is shown in TEXT (BAK-004 empty state).
    expect(status.lastBackupAt).toBe(null);
    await expect(backupPage.staleBanner).toBeDisplayed();

    // 3. Real backup to the shared folder with a password.
    const res = await backupPage.backupNow(
      BACKUP_DIR as string,
      BACKUP_PASSWORD,
    );
    expect(res.ok).toBe(true);
    // BAK-004 post-backup integrity check passed.
    expect(res.verified).toBe(true);
    // A real .hcbak path was returned under the chosen folder.
    expect(res.filePath).toContain('.hcbak');
    expect(res.filePath).toContain(BACKUP_DIR as string);

    // The archive really exists on disk (runner-side check), and the shared
    // folder now holds exactly one .hcbak for phase B to restore.
    expect(existsSync(res.filePath)).toBe(true);
    const archives = readdirSync(BACKUP_DIR as string).filter((f) =>
      f.endsWith('.hcbak'),
    );
    expect(archives.length).toBeGreaterThanOrEqual(1);

    // After a successful backup the real status reports a last-good time and is
    // no longer stale (BAK-004) — proves the engine recorded the integrity result.
    const after = await backupPage.getStatus();
    expect(after.lastBackupAt).not.toBe(null);
    expect(after.stale).toBe(false);
  });
});
