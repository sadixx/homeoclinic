// @req NFR-030 NFR-032
// @tier regression
// @area settings
// @targets linux
//
// R0 walking-skeleton demo (docs/milestones/README.md), network disabled.
// Verifies the three gated steps against the built M0 shell:
//   1. App launches and the shell renders; nav shows Today, Patients, Settings.
//   2. Today shows its empty state.
//   3. F2 focuses the global search box.
//
// Opening-time < 4 s (NFR aspiration) is observed and logged but, per the
// round brief, a slow cold start in a debug build under xvfb is NOT a blocking
// fail here; app-opens/renders is the gate.
import { expect } from '@wdio/globals';

import { shellPage } from '../../pages/shell.page.js';

describe('R0 walking skeleton: app shell renders', () => {
  it('opens the app, renders shell + nav, shows Today empty state, F2 focuses search', async () => {
    const t0 = Date.now();

    // Step 1: shell renders.
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
