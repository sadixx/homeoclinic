// Page object for the S09 follow-up visit (docs/ui/S09-follow-up-visit.md;
// VIS-001..004, CASE-005 autosave pattern). hc-e2e-testing rule: specs use page
// objects; selectors are data-testid only, never raw CSS/XPath in specs. No
// sleeps — all waits go through waitUntil / WebdriverIO auto-waiting
// waitForDisplayed.
//
// The follow-up screen (FollowupVisit.tsx) pre-loads the previous visit's
// complaints as followup-complaint-<n> (1-based), each with a status segmented
// control (followup-status-<n>), an improvement-% range (followup-improve-<n>)
// and a note (followup-note-<n>). The remedy-response radios live in
// followup-remedy-response; next-follow-up quick buttons are
// followup-next-7d/15d/1m/2m and a custom date input followup-next-custom.
// Autosave status is followup-save-status (role=status). Prescribe
// (followup-prescribe) is rendered DISABLED (R4); the VIS-007 progress chart is
// NOT rendered at all (R9).
import { $, browser } from '@wdio/globals';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

export class FollowupPage {
  // ---- shell -------------------------------------------------------------
  get screen(): ChainablePromiseElement {
    return byTestId('followup-screen');
  }

  get saveStatus(): ChainablePromiseElement {
    return byTestId('followup-save-status');
  }

  get prescribe(): ChainablePromiseElement {
    return byTestId('followup-prescribe');
  }

  get nextCustom(): ChainablePromiseElement {
    return byTestId('followup-next-custom');
  }

  // ---- pre-loaded complaint rows (1-based) -------------------------------
  complaint(n = 1): ChainablePromiseElement {
    return byTestId(`followup-complaint-${n}`);
  }

  statusGroup(n = 1): ChainablePromiseElement {
    return byTestId(`followup-status-${n}`);
  }

  improve(n = 1): ChainablePromiseElement {
    return byTestId(`followup-improve-${n}`);
  }

  note(n = 1): ChainablePromiseElement {
    return byTestId(`followup-note-${n}`);
  }

  // ---- waits -------------------------------------------------------------
  /** Wait until the follow-up screen is rendered. */
  async waitForScreen(timeout = 20000): Promise<void> {
    await this.screen.waitForExist({ timeout });
    await this.screen.waitForDisplayed({ timeout });
  }

  /** Wait until the first pre-loaded complaint row is present (VIS-002). */
  async waitForPreload(n = 1, timeout = 20000): Promise<void> {
    await this.complaint(n).waitForExist({ timeout });
    await this.complaint(n).waitForDisplayed({ timeout });
  }

  // ---- reads -------------------------------------------------------------
  /** The visible text (complaint title) of a pre-loaded complaint row. */
  async complaintText(n = 1): Promise<string> {
    await this.waitForPreload(n);
    return (await this.complaint(n).getText()).trim();
  }

  /** The current autosave status-bar text. */
  async saveStatusText(): Promise<string> {
    await this.saveStatus.waitForExist({ timeout: 15000 });
    return (await this.saveStatus.getText()).trim();
  }

  /**
   * Wait until autosave reports Saved (status text begins with the en.json
   * "Saved" prefix). Returns the final status text for logging/evidence.
   */
  async waitForSaved(timeout = 20000): Promise<string> {
    await browser.waitUntil(
      async () => (await this.saveStatusText()).startsWith('Saved'),
      {
        timeout,
        timeoutMsg: 'follow-up autosave did not reach "Saved" within timeout',
      },
    );
    return this.saveStatusText();
  }

  // ---- actions -----------------------------------------------------------
  /**
   * Set a complaint's status by its button value (better/same/worse/new/
   * resolved) inside the row's segmented control. The button toggles
   * aria-pressed when selected.
   */
  async setStatus(n: number, value: string): Promise<void> {
    const btn = this.statusGroup(n).$(`button[aria-pressed]`);
    // Find the specific option button by its visible value via the group; the
    // buttons carry no per-value testid, so click by text match on the group's
    // buttons. We locate the Nth status option deterministically by its label.
    await this.statusGroup(n).waitForDisplayed({ timeout: 15000 });
    const buttons = await this.statusGroup(n).$$('button');
    for (const b of buttons) {
      const label = (await b.getText()).trim().toLowerCase();
      if (label === value.toLowerCase()) {
        await b.click();
        return;
      }
    }
    // Fallback: click the first button so the test fails loudly on a bad value.
    await btn.click();
    throw new Error(`follow-up status option "${value}" not found in row ${n}`);
  }

  /** Set the improvement-% range slider for a complaint row. */
  async setImprovement(n: number, pct: number): Promise<void> {
    const el = this.improve(n);
    await el.waitForDisplayed({ timeout: 15000 });
    await el.setValue(String(pct));
  }

  /** Pick a remedy-response radio by its value (e.g. 'amelioration'). */
  async setRemedyResponse(value: string): Promise<void> {
    const radio = byTestId('followup-remedy-response').$(
      `input[value="${value}"]`,
    );
    await radio.waitForExist({ timeout: 15000 });
    await radio.click();
  }

  /**
   * Set the next-follow-up date via the custom date input (YYYY-MM-DD).
   *
   * A native <input type="date"> cannot be driven reliably by WebKitWebDriver's
   * setValue (it types digit-by-digit and mangles the year, e.g. 2026 -> 0021).
   * Instead set the value natively and dispatch the React-recognised input +
   * change events so the production onChange (onCustomFollowup -> visitSetNext
   * Followup) fires with the exact date — the same handler a real user triggers.
   */
  async setNextFollowupCustom(isoDate: string): Promise<void> {
    await this.nextCustom.waitForDisplayed({ timeout: 15000 });
    await browser.execute((date: string) => {
      const el = document.querySelector(
        '[data-testid="followup-next-custom"]',
      ) as HTMLInputElement | null;
      if (el === null) throw new Error('followup-next-custom not found');
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(el, date);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, isoDate);
    // Confirm the value stuck (guards against a mistyped native date input).
    await browser.waitUntil(
      async () => (await this.nextCustom.getValue()) === isoDate,
      {
        timeout: 10000,
        timeoutMsg: `custom follow-up date did not become ${isoDate}`,
      },
    );
  }

  /** True when the Prescribe button is present AND disabled (R4). */
  async prescribeIsDisabled(): Promise<boolean> {
    if (!(await this.prescribe.isExisting())) return false;
    const disabledAttr = await this.prescribe.getAttribute('disabled');
    const aria = await this.prescribe.getAttribute('aria-disabled');
    return disabledAttr !== null || aria === 'true';
  }

  /**
   * True when a VIS-007 progress chart is present. It must be ABSENT at R9: the
   * component never renders it and there is no chart data-testid, so this checks
   * the stable negatives (a progress-chart testid and any <svg> chart within the
   * follow-up screen).
   */
  async hasProgressChart(): Promise<boolean> {
    const byId = await byTestId('followup-progress-chart').isExisting();
    const svg = await this.screen.$('svg').isExisting();
    return byId || svg;
  }

  // ---- route read --------------------------------------------------------
  /** The follow-up route ids parsed from the self-navigated hash. */
  async routeIds(): Promise<{ patientId: string; visitId: string; prev: string }> {
    const hash = await browser.execute(() => window.location.hash);
    const m = /#\/patient\/([^/]+)\/visit\/([^/?]+)\/followup\?prev=([^&]+)/.exec(
      hash,
    );
    if (m === null || m[1] === undefined || m[2] === undefined) {
      throw new Error(`follow-up route not found in hash: ${hash}`);
    }
    return {
      patientId: decodeURIComponent(m[1]),
      visitId: decodeURIComponent(m[2]),
      prev: m[3] !== undefined ? decodeURIComponent(m[3]) : '',
    };
  }

  // ---- open the follow-up (same steps AppShell.startFollowupForPatient) --
  /**
   * Open the S09 follow-up for a patient with a prior visit, reproducing EXACTLY
   * what AppShell.startFollowupForPatient does: call visit_create_followup
   * (which creates the follow-up visit and returns the pre-loaded complaints,
   * VIS-002) then deep-link the real shell route
   * #/patient/:id/visit/:createdVisitId/followup?prev=:prevVisitId. The create
   * step goes through the PRODUCTION IPC channel
   * (window.__TAURI_INTERNALS__.invoke — exactly what @tauri-apps/api `invoke`
   * and so the generated bindings call; the same channel backup.page/search.page
   * use), not a test backdoor. This is the slice's documented, deep-linkable S09
   * entry: the dashboard "New visit" button resolves to a follow-up only once
   * the dashboard payload carries prior visits, which is a later slice
   * (patient_get_dashboard returns visits:[] at R2, R-DEL-002); the route is the
   * real entry point. Returns the created follow-up visit id.
   */
  async openForPatient(patientId: string, prevVisitId: string): Promise<string> {
    const created = (await browser.executeAsync(
      (pid: string, prev: string, done: (v: unknown) => void) => {
        const internals = (
          window as unknown as {
            __TAURI_INTERNALS__?: {
              invoke: (cmd: string, args: unknown) => Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__;
        if (internals === undefined) {
          done({ status: 'error', error: { message: 'no __TAURI_INTERNALS__' } });
          return;
        }
        internals
          .invoke('visit_create_followup', {
            req: { patientId: pid, prevVisitId: prev },
          })
          .then((v) => done(v))
          .catch((e) => done({ status: 'error', error: { message: String(e) } }));
      },
      patientId,
      prevVisitId,
    )) as
      | { status: 'ok'; data: { visitId: string } }
      | { visitId: string }
      | { status: 'error'; error: { message?: string } };

    let visitId: string;
    if ('status' in created) {
      if (created.status !== 'ok') {
        throw new Error(
          `visit_create_followup failed: ${created.error.message ?? ''}`,
        );
      }
      visitId = created.data.visitId;
    } else {
      visitId = created.visitId;
    }
    if (typeof visitId !== 'string' || visitId.length === 0) {
      throw new Error('visit_create_followup returned no visitId');
    }

    await browser.execute(
      (pid: string, vid: string, prev: string) => {
        window.location.hash = `#/patient/${encodeURIComponent(
          pid,
        )}/visit/${encodeURIComponent(vid)}/followup?prev=${encodeURIComponent(
          prev,
        )}`;
      },
      patientId,
      visitId,
      prevVisitId,
    );
    await this.waitForScreen();
    return visitId;
  }
}

export const followupPage = new FollowupPage();
