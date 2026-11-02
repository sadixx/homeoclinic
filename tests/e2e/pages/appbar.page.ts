// Page object for the shared app-bar (M3-RW Slice C; 00-conventions §3;
// apps/desktop/src/app/AppBar.tsx + useZoom.ts). The shell renders ONE app-bar
// with the common Back control and the zoom cluster; it is present on every
// shell screen (case / follow-up / dashboard / list / Today).
//
// hc-e2e-testing rule: data-testid selectors only; no sleeps — waitUntil only.
// Zoom scales the content root by driving `--hc-font-scale` on
// [data-testid="content-area"] (baseline 1, step 0.1, clamp 0.7..2).
import { $, browser } from "@wdio/globals";

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

export class AppBarPage {
  get bar(): ChainablePromiseElement {
    return byTestId("app-bar");
  }

  get backButton(): ChainablePromiseElement {
    return byTestId("app-bar-back");
  }

  get zoomInButton(): ChainablePromiseElement {
    return byTestId("app-bar-zoom-in");
  }

  get zoomOutButton(): ChainablePromiseElement {
    return byTestId("app-bar-zoom-out");
  }

  get zoomResetButton(): ChainablePromiseElement {
    return byTestId("app-bar-zoom-reset");
  }

  async waitForBar(timeout = 15000): Promise<void> {
    await this.bar.waitForDisplayed({ timeout });
  }

  /** Click the common Back control (walks one step up the parent chain). */
  async clickBack(timeout = 15000): Promise<void> {
    await this.backButton.waitForClickable({ timeout });
    await this.backButton.click();
  }

  async zoomIn(timeout = 15000): Promise<void> {
    await this.zoomInButton.waitForClickable({ timeout });
    await this.zoomInButton.click();
  }

  async zoomOut(timeout = 15000): Promise<void> {
    await this.zoomOutButton.waitForClickable({ timeout });
    await this.zoomOutButton.click();
  }

  async zoomReset(timeout = 15000): Promise<void> {
    await this.zoomResetButton.waitForClickable({ timeout });
    await this.zoomResetButton.click();
  }

  /**
   * The current content zoom scale, read from the `--hc-font-scale` CSS custom
   * property set on the content-area root by the shell (useZoom). Returns a
   * number (1 = baseline).
   */
  async scale(): Promise<number> {
    const raw = await browser.execute(() => {
      const el = document.querySelector('[data-testid="content-area"]');
      if (el === null) return "";
      return (el as HTMLElement).style.getPropertyValue("--hc-font-scale");
    });
    const n = Number(raw);
    return Number.isNaN(n) ? Number.NaN : n;
  }

  /** The current hash path (for Back parent-chain assertions). */
  async hash(): Promise<string> {
    return browser.execute(() => window.location.hash);
  }

  /** Wait until the hash matches a predicate (no sleep). */
  async waitForHash(
    pred: (hash: string) => boolean,
    timeout = 15000,
    msg = "hash did not reach the expected value",
  ): Promise<void> {
    await browser.waitUntil(async () => pred(await this.hash()), {
      timeout,
      timeoutMsg: msg,
    });
  }
}

export const appBarPage = new AppBarPage();
