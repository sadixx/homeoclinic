// Page object for the S18 Settings screen (docs/ui/S18-settings.md, MS design
// §8.1) and the boot-time "data folder not available" screen
// (apps/desktop/src/app/DataFolderMissing.tsx, SET-006, ADR 0020).
// hc-e2e-testing rule: specs use page objects; selectors are data-testid only,
// never raw CSS/XPath in specs. No sleeps — every wait is a waitUntil /
// waitForDisplayed with a timeout.
//
// /settings is reached the way the doctor reaches it: the left-nav item
// (nav-settings). `openByHash` drives the HashRouter directly and exists only
// to prove the completion route-guard (a deep link before setup bounces to
// /setup).
import { $, browser } from '@wdio/globals';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

/** The later-release tabs that MS shows disabled (R-DEL-002 exception A8). */
export const LATER_TABS = [
  'templates',
  'advice',
  'print',
  'recycle',
  'audit',
  'maintenance',
] as const;
export type LaterTab = (typeof LATER_TABS)[number];

export type FontSize = 'normal' | 'large' | 'xlarge';
export type TimingsSession = 'morning' | 'evening';
export type TimingsEdge = 'from' | 'to';

/** Testid base of the reused ClinicTimingsInput inside S18. */
const TIMINGS = 'settings-clinic-timings';

/** A synthetic camera for the window.__HC_E2E_CAMERAS__ seam (shared/camera.ts). */
export interface FakeCamera {
  readonly deviceId: string;
  readonly label: string;
}

export class SettingsPage {
  // ---- screen + tabs -----------------------------------------------------
  get screen(): ChainablePromiseElement {
    return byTestId('settings-screen');
  }

  get general(): ChainablePromiseElement {
    return byTestId('settings-general');
  }

  get tabs(): ChainablePromiseElement {
    return byTestId('settings-tabs');
  }

  tab(id: 'general' | LaterTab): ChainablePromiseElement {
    return byTestId(`settings-tab-${id}`);
  }

  tabHint(id: LaterTab): ChainablePromiseElement {
    return byTestId(`settings-tab-${id}-hint`);
  }

  get navSettings(): ChainablePromiseElement {
    return byTestId('nav-settings');
  }

  /** Open Settings through the left nav and wait for the General form. */
  async openViaNav(timeout = 20000): Promise<void> {
    await this.navSettings.waitForClickable({ timeout });
    await this.navSettings.click();
    await this.waitForGeneral(timeout);
  }

  /** Deep-link #/settings (route-guard proof only). */
  async openByHash(): Promise<void> {
    await browser.execute(() => {
      window.location.hash = '#/settings';
    });
  }

  async waitForGeneral(timeout = 20000): Promise<void> {
    await this.screen.waitForDisplayed({ timeout });
    await this.general.waitForDisplayed({ timeout });
  }

  async hash(): Promise<string> {
    return browser.execute(() => window.location.hash);
  }

  // ---- doctor ------------------------------------------------------------
  field(testid: string): ChainablePromiseElement {
    return byTestId(testid);
  }

  async setText(testid: string, value: string): Promise<void> {
    const el = byTestId(testid);
    await el.waitForDisplayed({ timeout: 10000 });
    await el.clearValue();
    if (value !== '') await el.setValue(value);
    await browser.waitUntil(async () => (await el.getValue()) === value, {
      timeout: 10000,
      timeoutMsg: `${testid} did not take "${value}"`,
    });
  }

  async value(testid: string): Promise<string> {
    const el = byTestId(testid);
    await el.waitForExist({ timeout: 10000 });
    return el.getValue();
  }

  get council(): ChainablePromiseElement {
    return byTestId('settings-doctor-council');
  }

  async selectCouncil(label: string): Promise<void> {
    await this.council.waitForDisplayed({ timeout: 10000 });
    await this.council.selectByVisibleText(label);
  }

  /** Visible text of the selected council option. */
  async councilText(): Promise<string> {
    return browser.execute(() => {
      const el = document.querySelector<HTMLSelectElement>(
        '[data-testid="settings-doctor-council"]',
      );
      if (el === null) return '';
      return el.selectedOptions[0]?.textContent?.trim() ?? '';
    });
  }

  // ---- clinic timings ----------------------------------------------------
  timingsTab(session: TimingsSession): ChainablePromiseElement {
    return byTestId(`${TIMINGS}-tab-${session}`);
  }

  timingsPanel(session: TimingsSession): ChainablePromiseElement {
    return byTestId(`${TIMINGS}-panel-${session}`);
  }

  async selectTimingsTab(session: TimingsSession): Promise<void> {
    await this.timingsTab(session).waitForClickable({ timeout: 10000 });
    await this.timingsTab(session).click();
    await this.timingsPanel(session).waitForDisplayed({ timeout: 10000 });
  }

  timingsBoxId(
    session: TimingsSession,
    edge: TimingsEdge,
    part: 'hour' | 'minute',
  ): string {
    return `${TIMINGS}-${session}-${edge}-${part}`;
  }

  /** Fill a whole session (brings its tab forward first). */
  async setSession(
    session: TimingsSession,
    from: [string, string],
    to: [string, string],
  ): Promise<void> {
    await this.selectTimingsTab(session);
    await this.setText(this.timingsBoxId(session, 'from', 'hour'), from[0]);
    await this.setText(this.timingsBoxId(session, 'from', 'minute'), from[1]);
    await this.setText(this.timingsBoxId(session, 'to', 'hour'), to[0]);
    await this.setText(this.timingsBoxId(session, 'to', 'minute'), to[1]);
  }

  /** Read a whole session's four boxes (brings its tab forward first). */
  async readSession(session: TimingsSession): Promise<string[]> {
    await this.selectTimingsTab(session);
    const out: string[] = [];
    for (const edge of ['from', 'to'] as const) {
      for (const part of ['hour', 'minute'] as const) {
        out.push(await this.value(this.timingsBoxId(session, edge, part)));
      }
    }
    return out;
  }

  /** Inline error text for an error key, or null when absent. */
  async errorText(key: string): Promise<string | null> {
    const el = byTestId(`${key}-error`);
    if (!(await el.isExisting())) return null;
    return (await el.getText()).trim();
  }

  async waitError(key: string, text: string): Promise<void> {
    await browser.waitUntil(async () => (await this.errorText(key)) === text, {
      timeout: 10000,
      timeoutMsg: `inline error ${key}-error never read "${text}"`,
    });
  }

  // ---- app prefs ---------------------------------------------------------
  get nextId(): ChainablePromiseElement {
    return byTestId('settings-next-id');
  }

  get autolock(): ChainablePromiseElement {
    return byTestId('settings-autolock');
  }

  async setAutolock(minutes: number): Promise<void> {
    await this.autolock.waitForDisplayed({ timeout: 10000 });
    await this.autolock.selectByAttribute('value', String(minutes));
    await browser.waitUntil(
      async () => (await this.autolock.getValue()) === String(minutes),
      { timeout: 10000, timeoutMsg: `autolock did not take ${minutes}` },
    );
  }

  fontRadio(size: FontSize): ChainablePromiseElement {
    return byTestId(`settings-fontsize-${size}`);
  }

  async setFontSize(size: FontSize): Promise<void> {
    await this.fontRadio(size).waitForClickable({ timeout: 10000 });
    await this.fontRadio(size).click();
    await browser.waitUntil(async () => this.fontRadio(size).isSelected(), {
      timeout: 10000,
      timeoutMsg: `font radio ${size} not selected`,
    });
  }

  async checkedFontSize(): Promise<FontSize | null> {
    for (const size of ['normal', 'large', 'xlarge'] as const) {
      if (await this.fontRadio(size).isSelected()) return size;
    }
    return null;
  }

  /** <html data-hc-font-size> and the computed root / content font sizes. */
  async fontState(): Promise<{
    attr: string | null;
    rootPx: string;
    bodyTextPx: string;
  }> {
    return browser.execute(() => {
      const root = document.documentElement;
      const content =
        document.querySelector('[data-testid="content-area"]') ??
        document.body;
      return {
        attr: root.getAttribute('data-hc-font-size'),
        rootPx: getComputedStyle(root).fontSize,
        bodyTextPx: getComputedStyle(content).fontSize,
      };
    });
  }

  // ---- camera ------------------------------------------------------------
  get cameraSelect(): ChainablePromiseElement {
    return byTestId('settings-camera-select');
  }

  get cameraNone(): ChainablePromiseElement {
    return byTestId('settings-camera-none');
  }

  get cameraRefresh(): ChainablePromiseElement {
    return byTestId('settings-camera-refresh');
  }

  /** Install (or clear with null) the window.__HC_E2E_CAMERAS__ seam. */
  async setFakeCameras(cams: readonly FakeCamera[] | null): Promise<void> {
    await browser.execute((list: FakeCamera[] | null) => {
      const w = window as unknown as { __HC_E2E_CAMERAS__?: FakeCamera[] };
      if (list === null) delete w.__HC_E2E_CAMERAS__;
      else w.__HC_E2E_CAMERAS__ = list;
    }, cams === null ? null : [...cams]);
  }

  async refreshCameras(): Promise<void> {
    await this.cameraRefresh.waitForClickable({ timeout: 10000 });
    await this.cameraRefresh.click();
  }

  /** Option texts of the camera select (DOM order). */
  async cameraOptions(): Promise<string[]> {
    return browser.execute(() => {
      const el = document.querySelector<HTMLSelectElement>(
        '[data-testid="settings-camera-select"]',
      );
      if (el === null) return [] as string[];
      return Array.from(el.options).map((o) => (o.textContent ?? '').trim());
    });
  }

  // ---- save / cancel -----------------------------------------------------
  get save(): ChainablePromiseElement {
    return byTestId('settings-save');
  }

  get cancel(): ChainablePromiseElement {
    return byTestId('settings-cancel');
  }

  get saved(): ChainablePromiseElement {
    return byTestId('settings-saved');
  }

  get formError(): ChainablePromiseElement {
    return byTestId('settings-form-error');
  }

  /** Press Save and wait for the "Settings saved." status line. */
  async saveAndWait(timeout = 20000): Promise<string> {
    await this.save.waitForClickable({ timeout: 10000 });
    await this.save.click();
    await this.saved.waitForDisplayed({ timeout });
    return (await this.saved.getText()).trim();
  }

  // ---- data folder -------------------------------------------------------
  get dataFolder(): ChainablePromiseElement {
    return byTestId('settings-datafolder');
  }

  get dataFolderChange(): ChainablePromiseElement {
    return byTestId('settings-datafolder-change');
  }

  get dataFolderConfirm(): ChainablePromiseElement {
    return byTestId('settings-datafolder-confirm');
  }

  get dataFolderTarget(): ChainablePromiseElement {
    return byTestId('settings-datafolder-target');
  }

  get dataFolderMove(): ChainablePromiseElement {
    return byTestId('settings-datafolder-move');
  }

  get dataFolderResult(): ChainablePromiseElement {
    return byTestId('settings-datafolder-result');
  }

  get dataFolderError(): ChainablePromiseElement {
    return byTestId('settings-datafolder-error');
  }

  async dataFolderPath(): Promise<string> {
    await this.dataFolder.waitForDisplayed({ timeout: 10000 });
    return (await this.dataFolder.getText()).trim();
  }

  /** Change… -> (seam picker) -> confirm dialog -> Move -> result banner. */
  async moveDataFolder(timeout = 60000): Promise<{ target: string; result: string }> {
    await this.dataFolderChange.waitForClickable({ timeout: 10000 });
    await this.dataFolderChange.click();
    await this.dataFolderConfirm.waitForDisplayed({ timeout: 15000 });
    const target = (await this.dataFolderTarget.getText()).trim();
    await this.dataFolderMove.waitForClickable({ timeout: 10000 });
    await this.dataFolderMove.click();
    await this.dataFolderResult.waitForDisplayed({ timeout });
    return { target, result: (await this.dataFolderResult.getText()).trim() };
  }

  // ---- data folder missing (boot screen) ----------------------------------
  get missingScreen(): ChainablePromiseElement {
    return byTestId('data-missing-screen');
  }

  get missingPath(): ChainablePromiseElement {
    return byTestId('data-missing-path');
  }

  get missingRetry(): ChainablePromiseElement {
    return byTestId('data-missing-retry');
  }

  get missingUseDefault(): ChainablePromiseElement {
    return byTestId('data-missing-use-default');
  }

  get missingConfirm(): ChainablePromiseElement {
    return byTestId('data-missing-confirm');
  }

  get missingCancel(): ChainablePromiseElement {
    return byTestId('data-missing-cancel');
  }

  async waitForMissingScreen(timeout = 30000): Promise<void> {
    await this.missingScreen.waitForDisplayed({ timeout });
  }
}

export const settingsPage = new SettingsPage();
