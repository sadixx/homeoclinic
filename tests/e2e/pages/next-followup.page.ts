// Page object for the S08 case-header Next follow-up scheduler + the case-form
// keyboard shortcuts added in HC-MVP1-M3vis (docs/ui/S08-case-form.md:
// VIS-004 control, F5 resolution, Ctrl/Cmd+S force-save).
//
// hc-e2e-testing rules honoured: data-testid selectors only (case-form-next-*,
// case-form-save-status), no sleeps (every wait is waitUntil with a timeout),
// TEST-ONLY observers are pass-through (they never change what the app sends).
//
// Test-only instruments (all live in the webview, never in production code):
//  - IPC spy: wraps the global fetch / window.ipc.postMessage the Tauri 2 IPC
//    transport uses (same technique as setup.page installIpcSpy) and records
//    only the command name + parsed body of the commands asked for.
//  - Save-status recorder: a MutationObserver on case-form-save-status that
//    keeps every distinct text it shows, so a fast Saving… -> Saved flip is
//    still observed (the flip can be quicker than a WebDriver poll).
//  - Webview test clock: shifts ONLY argument-less `new Date()` by N days.
//    The Today screen anchors today_get_overview on todayIsoDate() (= new
//    Date()), so a +N-day shift makes a saved follow-up date lie in the past
//    for the overview without writing a past date. Date.now(), timers and
//    `new Date(x)` are untouched (idle auto-lock is unaffected). Restored by
//    restoreClock() or by any relaunch.
import { $, browser } from '@wdio/globals';
import { Key } from 'webdriverio';

import { appMainWindow, typeKeysyms } from '../helpers/x11.js';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

export type QuickId = '7d' | '15d' | '1m' | '2m';

export interface SpiedCall {
  cmd: string;
  args: unknown;
}

export interface HeaderFit {
  innerWidth: number;
  innerHeight: number;
  docOverflowX: number;
  headerScrollW: number;
  headerClientW: number;
  /** Header controls whose box crosses the right/left viewport edge. */
  outside: string[];
  /** Bounding boxes of the header controls (for the evidence log). */
  boxes: Record<string, { left: number; right: number; top: number; bottom: number }>;
}

export class NextFollowupPage {
  get display(): ChainablePromiseElement {
    return byTestId('case-form-next-followup');
  }

  get group(): ChainablePromiseElement {
    return byTestId('case-form-next-group');
  }

  get custom(): ChainablePromiseElement {
    return byTestId('case-form-next-custom');
  }

  get customLabel(): ChainablePromiseElement {
    return byTestId('case-form-next-custom-label');
  }

  get clearButton(): ChainablePromiseElement {
    return byTestId('case-form-next-clear');
  }

  get error(): ChainablePromiseElement {
    return byTestId('case-form-next-error');
  }

  quick(id: QuickId): ChainablePromiseElement {
    return byTestId(`case-form-next-${id}`);
  }

  async displayText(): Promise<string> {
    await this.display.waitForExist({ timeout: 15000 });
    return (await this.display.getText()).trim();
  }

  /** Wait until the header display reads exactly `text`. */
  async waitDisplay(text: string, what: string, timeout = 15000): Promise<void> {
    await browser
      .waitUntil(async () => (await this.displayText()) === text, { timeout, interval: 100 })
      .catch(async () => {
        throw new Error(`${what}: header shows ${JSON.stringify(await this.displayText())}, want ${JSON.stringify(text)}`);
      });
  }

  /**
   * Bounded NEGATIVE wait (no sleep): true when the header still shows `text`
   * for the whole `ms` window, false as soon as it changes.
   */
  async displayStays(text: string, ms: number): Promise<boolean> {
    try {
      await browser.waitUntil(async () => (await this.displayText()) !== text, { timeout: ms, interval: 100 });
      return false;
    } catch {
      return true;
    }
  }

  /** Click a quick button by its testid (real WebDriver click). */
  async clickQuick(id: QuickId, timeout = 15000): Promise<string> {
    const b = this.quick(id);
    await b.waitForClickable({ timeout });
    const text = (await b.getText()).trim();
    await b.click();
    return text;
  }

  async clickClear(timeout = 15000): Promise<void> {
    await this.clearButton.waitForClickable({ timeout });
    await this.clearButton.click();
  }

  /**
   * Set the custom date input to `iso` (YYYY-MM-DD) the way a native calendar
   * pick does: the native value setter + input/change events (WebKitWebDriver
   * setValue mangles <input type=date>, see followup.page). The production
   * onChange then runs its own validation. Nothing is saved until the field
   * is left (blurCustomByClickingHeader) or Enter is pressed: the control
   * commits a custom date on blur / Enter only.
   */
  async setCustom(iso: string): Promise<void> {
    await this.custom.waitForDisplayed({ timeout: 15000 });
    await browser.execute((date: string) => {
      const el = document.querySelector('[data-testid="case-form-next-custom"]') as HTMLInputElement | null;
      if (el === null) throw new Error('case-form-next-custom not found');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, date);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, iso);
    await browser.waitUntil(async () => (await this.custom.getValue()) === iso, {
      timeout: 10000,
      timeoutMsg: `custom follow-up date did not become ${iso}`,
    });
  }

  /** True when the custom date input has keyboard focus. */
  async customFocused(): Promise<boolean> {
    return browser.execute(
      () => document.activeElement === document.querySelector('[data-testid="case-form-next-custom"]'),
    );
  }

  /** Give the custom date input focus (as a calendar pick leaves it focused). */
  async focusCustom(): Promise<void> {
    await this.custom.waitForDisplayed({ timeout: 15000 });
    await browser.execute(() => {
      (document.querySelector('[data-testid="case-form-next-custom"]') as HTMLInputElement | null)?.focus();
    });
    await browser.waitUntil(async () => this.customFocused(), { timeout: 10000, timeoutMsg: 'custom date input did not take focus' });
  }

  /**
   * Leave the custom field with a REAL click on the (non-focusable) header
   * display, the way a doctor clicks elsewhere after picking a date.
   */
  async blurCustomByClickingHeader(): Promise<void> {
    await this.display.click();
    await browser.waitUntil(async () => !(await this.customFocused()), {
      timeout: 10000,
      timeoutMsg: 'custom date input kept focus after clicking the header',
    });
  }

  /**
   * REAL keyboard typing into the focused custom date input: XTest key
   * presses into the app's X11 window (WebDriver key actions do not reach the
   * WebKitGTK date segments). `keysyms` are X keysym names, e.g. '1', 'slash'
   * (next segment), 'Left' (previous segment), 'Tab'.
   */
  async typeIntoCustom(keysyms: string[]): Promise<void> {
    const w = appMainWindow('HomeoClinic');
    if (w === null) throw new Error('app main X11 window "HomeoClinic" not found for XTest typing');
    typeKeysyms(w.id, keysyms);
  }

  /** The custom input's current value (YYYY-MM-DD, or '' while incomplete). */
  async customValue(): Promise<string> {
    return browser.execute(
      () => (document.querySelector('[data-testid="case-form-next-custom"]') as HTMLInputElement | null)?.value ?? '',
    );
  }

  /**
   * Two quick buttons clicked in the SAME task (no await between them): the
   * second click is guaranteed to land while the first command is in flight.
   * Each is a full mousedown/mouseup/click sequence on the real button.
   */
  async clickQuickPairSameTick(first: QuickId, second: QuickId): Promise<void> {
    await this.quick(first).waitForClickable({ timeout: 15000 });
    await browser.execute(
      (a: string, b: string) => {
        for (const id of [a, b]) {
          const el = document.querySelector(`[data-testid="case-form-next-${id}"]`) as HTMLButtonElement | null;
          if (el === null) throw new Error(`quick button ${id} not found`);
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          el.click();
        }
      },
      first,
      second,
    );
  }

  /** Wait for the inline error and return its text + the input's aria state. */
  async waitError(timeout = 10000): Promise<{ text: string; role: string | null; invalid: string | null }> {
    await this.error.waitForDisplayed({ timeout });
    return {
      text: (await this.error.getText()).trim(),
      role: await this.error.getAttribute('role'),
      invalid: await this.custom.getAttribute('aria-invalid'),
    };
  }

  /** The visible "Custom date" label: text + displayed + it wraps the input. */
  async customLabelInfo(): Promise<{ text: string; displayed: boolean; wrapsInput: boolean }> {
    await this.customLabel.waitForExist({ timeout: 15000 });
    const wrapsInput = await browser.execute(() => {
      const span = document.querySelector('[data-testid="case-form-next-custom-label"]');
      const input = document.querySelector('[data-testid="case-form-next-custom"]');
      const label = span?.closest('label') ?? null;
      return label !== null && input !== null && label.contains(input);
    });
    return {
      text: (await this.customLabel.getText()).trim(),
      displayed: await this.customLabel.isDisplayed(),
      wrapsInput,
    };
  }

  // ---- read-back through the typed command --------------------------------
  /**
   * The saved next follow-up of the patient's open visit of `visitType`, read
   * via case_visit_open_or_create (it returns nextFollowupOn, CaseForm.tsx).
   * Call only for a visit type that already exists (it would create one).
   */
  async savedNextFollowup(
    patientId: string,
    visitType: 'first' | 'follow_up',
  ): Promise<{ visitId: string; nextFollowupOn: string | null }> {
    const res = (await browser.executeAsync(
      (pid: string, vt: string, done: (v: unknown) => void) => {
        const internals = (
          window as unknown as {
            __TAURI_INTERNALS__?: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
          }
        ).__TAURI_INTERNALS__;
        if (internals === undefined) {
          done({ status: 'error', error: { message: 'no __TAURI_INTERNALS__' } });
          return;
        }
        internals
          .invoke('case_visit_open_or_create', { req: { patientId: pid, visitType: vt } })
          .then((v) => done(v))
          .catch((e) => done({ status: 'error', error: { message: String(e) } }));
      },
      patientId,
      visitType,
    )) as
      | { status: 'ok'; data: { visitId: string; nextFollowupOn: string | null } }
      | { visitId: string; nextFollowupOn: string | null }
      | { status: 'error'; error: { message?: string } };
    if ('status' in res) {
      if (res.status !== 'ok') throw new Error(`case_visit_open_or_create failed: ${res.error.message ?? ''}`);
      return { visitId: res.data.visitId, nextFollowupOn: res.data.nextFollowupOn ?? null };
    }
    return { visitId: res.visitId, nextFollowupOn: res.nextFollowupOn ?? null };
  }

  // ---- IPC spy -------------------------------------------------------------
  /** Install (once per page load) a pass-through spy for the named commands. */
  async installIpcSpy(cmds: string[]): Promise<void> {
    const ok = await browser.execute((wanted: string[]) => {
      const w = window as unknown as {
        __hcNfSpy?: boolean;
        __HC_E2E_NF_IPC__?: { cmd: string; args: unknown }[];
        __HC_E2E_NF_WANT__?: string[];
        ipc?: { postMessage?: (m: string) => void };
      };
      w.__HC_E2E_NF_WANT__ = wanted;
      if (w.__hcNfSpy === true) return true;
      w.__HC_E2E_NF_IPC__ = [];
      const record = (cmd: string, body: unknown): void => {
        if (!(w.__HC_E2E_NF_WANT__ ?? []).includes(cmd)) return;
        let args: unknown = null;
        try {
          args = typeof body === 'string' ? JSON.parse(body) : null;
        } catch {
          args = null;
        }
        w.__HC_E2E_NF_IPC__?.push({ cmd, args });
      };
      const realFetch = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith('ipc:') || url.includes('ipc.localhost')) {
          record(decodeURIComponent(url.split('/').pop() ?? ''), init?.body);
        }
        return realFetch(input, init);
      };
      const ipc = w.ipc;
      if (ipc !== undefined && typeof ipc.postMessage === 'function') {
        const realPost = ipc.postMessage.bind(ipc);
        try {
          ipc.postMessage = (m: string) => {
            try {
              const msg = JSON.parse(m) as { cmd?: string; payload?: unknown };
              record(msg.cmd ?? '', JSON.stringify(msg.payload ?? null));
            } catch {
              /* not JSON: ignore */
            }
            realPost(m);
          };
        } catch {
          /* read-only: the fetch path is still observed */
        }
      }
      w.__hcNfSpy = true;
      return window.fetch !== realFetch;
    }, cmds);
    if (ok !== true) throw new Error('could not install the M3vis IPC spy (window.fetch not wrappable)');
  }

  async spiedCalls(cmd: string): Promise<SpiedCall[]> {
    return browser.execute((c: string) => {
      const w = window as unknown as { __HC_E2E_NF_IPC__?: { cmd: string; args: unknown }[] };
      return (w.__HC_E2E_NF_IPC__ ?? []).filter((x) => x.cmd === c);
    }, cmd) as Promise<SpiedCall[]>;
  }

  /** Wait until exactly `n` calls of `cmd` have been spied. */
  async waitCalls(cmd: string, n: number, what: string, timeout = 15000): Promise<SpiedCall[]> {
    await browser
      .waitUntil(async () => (await this.spiedCalls(cmd)).length >= n, { timeout, interval: 100 })
      .catch(async () => {
        throw new Error(`${what}: ${cmd} calls=${(await this.spiedCalls(cmd)).length}, want ${n}`);
      });
    return this.spiedCalls(cmd);
  }

  // ---- save-status recorder -------------------------------------------------
  /** Start recording every distinct text of case-form-save-status. */
  async startStatusRecorder(): Promise<void> {
    const ok = await browser.execute(() => {
      const w = window as unknown as { __hcStatusObs?: MutationObserver; __HC_E2E_STATUS__?: string[] };
      w.__hcStatusObs?.disconnect();
      const el = document.querySelector('[data-testid="case-form-save-status"]');
      if (el === null) return false;
      const seen: string[] = [(el.textContent ?? '').trim()];
      w.__HC_E2E_STATUS__ = seen;
      const obs = new MutationObserver(() => {
        const now = document.querySelector('[data-testid="case-form-save-status"]');
        const txt = (now?.textContent ?? '').trim();
        if (seen[seen.length - 1] !== txt) seen.push(txt);
      });
      // The indicator node may be replaced on a status change: watch its parent.
      obs.observe(el.parentElement ?? el, { subtree: true, childList: true, characterData: true });
      w.__hcStatusObs = obs;
      return true;
    });
    if (ok !== true) throw new Error('case-form-save-status not found to record');
  }

  async recordedStatus(): Promise<string[]> {
    return browser.execute(() => {
      const w = window as unknown as { __HC_E2E_STATUS__?: string[] };
      return [...(w.__HC_E2E_STATUS__ ?? [])];
    });
  }

  /**
   * Wait until the recorder saw "Saving…" and, AFTER it, a "Saved hh:mm"
   * that is the current text. Returns the recorded sequence.
   */
  async waitSavingThenSaved(what: string, timeout = 15000): Promise<string[]> {
    const ok = (s: string[]): boolean => {
      const i = s.findIndex((x) => x.startsWith('Saving'));
      return i >= 0 && s.slice(i + 1).some((x) => /^Saved \S+/.test(x)) && /^Saved \S+/.test(s[s.length - 1] ?? '');
    };
    await browser
      .waitUntil(async () => ok(await this.recordedStatus()), { timeout, interval: 50 })
      .catch(async () => {
        throw new Error(`${what}: status sequence ${JSON.stringify(await this.recordedStatus())} lacks Saving… then Saved`);
      });
    return this.recordedStatus();
  }

  // ---- keys ------------------------------------------------------------------
  /** The REAL Ctrl+S chord via WebDriver key actions. */
  async pressCtrlS(): Promise<void> {
    await browser.action('key').down(Key.Ctrl).down('s').up('s').up(Key.Ctrl).perform();
  }

  /** A real F5 key press. */
  async pressF5(): Promise<void> {
    await browser.action('key').down(Key.F5).up(Key.F5).perform();
  }

  // ---- webview test clock ----------------------------------------------------
  /** Shift argument-less `new Date()` by `days` (see file header). */
  async shiftClockDays(days: number): Promise<string> {
    return browser.execute((d: number) => {
      const w = window as unknown as { __hcRealDate?: DateConstructor; Date: DateConstructor };
      const Real = w.__hcRealDate ?? w.Date;
      w.__hcRealDate = Real;
      const offset = d * 24 * 60 * 60 * 1000;
      class ShiftedDate extends Real {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(Real.now() + offset);
          else super(...(args as [string | number | Date]));
        }
      }
      w.Date = ShiftedDate as unknown as DateConstructor;
      const t = new w.Date();
      const p = (n: number): string => n.toString().padStart(2, '0');
      return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
    }, days);
  }

  async restoreClock(): Promise<void> {
    await browser.execute(() => {
      const w = window as unknown as { __hcRealDate?: DateConstructor; Date: DateConstructor };
      if (w.__hcRealDate !== undefined) w.Date = w.__hcRealDate;
    });
  }

  // ---- layout ----------------------------------------------------------------
  /** Header fit: no horizontal overflow, every header control inside the viewport. */
  async headerFit(): Promise<HeaderFit> {
    return browser.execute(() => {
      const vw = window.innerWidth;
      const se = document.scrollingElement ?? document.documentElement;
      const header = document.querySelector('[data-testid="case-form-next-group"]')?.closest('header') ?? null;
      const ids = [
        'case-form-back',
        'case-form-next-followup',
        'case-form-next-7d',
        'case-form-next-15d',
        'case-form-next-1m',
        'case-form-next-2m',
        'case-form-next-custom-label',
        'case-form-next-custom',
        'case-form-next-clear',
        'case-form-zoom-out',
        'case-form-zoom-in',
        'case-form-save',
        'case-form-save-status',
      ];
      const outside: string[] = [];
      const boxes: Record<string, { left: number; right: number; top: number; bottom: number }> = {};
      for (const id of ids) {
        const el = document.querySelector(`[data-testid="${id}"]`);
        if (el === null) continue;
        const r = el.getBoundingClientRect();
        boxes[id] = { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
        if (r.width > 0 && (r.left < -0.5 || r.right > vw + 0.5)) outside.push(id);
      }
      return {
        innerWidth: vw,
        innerHeight: window.innerHeight,
        docOverflowX: se.scrollWidth - vw,
        headerScrollW: header?.scrollWidth ?? -1,
        headerClientW: header?.clientWidth ?? -1,
        outside,
        boxes,
      };
    });
  }

  /** Screenshot just the case header to `file`. */
  async screenshotHeader(file: string): Promise<void> {
    const header = await browser.execute(() => {
      const h = document.querySelector('[data-testid="case-form-next-group"]')?.closest('header');
      if (h === null || h === undefined) return false;
      h.setAttribute('data-hc-e2e-header', '1');
      return true;
    });
    if (header !== true) throw new Error('case header not found to screenshot');
    await $('[data-hc-e2e-header="1"]').saveScreenshot(file);
  }
}

export const nextFollowupPage = new NextFollowupPage();
