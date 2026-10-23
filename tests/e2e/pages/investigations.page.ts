// Page object for the S08 case-form Investigations panel (lab-report
// attachments, PAT-009; docs/ui/S08-case-form.md). hc-e2e-testing rule: specs
// use page objects; selectors are data-testid only. No sleeps — all waits go
// through waitForDisplayed / waitUntil.
//
// The Investigations panel is rendered inside the `investigations` section of
// the schema-driven case form, so a caller must expand that rail section (via
// CasePage.expandSection) before these controls are in the DOM. The upload
// control calls the typed `visit_pick_report_file` command; under the E2E
// build (--features e2e-test-keys) that command returns the path named by the
// HC_E2E_REPORT_FILE env var INSTEAD of opening the native GTK picker, so a
// webdriver test can drive uploads deterministically (ADR 0017; mirrors the
// window.__HC_E2E_CAMERA__ camera seam). Items are 1-based in the list.
import { $, browser } from "@wdio/globals";

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

export class InvestigationsPage {
  // ---- Suggested / Submitted tabs ----------------------------------------
  // The Investigations section has two tabs: "Suggested" (free text) and
  // "Submitted" — the PAT-009 uploader (caption + Upload + the list) lives
  // under the SUBMITTED tab, so a caller must switch to it after expanding the
  // section and before touching the upload controls.
  get suggestedTab(): ChainablePromiseElement {
    return byTestId("case-form-invest-suggested-tab");
  }

  get submittedTab(): ChainablePromiseElement {
    return byTestId("case-form-invest-submitted-tab");
  }

  /**
   * Switch to the Submitted tab and wait until the uploader's caption input is
   * in the DOM. The caller must already have expanded the investigations rail
   * section (CasePage.expandSection('investigations')).
   */
  async openSubmittedTab(timeout = 15000): Promise<void> {
    await this.submittedTab.waitForClickable({ timeout });
    await this.submittedTab.click();
    await this.caption.waitForDisplayed({ timeout });
  }

  // ---- upload control ----------------------------------------------------
  get caption(): ChainablePromiseElement {
    return byTestId("case-form-investigations-caption");
  }

  get uploadButton(): ChainablePromiseElement {
    return byTestId("case-form-investigations-upload");
  }

  get empty(): ChainablePromiseElement {
    return byTestId("case-form-investigations-empty");
  }

  get list(): ChainablePromiseElement {
    return byTestId("case-form-investigations-list");
  }

  get error(): ChainablePromiseElement {
    return byTestId("case-form-investigations-error");
  }

  // ---- list items (1-based) ---------------------------------------------
  item(n: number): ChainablePromiseElement {
    return byTestId(`case-form-investigations-item-${n}`);
  }

  badge(n: number): ChainablePromiseElement {
    return byTestId(`case-form-investigations-badge-${n}`);
  }

  openButton(n: number): ChainablePromiseElement {
    return byTestId(`case-form-investigations-open-${n}`);
  }

  removeButton(n: number): ChainablePromiseElement {
    return byTestId(`case-form-investigations-remove-${n}`);
  }

  // ---- remove confirm dialog --------------------------------------------
  get removeDialog(): ChainablePromiseElement {
    return byTestId("case-form-investigations-remove-dialog");
  }

  get removeConfirm(): ChainablePromiseElement {
    return byTestId("case-form-investigations-remove-confirm");
  }

  get removeCancel(): ChainablePromiseElement {
    return byTestId("case-form-investigations-remove-cancel");
  }

  // ---- preview dialog ----------------------------------------------------
  get preview(): ChainablePromiseElement {
    return byTestId("case-form-investigations-preview");
  }

  get previewImage(): ChainablePromiseElement {
    return byTestId("case-form-investigations-preview-image");
  }

  get previewDownload(): ChainablePromiseElement {
    return byTestId("case-form-investigations-preview-download");
  }

  get previewClose(): ChainablePromiseElement {
    return byTestId("case-form-investigations-preview-close");
  }

  // ---- waits / reads -----------------------------------------------------
  /** Wait until the empty-state ("No reports attached") is shown. */
  async waitForEmpty(timeout = 20000): Promise<void> {
    await this.empty.waitForDisplayed({ timeout });
  }

  /** Current number of attachment list items (0 when the list is absent). */
  async itemCount(): Promise<number> {
    if (!(await this.list.isExisting())) {
      return 0;
    }
    const items = await $(
      '[data-testid="case-form-investigations-list"]',
    ).$$('li');
    return items.length;
  }

  /** The uppercase badge text of item n (e.g. "PDF" / "IMAGE"). */
  async badgeText(n: number): Promise<string> {
    await this.badge(n).waitForDisplayed({ timeout: 15000 });
    return (await this.badge(n).getText()).trim();
  }

  /**
   * Click Upload and wait until the list has grown to `expectedCount` items.
   * The caller must have already set the HC_E2E_REPORT_FILE env on the driver
   * chain (and relaunched) so the seam returns the intended fixture path; this
   * only drives the in-webview click + waits for the resulting list growth.
   */
  async uploadAndWaitForCount(
    expectedCount: number,
    timeout = 30000,
  ): Promise<void> {
    await this.uploadButton.waitForClickable({ timeout: 15000 });
    await this.uploadButton.click();
    await browser.waitUntil(
      async () => (await this.itemCount()) === expectedCount,
      {
        timeout,
        timeoutMsg: `investigations list did not reach ${expectedCount} item(s) after upload`,
      },
    );
  }

  /** Set the optional caption before an upload. */
  async setCaption(text: string): Promise<void> {
    await this.caption.waitForDisplayed({ timeout: 15000 });
    await this.caption.setValue(text);
  }

  /** Open item n and wait for the in-app preview dialog. */
  async openItem(n: number, timeout = 20000): Promise<void> {
    await this.openButton(n).waitForClickable({ timeout: 15000 });
    await this.openButton(n).click();
    await this.preview.waitForDisplayed({ timeout });
  }

  /** Close the preview dialog and wait for it to disappear. */
  async closePreview(timeout = 15000): Promise<void> {
    await this.previewClose.waitForClickable({ timeout });
    await this.previewClose.click();
    await this.preview.waitForDisplayed({ reverse: true, timeout });
  }

  /**
   * Remove item n behind the confirm dialog and wait for the list to shrink to
   * `expectedCount` items (0 collapses to the empty-state).
   */
  async removeItemAndWaitForCount(
    n: number,
    expectedCount: number,
    timeout = 20000,
  ): Promise<void> {
    await this.removeButton(n).waitForClickable({ timeout: 15000 });
    await this.removeButton(n).click();
    await this.removeDialog.waitForDisplayed({ timeout: 15000 });
    await this.removeConfirm.waitForClickable({ timeout: 15000 });
    await this.removeConfirm.click();
    await browser.waitUntil(
      async () => (await this.itemCount()) === expectedCount,
      {
        timeout,
        timeoutMsg: `investigations list did not shrink to ${expectedCount} item(s) after remove`,
      },
    );
  }
}

export const investigationsPage = new InvestigationsPage();
