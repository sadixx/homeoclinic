// Page object for the S08 case record — doctor-journal model (docs/ui/
// S08-case-form.md revised; ADR 0018; schema M3-RW-data-json-schema.md).
// hc-e2e-testing rule: specs use page objects; selectors are data-testid only,
// never raw CSS/XPath in specs. No sleeps — all waits go through waitUntil /
// WebdriverIO auto-waiting waitForDisplayed.
//
// The journal case form is one BIG editable box per complaint: a dated running
// log of editable text + table blocks. A brand-new first case opens with ONE
// complaint ("cc1") that has ONE dated entry with NO blocks, so a text block is
// created by "Add text" or "Add entry". Buttons insert editable tables:
// Record vitals (a popup seeds the first row), Add prescription (a labelled
// placeholder medicine table). The explicit Save button force-flushes autosave
// (CASE-005). Structured side sections (family Maternal/Paternal tabs,
// investigations Suggested/Submitted tabs, generals, diagnosis) live in a
// COLLAPSED rail — expand the section before its fields/tabs are in the DOM.
//
// Table cell test ids (schema §4): body cell `case-cell-<cid>-<bid>-<r>-<c>`,
// header cell `case-cell-<cid>-<bid>-h-<c>`. The default complaint id is "cc1".
import { $, $$, browser } from "@wdio/globals";

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

/** The vitals a Record-vitals popup can seed (all optional; strings). */
export interface VitalsInput {
  sys?: string;
  dia?: string;
  pulse?: string;
  weight?: string;
  height?: string;
  temp?: string;
  spo2?: string;
}

export class CasePage {
  // ---- shell -------------------------------------------------------------
  get form(): ChainablePromiseElement {
    return byTestId("case-form");
  }

  get content(): ChainablePromiseElement {
    return byTestId("case-form-content");
  }

  get journalBox(): ChainablePromiseElement {
    return byTestId("case-form-journal-box");
  }

  get saveStatus(): ChainablePromiseElement {
    return byTestId("case-form-save-status");
  }

  get saveButton(): ChainablePromiseElement {
    return byTestId("case-form-save");
  }

  get back(): ChainablePromiseElement {
    return byTestId("case-form-back");
  }

  get complaintTitle(): ChainablePromiseElement {
    return byTestId("case-form-complaint-title");
  }

  // ---- journal controls --------------------------------------------------
  get addEntryButton(): ChainablePromiseElement {
    return byTestId("case-form-add-entry");
  }

  get addTextButton(): ChainablePromiseElement {
    return byTestId("case-form-add-text");
  }

  get recordVitalsButton(): ChainablePromiseElement {
    return byTestId("case-form-record-vitals");
  }

  get addPrescriptionButton(): ChainablePromiseElement {
    return byTestId("case-form-add-prescription");
  }

  get rxPlaceholderHint(): ChainablePromiseElement {
    return byTestId("case-form-rx-placeholder-hint");
  }

  /** A dated entry header for complaint `cid` at 0-based index `idx`. */
  entryHeader(cid: string, idx: number): ChainablePromiseElement {
    return byTestId(`case-form-entry-${cid}-${idx}`);
  }

  /** A block element (text textarea or table wrapper) by complaint + block id. */
  block(cid: string, bid: string): ChainablePromiseElement {
    return byTestId(`case-block-${cid}-${bid}`);
  }

  /** A body cell input of a table block. */
  cell(cid: string, bid: string, row: number, col: number): ChainablePromiseElement {
    return byTestId(`case-cell-${cid}-${bid}-${row}-${col}`);
  }

  /** A header (column) cell input of a table block. */
  headerCell(cid: string, bid: string, col: number): ChainablePromiseElement {
    return byTestId(`case-cell-${cid}-${bid}-h-${col}`);
  }

  // ---- vitals popup ------------------------------------------------------
  get vitalsPopup(): ChainablePromiseElement {
    return byTestId("case-form-vitals-popup");
  }

  get vitalsConfirm(): ChainablePromiseElement {
    return byTestId("case-form-record-vitals-confirm");
  }

  get vitalsCancel(): ChainablePromiseElement {
    return byTestId("case-form-record-vitals-cancel");
  }

  get vitalsBmi(): ChainablePromiseElement {
    return byTestId("case-vitals-bmi");
  }

  // ---- side-section rail -------------------------------------------------
  section(key: string): ChainablePromiseElement {
    return byTestId(`case-form-section-${key}`);
  }

  get familyMaternalTab(): ChainablePromiseElement {
    return byTestId("case-form-family-maternal-tab");
  }

  get familyPaternalTab(): ChainablePromiseElement {
    return byTestId("case-form-family-paternal-tab");
  }

  get familyMaternal(): ChainablePromiseElement {
    return byTestId("case-form-family-maternal");
  }

  get familyPaternal(): ChainablePromiseElement {
    return byTestId("case-form-family-paternal");
  }

  get investSuggestedTab(): ChainablePromiseElement {
    return byTestId("case-form-invest-suggested-tab");
  }

  get investSubmittedTab(): ChainablePromiseElement {
    return byTestId("case-form-invest-submitted-tab");
  }

  get investSuggested(): ChainablePromiseElement {
    return byTestId("case-form-invest-suggested");
  }

  // ---- waits -------------------------------------------------------------
  async waitForForm(timeout = 20000): Promise<void> {
    await this.form.waitForExist({ timeout });
    await this.form.waitForDisplayed({ timeout });
    await this.journalBox.waitForDisplayed({ timeout });
  }

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

  async saveStatusText(): Promise<string> {
    await this.saveStatus.waitForExist({ timeout: 15000 });
    return (await this.saveStatus.getText()).trim();
  }

  // ---- actions -----------------------------------------------------------
  /** Click the explicit Save button (force-flush autosave). */
  async save(timeout = 15000): Promise<void> {
    await this.saveButton.waitForClickable({ timeout });
    await this.saveButton.click();
  }

  /** Click "Add text" to append a fresh text block to the newest entry. */
  async addTextBlock(timeout = 15000): Promise<void> {
    await this.addTextButton.waitForClickable({ timeout });
    await this.addTextButton.click();
  }

  /** Click "Add entry" to append a NEW dated entry (with a fresh text block). */
  async addEntry(timeout = 15000): Promise<void> {
    await this.addEntryButton.waitForClickable({ timeout });
    await this.addEntryButton.click();
  }

  /**
   * The id (`b<n>`) of the first text-block textarea currently in the journal
   * box, parsed from its data-testid. The brand-new first case has no block
   * until Add text / Add entry is clicked, so call that first.
   */
  async firstBlockId(cid = "cc1", timeout = 15000): Promise<string> {
    await browser.waitUntil(
      async () => (await this.blockTestIds(cid)).length > 0,
      { timeout, timeoutMsg: "no block appeared in the journal box" },
    );
    const ids = await this.blockTestIds(cid);
    const first = ids[0];
    if (first === undefined) throw new Error("no block id found");
    return first;
  }

  /** Every block id (`b<n>`) present for complaint `cid`, in DOM order. */
  async blockTestIds(cid = "cc1"): Promise<string[]> {
    const els = await $$(`[data-testid^="case-block-${cid}-"]`);
    const out: string[] = [];
    for await (const el of els) {
      const testId = await el.getAttribute("data-testid");
      // Skip the per-block remove button (case-block-remove-<bid>).
      const m = new RegExp(`^case-block-${cid}-(b\\d+)$`).exec(testId ?? "");
      if (m && m[1] !== undefined) out.push(m[1]);
    }
    return out;
  }

  /** Number of dated entry headers present for complaint `cid`. */
  async entryCount(cid = "cc1"): Promise<number> {
    const els = await $$(`[data-testid^="case-form-entry-${cid}-"]`);
    return els.length;
  }

  /** Type into a text block textarea by id. */
  async typeInBlock(cid: string, bid: string, text: string): Promise<void> {
    const el = this.block(cid, bid);
    await el.waitForDisplayed({ timeout: 15000 });
    await el.setValue(text);
  }

  /** Read the current value of a block textarea by id. */
  async blockValue(cid: string, bid: string): Promise<string> {
    const el = this.block(cid, bid);
    await el.waitForExist({ timeout: 15000 });
    return (await el.getValue()) ?? "";
  }

  /**
   * Open the Record-vitals popup, fill the given fields (BP sys + dia are TWO
   * separate fields — ADR 0018 #3), and confirm. The app inserts an editable
   * vitals table block into the newest entry.
   */
  async recordVitals(v: VitalsInput, timeout = 15000): Promise<void> {
    await this.recordVitalsButton.waitForClickable({ timeout });
    await this.recordVitalsButton.click();
    await this.vitalsPopup.waitForDisplayed({ timeout });
    const fill = async (testId: string, value?: string): Promise<void> => {
      if (value === undefined) return;
      const el = byTestId(testId);
      await el.waitForDisplayed({ timeout });
      await el.setValue(value);
    };
    await fill("case-vitals-bp-sys", v.sys);
    await fill("case-vitals-bp-dia", v.dia);
    await fill("case-vitals-pulse", v.pulse);
    await fill("case-vitals-weight", v.weight);
    await fill("case-vitals-height", v.height);
    await fill("case-vitals-temp", v.temp);
    await fill("case-vitals-spo2", v.spo2);
    await this.vitalsConfirm.waitForClickable({ timeout });
    await this.vitalsConfirm.click();
    await this.vitalsPopup.waitForDisplayed({ reverse: true, timeout });
  }

  /** Click "Add prescription" to insert a placeholder medicine table. */
  async addPrescription(timeout = 15000): Promise<void> {
    await this.addPrescriptionButton.waitForClickable({ timeout });
    await this.addPrescriptionButton.click();
  }

  /** True when the rx-placeholder hint note is shown. */
  async hasRxPlaceholderHint(): Promise<boolean> {
    return this.rxPlaceholderHint.isExisting();
  }

  /** Edit a table body cell and blur to flush autosave. */
  async editCell(
    cid: string,
    bid: string,
    row: number,
    col: number,
    value: string,
  ): Promise<void> {
    const el = this.cell(cid, bid, row, col);
    await el.waitForDisplayed({ timeout: 15000 });
    await el.setValue(value);
    // Blur onto the complaint title to fire the onBlur autosave flush.
    await this.complaintTitle.click();
  }

  /** Read a table body cell value. */
  async cellValue(cid: string, bid: string, row: number, col: number): Promise<string> {
    const el = this.cell(cid, bid, row, col);
    await el.waitForExist({ timeout: 15000 });
    return (await el.getValue()) ?? "";
  }

  /** The block id of the only/first table block present for `cid` (vitals/rx). */
  async tableBlockIds(cid = "cc1"): Promise<string[]> {
    // A table block wrapper shares the case-block-<cid>-<bid> id with text
    // blocks; distinguish by the presence of a header cell (case-cell-...-h-0).
    const ids = await this.blockTestIds(cid);
    const out: string[] = [];
    for (const bid of ids) {
      // eslint-disable-next-line no-await-in-loop
      if (await this.headerCell(cid, bid, 0).isExisting()) out.push(bid);
    }
    return out;
  }

  /** True when a Case summary control is present (must be ABSENT, ADR 0018 #5). */
  async hasCaseSummary(): Promise<boolean> {
    return byTestId("case-form-case-summary").isExisting();
  }

  /** Expand a collapsed side-section; optionally wait for a field to render. */
  async expandSection(
    key: string,
    waitForTestId?: string,
    timeout = 15000,
  ): Promise<void> {
    await this.section(key).waitForDisplayed({ timeout });
    if ((await this.section(key).getAttribute("aria-expanded")) !== "true") {
      await this.section(key).click();
    }
    if (waitForTestId !== undefined) {
      await byTestId(waitForTestId).waitForDisplayed({ timeout });
    }
  }

  // ---- navigation --------------------------------------------------------
  /** Deep-link the HashRouter to a visit's journal case form. */
  async openVisit(patientId: string, visitId: string, timeout = 20000): Promise<void> {
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
   * Deep-link the HashRouter to a visit's journal case form in FOLLOW-UP mode
   * (ADR 0018 #2): `/patient/:id/case/:vid/followup` renders the SAME journal
   * CaseForm with visitType='follow_up', so the box pre-opens with the prior
   * visit's content, the prior complaints pre-load (VIS-002) and the insert
   * buttons read "Update vitals"/"Update prescription". This is the deep-linkable
   * entry the dashboard "Follow-up" button navigates to.
   */
  async openFollowupVisit(
    patientId: string,
    visitId: string,
    timeout = 20000,
  ): Promise<void> {
    await browser.execute(
      (pid: string, vid: string) => {
        window.location.hash = `#/patient/${encodeURIComponent(
          pid,
        )}/case/${encodeURIComponent(vid)}/followup`;
      },
      patientId,
      visitId,
    );
    await this.waitForForm(timeout);
  }

  /** The current value of a complaint-title input (the pre-loaded title, VIS-002). */
  async complaintTitleValue(timeout = 15000): Promise<string> {
    await this.complaintTitle.waitForDisplayed({ timeout });
    return (await this.complaintTitle.getValue()) ?? "";
  }

  /** The visible label of the Record/Update-vitals button (follow-up reads "Update vitals"). */
  async recordVitalsButtonText(timeout = 15000): Promise<string> {
    await this.recordVitalsButton.waitForDisplayed({ timeout });
    return (await this.recordVitalsButton.getText()).trim();
  }

  /** The visible label of the Add/Update-prescription button (follow-up reads "Update prescription"). */
  async addPrescriptionButtonText(timeout = 15000): Promise<string> {
    await this.addPrescriptionButton.waitForDisplayed({ timeout });
    return (await this.addPrescriptionButton.getText()).trim();
  }

  /** Parse patientId + visitId from the self-navigated case hash. */
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
}

export const casePage = new CasePage();
