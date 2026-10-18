// Page object for the launch BOOT-GATE (AppShell.tsx; SET-001, SET-004).
// hc-e2e-testing rule: specs use page objects; selectors are data-testid only.
// No sleeps — all waits go through waitUntil / waitForDisplayed.
//
// WHAT MAKES THIS DIFFERENT FROM setup.page / lock.page:
// Those page objects DRIVE the route by executing `window.location.hash =
// '#/setup' | '#/lock'` in-page (forced navigation). This page object does the
// OPPOSITE: it NEVER sets the hash. It only observes the route the APP chose on
// its own at launch. That is the whole point of the boot-gate proof — on a cold
// launch the hash starts empty and AppShell's BootRouter seeds it itself
// (#/setup / #/lock / #/today) after reading setup_get_state +
// auth_get_lock_state. Reading window.location.hash right after load, before any
// navigation, captures the app's self-chosen launch route.
import { $, browser } from '@wdio/globals';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

/** The launch routes the boot-gate can choose. */
export type LaunchRoute = '#/setup' | '#/lock' | '#/today';

export class BootPage {
  /** The app-boot splash shown while the two boot reads are in flight. */
  get splash(): ChainablePromiseElement {
    return byTestId('app-boot');
  }

  get setupWizard(): ChainablePromiseElement {
    return byTestId('setup-wizard');
  }

  get lockCard(): ChainablePromiseElement {
    return byTestId('lock-card');
  }

  get todayScreen(): ChainablePromiseElement {
    return byTestId('today-screen');
  }

  /**
   * Read the app's self-chosen launch hash. NEVER sets the hash; this is a pure
   * observation of what AppShell's BootRouter seeded on launch.
   */
  async launchHash(): Promise<string> {
    return browser.execute(() => window.location.hash);
  }

  /**
   * Wait until the boot-gate has settled on a decided screen WITHOUT any
   * spec-side navigation. We wait for the app-boot splash to be gone and for
   * exactly one of the three decided screens to be displayed. Returns which
   * decided route is live, read from the DOM (not from any hash we set).
   */
  async waitForDecidedScreen(timeout = 30000): Promise<LaunchRoute> {
    // First let the splash disappear (the decision has been made). The splash
    // may already be gone by the time we poll; that is fine.
    await browser.waitUntil(
      async () => {
        const splashGone = !(await this.splash.isExisting());
        const onSetup = await this.setupWizard.isExisting();
        const onLock = await this.lockCard.isExisting();
        const onToday = await this.todayScreen.isExisting();
        return splashGone && (onSetup || onLock || onToday);
      },
      {
        timeout,
        timeoutMsg:
          'boot-gate did not settle on a decided screen (setup/lock/today) ' +
          'within timeout',
      },
    );
    if (await this.setupWizard.isDisplayed()) {
      return '#/setup';
    }
    if (await this.lockCard.isDisplayed()) {
      return '#/lock';
    }
    return '#/today';
  }
}

export const bootPage = new BootPage();
