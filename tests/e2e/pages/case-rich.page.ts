// Page object for the S08 case record — M3-RWv2 RICH-TEXT (TipTap) model
// (docs/ui/S08-case-form.md revised; ADR 0019; schema
// .worklog/HC-MVP1-M3/handoffs/M3-RWv2-serialization-v3.md).
//
// This SUPERSEDES the v2 journal-box page object for the rich editor flow. The
// case body is now ONE TipTap/ProseMirror contenteditable per complaint
// (`case-form-editor-<complaintId>`, class `ProseMirror hc-case-editor`): free
// prose, dated-entry headings, and record-button popups that INSERT editable
// tables (real <table data-hc-table-type>/<th>/<td>), each under a NUMBERED
// section heading (<h3 data-hc-section-no>) preceded by a full-width rule (<hr>).
//
// Why DOM queries, not per-cell testids: TipTap renders a native ProseMirror
// document. Cells are plain contenteditable <td>/<th>; headings carry
// `data-hc-section-no`; separators are `horizontalRule` <hr> nodes; tables
// carry `data-hc-table-type`. There is NO `data-testid` on individual cells
// (confirmed in caseRichEditor.ts HcAttributes + CaseForm.tsx). So structural
// reads go through the editor root element via browser.execute, and cell edits
// drive the real contenteditable (click to place the caret, type, blur).
//
// hc-e2e-testing rules honoured: specs use page objects; the only selectors are
// data-testid (controls) + scoped structural queries inside the editor root; no
// sleeps — all waits go through waitUntil / waitForDisplayed.
import { $, $$, browser } from '@wdio/globals';

import { appBarPage } from './appbar.page.js';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

/** The default (R3 single) complaint id. */
export const DEFAULT_CID = 'cc1';

/** Vitals a Record-vitals popup can seed (all optional; strings). */
export interface VitalsInput {
  sys?: string;
  dia?: string;
  pulse?: string;
  weight?: string;
  height?: string;
  temp?: string;
  spo2?: string;
}

/** A structural snapshot of one table in the editor (read via the DOM). */
export interface TableShape {
  tableType: string | null;
  rxPlaceholder: boolean;
  headers: string[];
  rows: string[][]; // body rows (excludes the header row)
}

export class CaseRichPage {
  // ---- shell / controls (data-testid) ------------------------------------
  get form(): ChainablePromiseElement {
    return byTestId('case-form');
  }

  get content(): ChainablePromiseElement {
    return byTestId('case-form-content');
  }

  editor(cid = DEFAULT_CID): ChainablePromiseElement {
    return byTestId(`case-form-editor-${cid}`);
  }

  get complaintTitle(): ChainablePromiseElement {
    return byTestId('case-form-complaint-title');
  }

  // M3-RWv4 §1: "Add new entry" (case-form-add-entry) was REMOVED. Only
  // "Add follow-up entry" + "Add new complaint" survive. Expose a presence
  // probe so specs can assert its ABSENCE.
  async hasAddEntryButton(): Promise<boolean> {
    return byTestId('case-form-add-entry').isExisting();
  }

  // ---- M3-RWv4 §3: list formatting toolbar -------------------------------
  get formatToolbar(): ChainablePromiseElement {
    return byTestId('case-form-format-toolbar');
  }

  get formatBulletButton(): ChainablePromiseElement {
    return byTestId('case-form-format-bullet');
  }

  get formatOrderedButton(): ChainablePromiseElement {
    return byTestId('case-form-format-ordered');
  }

  // ---- M3-RWv4 §4: modalities record button ------------------------------
  get recordModalitiesButton(): ChainablePromiseElement {
    return byTestId('case-form-modalities');
  }

  get modalitiesPopup(): ChainablePromiseElement {
    return byTestId('case-form-modalities-popup');
  }

  get modalitiesConfirm(): ChainablePromiseElement {
    return byTestId('case-form-modalities-confirm');
  }

  // ---- M3-RWv4 §5: remove controls + shared confirm dialog ---------------
  get removeControls(): ChainablePromiseElement {
    return byTestId('case-form-remove-controls');
  }

  complaintRemoveButton(complaintId: string): ChainablePromiseElement {
    return byTestId(`case-form-complaint-remove-${complaintId}`);
  }

  entryRemoveButton(n: number): ChainablePromiseElement {
    return byTestId(`case-form-entry-remove-${n}`);
  }

  get removeDialog(): ChainablePromiseElement {
    return byTestId('case-form-remove-dialog');
  }

  get removeConfirm(): ChainablePromiseElement {
    return byTestId('case-form-remove-confirm');
  }

  get removeCancel(): ChainablePromiseElement {
    return byTestId('case-form-remove-cancel');
  }

  get recordVitalsButton(): ChainablePromiseElement {
    return byTestId('case-form-record-vitals');
  }

  get recordFamilyButton(): ChainablePromiseElement {
    return byTestId('case-form-record-family');
  }

  get addPrescriptionButton(): ChainablePromiseElement {
    return byTestId('case-form-add-prescription');
  }

  get rxPlaceholderHint(): ChainablePromiseElement {
    return byTestId('case-form-rx-placeholder-hint');
  }

  get saveButton(): ChainablePromiseElement {
    return byTestId('case-form-save');
  }

  get saveStatus(): ChainablePromiseElement {
    return byTestId('case-form-save-status');
  }

  get back(): ChainablePromiseElement {
    return byTestId('case-form-back');
  }

  // M3-RWv3: the two extra complaint/entry actions beside "Add new entry".
  get addFollowupEntryButton(): ChainablePromiseElement {
    return byTestId('case-form-add-followup-entry');
  }

  get addComplaintButton(): ChainablePromiseElement {
    return byTestId('case-form-add-complaint');
  }

  // ---- vitals popup ------------------------------------------------------
  get vitalsPopup(): ChainablePromiseElement {
    return byTestId('case-form-vitals-popup');
  }

  get vitalsConfirm(): ChainablePromiseElement {
    return byTestId('case-form-record-vitals-confirm');
  }

  get vitalsBmi(): ChainablePromiseElement {
    return byTestId('case-vitals-bmi');
  }

  // ---- family popup ------------------------------------------------------
  get familyPopup(): ChainablePromiseElement {
    return byTestId('case-form-family-popup');
  }

  get familyMaternalTab(): ChainablePromiseElement {
    return byTestId('case-family-maternal');
  }

  get familyPaternalTab(): ChainablePromiseElement {
    return byTestId('case-family-paternal');
  }

  get familyMaternalInput(): ChainablePromiseElement {
    return byTestId('case-form-family-maternal-input');
  }

  get familyPaternalInput(): ChainablePromiseElement {
    return byTestId('case-form-family-paternal-input');
  }

  get familyConfirm(): ChainablePromiseElement {
    return byTestId('case-form-record-family-confirm');
  }

  // ---- waits -------------------------------------------------------------
  async waitForForm(timeout = 20000): Promise<void> {
    await this.form.waitForExist({ timeout });
    await this.form.waitForDisplayed({ timeout });
    await this.editor().waitForExist({ timeout });
    await this.editor().waitForDisplayed({ timeout });
  }

  async saveStatusText(): Promise<string> {
    await this.saveStatus.waitForExist({ timeout: 15000 });
    return (await this.saveStatus.getText()).trim();
  }

  async waitForSaved(timeout = 20000): Promise<string> {
    await browser.waitUntil(
      async () => (await this.saveStatusText()).startsWith('Saved'),
      { timeout, timeoutMsg: 'autosave did not reach the "Saved" status' },
    );
    return this.saveStatusText();
  }

  // ---- prose -------------------------------------------------------------
  /**
   * Type prose into the editor. TipTap renders a contenteditable
   * `.ProseMirror` INSIDE the testid wrapper; clicking the wrapper does not
   * focus it, so we focus the `.ProseMirror` node and place the caret at the
   * END of the document. If the last block is a heading (e.g. the opening
   * dated-entry heading of a fresh case), we press Enter first so the prose
   * lands in its own paragraph rather than being appended to the heading. A
   * trailing blur (click the complaint title) flushes autosave.
   */
  async typeProse(text: string, cid = DEFAULT_CID): Promise<void> {
    const ed = this.editor(cid);
    await ed.waitForDisplayed({ timeout: 15000 });
    // Focus the inner contenteditable, place the caret at the end of the doc,
    // open a fresh paragraph after a trailing heading, and insert the text
    // ATOMICALLY via execCommand('insertText'). Atomic insertion avoids the
    // dropped-repeated-character problem of per-key WebDriver typing (e.g.
    // "11am"/"bb" collapsing) while still driving ProseMirror's real input
    // path (beforeinput -> onUpdate -> autosave), so the behaviour under test
    // is unchanged.
    const ok = await browser.execute(
      (selector: string, value: string) => {
        const root = document.querySelector(selector);
        const pm = (root?.querySelector('.ProseMirror') ?? root) as HTMLElement | null;
        if (pm === null) return false;
        pm.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(pm);
        range.collapse(false); // caret to the very end
        sel?.removeAllRanges();
        sel?.addRange(range);
        const last = pm.lastElementChild;
        if (last !== null && /^H[1-6]$/.test(last.tagName)) {
          // Open a paragraph after the trailing heading via the Enter input.
          document.execCommand('insertParagraph');
        }
        return document.execCommand('insertText', false, value);
      },
      `[data-testid="case-form-editor-${cid}"]`,
      text,
    );
    if (ok !== true) {
      throw new Error('could not insert prose into the editor contenteditable');
    }
    await browser.waitUntil(async () => (await ed.getText()).includes(text), {
      timeout: 15000,
      timeoutMsg: 'typed prose did not appear in the editor',
    });
    await this.complaintTitle.click();
  }

  /** The visible text content of the whole editor (prose + table cells). */
  async editorText(cid = DEFAULT_CID): Promise<string> {
    const ed = this.editor(cid);
    await ed.waitForExist({ timeout: 15000 });
    return (await ed.getText()).trim();
  }

  // ---- structural reads via the editor DOM -------------------------------
  /** Number of dated-entry headings (h*[data-hc-kind="entry"]) in the editor. */
  async entryCount(cid = DEFAULT_CID): Promise<number> {
    return browser.execute((selector: string) => {
      const root = document.querySelector(selector);
      if (root === null) return 0;
      return root.querySelectorAll('[data-hc-kind="entry"]').length;
    }, `[data-testid="case-form-editor-${cid}"]`);
  }

  /** The ordered list of section numbers stamped on numbered headings. */
  async sectionNumbers(cid = DEFAULT_CID): Promise<number[]> {
    return browser.execute((selector: string) => {
      const root = document.querySelector(selector);
      if (root === null) return [] as number[];
      return Array.from(root.querySelectorAll('[data-hc-section-no]')).map((el) =>
        Number((el as HTMLElement).getAttribute('data-hc-section-no')),
      );
    }, `[data-testid="case-form-editor-${cid}"]`);
  }

  /** Number of full-width separators (horizontalRule <hr>) in the editor. */
  async separatorCount(cid = DEFAULT_CID): Promise<number> {
    return browser.execute((selector: string) => {
      const root = document.querySelector(selector);
      if (root === null) return 0;
      return root.querySelectorAll('hr').length;
    }, `[data-testid="case-form-editor-${cid}"]`);
  }

  /** Structural snapshot of every inserted table, in document order. */
  async tables(cid = DEFAULT_CID): Promise<TableShape[]> {
    return browser.execute((selector: string) => {
      const root = document.querySelector(selector);
      if (root === null) return [] as unknown[];
      const out: unknown[] = [];
      root.querySelectorAll('table').forEach((tbl) => {
        const rowsEls = Array.from(tbl.querySelectorAll('tr'));
        const headers: string[] = [];
        const rows: string[][] = [];
        rowsEls.forEach((tr) => {
          const ths = Array.from(tr.querySelectorAll('th'));
          const tds = Array.from(tr.querySelectorAll('td'));
          if (ths.length > 0) {
            ths.forEach((c) => headers.push((c.textContent ?? '').trim()));
          }
          if (tds.length > 0) {
            rows.push(tds.map((c) => (c.textContent ?? '').trim()));
          }
        });
        out.push({
          tableType: tbl.getAttribute('data-hc-table-type'),
          rxPlaceholder: tbl.getAttribute('data-hc-rx-placeholder') === 'true',
          headers,
          rows,
        });
      });
      return out;
    }, `[data-testid="case-form-editor-${cid}"]`) as Promise<TableShape[]>;
  }

  /** The first table whose hcTableType matches, or undefined. */
  async tableByType(type: string, cid = DEFAULT_CID): Promise<TableShape | undefined> {
    const all = await this.tables(cid);
    return all.find((t) => t.tableType === type);
  }

  /**
   * Edit the (row,col) BODY cell of the table with hcTableType `type`: click the
   * cell to place the caret inside its paragraph, select-all, type the new
   * value, then blur to flush autosave. Row/col are 0-based over body rows.
   */
  async editTableCell(
    type: string,
    row: number,
    col: number,
    value: string,
    cid = DEFAULT_CID,
  ): Promise<void> {
    // Focus the target cell's editable paragraph, select its contents, and
    // replace them ATOMICALLY via execCommand('insertText') (same rationale as
    // typeProse: avoids dropped repeated characters while driving ProseMirror's
    // real input path). Row/col are 0-based over body rows.
    const ok = await browser.execute(
      (selector: string, tType: string, r: number, c: number, value2: string) => {
        const root = document.querySelector(selector);
        if (root === null) return false;
        const tbl = Array.from(root.querySelectorAll('table')).find(
          (t) => t.getAttribute('data-hc-table-type') === tType,
        );
        if (tbl === undefined) return false;
        const bodyRows = Array.from(tbl.querySelectorAll('tr')).filter(
          (tr) => tr.querySelectorAll('td').length > 0,
        );
        const tr = bodyRows[r];
        if (tr === undefined) return false;
        const cell = Array.from(tr.querySelectorAll('td'))[c] as HTMLElement | undefined;
        if (cell === undefined) return false;
        const target = (cell.querySelector('p') ?? cell) as HTMLElement;
        target.focus();
        const range = document.createRange();
        range.selectNodeContents(target);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return document.execCommand('insertText', false, value2);
      },
      `[data-testid="case-form-editor-${cid}"]`,
      type,
      row,
      col,
      value,
    );
    if (ok !== true) {
      throw new Error(`cell (${type} r${row} c${col}) not found/editable in editor ${cid}`);
    }
    // Blur to flush autosave.
    await this.complaintTitle.click();
  }

  /** The text of a BODY cell of the table with hcTableType `type`. */
  async tableCellText(
    type: string,
    row: number,
    col: number,
    cid = DEFAULT_CID,
  ): Promise<string> {
    const t = await this.tableByType(type, cid);
    if (t === undefined) throw new Error(`no table of type ${type}`);
    const r = t.rows[row];
    if (r === undefined) throw new Error(`table ${type} has no body row ${row}`);
    return r[col] ?? '';
  }

  // ---- actions -----------------------------------------------------------
  async save(timeout = 15000): Promise<void> {
    await this.saveButton.waitForClickable({ timeout });
    await this.saveButton.click();
  }

  /**
   * Put the ProseMirror caret INSIDE a specific complaint by NAME via a real
   * WebDriver click on that complaint's header element. A native click is
   * essential: ProseMirror tracks its own `editor.state.selection`, which is
   * what "Add new entry"/"Add follow-up entry" read (currentComplaintName).
   * Directly mutating `window.getSelection()` does NOT update ProseMirror's
   * state, so the new entry would be attributed to the wrong complaint. The
   * click lands on the rendered h1[data-hc-kind="complaint"] whose text
   * contains `name`, which ProseMirror maps to a selection inside that
   * complaint section.
   */
  async focusComplaintByName(name: string, cid = DEFAULT_CID): Promise<void> {
    const sel = `[data-testid="case-form-editor-${cid}"] [data-hc-kind="complaint"]`;
    const els = await $$(sel);
    for (const el of els) {
      const txt = (await el.getText()).trim();
      if (txt.includes(name)) {
        await el.click();
        return;
      }
    }
    throw new Error(`complaint header containing "${name}" not found to focus`);
  }

  // ---- M3-RWv4 §1: complaint-heading standout ----------------------------
  /**
   * Computed boldness + underline of the complaint heading whose text contains
   * `name`, plus how many times `name` occurs in that heading's text. The
   * RWv4 CSS `.hc-case-editor h1[data-hc-kind='complaint']` sets
   * font-weight:700 + text-decoration:underline, and the name must render ONCE.
   */
  async complaintHeadingStyle(
    name: string,
    cid = DEFAULT_CID,
  ): Promise<{ fontWeight: number; underline: boolean; nameOccurrences: number; text: string }> {
    return browser.execute(
      (selector: string, nm: string) => {
        const root = document.querySelector(selector);
        const empty = { fontWeight: 0, underline: false, nameOccurrences: 0, text: '' };
        if (root === null) return empty;
        const h = Array.from(root.querySelectorAll("[data-hc-kind='complaint']")).find((el) =>
          ((el as HTMLElement).textContent ?? '').includes(nm),
        ) as HTMLElement | undefined;
        if (h === undefined) return empty;
        const cs = window.getComputedStyle(h);
        const deco = `${cs.textDecoration} ${cs.textDecorationLine}`;
        const text = (h.textContent ?? '').trim();
        const occ = nm.length === 0 ? 0 : text.split(nm).length - 1;
        return {
          fontWeight: Number.parseInt(cs.fontWeight, 10) || 0,
          underline: deco.includes('underline'),
          nameOccurrences: occ,
          text,
        };
      },
      `[data-testid="case-form-editor-${cid}"]`,
      name,
    ) as Promise<{ fontWeight: number; underline: boolean; nameOccurrences: number; text: string }>;
  }

  // ---- M3-RWv4 §3: lists -------------------------------------------------
  async toggleBulletList(timeout = 15000): Promise<void> {
    await this.formatBulletButton.waitForClickable({ timeout });
    await this.formatBulletButton.click();
  }

  async toggleOrderedList(timeout = 15000): Promise<void> {
    await this.formatOrderedButton.waitForClickable({ timeout });
    await this.formatOrderedButton.click();
  }

  /**
   * Exit the list the caret currently sits in and land in a FRESH top-level
   * paragraph after it. TipTap/ProseMirror lifts out of a list when Enter is
   * pressed on an EMPTY trailing list item; pressing it twice from the end of
   * the document guarantees an empty item first, then the lift. This keeps a
   * subsequently-created list a SEPARATE block (a `<ul>` and an `<ol>` can
   * then coexist) instead of the second toggle converting the first list in
   * place. The caret stays in entry body text the whole time (never on the
   * complaint heading), so the DEFECT 1 list guard is not engaged.
   */
  async exitListToNewParagraph(cid = DEFAULT_CID): Promise<void> {
    const ed = this.editor(cid);
    await ed.waitForDisplayed({ timeout: 15000 });
    const ok = await browser.execute((selector: string) => {
      const root = document.querySelector(selector);
      const pm = (root?.querySelector('.ProseMirror') ?? root) as HTMLElement | null;
      if (pm === null) return false;
      pm.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(pm);
      range.collapse(false); // caret to the very end (inside the last list item)
      sel?.removeAllRanges();
      sel?.addRange(range);
      // First Enter: open a new (empty) list item. Second Enter on the empty
      // item: ProseMirror lifts the caret out of the list into a paragraph.
      document.execCommand('insertParagraph');
      document.execCommand('insertParagraph');
      return true;
    }, `[data-testid="case-form-editor-${cid}"]`);
    if (ok !== true) {
      throw new Error('could not exit the list into a fresh paragraph');
    }
    // Blur to flush autosave, mirroring typeProse().
    await this.complaintTitle.click();
  }

  /** Counts of rendered list nodes inside the editor. */
  async listCounts(cid = DEFAULT_CID): Promise<{ ul: number; ol: number; li: number }> {
    return browser.execute((selector: string) => {
      const root = document.querySelector(selector);
      if (root === null) return { ul: 0, ol: 0, li: 0 };
      return {
        ul: root.querySelectorAll('ul').length,
        ol: root.querySelectorAll('ol').length,
        li: root.querySelectorAll('li').length,
      };
    }, `[data-testid="case-form-editor-${cid}"]`) as Promise<{ ul: number; ol: number; li: number }>;
  }

  /**
   * M3-RWv4 build-12 DEFECT 1 (DATA LOSS) guard state of the list toolbar.
   * When the ProseMirror caret is on a complaint heading the bullet + ordered
   * buttons are DISABLED (`disabled` + `aria-disabled='true'`) so a complaint
   * heading can never be wrapped into a list item and lost; they re-enable the
   * moment the caret moves into entry body text. Returns the webview-observable
   * enabled flag (from the native `disabled` attribute) and the `aria-disabled`
   * string for each button so a spec can prove the guard both ways.
   */
  async listToolbarGuardState(): Promise<{
    bulletEnabled: boolean;
    orderedEnabled: boolean;
    bulletAriaDisabled: string | null;
    orderedAriaDisabled: string | null;
  }> {
    await this.formatBulletButton.waitForExist({ timeout: 15000 });
    await this.formatOrderedButton.waitForExist({ timeout: 15000 });
    const [bulletEnabled, orderedEnabled, bulletAriaDisabled, orderedAriaDisabled] =
      await Promise.all([
        this.formatBulletButton.isEnabled(),
        this.formatOrderedButton.isEnabled(),
        this.formatBulletButton.getAttribute('aria-disabled'),
        this.formatOrderedButton.getAttribute('aria-disabled'),
      ]);
    return { bulletEnabled, orderedEnabled, bulletAriaDisabled, orderedAriaDisabled };
  }

  // ---- M3-RWv4 §4: modalities single-append table ------------------------
  /** Open Record modalities, fill factor/agg/amel, Record. Appends to the same table on re-press. */
  async recordModalities(
    factor: string,
    agg: string,
    amel: string,
    timeout = 15000,
  ): Promise<void> {
    await this.recordModalitiesButton.waitForClickable({ timeout });
    await this.recordModalitiesButton.click();
    const fill = async (testId: string, value: string): Promise<void> => {
      const el = byTestId(testId);
      await el.waitForDisplayed({ timeout });
      await el.setValue(value);
    };
    await fill('case-modalities-factor', factor);
    await fill('case-modalities-agg', agg);
    await fill('case-modalities-amel', amel);
    await this.modalitiesConfirm.waitForClickable({ timeout });
    await this.modalitiesConfirm.click();
  }

  /** Number of modalities tables (RWv4 §4: must stay 1 per entry). */
  async modalitiesTableCount(cid = DEFAULT_CID): Promise<number> {
    return browser.execute((selector: string) => {
      const root = document.querySelector(selector);
      if (root === null) return 0;
      return Array.from(root.querySelectorAll('table')).filter(
        (t) => t.getAttribute('data-hc-table-type') === 'modalities',
      ).length;
    }, `[data-testid="case-form-editor-${cid}"]`);
  }

  /** Body-row count of the (single) modalities table. */
  async modalitiesRowCount(cid = DEFAULT_CID): Promise<number> {
    const t = await this.tableByType('modalities', cid);
    return t?.rows.length ?? 0;
  }

  // ---- M3-RWv4 §5: remove with confirm + renumber ------------------------
  async removeComplaint(complaintId: string, timeout = 15000): Promise<void> {
    await this.complaintRemoveButton(complaintId).waitForClickable({ timeout });
    await this.complaintRemoveButton(complaintId).click();
    await this.removeDialog.waitForDisplayed({ timeout });
    await this.removeConfirm.waitForClickable({ timeout });
    await this.removeConfirm.click();
    await this.removeDialog.waitForDisplayed({ reverse: true, timeout });
  }

  async removeComplaintCancel(complaintId: string, timeout = 15000): Promise<void> {
    await this.complaintRemoveButton(complaintId).waitForClickable({ timeout });
    await this.complaintRemoveButton(complaintId).click();
    await this.removeDialog.waitForDisplayed({ timeout });
    await this.removeCancel.waitForClickable({ timeout });
    await this.removeCancel.click();
    await this.removeDialog.waitForDisplayed({ reverse: true, timeout });
  }

  async removeEntry(n: number, timeout = 15000): Promise<void> {
    await this.entryRemoveButton(n).waitForClickable({ timeout });
    await this.entryRemoveButton(n).click();
    await this.removeDialog.waitForDisplayed({ timeout });
    await this.removeConfirm.waitForClickable({ timeout });
    await this.removeConfirm.click();
    await this.removeDialog.waitForDisplayed({ reverse: true, timeout });
  }

  /**
   * M3-RWv5 C / b15-r1-f1: ONE synchronous DOM snapshot of the complaint
   * naming state — the complaint headers, whether the empty prompt exists, and
   * every complaint-remove control (id + aria-label). Taken in a single
   * browser.execute so the three facts describe the same instant.
   */
  async complaintNamingSnapshot(cid = DEFAULT_CID): Promise<{
    headers: { id: string | null; text: string }[];
    promptExists: boolean;
    removes: { testId: string; ariaLabel: string }[];
  }> {
    return browser.execute((selector: string) => {
      const root = document.querySelector(selector);
      const headers =
        root === null
          ? []
          : Array.from(root.querySelectorAll('[data-hc-kind="complaint"]')).map((el) => ({
              id: (el as HTMLElement).getAttribute('data-hc-complaint-id'),
              text: ((el as HTMLElement).textContent ?? '').trim(),
            }));
      const promptExists =
        document.querySelector('[data-testid="case-form-complaint-empty-prompt"]') !== null;
      const removes = Array.from(
        document.querySelectorAll('[data-testid^="case-form-complaint-remove-"]'),
      ).map((el) => ({
        testId: el.getAttribute('data-testid') ?? '',
        ariaLabel: el.getAttribute('aria-label') ?? '',
      }));
      return { headers, promptExists, removes };
    }, `[data-testid="case-form-editor-${cid}"]`) as Promise<{
      headers: { id: string | null; text: string }[];
      promptExists: boolean;
      removes: { testId: string; ariaLabel: string }[];
    }>;
  }

  /** Whether a complaint-remove control exists for the given id (floor-of-one probe). */
  async hasComplaintRemove(complaintId: string): Promise<boolean> {
    return this.complaintRemoveButton(complaintId).isExisting();
  }

  // ---- M3-RWv4 §6: bounded internal scroll -------------------------------
  /**
   * Scroll + overflow metrics of the editor box and whether it stays within
   * the content container (does not overflow past the record toolbar / Save).
   */
  async scrollMetrics(cid = DEFAULT_CID): Promise<{
    scrollHeight: number;
    clientHeight: number;
    overflowY: string;
    scrolls: boolean;
    withinContent: boolean;
  }> {
    return browser.execute((selector: string) => {
      const ed = document.querySelector(selector) as HTMLElement | null;
      const content = document.querySelector('[data-testid="case-form-content"]') as HTMLElement | null;
      if (ed === null) {
        return { scrollHeight: 0, clientHeight: 0, overflowY: 'visible', scrolls: false, withinContent: false };
      }
      const cs = window.getComputedStyle(ed);
      const edRect = ed.getBoundingClientRect();
      const contentRect = content?.getBoundingClientRect();
      const withinContent =
        contentRect === undefined
          ? true
          : edRect.bottom <= Math.ceil(contentRect.bottom) + 1;
      return {
        scrollHeight: ed.scrollHeight,
        clientHeight: ed.clientHeight,
        overflowY: cs.overflowY,
        scrolls: ed.scrollHeight > ed.clientHeight,
        withinContent,
      };
    }, `[data-testid="case-form-editor-${cid}"]`) as Promise<{
      scrollHeight: number;
      clientHeight: number;
      overflowY: string;
      scrolls: boolean;
      withinContent: boolean;
    }>;
  }

  /**
   * M3-RWv4 §1: "Add follow-up entry" appends a dated entry headed
   * `<complaint-name>-follow-up — <date>` under the CURRENT complaint (same
   * section), proving the follow-up suffix path.
   */
  async addFollowupEntry(timeout = 15000): Promise<void> {
    await this.addFollowupEntryButton.waitForClickable({ timeout });
    await this.addFollowupEntryButton.click();
  }

  /**
   * M3-RWv3: type a complaint name into the shared complaint-name input, then
   * click "Add new complaint". Production consumes the input value into a NEW
   * numbered complaint section (h1 hcKind=complaint, text "<no>. <name>") plus
   * its first dated entry headed `<name> — <date>`, and clears the input.
   */
  async addComplaint(name: string, timeout = 15000): Promise<void> {
    await this.complaintTitle.waitForDisplayed({ timeout });
    await this.complaintTitle.setValue(name);
    await this.addComplaintButton.waitForClickable({ timeout });
    await this.addComplaintButton.click();
  }

  /** Open Record vitals, fill the given fields (BP sys+dia are two fields), Record. */
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
    await fill('case-vitals-bp-sys', v.sys);
    await fill('case-vitals-bp-dia', v.dia);
    await fill('case-vitals-pulse', v.pulse);
    await fill('case-vitals-weight', v.weight);
    await fill('case-vitals-height', v.height);
    await fill('case-vitals-temp', v.temp);
    await fill('case-vitals-spo2', v.spo2);
    await this.vitalsConfirm.waitForClickable({ timeout });
    await this.vitalsConfirm.click();
    await this.vitalsPopup.waitForDisplayed({ reverse: true, timeout });
  }

  /** Open Record family history, fill Maternal + Paternal tabs, Record. */
  async recordFamily(
    maternal: string,
    paternal: string,
    timeout = 15000,
  ): Promise<void> {
    await this.recordFamilyButton.waitForClickable({ timeout });
    await this.recordFamilyButton.click();
    await this.familyPopup.waitForDisplayed({ timeout });
    await this.familyMaternalTab.click();
    await this.familyMaternalInput.waitForDisplayed({ timeout });
    await this.familyMaternalInput.setValue(maternal);
    await this.familyPaternalTab.click();
    await this.familyPaternalInput.waitForDisplayed({ timeout });
    await this.familyPaternalInput.setValue(paternal);
    await this.familyConfirm.waitForClickable({ timeout });
    await this.familyConfirm.click();
    await this.familyPopup.waitForDisplayed({ reverse: true, timeout });
  }

  get prescriptionPopup(): ChainablePromiseElement {
    return byTestId('case-form-prescription-popup');
  }

  get prescriptionConfirm(): ChainablePromiseElement {
    return byTestId('case-form-add-prescription-confirm');
  }

  /**
   * Open the Add-prescription popup, optionally seed the Medicine field, and
   * Record. Inserts a labelled R4 PLACEHOLDER medicine table.
   */
  async addPrescription(medicine?: string, timeout = 15000): Promise<void> {
    await this.addPrescriptionButton.waitForClickable({ timeout });
    await this.addPrescriptionButton.click();
    await this.prescriptionPopup.waitForDisplayed({ timeout });
    if (medicine !== undefined) {
      const el = byTestId('case-rx-medicine');
      await el.waitForDisplayed({ timeout });
      await el.setValue(medicine);
    }
    await this.prescriptionConfirm.waitForClickable({ timeout });
    await this.prescriptionConfirm.click();
    await this.prescriptionPopup.waitForDisplayed({ reverse: true, timeout });
  }

  async hasRxPlaceholderHint(): Promise<boolean> {
    return this.rxPlaceholderHint.isExisting();
  }

  async hasCaseSummary(): Promise<boolean> {
    return byTestId('case-form-case-summary').isExisting();
  }

  // ---- complaint sections & dated entries (M3-RWv3) ----------------------
  /**
   * Every numbered COMPLAINT-SECTION header in the document, in order. Each
   * complaint renders an h1 `data-hc-kind="complaint"` carrying
   * `data-hc-complaint-no`, `data-hc-complaint-id` and text `"<no>. <name>"`.
   */
  async complaintHeaders(cid = DEFAULT_CID): Promise<
    { no: number; id: string | null; text: string }[]
  > {
    return browser.execute((selector: string) => {
      const root = document.querySelector(selector);
      if (root === null) return [] as unknown[];
      return Array.from(root.querySelectorAll('[data-hc-kind="complaint"]')).map(
        (el) => {
          const h = el as HTMLElement;
          return {
            no: Number(h.getAttribute('data-hc-complaint-no')),
            id: h.getAttribute('data-hc-complaint-id'),
            text: (h.textContent ?? '').trim(),
          };
        },
      );
    }, `[data-testid="case-form-editor-${cid}"]`) as Promise<
      { no: number; id: string | null; text: string }[]
    >;
  }

  /**
   * Every dated-entry heading in the document, in order: its rendered text and
   * its entry kind (`first` | `follow_up`, from `data-hc-entry-kind`).
   */
  async entryHeadings(cid = DEFAULT_CID): Promise<{ text: string; kind: string | null }[]> {
    return browser.execute((selector: string) => {
      const root = document.querySelector(selector);
      if (root === null) return [] as unknown[];
      return Array.from(root.querySelectorAll('[data-hc-kind="entry"]')).map((el) => {
        const h = el as HTMLElement;
        return {
          text: (h.textContent ?? '').trim(),
          kind: h.getAttribute('data-hc-entry-kind'),
        };
      });
    }, `[data-testid="case-form-editor-${cid}"]`) as Promise<
      { text: string; kind: string | null }[]
    >;
  }

  /**
   * The computed border of the FIRST body cell of the table with hcTableType
   * `type`: width (px) and style, read from getComputedStyle. Proves the
   * RWv3 "visible table cell borders" CSS actually renders (border-width > 0
   * and border-style not 'none').
   */
  async tableCellBorder(
    type: string,
    cid = DEFAULT_CID,
  ): Promise<{ widthPx: number; style: string }> {
    return browser.execute(
      (selector: string, tType: string) => {
        const root = document.querySelector(selector);
        if (root === null) return { widthPx: 0, style: 'none' };
        const tbl = Array.from(root.querySelectorAll('table')).find(
          (t) => t.getAttribute('data-hc-table-type') === tType,
        );
        if (tbl === undefined) return { widthPx: 0, style: 'none' };
        const cell = tbl.querySelector('td') ?? tbl.querySelector('th');
        if (cell === null) return { widthPx: 0, style: 'none' };
        const cs = window.getComputedStyle(cell as HTMLElement);
        return {
          widthPx: Number.parseFloat(cs.borderTopWidth) || 0,
          style: cs.borderTopStyle,
        };
      },
      `[data-testid="case-form-editor-${cid}"]`,
      type,
    ) as Promise<{ widthPx: number; style: string }>;
  }

  // ---- app-level zoom (M3-RWv3 C8) ---------------------------------------
  /**
   * The current DOCUMENT-ROOT font-size in px. App-level zoom (AppShell C8)
   * sets `document.documentElement.style.fontSize = 14 * scale + 'px'`, so a
   * zoom-in must raise THIS value (the whole app scales), not an editor-only
   * override. Reads the inline value, falling back to the computed root size.
   */
  async rootFontPx(): Promise<number> {
    return browser.execute(() => {
      const root = document.documentElement;
      const inline = Number.parseFloat(root.style.fontSize);
      if (!Number.isNaN(inline) && inline > 0) return inline;
      return Number.parseFloat(window.getComputedStyle(root).fontSize);
    });
  }

  /** Click the shared APP-BAR zoom-in (scales the whole app via the root). */
  async zoomIn(timeout = 15000): Promise<void> {
    await appBarPage.zoomIn(timeout);
  }

  /** Click the shared APP-BAR zoom-out. */
  async zoomOut(timeout = 15000): Promise<void> {
    await appBarPage.zoomOut(timeout);
  }

  /** Click the shared APP-BAR zoom-reset (returns the root to baseline). */
  async zoomReset(timeout = 15000): Promise<void> {
    await appBarPage.zoomReset(timeout);
  }

  /** The editor's rendered width in px and the viewport width (for fullscreen). */
  async editorWidthVsViewport(cid = DEFAULT_CID): Promise<{ editor: number; viewport: number }> {
    return browser.execute((selector: string) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      const editor = el === null ? 0 : el.getBoundingClientRect().width;
      return { editor, viewport: window.innerWidth };
    }, `[data-testid="case-form-editor-${cid}"]`);
  }

  // ---- M3-RWv5 A: per-entry one-table-per-type ---------------------------
  /** RWv5 C: the prompt a fresh (unnamed) case shows instead of "Untitled complaint". */
  get complaintEmptyPrompt(): ChainablePromiseElement {
    return byTestId('case-form-complaint-empty-prompt');
  }

  /** Open Record physical generals, fill the four fields, Record. */
  async recordGenerals(
    v: { appetite: string; thirst: string; thermal: string; notes: string },
    timeout = 15000,
  ): Promise<void> {
    await byTestId('case-form-record-generals').waitForClickable({ timeout });
    await byTestId('case-form-record-generals').click();
    await byTestId('case-form-generals-popup').waitForDisplayed({ timeout });
    const fill = async (testId: string, value: string): Promise<void> => {
      const el = byTestId(testId);
      await el.waitForDisplayed({ timeout });
      await el.setValue(value);
    };
    await fill('case-generals-appetite', v.appetite);
    await fill('case-generals-thirst', v.thirst);
    await fill('case-generals-thermal', v.thermal);
    await fill('case-generals-notes', v.notes);
    await byTestId('case-form-record-generals-confirm').waitForClickable({ timeout });
    await byTestId('case-form-record-generals-confirm').click();
    await byTestId('case-form-generals-popup').waitForDisplayed({ reverse: true, timeout });
  }

  /** Open Record investigations, leave status Suggested, fill name + notes, Record. */
  async recordInvestigationSuggested(name: string, notes: string, timeout = 15000): Promise<void> {
    await byTestId('case-form-record-investigations').waitForClickable({ timeout });
    await byTestId('case-form-record-investigations').click();
    await byTestId('case-form-investigations-popup').waitForDisplayed({ timeout });
    await byTestId('case-investigations-name').waitForDisplayed({ timeout });
    await byTestId('case-investigations-name').setValue(name);
    await byTestId('case-investigations-notes').setValue(notes);
    await byTestId('case-form-record-investigations-confirm').waitForClickable({ timeout });
    await byTestId('case-form-record-investigations-confirm').click();
    await byTestId('case-form-investigations-popup').waitForDisplayed({ reverse: true, timeout });
  }

  /**
   * Type an EMPTY line after the prose line containing `afterText`: caret to
   * the END of that top-level paragraph, then Enter (insertParagraph) -> a new
   * empty paragraph right after it. This is what a doctor does (click at the
   * end of a line, press Enter) and it exercises RWv5's ProseMirror nodeSize
   * fix: an empty paragraph has nodeSize 2, which the old JSON-length caret
   * mapping mis-counted. Blurs afterwards like typeProse().
   */
  async typeEmptyLineAfter(afterText: string, cid = DEFAULT_CID): Promise<void> {
    const before = await this.topLevelBlockCount(cid);
    const ok = await browser.execute(
      (selector: string, needle: string) => {
        const root = document.querySelector(selector);
        const pm = (root?.querySelector('.ProseMirror') ?? root) as HTMLElement | null;
        if (pm === null) return false;
        const para = Array.from(pm.children).find(
          (c) => c.tagName === 'P' && (c.textContent ?? '').includes(needle),
        );
        if (para === undefined) return false;
        pm.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(para);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
        return document.execCommand('insertParagraph');
      },
      `[data-testid="case-form-editor-${cid}"]`,
      afterText,
    );
    if (ok !== true) throw new Error(`could not type an empty line after "${afterText}"`);
    await browser.waitUntil(async () => (await this.topLevelBlockCount(cid)) > before, {
      timeout: 15000,
      timeoutMsg: 'Enter did not add an empty paragraph',
    });
    await this.complaintTitle.click();
  }

  /** Count of top-level ProseMirror blocks (for the empty-line wait). */
  async topLevelBlockCount(cid = DEFAULT_CID): Promise<number> {
    return browser.execute((selector: string) => {
      const root = document.querySelector(selector);
      const pm = (root?.querySelector('.ProseMirror') ?? root) as HTMLElement | null;
      return pm === null ? 0 : pm.children.length;
    }, `[data-testid="case-form-editor-${cid}"]`);
  }

  /**
   * The tables of each dated entry, in document order. Walks the TOP-LEVEL
   * ProseMirror blocks; every `[data-hc-kind="entry"]` heading opens a new
   * entry and every table (TipTap may wrap it in div.tableWrapper) is
   * attributed to the entry it follows. `emptyParagraphs` counts empty
   * top-level <p> in the entry (proves the typed empty line is there).
   */
  async entryTables(cid = DEFAULT_CID): Promise<
    {
      heading: string;
      kind: string | null;
      emptyParagraphs: number;
      tables: { type: string | null; rows: string[][] }[];
    }[]
  > {
    return browser.execute((selector: string) => {
      const root = document.querySelector(selector);
      const pm = (root?.querySelector('.ProseMirror') ?? root) as HTMLElement | null;
      const out: {
        heading: string;
        kind: string | null;
        emptyParagraphs: number;
        tables: { type: string | null; rows: string[][] }[];
      }[] = [];
      if (pm === null) return out;
      for (const child of Array.from(pm.children)) {
        const el = child as HTMLElement;
        if (el.getAttribute('data-hc-kind') === 'entry') {
          out.push({
            heading: (el.textContent ?? '').trim(),
            kind: el.getAttribute('data-hc-entry-kind'),
            emptyParagraphs: 0,
            tables: [],
          });
          continue;
        }
        const cur = out[out.length - 1];
        if (cur === undefined) continue;
        if (el.tagName === 'P' && (el.textContent ?? '').trim() === '') cur.emptyParagraphs += 1;
        const tbls = el.tagName === 'TABLE' ? [el] : Array.from(el.querySelectorAll('table'));
        for (const tbl of tbls) {
          const rows = Array.from(tbl.querySelectorAll('tr'))
            .filter((tr) => tr.querySelectorAll('td').length > 0)
            .map((tr) => Array.from(tr.querySelectorAll('td')).map((c) => (c.textContent ?? '').trim()));
          cur.tables.push({ type: tbl.getAttribute('data-hc-table-type'), rows });
        }
      }
      return out;
    }, `[data-testid="case-form-editor-${cid}"]`) as Promise<
      {
        heading: string;
        kind: string | null;
        emptyParagraphs: number;
        tables: { type: string | null; rows: string[][] }[];
      }[]
    >;
  }

  /** Texts of every record-section heading (`[data-hc-section-no]`), in order. */
  async sectionHeadingTexts(cid = DEFAULT_CID): Promise<string[]> {
    return browser.execute((selector: string) => {
      const root = document.querySelector(selector);
      if (root === null) return [] as string[];
      return Array.from(root.querySelectorAll('[data-hc-section-no]')).map((el) =>
        ((el as HTMLElement).textContent ?? '').trim(),
      );
    }, `[data-testid="case-form-editor-${cid}"]`);
  }

  // ---- navigation --------------------------------------------------------
  async openVisit(patientId: string, visitId: string, timeout = 20000): Promise<void> {
    await browser.execute(
      (pid: string, vid: string) => {
        window.location.hash = `#/patient/${encodeURIComponent(pid)}/case/${encodeURIComponent(vid)}`;
      },
      patientId,
      visitId,
    );
    await this.waitForForm(timeout);
  }

  async openFollowupVisit(patientId: string, visitId: string, timeout = 20000): Promise<void> {
    await browser.execute(
      (pid: string, vid: string) => {
        window.location.hash = `#/patient/${encodeURIComponent(pid)}/case/${encodeURIComponent(vid)}/followup`;
      },
      patientId,
      visitId,
    );
    await this.waitForForm(timeout);
  }

  async routeIds(): Promise<{ patientId: string; visitId: string }> {
    const hash = await browser.execute(() => window.location.hash);
    const m = /#\/patient\/([^/]+)\/case\/([^/?]+)/.exec(hash);
    if (m === null || m[1] === undefined || m[2] === undefined) {
      throw new Error(`case route not found in hash: ${hash}`);
    }
    return { patientId: decodeURIComponent(m[1]), visitId: decodeURIComponent(m[2]) };
  }
}

export const caseRichPage = new CaseRichPage();
