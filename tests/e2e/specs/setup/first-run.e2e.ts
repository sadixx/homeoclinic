// @req SET-001 SET-002 SET-003 SET-004 LIC-063
// @tier regression
// @area settings
// @targets linux, windows
//
// R1 demo steps 1-2 (docs/milestones/README.md), network disabled, fresh data
// dir. Validates the two tasks Slice C enables, end to end against the built
// Tauri app wired to the real typed commands and the encrypted SQLCipher DB:
//
//   HC-MVP1-026 First-run wizard (SET-001/002/003, LIC-063 dev trial):
//     doctor -> clinic -> PIN + one-time recovery code (printable + ack) ->
//     licence 'Development trial' -> Finish -> setup_complete + setup_start_trial
//     -> Today, unlocked. <=4 steps. The wizard has ONE forward exit (Finish);
//     there is no in-wizard jump-to-Backup link.
//
//   HC-MVP1-027 PIN set / unlock / wrong PIN refused without lockout (SET-004):
//     from the lock screen (reached by a real close + reopen) a wrong PIN is
//     refused inline and the app stays usable (no lockout, SUX-005); the correct
//     PIN unlocks in one entry and returns to Today.
//
// ── Routing under the completion route-guard (commit 216cfed; SET-001 fix) ──
// The shell is GATED: every shell route (/today, /backup) is wrapped by a
// completion route-guard (ShellRoute) that redirects to /setup while setup is
// not completed. The SET-001 user-reported defect was that the guard read a
// FROZEN boot-time `completed` value, so finishing the wizard on a fresh launch
// bounced /today back to /setup and the app was only usable after a
// close/reopen + PIN unlock. The product fix holds the guard's `completed` as a
// LIVE signal: the wizard's Finish flips it to true BEFORE navigating to
// /today, so finishing the wizard lands on Today, unlocked, on THIS launch —
// the real first-run experience. The separate SET-004 "close, reopen, unlock
// with the PIN" path is still exercised below by an explicit relaunch: a fresh
// process over the provisioned 'main' dir boots to #/lock, and the PIN set by
// the wizard in step 1 unlocks it against the real encrypted DB.
import { expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { setupPage } from '../../pages/setup.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { relaunchInto } from '../../helpers/launch.js';

const PIN = '4321';
const WRONG_PIN = '9999';

describe('R1 first-run wizard and lock/unlock (HC-MVP1-026, HC-MVP1-027)', () => {
  it('completes the first-run wizard in <=4 steps, reveals a one-time recovery code, starts the dev trial, and finishing lands on Today unlocked', async () => {
    // Step 1 of the demo: first-run wizard. The fresh data dir self-routes to
    // #/setup (boot-gate). Drive the wizard from there (reach it via the real
    // launch route, not a forced hash).
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await expect(setupPage.wizard).toBeDisplayed();

    // SET-001: exactly four steps. Step rail shows "... 4".
    await expect(setupPage.stepIndicator).toHaveText(
      expect.stringContaining('4'),
    );

    // SET-002 doctor, SET-003 clinic.
    await setupPage.fillDoctorAndNext();
    await setupPage.fillClinicAndNext();

    // SET-004: set the PIN, which reveals the one-time recovery code.
    const recoveryCode = await setupPage.setPinAndRevealRecovery(PIN);
    // The code is real (minted by setup_set_pin), shown once, non-empty.
    expect(recoveryCode.length).toBeGreaterThan(0);
    // It is printable (a Print control is offered next to it).
    await expect(setupPage.recoveryPrint).toBeDisplayed();

    // Acknowledge the saved code, then advance to the licence step.
    await setupPage.ackRecoveryAndNext();

    // LIC-063: development-trial licence step.
    await expect(setupPage.licenceDevTrial).toBeDisplayed();

    // Finish -> setup_start_trial + setup_complete. Under the SET-001 fix the
    // wizard flips the live completion signal before navigating to /today, so
    // the completion route-guard admits the shell on THIS launch: finishing the
    // wizard lands on Today, unlocked. The user-reported defect (bounced back to
    // /setup until a close/reopen + PIN) is fixed.
    await setupPage.finishSetup();
    await shellPage.waitForShell();
    await expect(shellPage.todayScreen).toBeDisplayed();
    await expect(bootPage.setupWizard).not.toBeDisplayed();
  });

  it('refuses a wrong PIN inline without locking the user out, then unlocks with the correct PIN in one entry (reopen the provisioned install)', async () => {
    // Step 2 of the demo: the real SET-004 "close and reopen" path. Relaunch the
    // SAME 'main' data dir step 1 provisioned; a fresh process over a completed
    // dir self-routes to #/lock.
    await relaunchInto('main');
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/lock');
    await expect(lockPage.card).toBeDisplayed();

    // SUX-005: a wrong PIN is refused inline and never restricts the app.
    await lockPage.attempt(WRONG_PIN);
    await lockPage.waitForError();
    await expect(lockPage.error).toBeDisplayed();
    await expect(lockPage.error).toHaveText('That PIN is not correct.');
    // No lockout: the PIN input and Unlock button remain usable.
    await expect(lockPage.pin).toBeEnabled();
    await expect(lockPage.unlock).toBeDisplayed();

    // SUX-003: the correct PIN unlocks in one entry and returns to Today, now
    // with the completion guard satisfied (completed=true on this launch).
    await lockPage.attempt(PIN);
    await shellPage.waitForShell();
    await expect(shellPage.todayScreen).toBeDisplayed();
  });
});
