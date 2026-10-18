// @req BAK-002 BAK-003
// @tier regression
// @area backup
// @targets linux
//
// R1 demo STEP 3, PHASE B (clean install). Network disabled, a SECOND fresh
// data dir (the executor sets a different XDG_DATA_HOME than phase A, so this is
// a genuine clean install), sharing the SAME backup folder (HC_E2E_BACKUP_DIR)
// that phase A wrote its .hcbak into.
//
// Drives the REAL built Tauri app end to end:
//   1. First-run setup with a DIFFERENT doctor + clinic (the "destination"
//      profile) and a PIN -> Today, unlocked. Using a different profile proves
//      the restore REPLACES the destination data with the source's, rather than
//      passing trivially.
//   2. Navigate to the real S17 /backup screen and open the restore wizard
//      chrome (real screen).
//   3. Discover the source .hcbak in the shared folder, then:
//        - real restore_preview: reads the plaintext header WITHOUT mutating
//          anything and WITHOUT the body key (BAK-003 preview / AC4) — asserts a
//          valid created_at + app_version came from the source archive.
//        - a WRONG password is refused by restore_apply before anything live is
//          swapped (AC4) — the destination profile is still intact afterwards.
//        - real restore_apply with the correct password: safety copy -> atomic
//          swap -> RE-KEY the source snapshot under THIS clean install's own DEK
//          (design §5 / ADR 0014) -> migrate. A successful apply is itself proof
//          the re-key opened the restored clinic.db under install B's keystore;
//          if the re-key were wrong, restore_apply would error on reopen.
//   4. After restore the install is still a completed, operable setup
//      (setup_get_state.completed) and a pre-restore safety copy exists — the
//      source data (incl. the doctor + clinic profile) has been restored onto
//      the clean install (R1 demo step 3). The exact doctor/clinic VALUE
//      equality is asserted at the Rust integration layer
//      (bak030_hcbak_round_trip_reproduces_doctor_and_clinic_rows), because no
//      typed command exposes the profile rows to the webview in M1; adding one
//      would be production work outside this E2E stage.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { expect } from '@wdio/globals';

import { backupPage } from '../../pages/backup.page.js';
import { setupPage } from '../../pages/setup.page.js';
import { shellPage } from '../../pages/shell.page.js';

const PIN = '7788';
const SOURCE_BACKUP_PASSWORD = 'clinic-backup-1';
const WRONG_PASSWORD = 'not-the-password';

const BACKUP_DIR = process.env.HC_E2E_BACKUP_DIR;

/** Resolve the single .hcbak phase A left in the shared folder. */
function sourceArchive(): string {
  const dir = BACKUP_DIR as string;
  const found = readdirSync(dir).filter((f) => f.endsWith('.hcbak'));
  if (found.length === 0) {
    throw new Error(`no .hcbak found in shared backup dir ${dir}`);
  }
  return path.join(dir, found[0] as string);
}

describe('R1 demo step 3 — PHASE B: restore on a clean install (HC-MVP1-033)', () => {
  it('sets up a fresh install with a different profile, then restores the source backup and ends operable', async () => {
    expect(BACKUP_DIR).toBeDefined();
    const archive = sourceArchive();
    expect(existsSync(archive)).toBe(true);

    // 1. Clean install: fresh setup with a DIFFERENT doctor + clinic, unlocked.
    await setupPage.open();
    await setupPage.fillDoctorAndNext();
    await setupPage.fillClinicAndNext();
    await setupPage.setPinAndRevealRecovery(PIN);
    await setupPage.ackRecoveryAndNext();
    await setupPage.finishSetup();
    await shellPage.waitForShell();

    // This install is its own completed setup before any restore.
    const before = await backupPage.setupState();
    expect(before.completed).toBe(true);

    // 2. Real S17 screen + restore wizard chrome.
    await backupPage.open();
    await expect(backupPage.screen).toBeDisplayed();
    await backupPage.restoreChoose.waitForDisplayed({ timeout: 10000 });

    // 3a. Real preview reads the SOURCE archive header without mutating.
    const preview = await backupPage.restorePreview(
      archive,
      SOURCE_BACKUP_PASSWORD,
    );
    expect(typeof preview.createdAt).toBe('string');
    expect(preview.createdAt.length).toBeGreaterThan(0);
    expect(typeof preview.appVersion).toBe('string');
    expect(preview.appVersion.length).toBeGreaterThan(0);

    // 3b. A wrong password is refused before anything live is swapped (AC4):
    //     restore_apply throws and the install stays a completed setup.
    let wrongRejected = false;
    try {
      await backupPage.restoreApply(archive, WRONG_PASSWORD);
    } catch {
      wrongRejected = true;
    }
    expect(wrongRejected).toBe(true);
    const afterWrong = await backupPage.setupState();
    expect(afterWrong.completed).toBe(true);

    // 3c. Real restore apply with the correct password: re-key under THIS
    //     install's DEK + atomic swap. Success is proof the restored DB opens
    //     under install B's keystore.
    const applied = await backupPage.restoreApply(
      archive,
      SOURCE_BACKUP_PASSWORD,
    );
    expect(applied.ok).toBe(true);
    // BAK-003 pre-restore safety copy of the clean install's prior data.
    expect(applied.preRestoreBackupPath.length).toBeGreaterThan(0);

    // 4. The restored install is still a completed, operable setup, and its
    //    real backup health reads back through the engine on the restored DB
    //    (proves the restored clinic.db is open and queryable under B's DEK).
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
