// Page object for the S01 first-run setup wizard (docs/ui/S01-first-run-setup.md).
// hc-e2e-testing rule: specs use page objects; selectors are data-testid only,
// never raw CSS/XPath in specs. No sleeps — all waits go through waitUntil /
// WebdriverIO auto-waiting waitForDisplayed.
import { $, browser } from '@wdio/globals';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

/**
 * Council every shared-setup spec picks from the Step 1 dropdown. M3-RWv6
 * item 1: labels read '<State>: <Authority>' (no em dash).
 */
export const DEFAULT_COUNCIL_LABEL =
  'Maharashtra: Maharashtra Council of Homoeopathy';

/** One recorded setup IPC call (see SetupPage.installIpcSpy). */
export interface SpiedCall {
  cmd: string;
  args: { req?: Record<string, unknown> } | null;
}

/** Clinic timings session / edge / box part (M3-RWv6 item 3). */
export type TimingsSession = 'morning' | 'evening';
export type TimingsEdge = 'from' | 'to';

/** The four-step first-run wizard (SET-001..004, LIC-063 dev trial). */
export class SetupPage {
  get wizard(): ChainablePromiseElement {
    return byTestId('setup-wizard');
  }

  get stepIndicator(): ChainablePromiseElement {
    return byTestId('setup-step-indicator');
  }

  get next(): ChainablePromiseElement {
    return byTestId('setup-next');
  }

  get finish(): ChainablePromiseElement {
    return byTestId('setup-finish');
  }

  // Step 3 security / recovery.
  get recoveryCode(): ChainablePromiseElement {
    return byTestId('setup-recovery-code');
  }

  get recoveryPrint(): ChainablePromiseElement {
    return byTestId('setup-recovery-print');
  }

  get recoveryAck(): ChainablePromiseElement {
    return byTestId('setup-recovery-ack');
  }

  // Step 4 licence.
  get licenceDevTrial(): ChainablePromiseElement {
    // The "Development trial" heading panel on the licence step.
    return byTestId('setup-licence-choice');
  }

  /**
   * Navigate the app to the first-run wizard route and wait for it. The app
   * uses a HashRouter served from a tauri:// origin, so we drive the route by
   * setting location.hash in-page (browser.url rejects a bare "#/setup" as an
   * invalid URL) rather than reloading.
   */
  async open(timeout = 20000): Promise<void> {
    await browser.execute(() => {
      window.location.hash = '#/setup';
    });
    await this.wizard.waitForExist({ timeout });
    await this.wizard.waitForDisplayed({ timeout });
  }

  private async setField(testid: string, value: string): Promise<void> {
    const el = byTestId(testid);
    await el.waitForDisplayed({ timeout: 10000 });
    await el.setValue(value);
  }

  get back(): ChainablePromiseElement {
    return byTestId('setup-back');
  }

  // Step 1 registration council (HC-MVP1-M3set): a <select> of the verified
  // registering authorities + "Other (type manually)" revealing a text box.
  get council(): ChainablePromiseElement {
    return byTestId('setup-doctor-council');
  }

  get councilError(): ChainablePromiseElement {
    return byTestId('setup-doctor-council-error');
  }

  get councilOther(): ChainablePromiseElement {
    return byTestId('setup-doctor-council-other');
  }

  get councilOtherError(): ChainablePromiseElement {
    return byTestId('setup-doctor-council-other-error');
  }

  /**
   * Choose a council by its visible label. The current build renders a
   * <select>; an older build (the R1 binary driven by upgrade-path PHASE C)
   * still renders a free-text <input>, so type the label there instead.
   */
  async selectCouncil(label: string): Promise<void> {
    const el = this.council;
    await el.waitForDisplayed({ timeout: 10000 });
    if ((await el.getTagName()).toLowerCase() === 'select') {
      await el.selectByVisibleText(label);
      await browser.waitUntil(async () => (await el.getValue()) !== '', {
        timeout: 10000,
        timeoutMsg: `council option "${label}" was not selected`,
      });
    } else {
      await el.setValue(label);
    }
  }

  /** Visible texts of every council <option>, in DOM order (read via the testid'd select). */
  async councilOptionTexts(): Promise<string[]> {
    const el = await this.council;
    await el.waitForDisplayed({ timeout: 10000 });
    return browser.execute(
      (sel: HTMLSelectElement) =>
        Array.from(sel.options).map((o) => o.text),
      el as unknown as HTMLSelectElement,
    );
  }

  /** Current value of the council <select> ('' | listed label | '__other__'). */
  async councilValue(): Promise<string> {
    return this.council.getValue();
  }

  /** Type into the Other council text box (shown only when Other is chosen). */
  async typeCouncilOther(text: string): Promise<void> {
    await this.setField('setup-doctor-council-other', text);
  }

  /** Fill the non-council required step-1 fields with synthetic data. */
  async fillDoctorBasics(): Promise<void> {
    await this.setField('setup-doctor-name', 'Dr Aarti Rao');
    await this.setField('setup-doctor-qualification', 'BHMS');
    await this.setField('setup-doctor-regno', 'HMC-12345');
  }

  /** Press Next and wait until the step rail reports `step`. */
  async nextAndWaitForStep(step: number, what: string): Promise<void> {
    await this.next.click();
    await browser.waitUntil(
      async () => (await this.stepIndicator.getText()).includes(` ${step} `),
      { timeout: 10000, timeoutMsg: `did not advance to step ${step} (${what})` },
    );
  }

  /** Press Back and wait until the step rail reports `step`. */
  async backAndWaitForStep(step: number): Promise<void> {
    await this.back.click();
    await browser.waitUntil(
      async () => (await this.stepIndicator.getText()).includes(` ${step} `),
      { timeout: 10000, timeoutMsg: `did not go back to step ${step}` },
    );
  }

  /** Fill step 1 (doctor) and advance. */
  async fillDoctorAndNext(): Promise<void> {
    await this.fillDoctorBasics();
    await this.selectCouncil(DEFAULT_COUNCIL_LABEL);
    await this.nextAndWaitForStep(2, 'clinic');
  }

  /** Fill step 2 (clinic) and advance. */
  async fillClinicAndNext(): Promise<void> {
    await this.setField('setup-clinic-name', 'Rao Homoeo Clinic');
    await this.setField('setup-clinic-address', '12 MG Road, Pune 411001');
    await this.setField('setup-clinic-fee-first', '500');
    await this.setField('setup-clinic-fee-followup', '300');
    await this.next.click();
    await browser.waitUntil(
      async () => (await this.stepIndicator.getText()).includes(' 3 '),
      { timeout: 10000, timeoutMsg: 'did not advance to step 3 (security)' },
    );
  }

  /**
   * Step 3 phase 1: set + confirm the PIN and press Next, which reveals the
   * one-time recovery code (SET-004). Returns the revealed code text.
   */
  async setPinAndRevealRecovery(pin: string): Promise<string> {
    await this.setField('setup-pin', pin);
    await this.setField('setup-pin-confirm', pin);
    await this.next.click();
    await this.recoveryCode.waitForDisplayed({
      timeout: 10000,
    });
    const code = (await this.recoveryCode.getText()).trim();
    return code;
  }

  /** Step 3 phase 2: acknowledge the recovery code then advance to licence. */
  async ackRecoveryAndNext(): Promise<void> {
    await this.recoveryAck.click();
    await this.next.click();
    await browser.waitUntil(
      async () => (await this.stepIndicator.getText()).includes(' 4 '),
      { timeout: 10000, timeoutMsg: 'did not advance to step 4 (licence)' },
    );
  }

  // ---- M3-RWv6 item 2: phone asked once (Step 1) --------------------------
  /** Type the Step 1 doctor phone. */
  async setDoctorPhone(phone: string): Promise<void> {
    await this.setField('setup-doctor-phone', phone);
  }

  /**
   * data-testids of every phone-like control currently rendered in the
   * wizard (testid contains "phone", or an input of type tel). Step 2 must
   * report none.
   */
  async phoneControlIds(): Promise<string[]> {
    return browser.execute(() => {
      const root = document.querySelector('[data-testid="setup-wizard"]');
      if (root === null) return [] as string[];
      const out = new Set<string>();
      root.querySelectorAll('[data-testid*="phone"]').forEach((el) => {
        out.add(el.getAttribute('data-testid') ?? '');
      });
      root.querySelectorAll('input[type="tel"]').forEach((el) => {
        out.add(el.getAttribute('data-testid') ?? '(tel input without testid)');
      });
      return Array.from(out);
    });
  }

  /** Fill the Step 2 clinic fields (no phone: RWv6) WITHOUT pressing Next. */
  async fillClinicBasics(): Promise<void> {
    await this.setField('setup-clinic-name', 'Rao Homoeo Clinic');
    await this.setField('setup-clinic-address', '12 MG Road, Pune 411001');
    await this.setField('setup-clinic-fee-first', '500');
    await this.setField('setup-clinic-fee-followup', '300');
  }

  /** Visible text of the step rail (e.g. "Step 2 of 4"). */
  async stepText(): Promise<string> {
    return this.stepIndicator.getText();
  }

  /**
   * TEST-ONLY observer of the payload the UI sends to setup_save_* commands.
   * Tauri 2 defines __TAURI_INTERNALS__.invoke / ipc / postMessage as
   * non-writable, but its IPC transport calls the GLOBAL `fetch` at call time
   * (POST ipc://localhost/<cmd>, JSON body; tauri scripts/ipc-protocol.js),
   * falling back to `window.ipc.postMessage(json)`. Both are wrapped with a
   * PASS-THROUGH that records only the command name and the parsed JSON body
   * (never the headers, which carry the invoke key) into
   * window.__HC_E2E_IPC__. The real request is sent unchanged. Needed because
   * no command reads the staged clinic profile back.
   */
  async installIpcSpy(): Promise<void> {
    const ok = await browser.execute(() => {
      const w = window as unknown as {
        __hcSpy?: boolean;
        __HC_E2E_IPC__?: { cmd: string; args: unknown }[];
        ipc?: { postMessage?: (m: string) => void };
      };
      if (w.__hcSpy === true) return true;
      w.__HC_E2E_IPC__ = [];
      const record = (cmd: string, body: unknown): void => {
        if (!cmd.startsWith('setup_save_')) return;
        let args: unknown = null;
        try {
          args = typeof body === 'string' ? JSON.parse(body) : null;
        } catch {
          args = null;
        }
        w.__HC_E2E_IPC__?.push({ cmd, args });
      };
      const realFetch = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith('ipc:') || url.includes('ipc.localhost')) {
          const cmd = decodeURIComponent(url.split('/').pop() ?? '');
          record(cmd, init?.body);
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
          /* read-only: fetch path still observed */
        }
      }
      w.__hcSpy = true;
      return window.fetch !== realFetch;
    });
    if (ok !== true) throw new Error('could not install the setup IPC spy (window.fetch not wrappable)');
  }

  /** Every spied call of `cmd`, oldest first. */
  async spiedCalls(cmd: string): Promise<SpiedCall[]> {
    return browser.execute((c: string) => {
      const w = window as unknown as { __HC_E2E_IPC__?: { cmd: string; args: unknown }[] };
      return (w.__HC_E2E_IPC__ ?? []).filter((x) => x.cmd === c);
    }, cmd) as Promise<SpiedCall[]>;
  }

  // ---- M3-RWv6 item 3: Morning / Evening clock boxes ----------------------
  timingsTab(session: TimingsSession): ChainablePromiseElement {
    return byTestId(`setup-clinic-timings-tab-${session}`);
  }

  timingsPanel(session: TimingsSession): ChainablePromiseElement {
    return byTestId(`setup-clinic-timings-panel-${session}`);
  }

  /** Bring a session tab forward (real click) and wait for its panel. */
  async selectTimingsTab(session: TimingsSession): Promise<void> {
    await this.timingsTab(session).waitForClickable({ timeout: 10000 });
    await this.timingsTab(session).click();
    await this.timingsPanel(session).waitForDisplayed({ timeout: 10000 });
  }

  /** Testid of one hour / minute box. */
  timingsBoxId(session: TimingsSession, edge: TimingsEdge, part: 'hour' | 'minute'): string {
    return `setup-clinic-timings-${session}-${edge}-${part}`;
  }

  /** Clear and type one hour / minute box (its tab must be in front). */
  async setTimingsBox(
    session: TimingsSession,
    edge: TimingsEdge,
    part: 'hour' | 'minute',
    value: string,
  ): Promise<void> {
    const el = byTestId(this.timingsBoxId(session, edge, part));
    await el.waitForDisplayed({ timeout: 10000 });
    await el.clearValue();
    if (value !== '') await el.setValue(value);
    await browser.waitUntil(async () => (await el.getValue()) === value, {
      timeout: 10000,
      timeoutMsg: `timings box ${session}-${edge}-${part} did not take "${value}"`,
    });
  }

  /** Fill a whole session: From h:m, To h:m (selects its tab first). */
  async setSession(
    session: TimingsSession,
    from: [string, string],
    to: [string, string],
  ): Promise<void> {
    await this.selectTimingsTab(session);
    await this.setTimingsBox(session, 'from', 'hour', from[0]);
    await this.setTimingsBox(session, 'from', 'minute', from[1]);
    await this.setTimingsBox(session, 'to', 'hour', to[0]);
    await this.setTimingsBox(session, 'to', 'minute', to[1]);
  }

  /** The automatic AM/PM text shown beside a From / To row. */
  async ampm(session: TimingsSession, edge: TimingsEdge): Promise<string> {
    const el = byTestId(`setup-clinic-timings-${session}-${edge}-ampm`);
    await el.waitForExist({ timeout: 10000 });
    return (await el.getText()).trim();
  }

  /** Inline error text for a key (box testid or setup-clinic-timings-<session>), or null. */
  async timingsError(key: string): Promise<string | null> {
    const el = byTestId(`${key}-error`);
    if (!(await el.isExisting())) return null;
    return (await el.getText()).trim();
  }

  /** Step 1 (doctor) with a phone, then Next to Step 2. */
  async fillDoctorWithPhoneAndNext(phone: string): Promise<void> {
    await this.fillDoctorBasics();
    await this.setDoctorPhone(phone);
    await this.selectCouncil(DEFAULT_COUNCIL_LABEL);
    await this.nextAndWaitForStep(2, 'clinic');
  }

  /** Step 4: finish setup (development-trial path is the default). */
  async finishSetup(): Promise<void> {
    await this.finish.waitForDisplayed({ timeout: 10000 });
    await this.finish.click();
  }
}

export const setupPage = new SetupPage();
