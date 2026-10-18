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
// Two phases, run as two separate app launches (the executor gives each phase
// its own XDG_DATA_HOME so the Tauri app resolves a distinct data dir, which is
// how a "fresh install" vs a "provisioned install relaunch" is simulated — a
// real tauri-driver session launches the app exactly once):
//
//   PHASE A — fresh data dir -> #/setup (SET-001):
//     a brand-new data dir has no initialised key hierarchy, so setup_get_state
//     reports completed=false and the gate self-routes to the first-run wizard.
//     We assert the app chose #/setup WITHOUT navigating, then run the REAL
//     first-run wizard to PROVISION this same data dir (initialises the key
//     hierarchy + sets the PIN) so phase B can relaunch against it.
//
//   PHASE B — provisioned + locked data dir relaunch -> #/lock (SET-004):
//     the executor relaunches the app with XDG_DATA_HOME pointing at the data
//     dir phase A provisioned. A fresh process starts LOCKED
//     (hc-app/state.rs: "Fresh process starts locked until setup completes or
//     the user [unlocks]") and setup_get_state reports completed=true (key
//     hierarchy is initialised on disk), so the gate self-routes to the lock
//     screen. We assert the app chose #/lock WITHOUT navigating — the real
//     SET-004 "reopen -> unlock with PIN" launch path.
import { expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { setupPage } from '../../pages/setup.page.js';

const PIN = '4321';

describe('R1 boot-gate PHASE A: fresh install launches into the wizard (SET-001)', () => {
  it('auto-routes a fresh data dir to #/setup on launch with no forced navigation, then provisions the install', async () => {
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

    // Provision THIS data dir with the real first-run wizard so phase B can
    // relaunch a "completed + locked" install against it. The wizard is already
    // on screen (the app put us here); run it through the real typed commands.
    await expect(setupPage.wizard).toBeDisplayed();
    await setupPage.fillDoctorAndNext();
    await setupPage.fillClinicAndNext();
    const recoveryCode = await setupPage.setPinAndRevealRecovery(PIN);
    expect(recoveryCode.length).toBeGreaterThan(0);
    await setupPage.ackRecoveryAndNext();
    await expect(setupPage.licenceDevTrial).toBeDisplayed();
    await setupPage.finishSetup();

    // After finish the app is unlocked on Today; the key hierarchy is now
    // initialised on disk in this data dir (completed=true persists).
    await expect(bootPage.todayScreen).toBeDisplayed();
  });
});

describe('R1 boot-gate PHASE B: reopening a provisioned install launches into lock (SET-004)', () => {
  it('auto-routes a provisioned + locked data dir to #/lock on relaunch with no forced navigation', async () => {
    // This phase is a SEPARATE app launch whose XDG_DATA_HOME is the data dir
    // phase A provisioned. A fresh process starts locked; setup is completed.
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
