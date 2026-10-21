// Page object for the S04 global search overlay (docs/ui/S04-global-search.md;
// PSR-001..007) and the DEV/E2E-only fixture seeding path. hc-e2e-testing rule:
// specs use page objects; selectors are data-testid only. No sleeps — all waits
// go through waitUntil / waitForDisplayed.
//
// The overlay is opened the way the shell opens it: F2 (00-conventions §2/§3),
// floating over every screen. A search result's Enter navigates the app to
// /patients?id=<id> (the S07 dashboard) and closes the overlay (PSR-006).
//
// Seeding: the >=200-patient multi-disease fixture is imported into the
// ALREADY-PROVISIONED app DB through the real create path via the feature-gated
// `patient_import_fixture` command (OPTION A; needs the app built with
// --features e2e-test-keys). The import goes over the production IPC channel
// (window.__TAURI_INTERNALS__.invoke, exactly what @tauri-apps/api `invoke`
// uses), so FTS/trigram/phonetic stay in sync and every imported patient is
// immediately findable.
import { $, $$, browser } from '@wdio/globals';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

export class SearchPage {
  get overlay(): ChainablePromiseElement {
    return byTestId('search-overlay');
  }

  get input(): ChainablePromiseElement {
    return byTestId('search-input');
  }

  get results(): ChainablePromiseElement {
    return byTestId('search-results');
  }

  get resultRows(): ReturnType<typeof $$> {
    return $$('[data-testid="search-result-row"]');
  }

  get empty(): ChainablePromiseElement {
    return byTestId('search-empty');
  }

  /** Open the overlay with F2 (the global shortcut the shell binds). */
  async openWithF2(timeout = 15000): Promise<void> {
    await browser.keys(['F2']);
    await this.overlay.waitForDisplayed({ timeout });
    await this.input.waitForDisplayed({ timeout });
  }

  /** Close the overlay with Escape. */
  async close(timeout = 10000): Promise<void> {
    await browser.keys(['Escape']);
    await browser.waitUntil(async () => !(await this.overlay.isExisting()), {
      timeout,
      timeoutMsg: 'search overlay did not close on Escape',
    });
  }

  /**
   * Type a query and wait until at least `minHits` result rows are shown. The
   * overlay debounces 80 ms then queries, so we wait on the rows, never sleep.
   */
  async searchFor(query: string, minHits = 1, timeout = 15000): Promise<void> {
    await this.input.waitForDisplayed({ timeout });
    await this.input.setValue(query);
    await browser.waitUntil(
      async () => (await this.resultRows.length) >= minHits,
      {
        timeout,
        timeoutMsg: `search for "${query}" returned fewer than ${minHits} rows`,
      },
    );
  }

  /** Text of the first result row (name + code + meta line). */
  async firstResultText(): Promise<string> {
    const rows = await this.resultRows;
    return (await rows[0]!.getText()).trim();
  }

  /**
   * Press Enter to open the highlighted (first) result. The overlay navigates
   * to /patients?id=<id> and closes; the caller then asserts the dashboard.
   */
  async openFirstResult(timeout = 15000): Promise<void> {
    await browser.keys(['Enter']);
    await browser.waitUntil(async () => !(await this.overlay.isExisting()), {
      timeout,
      timeoutMsg: 'search overlay did not close after opening a result',
    });
  }

  /**
   * DEV/E2E-only: import a plaintext JSONL fixture into the provisioned app DB
   * through the real create path (feature-gated `patient_import_fixture`).
   * Returns the number of patients imported. Requires the app built with
   * --features e2e-test-keys; a release build has no such command and this
   * throws, which is the correct (loud) failure for a mis-built binary.
   */
  async importFixture(jsonlPath: string): Promise<number> {
    const result = (await browser.executeAsync(
      (path: string, done: (v: unknown) => void) => {
        const internals = (
          window as unknown as {
            __TAURI_INTERNALS__?: {
              invoke: (cmd: string, args: unknown) => Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__;
        if (internals === undefined) {
          done({ ok: false, error: 'no __TAURI_INTERNALS__' });
          return;
        }
        // The raw IPC resolves to the plain command data on success and
        // REJECTS with the UserFacingError on the Rust Err case (this is what
        // @tauri-apps/api `invoke` + the generated typedError wrapper rely on);
        // there is no {status} envelope at this layer.
        internals
          .invoke('patient_import_fixture', { req: { path } })
          .then((data) => done({ ok: true, data }))
          .catch((e) => done({ ok: false, error: String(e) }));
      },
      jsonlPath,
    )) as { ok: true; data: { imported: number } } | { ok: false; error: string };

    if (result.ok) {
      return result.data.imported;
    }
    throw new Error(`patient_import_fixture failed: ${result.error}`);
  }
}

export const searchPage = new SearchPage();
