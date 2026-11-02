// Page object for the S03 Today home screen (docs/ui/S03-today.md; VIS-005).
// hc-e2e-testing rule: specs use page objects; selectors are data-testid only,
// never raw CSS/XPath in specs. No sleeps — all waits go through waitUntil /
// WebdriverIO auto-waiting waitForDisplayed.
//
// Today (TodayScreen.tsx) renders three lists from today_get_overview:
// due-today (today-due-list / today-due-row), overdue (today-overdue-list /
// today-overdue-row) and registered-today (today-registered-list /
// today-registered-row). Each list is omitted when empty; the empty state
// (today-empty) shows only when all three are empty. Rows carry the patient
// name + code so the spec matches a patient by name.
import { $, $$, browser } from '@wdio/globals';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

export class TodayPage {
  get screen(): ChainablePromiseElement {
    return byTestId('today-screen');
  }

  get empty(): ChainablePromiseElement {
    return byTestId('today-empty');
  }

  get dueList(): ChainablePromiseElement {
    return byTestId('today-due-list');
  }

  get overdueList(): ChainablePromiseElement {
    return byTestId('today-overdue-list');
  }

  get dueRows(): ReturnType<typeof $$> {
    return $$('[data-testid="today-due-row"]');
  }

  get overdueRows(): ReturnType<typeof $$> {
    return $$('[data-testid="today-overdue-row"]');
  }

  get registeredRows(): ReturnType<typeof $$> {
    return $$('[data-testid="today-registered-row"]');
  }

  /** Navigate the HashRouter to Today (the shell's default route). */
  async open(timeout = 20000): Promise<void> {
    await browser.execute(() => {
      window.location.hash = '#/today';
    });
    await this.screen.waitForExist({ timeout });
    await this.screen.waitForDisplayed({ timeout });
  }

  /** Wait until at least one due-today row is present. */
  async waitForDue(timeout = 20000): Promise<void> {
    await browser.waitUntil(async () => (await this.dueRows.length) > 0, {
      timeout,
      timeoutMsg: 'no today-due-row appeared within timeout',
    });
  }

  /** Wait until at least one overdue row is present. */
  async waitForOverdue(timeout = 20000): Promise<void> {
    await browser.waitUntil(async () => (await this.overdueRows.length) > 0, {
      timeout,
      timeoutMsg: 'no today-overdue-row appeared within timeout',
    });
  }

  /** Wait until at least one registered-today row is present. */
  async waitForRegistered(timeout = 20000): Promise<void> {
    await browser.waitUntil(async () => (await this.registeredRows.length) > 0, {
      timeout,
      timeoutMsg: 'no today-registered-row appeared within timeout',
    });
  }

  /** The visible text of every due-today row. */
  async dueTexts(): Promise<string[]> {
    const out: string[] = [];
    for await (const r of this.dueRows) {
      out.push((await r.getText()).trim());
    }
    return out;
  }

  /** The visible text of every overdue row. */
  async overdueTexts(): Promise<string[]> {
    const out: string[] = [];
    for await (const r of this.overdueRows) {
      out.push((await r.getText()).trim());
    }
    return out;
  }

  /** True when some due-today row's text contains `name`. */
  async dueContains(name: string): Promise<boolean> {
    return (await this.dueTexts()).some((t) => t.includes(name));
  }

  /** True when some overdue row's text contains `name`. */
  async overdueContains(name: string): Promise<boolean> {
    return (await this.overdueTexts()).some((t) => t.includes(name));
  }

  /** The visible text of every registered-today row. */
  async registeredTexts(): Promise<string[]> {
    const out: string[] = [];
    for await (const r of this.registeredRows) {
      out.push((await r.getText()).trim());
    }
    return out;
  }

  /** True when some registered-today row's text contains `name`. */
  async registeredContains(name: string): Promise<boolean> {
    return (await this.registeredTexts()).some((t) => t.includes(name));
  }
}

export const todayPage = new TodayPage();
