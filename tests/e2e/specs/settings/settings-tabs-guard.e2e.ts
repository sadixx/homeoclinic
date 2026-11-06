// @req SET-001 SET-002 LIC-006
// @tier regression
// @area settings
// @targets linux, windows
//
// MS (S18 Settings) route guard + tab bar.
//
//   PHASE A — fresh install: a deep link to #/settings BEFORE setup is
//     completed is bounced to #/setup by the completion route-guard (Settings
//     lives inside ShellFrame, so ShellRoute covers it). The nav item is not
//     reachable either: the wizard renders outside the shell.
//   PHASE B — after the first-run wizard: nav-settings opens S18 on the
//     General tab; every later tab (templates, advice, print, recycle, audit,
//     maintenance) is aria-disabled with the "Available in a later update"
//     hint and activating it (click, Enter) keeps the General panel — no dead
//     end (R-DEL-002 exception A8). The trial (unlocked) identity note shows
//     (LIC-006: name / reg no editable until activation).
import { browser, expect } from '@wdio/globals';

import { evidence } from '../../helpers/evidence.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { bootPage } from '../../pages/boot.page.js';
import { LATER_TABS, settingsPage } from '../../pages/settings.page.js';
import { setupPage } from '../../pages/setup.page.js';

const LATER_HINT = 'Available in a later update';

describe('MS settings tabs-guard PHASE A: #/settings before setup bounces to the wizard (SET-001)', () => {
  it('MS guard: a fresh install deep-linked to #/settings lands on #/setup, not Settings', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');

    await settingsPage.openByHash();
    // The guard redirects synchronously on route change; wait for the wizard
    // to be the screen again and for the hash to settle on #/setup.
    await browser.waitUntil(
      async () => (await settingsPage.hash()).startsWith('#/setup'),
      { timeout: 10000, timeoutMsg: '#/settings before setup was not redirected to #/setup' },
    );
    await expect(setupPage.wizard).toBeDisplayed();
    expect(await settingsPage.screen.isExisting()).toBe(false);
    expect(await settingsPage.navSettings.isExisting()).toBe(false);
    evidence('[ms-guard] PHASE A fresh install: #/settings -> #/setup, settings-screen absent, nav-settings absent');
  });
});

describe('MS settings tabs-guard PHASE B: after setup Settings opens on General and later tabs are disabled (SET-002, LIC-006)', () => {
  it('MS tabs: nav-settings opens General; the six later tabs are aria-disabled with the hint and never open a panel', async () => {
    await setupPage.open();
    await provisionAndEnterApp('main');

    await settingsPage.openViaNav();
    expect(await settingsPage.hash()).toBe('#/settings');
    await expect(settingsPage.tab('general')).toHaveAttribute('aria-selected', 'true');

    for (const id of LATER_TABS) {
      const tab = settingsPage.tab(id);
      await expect(tab).toBeDisplayed();
      await expect(tab).toHaveAttribute('aria-disabled', 'true');
      await expect(tab).toHaveAttribute('aria-selected', 'false');
      expect(await tab.getAttribute('title')).toBe(LATER_HINT);
      expect((await settingsPage.tabHint(id).getProperty('textContent')) as string).toBe(LATER_HINT);

      // Activate it both ways; the General panel must stay, the tab stays
      // unselected, and the route does not change.
      await tab.click();
      await tab.click(); // a second click must still do nothing
      await browser.keys(['Enter']);
      await expect(settingsPage.general).toBeDisplayed();
      await expect(settingsPage.tab('general')).toHaveAttribute('aria-selected', 'true');
      await expect(tab).toHaveAttribute('aria-selected', 'false');
      expect(await settingsPage.hash()).toBe('#/settings');
      evidence(`[ms-tabs] later tab ${id}: aria-disabled=true, hint "${LATER_HINT}", click+Enter kept General`);
    }

    // Trial: identity editable, with the "will lock on activation" note.
    await expect(settingsPage.field('settings-doctor-identity-note')).toBeDisplayed();
    expect(await settingsPage.field('settings-doctor-identity-locked').isExisting()).toBe(false);
    expect(await settingsPage.field('settings-doctor-name').getAttribute('readonly')).toBeNull();
    await expect(settingsPage.field('settings-doctor-signature')).toBeDisabled();
    evidence('[ms-tabs] trial identity note shown, name editable, signature button disabled (coming later)');
  });
});
