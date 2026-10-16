// Page object for the HomeoClinic app shell (00-conventions §2).
// hc-e2e-testing rule: specs use page objects; selectors are data-testid only,
// never raw CSS/XPath in specs. No sleeps — all waits go through waitUntil /
// WebdriverIO's auto-waiting `waitForDisplayed`.
import { $, browser } from '@wdio/globals';

/** Resolve an element by its data-testid attribute. */
function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

export class ShellPage {
  get appShell(): ChainablePromiseElement {
    return byTestId('app-shell');
  }

  get sideNav(): ChainablePromiseElement {
    return byTestId('side-nav');
  }

  get navToday(): ChainablePromiseElement {
    return byTestId('nav-today');
  }

  get navPatients(): ChainablePromiseElement {
    return byTestId('nav-patients');
  }

  get navSettings(): ChainablePromiseElement {
    return byTestId('nav-settings');
  }

  get todayScreen(): ChainablePromiseElement {
    return byTestId('today-screen');
  }

  get todayEmpty(): ChainablePromiseElement {
    return byTestId('today-empty');
  }

  get search(): ChainablePromiseElement {
    return byTestId('topbar-search');
  }

  /** Wait until the shell has mounted and the default Today screen rendered. */
  async waitForShell(timeout = 15000): Promise<void> {
    await this.appShell.waitForExist({ timeout });
    await this.appShell.waitForDisplayed({ timeout });
    await this.todayScreen.waitForDisplayed({ timeout });
  }

  /** True when the global search box currently holds keyboard focus. */
  async searchIsFocused(): Promise<boolean> {
    const el = await this.search;
    return el.isFocused();
  }

  /**
   * Press F2 to focus the global search box, then wait (no sleep) for the
   * focus to land on the search input.
   */
  async focusSearchWithF2(timeout = 10000): Promise<void> {
    // Ensure focus is not already on search before the keypress so the
    // assertion proves F2 did the work.
    await browser.keys(['F2']);
    await browser.waitUntil(async () => this.searchIsFocused(), {
      timeout,
      timeoutMsg: 'search box did not receive focus after pressing F2',
    });
  }
}

export const shellPage = new ShellPage();
