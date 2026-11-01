// Page object for window-size / layout checks (M3-RWv5 C fluid resize).
//
// Window sizing goes through WebDriver setWindowRect (honoured by the Tauri
// GTK window under X11). "Maximised" first tries WebDriver maximizeWindow;
// Xvfb has no window manager, so when that is a no-op the window is sized to
// the full X screen instead — the same geometry a WM maximise produces.
// Requires the app to run on X11 (GDK_BACKEND=x11), see the resize spec.
import { browser } from '@wdio/globals';

import { screenSize } from '../helpers/x11.js';

export interface LayoutMetrics {
  innerWidth: number;
  innerHeight: number;
  /** document.scrollingElement.scrollWidth - innerWidth (>0 = page scrolls sideways). */
  docOverflowX: number;
  /** Visible data-testid elements whose box crosses the left/right viewport edge. */
  clipped: { testId: string; left: number; right: number }[];
  /** Containers (overflow-x hidden/clip) whose content is wider than their box. */
  hiddenOverflow: { testId: string; scrollWidth: number; clientWidth: number }[];
}

export class LayoutPage {
  async inner(): Promise<{ w: number; h: number }> {
    return browser.execute(() => ({ w: window.innerWidth, h: window.innerHeight }));
  }

  /** Resize and wait until the webview reports the new inner width. */
  async setSize(width: number, height: number): Promise<{ w: number; h: number }> {
    const before = await this.inner();
    await browser.setWindowRect(0, 0, width, height);
    await browser
      .waitUntil(async () => (await this.inner()).w !== before.w || before.w === width, {
        timeout: 5000,
      })
      .catch(() => undefined); // clamped to the window minimum: size unchanged is valid
    return this.inner();
  }

  /** Maximise; falls back to the full X screen when there is no WM. */
  async maximise(): Promise<{ w: number; h: number; via: string }> {
    const before = await this.inner();
    await browser.maximizeWindow();
    const after = await this.inner();
    const scr = screenSize();
    if (after.w >= scr.width - 1 || (after.w > before.w && after.w >= scr.width * 0.95)) {
      return { ...after, via: 'maximizeWindow' };
    }
    const sized = await this.setSize(scr.width, scr.height);
    return { ...sized, via: `setWindowRect(screen ${scr.width}x${scr.height}; no WM)` };
  }

  async measure(): Promise<LayoutMetrics> {
    return browser.execute(() => {
      const vw = window.innerWidth;
      const se = document.scrollingElement ?? document.documentElement;
      const clipped: { testId: string; left: number; right: number }[] = [];
      const hiddenOverflow: { testId: string; scrollWidth: number; clientWidth: number }[] = [];
      document.querySelectorAll('[data-testid]').forEach((n) => {
        const el = n as HTMLElement;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const cs = window.getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') return;
        // Skip visually-hidden (sr-only) inputs: 1px boxes clipped on purpose.
        if (r.width <= 1 && r.height <= 1) return;
        const testId = el.getAttribute('data-testid') ?? '';
        if (r.right > vw + 1 || r.left < -1) {
          clipped.push({ testId, left: Math.round(r.left), right: Math.round(r.right) });
        }
        if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 1) {
          hiddenOverflow.push({ testId, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
        }
      });
      return {
        innerWidth: vw,
        innerHeight: window.innerHeight,
        docOverflowX: se.scrollWidth - vw,
        clipped,
        hiddenOverflow,
      };
    });
  }

  /** Rendered width of the element with `testId` (0 when absent). */
  async widthOf(testId: string): Promise<number> {
    return browser.execute((id: string) => {
      const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      return el === null ? 0 : Math.round(el.getBoundingClientRect().width);
    }, testId);
  }
}

export const layoutPage = new LayoutPage();
