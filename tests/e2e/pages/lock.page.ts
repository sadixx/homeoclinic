// Page object for the S02 lock / unlock screen (docs/ui/S02-lock-unlock.md).
// hc-e2e-testing rule: specs use page objects; selectors are data-testid only.
// No sleeps — all waits go through waitUntil / waitForDisplayed.
import { $, browser } from '@wdio/globals';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

/** Full-window lock overlay with PIN unlock (SUX-003/005). */
export class LockPage {
  get screen(): ChainablePromiseElement {
    return byTestId('lock-screen');
  }

  get card(): ChainablePromiseElement {
    return byTestId('lock-card');
  }

  get pin(): ChainablePromiseElement {
    return byTestId('lock-pin');
  }

  get unlock(): ChainablePromiseElement {
    return byTestId('lock-unlock');
  }

  get error(): ChainablePromiseElement {
    return byTestId('lock-error');
  }

  /**
   * Navigate to the lock route and wait for the unlock card. HashRouter is
   * driven in-page via location.hash (browser.url rejects a bare "#/lock").
   */
  async open(timeout = 20000): Promise<void> {
    await browser.execute(() => {
      window.location.hash = '#/lock';
    });
    await this.screen.waitForExist({ timeout });
    await this.card.waitForDisplayed({ timeout });
  }

  /**
   * Type a PIN and press Unlock. The PIN input is React-controlled and Unlock
   * is disabled while it is empty (LockScreen.tsx), so the click waits until
   * the field holds the whole PIN and Unlock is enabled: a click before that
   * would never reach auth_unlock (build-6 round-4 saw one unlock that never
   * opened the DB). Callers still wait for the shell or the error themselves.
   */
  async attempt(pin: string): Promise<void> {
    await this.pin.waitForDisplayed({ timeout: 10000 });
    await this.pin.setValue(pin);
    await browser.waitUntil(
      async () => (await this.pin.getValue()) === pin && (await this.unlock.isEnabled()),
      { timeout: 10000, timeoutMsg: 'lock: the PIN field did not hold the PIN with Unlock enabled' },
    );
    await this.unlock.click();
  }

  /** True once the inline wrong-PIN error is shown. */
  async waitForError(timeout = 10000): Promise<void> {
    await this.error.waitForDisplayed({ timeout });
  }
}

export const lockPage = new LockPage();
