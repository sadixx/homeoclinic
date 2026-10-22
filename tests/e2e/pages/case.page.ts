// Page object for the S08 first (detailed) case form (docs/ui/S08-case-form.md;
// CASE-001..006, CASE-009, VIS-001). hc-e2e-testing rule: specs use page
// objects; selectors are data-testid only, never raw CSS/XPath in specs. No
// sleeps — all waits go through waitUntil / WebdriverIO auto-waiting
// waitForDisplayed.
//
// The case form is a schema-driven engine: the left rail lists one
// `case-form-section-<key>` button per visible template section, and sections
// other than chief_complaints start COLLAPSED, so a field in another section
// must have its section expanded (click its rail button) before the field is
// in the DOM. The autosave status bar (`case-form-save-status`) shows
// Saving…/Saved hh:mm; there is no Save button on this clinical form
// (CASE-005). Send-to-repertory (CASE-006) is flagged OFF pre-R7 and is not
// rendered.
import { $, browser } from "@wdio/globals";

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

export class CasePage {
  // ---- shell -------------------------------------------------------------
  get form(): ChainablePromiseElement {
    return byTestId("case-form");
  }

  get saveStatus(): ChainablePromiseElement {
    return byTestId("case-form-save-status");
  }

  get bmi(): ChainablePromiseElement {
    return byTestId("case-form-bmi");
  }

  // ---- section rail ------------------------------------------------------
  section(key: string): ChainablePromiseElement {
    return byTestId(`case-form-section-${key}`);
  }

  /** The first-class Back control (UX1); rendered only when onBack is wired. */
  get back(): ChainablePromiseElement {
    return byTestId("case-form-back");
  }

  /** True when the case-form Back control is present (no-dead-end guard). */
  async hasBack(): Promise<boolean> {
    return this.back.isExisting();
  }

  /** Click the case-form Back control (UX1 -> patient dashboard). */
  async clickBack(timeout = 15000): Promise<void> {
    await this.back.waitForClickable({ timeout });
    await this.back.click();
  }

  /**
   * Click a rail section to TOGGLE it (UX2). The production handler is three-
   * state (hidden->re-show+expand; shown+collapsed->expand; shown+expanded->
   * hide). Callers drive explicit before/after assertions around each click.
   */
  async railToggle(key: string, timeout = 15000): Promise<void> {
    await this.section(key).waitForClickable({ timeout });
    await this.section(key).click();
  }

  /**
   * True when a section's rail item marks it HIDDEN (UX2 discoverability): the
   * production rail sets data-hidden="true" and aria-pressed="false" on a
   * rail-toggled-hidden section so the doctor can click it back on.
   */
  async sectionIsHidden(key: string): Promise<boolean> {
    const el = this.section(key);
    await el.waitForExist({ timeout: 15000 });
    const dataHidden = await el.getAttribute("data-hidden");
    const pressed = await el.getAttribute("aria-pressed");
    return dataHidden === "true" || pressed === "false";
  }

  /** aria-expanded on a rail section (the centre-pane panel open state). */
  async sectionIsExpanded(key: string): Promise<boolean> {
    const el = this.section(key);
    await el.waitForExist({ timeout: 15000 });
    return (await el.getAttribute("aria-expanded")) === "true";
  }

  /**
   * True when a section's EDIT PANEL is present in the centre pane. The panel
   * renders only when the section is shown AND expanded, keyed by a known
   * field in that section (chief_complaints -> case-form-sensation-1). A
   * caller passes the section's panel-field testid.
   */
  async panelFieldExists(fieldTestId: string): Promise<boolean> {
    return byTestId(fieldTestId).isExisting();
  }

  /**
   * Send the global Alt+Left Back chord (00-conventions §3). Blurs any focused
   * text control first (clicks the rail nav heading region via the chief-
   * complaints rail button's parent is risky; instead focus the body) so the
   * production guard that skips INPUT/TEXTAREA/SELECT/contentEditable does not
   * suppress it — the chord must act as a shell-level Back.
   */
  async altLeftBack(): Promise<void> {
    // Move focus off any text field onto document.body so the global handler
    // (which ignores keystrokes inside text controls) treats this as a Back.
    await browser.execute(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active !== null && typeof active.blur === "function") active.blur();
      document.body.setAttribute("tabindex", "-1");
      document.body.focus();
    });
    await browser.keys(["Alt", "ArrowLeft"]);
  }

  // ---- fields ------------------------------------------------------------
  /** The chief-complaint sensation textarea for block n (1-based). */
  sensation(n = 1): ChainablePromiseElement {
    return byTestId(`case-form-sensation-${n}`);
  }

  /** A physical-generals pick list / field by key (e.g. thermal, thirst). */
  generals(key: string): ChainablePromiseElement {
    return byTestId(`case-form-generals-${key}`);
  }

  /** An examination vital input by field key (e.g. weight_kg, height_cm). */
  vital(key: string): ChainablePromiseElement {
    return byTestId(`case-form-vital-${key}`);
  }

  // ---- waits -------------------------------------------------------------
  /** Wait until the case form shell is rendered. */
  async waitForForm(timeout = 20000): Promise<void> {
    await this.form.waitForExist({ timeout });
    await this.form.waitForDisplayed({ timeout });
  }

  /**
   * Expand a collapsed section by clicking its rail button, then wait until a
   * known field of that section is present. The caller passes a field testid
   * to wait on (the section panel renders lazily when expanded).
   */
  async expandSection(
    key: string,
    waitForTestId: string,
    timeout = 15000,
  ): Promise<void> {
    await this.section(key).waitForDisplayed({ timeout });
    await this.section(key).click();
    await byTestId(waitForTestId).waitForDisplayed({ timeout });
  }

  // ---- read helpers ------------------------------------------------------
  /** The current value of a text/textarea/number input by its testid. */
  async valueOf(testId: string): Promise<string> {
    const el = byTestId(testId);
    await el.waitForExist({ timeout: 15000 });
    return (await el.getValue()) ?? "";
  }

  /** The rendered BMI text (an <output>, read via text not value). */
  async bmiText(): Promise<string> {
    await this.bmi.waitForExist({ timeout: 15000 });
    return (await this.bmi.getText()).trim();
  }

  /** The current autosave status bar text. */
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
      async () => (await this.saveStatusText()).startsWith("Saved"),
      {
        timeout,
        timeoutMsg: 'autosave did not reach the "Saved" status within timeout',
      },
    );
    return this.saveStatusText();
  }

  // ---- navigation --------------------------------------------------------
  /**
   * Navigate the HashRouter directly to a visit's case form (deep-link). Used
   * after a same-data-dir relaunch to reopen the exact visit. Driven in-page
   * via location.hash (browser.url rejects a bare hash), the same technique
   * the other page objects use.
   */
  async openVisit(
    patientId: string,
    visitId: string,
    timeout = 20000,
  ): Promise<void> {
    await browser.execute(
      (pid: string, vid: string) => {
        window.location.hash = `#/patient/${encodeURIComponent(
          pid,
        )}/case/${encodeURIComponent(vid)}`;
      },
      patientId,
      visitId,
    );
    await this.waitForForm(timeout);
  }

  /**
   * Read the patientId + visitId the app routed to after Take case, parsed
   * from the self-navigated hash (#/patient/<pid>/case/<vid>). Never sets the
   * hash — pure observation of the route startCaseForPatient chose.
   */
  async routeIds(): Promise<{ patientId: string; visitId: string }> {
    const hash = await browser.execute(() => window.location.hash);
    const m = /#\/patient\/([^/]+)\/case\/([^/?]+)/.exec(hash);
    if (m === null || m[1] === undefined || m[2] === undefined) {
      throw new Error(`case route not found in hash: ${hash}`);
    }
    return {
      patientId: decodeURIComponent(m[1]),
      visitId: decodeURIComponent(m[2]),
    };
  }

  /** True when the (pre-R7) send-to-repertory control is present. */
  async hasSendToRepertory(): Promise<boolean> {
    return byTestId("case-form-send-to-repertory").isExisting();
  }
}

export const casePage = new CasePage();
