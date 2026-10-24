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
  // ---- M3-RWv4: Record-investigations popup + Suggested/Submitted DROPDOWN -
  // The RWv4 flow replaces the old Suggested/Submitted TABS with a native
  // <select> inside the Record-investigations popup. Opening the popup is the
  // "case-form-record-investigations" record button; the dropdown chooses
  // Suggested (free text) or Submitted; choosing Submitted opens the
  // SubmitReportPopup (upload-new + pick-existing).
  get recordButton(): ChainablePromiseElement {
    return byTestId("case-form-record-investigations");
  }

  get recordPopup(): ChainablePromiseElement {
    return byTestId("case-form-investigations-popup");
  }

  get nameField(): ChainablePromiseElement {
    return byTestId("case-investigations-name");
  }

  get statusSelect(): ChainablePromiseElement {
    return byTestId("case-investigations-status-select");
  }

  // ---- Submitted popup (upload-new + pick-existing) ----------------------
  get submitPopup(): ChainablePromiseElement {
    return byTestId("case-form-investigation-submit-popup");
  }

  get submitUpload(): ChainablePromiseElement {
    return byTestId("case-form-investigation-submit-upload");
  }

  get submitCancel(): ChainablePromiseElement {
    return byTestId("case-form-investigation-submit-cancel");
  }

  get uploadWarning(): ChainablePromiseElement {
    return byTestId("case-form-investigation-upload-warning");
  }

  get submitPickList(): ChainablePromiseElement {
    return byTestId("case-form-investigation-submit-pick-list");
  }

  submitPickItem(n: number): ChainablePromiseElement {
    return byTestId(`case-form-investigation-submit-pick-item-${n}`);
  }

  get submitPickConfirm(): ChainablePromiseElement {
    return byTestId("case-form-investigation-submit-pick-confirm");
  }

  // ---- investigation link rows + UNLINK ----------------------------------
  get linkList(): ChainablePromiseElement {
    return byTestId("case-form-investigation-links");
  }

  unlinkButton(n: number): ChainablePromiseElement {
    return byTestId(`case-form-investigation-unlink-${n}`);
  }

  get unlinkDialog(): ChainablePromiseElement {
    return byTestId("case-form-investigation-unlink-dialog");
  }

  get unlinkConfirm(): ChainablePromiseElement {
    return byTestId("case-form-investigation-unlink-confirm");
  }

  get unlinkCancel(): ChainablePromiseElement {
    return byTestId("case-form-investigation-unlink-cancel");
  }

  /**
   * Open the Record-investigations popup, type the investigation name, and
   * select the Submitted status in the dropdown so the SubmitReportPopup opens.
   */
  async openSubmittedFor(investigation: string, timeout = 15000): Promise<void> {
    await this.recordButton.waitForClickable({ timeout });
    await this.recordButton.click();
    await this.recordPopup.waitForDisplayed({ timeout });
    await this.nameField.waitForDisplayed({ timeout });
    await this.nameField.setValue(investigation);
    await this.statusSelect.waitForDisplayed({ timeout });
    await this.statusSelect.selectByAttribute("value", "submitted");
    await this.submitPopup.waitForDisplayed({ timeout });
  }

  /**
   * Click upload-new in the Submitted popup. The caller must already have armed
   * the HC_E2E_REPORT_FILE seam (set env + relaunchInto) so the typed
   * visit_pick_report_file returns the fixture instead of the native picker.
   * After a successful upload the popups close and a link row appears.
   */
  async uploadNewAndWaitForLink(expectedLinks: number, timeout = 30000): Promise<void> {
    await this.submitUpload.waitForClickable({ timeout: 15000 });
    await this.submitUpload.click();
    await browser.waitUntil(
      async () => (await this.linkCount()) === expectedLinks,
      {
        timeout,
        timeoutMsg: `investigation link rows did not reach ${expectedLinks} after upload`,
      },
    );
  }

  /** Current number of investigation link rows (0 when the list is absent). */
  async linkCount(): Promise<number> {
    if (!(await this.linkList.isExisting())) return 0;
    const items = await $('[data-testid="case-form-investigation-links"]').$$("li");
    return items.length;
  }

  /** The visible display label of link row n (1-based). */
  async linkLabel(n: number): Promise<string> {
    // The row is `<li><span>{label}</span><button>unlink…</button></li>`. Read
    // the FIRST span's textContent via the DOM (NOT WebDriver getText(), which
    // returns empty for the `truncate`/`min-w-0` label span under
    // WebKitWebDriver) so the display label is captured without the unlink
    // button text.
    const label = await browser.execute((index: number) => {
      const list = document.querySelector('[data-testid="case-form-investigation-links"]');
      if (list === null) return "";
      const li = list.querySelectorAll("li")[index - 1];
      if (li === undefined) return "";
      const span = li.querySelector("span");
      return ((span ?? li).textContent ?? "").trim();
    }, n);
    if (label === "") throw new Error(`investigation link row ${n} not found`);
    return label;
  }

  /** Unlink row n behind the confirm dialog and wait for the link count to fall. */
  async unlinkAndWaitForCount(n: number, expected: number, timeout = 20000): Promise<void> {
    await this.unlinkButton(n).waitForClickable({ timeout: 15000 });
    await this.unlinkButton(n).click();
    await this.unlinkDialog.waitForDisplayed({ timeout: 15000 });
    await this.unlinkConfirm.waitForClickable({ timeout: 15000 });
    await this.unlinkConfirm.click();
    await browser.waitUntil(async () => (await this.linkCount()) === expected, {
      timeout,
      timeoutMsg: `investigation link rows did not fall to ${expected} after unlink`,
    });
  }

  // ---- legacy caption/list helpers (still used by non-RWv4 flows) --------
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
