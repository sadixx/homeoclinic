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
//     licence 'Development trial' -> Finish -> Today unlocked. <=4 steps.
//
//   HC-MVP1-027 PIN set / unlock / wrong PIN refused without lockout (SET-004):
//     from the lock screen a wrong PIN is refused inline and the app stays
//     usable (no lockout, SUX-005); the correct PIN unlocks in one entry and
//     returns to Today.
//
// Note on routing: at Slice C the shell has no boot-time gate, so the wizard
// (#/setup) and lock (#/lock) screens are driven by explicit route navigation.
// The commands, DB, PIN mint/verify and trial start are the REAL backend path;
// this is a genuine end-to-end exercise of what the slice delivers. The PIN set
// by the wizard in step 1 is the same PIN verified by auth_unlock in step 2,
// against the same open encrypted DB in one app session.
import { expect } from '@wdio/globals';

import { lockPage } from '../../pages/lock.page.js';
import { setupPage } from '../../pages/setup.page.js';
import { shellPage } from '../../pages/shell.page.js';

const PIN = '4321';

describe('R1 first-run wizard and lock/unlock (HC-MVP1-026, HC-MVP1-027)', () => {
  it('completes the first-run wizard in <=4 steps, reveals a one-time recovery code, starts the dev trial, and opens Today', async () => {
    // Step 1 of the demo: first-run wizard.
    await setupPage.open();
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

    // Finish -> setup_start_trial + setup_complete -> route to Today unlocked.
    await setupPage.finishSetup();

    await shellPage.waitForShell();
    await expect(shellPage.appShell).toBeDisplayed();
    await expect(shellPage.todayScreen).toBeDisplayed();
    await expect(shellPage.todayEmpty).toBeDisplayed();
  });

  it('refuses a wrong PIN inline without locking the user out, then unlocks with the correct PIN in one entry', async () => {
    // Step 2 of the demo: lock screen. Same session, DB still provisioned with
    // the PIN set above.
    await lockPage.open();
    await expect(lockPage.card).toBeDisplayed();

    // SUX-005: a wrong PIN is refused inline and never restricts the app.
    await lockPage.attempt('9999');
    await lockPage.waitForError();
    await expect(lockPage.error).toBeDisplayed();
    await expect(lockPage.error).toHaveText('That PIN is not correct.');
    // No lockout: the PIN input and Unlock button remain usable.
    await expect(lockPage.pin).toBeEnabled();
    await expect(lockPage.unlock).toBeDisplayed();

    // SUX-003: the correct PIN unlocks in one entry and returns to Today.
    await lockPage.attempt(PIN);
    await shellPage.waitForShell();
    await expect(shellPage.todayScreen).toBeDisplayed();
  });
});
