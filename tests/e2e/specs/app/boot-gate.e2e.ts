// @req SET-001 SET-004
// @tier regression
// @area settings
// @targets linux
//
// Boot-gate launch routing (AppShell.tsx; R1 demo as a genuine fresh-launch
// flow). Unlike first-run.e2e.ts — which reaches #/setup and #/lock by FORCING
// window.location.hash — this spec proves the app AUTO-ROUTES on its own at
// launch. It reads the self-chosen window.location.hash right after load,
// before any navigation, so a pass can only mean AppShell's BootRouter seeded
// the route itself from setup_get_state + auth_get_lock_state.
//
// Two phases, run as two app launches against ONE data dir (the primary 'main'
// dir; PHASE B relaunches it in-spec):
//
//   PHASE A — fresh data dir -> #/setup -> finish wizard -> Today (SET-001):
//     a brand-new data dir has no initialised key hierarchy, so setup_get_state
//     reports completed=false and the gate self-routes to the first-run wizard.
//     We assert the app chose #/setup WITHOUT navigating, then run the REAL
//     first-run wizard through Finish. Under the SET-001 fix the wizard's Finish
//     flips the LIVE completion signal before navigating to /today, so the
//     completion route-guard admits the shell on THIS launch: finishing the
//     wizard lands on Today, unlocked — the user-reported defect (bounced back
//     to /setup) is gone. This also provisions 'main' for PHASE B's relaunch.
//
//   PHASE B — provisioned + locked data dir relaunch -> #/lock (SET-004):
//     the app relaunches with XDG_DATA_HOME pointing at the data dir PHASE A
//     provisioned. A fresh process starts LOCKED
//     (hc-app/state.rs: "Fresh process starts locked until setup completes or
//     the user [unlocks]") and setup_get_state reports completed=true (key
//     hierarchy is initialised on disk), so the gate self-routes to the lock
//     screen. We assert the app chose #/lock WITHOUT navigating — the real
//     SET-004 "reopen -> unlock with PIN" launch path.
import { expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { setupPage } from '../../pages/setup.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { relaunchInto } from '../../helpers/launch.js';

const PIN = '4321';

describe('R1 boot-gate PHASE A: fresh install launches into the wizard, finishing it reaches Today (SET-001)', () => {
  it('auto-routes a fresh data dir to #/setup on launch with no forced navigation, then finishing the wizard lands on Today unlocked', async () => {
    // Observe the app's OWN launch decision. No page object here touches the
    // hash — bootPage only reads it.
    const decided = await bootPage.waitForDecidedScreen();

    // The app chose the wizard itself: the self-seeded hash is #/setup and the
    // wizard screen is live. Today/lock must NOT be the launch screen.
    const hash = await bootPage.launchHash();
    // eslint-disable-next-line no-console
    console.log(`[boot-gate][A] self-chosen launch hash = ${hash}`);
    expect(decided).toBe('#/setup');
    expect(hash).toBe('#/setup');
    await expect(bootPage.setupWizard).toBeDisplayed();

    // Run the real first-run wizard through Finish. The wizard is already on
    // screen (the app put us here); drive it through the real typed commands.
    await expect(setupPage.wizard).toBeDisplayed();
    await setupPage.fillDoctorAndNext();
    await setupPage.fillClinicAndNext();
    const recoveryCode = await setupPage.setPinAndRevealRecovery(PIN);
    expect(recoveryCode.length).toBeGreaterThan(0);
    await setupPage.ackRecoveryAndNext();
    await expect(setupPage.licenceDevTrial).toBeDisplayed();
    await setupPage.finishSetup();

    // COMPLETION ROUTE-GUARD under the SET-001 fix (AppShell BootRouter): Finish
    // persists setup_complete + setup_start_trial and flips the LIVE completion
    // signal (markCompleted) BEFORE navigating to /today, so ShellRoute admits
    // the shell on THIS launch. Finishing the wizard therefore lands on Today,
    // unlocked — the user-reported defect (bounced back to /setup until a
    // close/reopen + PIN) is fixed. Assert we are genuinely in the shell.
    await shellPage.waitForShell();
    await expect(shellPage.todayScreen).toBeDisplayed();
    await expect(bootPage.setupWizard).not.toBeDisplayed();
  });
});

describe('R1 boot-gate PHASE B: reopening a provisioned install launches into lock (SET-004)', () => {
  // PHASE B is a SEPARATE app launch against the SAME data dir PHASE A
  // provisioned. In one `wdio run` the app launches once per spec, so relaunch
  // the app here against the SAME 'main' dir (now completed + sealed). This is
  // the in-spec equivalent of the orchestrator's second process pointed at
  // PHASE A's XDG_DATA_HOME. 'main' is the primary dir PHASE A ran against, so
  // reusing the name reuses the provisioned dir (no fresh wipe).
  before(async () => {
    await relaunchInto('main');
  });

  it('auto-routes a provisioned + locked data dir to #/lock on relaunch with no forced navigation', async () => {
    // A fresh process starts locked; setup is completed on disk (PHASE A).
    const decided = await bootPage.waitForDecidedScreen();

    const hash = await bootPage.launchHash();
    // eslint-disable-next-line no-console
    console.log(`[boot-gate][B] self-chosen launch hash = ${hash}`);
    // The app chose the lock screen itself on reopen (SET-004), not Today.
    expect(decided).toBe('#/lock');
    expect(hash).toBe('#/lock');
    await expect(bootPage.lockCard).toBeDisplayed();
  });
});
