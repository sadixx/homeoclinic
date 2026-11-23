// Page object for the R5 S19 Reports screen (apps/desktop/src/reports/
// ReportsScreen.tsx): daily collection by payment mode, monthly summary,
// CSV / xlsx export into the folder the OS picker returns (the e2e build reads
// HC_E2E_EXPORT_FOLDER instead of opening the picker; crates/hc-app/src/
// commands/reports.rs, compiled out of release).
//
// hc-e2e-testing rule: data-testid selectors only; no sleeps.
import { $, browser } from '@wdio/globals';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

export interface ModeRow {
  readonly label: string;
  readonly count: string;
  readonly amount: string;
}

export class ReportsPage {
  get screen(): ChainablePromiseElement {
    return byTestId('reports-screen');
  }

  get totalCollected(): ChainablePromiseElement {
    return byTestId('reports-total-collected');
  }

  get totalCount(): ChainablePromiseElement {
    return byTestId('reports-total-count');
  }

  get outstanding(): ChainablePromiseElement {
    return byTestId('reports-outstanding');
  }

  get exportDone(): ChainablePromiseElement {
    return byTestId('reports-export-done');
  }

  get error(): ChainablePromiseElement {
    return byTestId('reports-error');
  }

  /** Open Reports from the side nav (a guarded shell navigation). */
  async openFromNav(timeout = 20000): Promise<void> {
    const nav = byTestId('nav-reports');
    await nav.waitForClickable({ timeout });
    await nav.click();
    await this.screen.waitForDisplayed({ timeout });
  }

  /** Wait for the daily totals panel to show `count` payments. */
  async waitForDailyCount(count: number, timeout = 20000): Promise<void> {
    await browser.waitUntil(
      async () =>
        (await this.totalCount.isExisting()) && (await this.totalCount.getText()).trim() === String(count),
      { timeout, timeoutMsg: `daily collection never showed ${count} payments` },
    );
  }

  /** Cells of the by-mode row for `mode`, or null when that row is absent. */
  async modeRow(mode: string): Promise<ModeRow | null> {
    return browser.execute((m: string) => {
      const tr = document.querySelector(`[data-testid="reports-mode-row-${m}"]`);
      if (tr === null) return null;
      const td = Array.from(tr.querySelectorAll('td')).map((c) => (c.textContent ?? '').trim());
      return { label: td[0] ?? '', count: td[1] ?? '', amount: td[2] ?? '' };
    }, mode);
  }

  /** Click Export CSV / Excel and return the "Saved <file>" status text. */
  async export(format: 'csv' | 'xlsx', timeout = 20000): Promise<string> {
    const b = byTestId(format === 'csv' ? 'reports-export-csv' : 'reports-export-xlsx');
    const before = (await this.exportDone.isExisting()) ? await this.exportDone.getText() : '';
    await b.waitForClickable({ timeout });
    await b.click();
    const ext = format === 'csv' ? '.csv' : '.xlsx';
    let last = '';
    await browser.waitUntil(
      async () => {
        if (await this.error.isExisting()) {
          throw new Error(`export ${format} failed: ${await this.error.getText()}`);
        }
        if (!(await this.exportDone.isExisting())) return false;
        last = await this.exportDone.getText();
        return last !== before && last.includes(ext);
      },
      { timeout, timeoutMsg: `export ${format} never reported a saved file (last "${last}")` },
    );
    return last;
  }
}

export const reportsPage = new ReportsPage();
