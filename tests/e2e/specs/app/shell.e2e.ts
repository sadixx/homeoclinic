// @req NFR-030 NFR-032
// @tier regression
// @area settings
// @targets linux, windows
//
// R0 walking-skeleton demo (docs/milestones/README.md), network disabled.
// Verifies the three gated steps against the built shell:
//   1. App launches and the shell renders; nav shows Today, Patients, Settings.
//   2. Today shows its empty state.
//   3. F2 focuses the global search box.
//
// BOOT-GATE NOTE (commit e1cd2cb): since R1 the launch boot-gate auto-routes a
// FRESH/unprovisioned data dir to #/setup, not straight to the shell. The R0
// demo's "app shell renders" step is therefore reached by first completing the
// real first-run wizard (which ends unlocked on Today inside the app-shell) —
// the same way a doctor reaches Today on a real first launch. This keeps the R0
// demo gate (shell + nav + Today empty + F2 search) honest against the way the
// app actually launches now, instead of assuming a cold launch lands on the
// shell. The shell/Today/nav markup itself is unchanged from R0.
//
// Opening-time < 4 s (NFR aspiration) is observed and logged but, per the
// round brief, a slow cold start in a debug build under xvfb is NOT a blocking
// fail here; app-opens/renders is the gate.
import { expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { setupPage } from '../../pages/setup.page.js';
import { shellPage } from '../../pages/shell.page.js';

const PIN = '2468';

describe('R0 walking skeleton: app shell renders', () => {
  it('opens the app, renders shell + nav, shows Today empty state, F2 focuses search', async () => {
    const t0 = Date.now();

    // The boot-gate self-routes a fresh data dir to the wizard (R1+); reach the
    // shell the way the app launches now by completing the real first-run
    // wizard, which ends unlocked on Today inside the app-shell.
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await expect(setupPage.wizard).toBeDisplayed();
    await setupPage.fillDoctorAndNext();
    await setupPage.fillClinicAndNext();
    const recoveryCode = await setupPage.setPinAndRevealRecovery(PIN);
    expect(recoveryCode.length).toBeGreaterThan(0);
    await setupPage.ackRecoveryAndNext();
    await expect(setupPage.licenceDevTrial).toBeDisplayed();
    await setupPage.finishSetup();

    // Step 1: shell renders (now on Today, unlocked).
    await shellPage.waitForShell();
    const openMs = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[R0] shell rendered in ${openMs} ms (NFR-030 cold-start aspiration < 4000 ms; non-blocking this round)`);

    await expect(shellPage.appShell).toBeDisplayed();
    await expect(shellPage.sideNav).toBeDisplayed();

    // Nav shows Today, Patients, Settings. The Today button also renders its
    // F3 shortcut hint inside the element, so assert the label is contained
    // rather than equal (containing matcher keeps the check label-driven
    // without coupling to the shortcut kbd).
    await expect(shellPage.navToday).toBeDisplayed();
    await expect(shellPage.navPatients).toBeDisplayed();
    await expect(shellPage.navSettings).toBeDisplayed();
    await expect(shellPage.navToday).toHaveText(expect.stringContaining('Today'));
    await expect(shellPage.navPatients).toHaveText(expect.stringContaining('Patients'));
    await expect(shellPage.navSettings).toHaveText(expect.stringContaining('Settings'));

    // Step 2: Today empty state.
    await expect(shellPage.todayScreen).toBeDisplayed();
    await expect(shellPage.todayEmpty).toBeDisplayed();

    // Step 3: F2 focuses the global search box.
    await expect(shellPage.search).toBeDisplayed();
    await shellPage.focusSearchWithF2();
    await expect(await shellPage.searchIsFocused()).toBe(true);
  });
});
