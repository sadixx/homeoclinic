// Page object for R5 billing: the S15 invoice of a visit, its Save/Discard
// leave dialog, the Clear dues dialog and the S16 receipt preview
// (apps/desktop/src/billing/InvoiceScreen.tsx, ClearDuesDialog.tsx,
// print/ReceiptPreview.tsx + ReceiptDocument.tsx; ADR 0021).
//
// hc-e2e-testing rule: data-testid selectors only; no sleeps — waitUntil /
// waitForDisplayed only. Amounts are shown as "Rs 1,234.00" (rupees() =
// common.duesPrefix + formatPaise, Indian grouping).
import { $, browser } from '@wdio/globals';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

/** The route of the S15 invoice of a visit. */
export function invoiceHash(patientId: string, visitId: string): string {
  return `#/patient/${patientId}/visit/${visitId}/invoice`;
}

export class BillingPage {
  // ---- S15 invoice -----------------------------------------------------------
  get screen(): ChainablePromiseElement {
    return byTestId('invoice-screen');
  }

  get number(): ChainablePromiseElement {
    return byTestId('invoice-number');
  }

  get total(): ChainablePromiseElement {
    return byTestId('invoice-total');
  }

  get paidTotal(): ChainablePromiseElement {
    return byTestId('invoice-paid-total');
  }

  get balance(): ChainablePromiseElement {
    return byTestId('invoice-balance');
  }

  get paid(): ChainablePromiseElement {
    return byTestId('invoice-paid');
  }

  get ref(): ChainablePromiseElement {
    return byTestId('invoice-ref');
  }

  get save(): ChainablePromiseElement {
    return byTestId('invoice-save');
  }

  get print(): ChainablePromiseElement {
    return byTestId('invoice-print');
  }

  get back(): ChainablePromiseElement {
    return byTestId('invoice-back');
  }

  get upiOpenSettings(): ChainablePromiseElement {
    return byTestId('invoice-upi-open-settings');
  }

  get saveError(): ChainablePromiseElement {
    return byTestId('invoice-save-error');
  }

  lineKind(n: number): ChainablePromiseElement {
    return byTestId(`invoice-line-kind-${n}`);
  }

  lineDesc(n: number): ChainablePromiseElement {
    return byTestId(`invoice-line-desc-${n}`);
  }

  lineQty(n: number): ChainablePromiseElement {
    return byTestId(`invoice-line-qty-${n}`);
  }

  lineRate(n: number): ChainablePromiseElement {
    return byTestId(`invoice-line-rate-${n}`);
  }

  lineAmount(n: number): ChainablePromiseElement {
    return byTestId(`invoice-line-amount-${n}`);
  }

  /** Wait for the loaded S15 screen (not the loading skeleton). */
  async waitForScreen(timeout = 20000): Promise<void> {
    await this.screen.waitForDisplayed({ timeout });
    await this.number.waitForDisplayed({ timeout });
  }

  /** Number of bill lines currently rendered. */
  async lineCount(): Promise<number> {
    return browser.execute(
      () => document.querySelectorAll('[data-testid^="invoice-line-kind-"]').length,
    );
  }

  /** The value of the line-kind <select> of line `n`. */
  async lineKindValue(n: number): Promise<string> {
    return this.lineKind(n).getValue();
  }

  /** Wait until line `n`'s computed amount reads `text` (e.g. "300.00"). */
  async waitForLineAmount(n: number, text: string, timeout = 15000): Promise<void> {
    await browser.waitUntil(async () => (await this.lineAmount(n).getText()).includes(text), {
      timeout,
      timeoutMsg: `invoice line ${n} amount never showed ${text}`,
    });
  }

  /** Add a medicine line and fill it (it becomes line `n`). */
  async addMedicine(n: number, desc: string, qty: string, rate: string, timeout = 15000): Promise<void> {
    const add = byTestId('invoice-add-medicine');
    await add.waitForClickable({ timeout });
    await add.click();
    await this.lineDesc(n).waitForDisplayed({ timeout });
    await this.lineDesc(n).setValue(desc);
    await this.lineQty(n).setValue(qty);
    await this.lineRate(n).setValue(rate);
  }

  /** Pick the payment mode radio (cash | upi | card | other). */
  async chooseMode(mode: string, timeout = 15000): Promise<void> {
    const radio = $(`[data-testid="invoice-mode"] input[value="${mode}"]`);
    await radio.waitForClickable({ timeout });
    await radio.click();
  }

  /** Type a payment amount (makes the bill dirty on a saved invoice). */
  async typePaid(amount: string, timeout = 15000): Promise<void> {
    await this.paid.waitForDisplayed({ timeout });
    await this.paid.setValue(amount);
  }

  async paidValue(): Promise<string> {
    return this.paid.getValue();
  }

  /** Click Save and wait until the screen shows a saved receipt number. */
  async saveAndWaitForNumber(timeout = 20000): Promise<string> {
    await this.save.waitForClickable({ timeout });
    await this.save.click();
    await browser.waitUntil(async () => /\d{4}-\d{2}\/\d{4}/.test(await this.number.getText()), {
      timeout,
      timeoutMsg: 'invoice Save did not produce a receipt number',
    });
    return this.number.getText();
  }

  /** Wait until the paid total and balance read the given texts. */
  async waitForPaidBalance(paid: string, balance: string, timeout = 20000): Promise<void> {
    await browser.waitUntil(
      async () =>
        (await this.paidTotal.isExisting()) &&
        (await this.paidTotal.getText()).includes(paid) &&
        (await this.balance.getText()).includes(balance),
      { timeout, timeoutMsg: `invoice paid/balance never read ${paid} / ${balance}` },
    );
  }

  async openReceipt(timeout = 15000): Promise<void> {
    await this.print.waitForClickable({ timeout });
    await this.print.click();
    await this.receiptDocument.waitForDisplayed({ timeout });
  }

  // ---- Save / Discard leave dialog ------------------------------------------
  get leaveDialog(): ChainablePromiseElement {
    return byTestId('invoice-leave-dialog');
  }

  get leaveStay(): ChainablePromiseElement {
    return byTestId('invoice-leave-stay');
  }

  get leaveDiscard(): ChainablePromiseElement {
    return byTestId('invoice-leave-discard');
  }

  get leaveSave(): ChainablePromiseElement {
    return byTestId('invoice-leave-save');
  }

  async waitForLeaveDialog(timeout = 10000): Promise<void> {
    await this.leaveDialog.waitForDisplayed({ timeout });
  }

  /** True when no leave dialog appears within `ms` (bounded negative wait). */
  async noLeaveDialogWithin(ms: number): Promise<boolean> {
    try {
      await this.leaveDialog.waitForDisplayed({ timeout: ms });
      return false;
    } catch {
      return true;
    }
  }

  async stay(timeout = 10000): Promise<void> {
    await this.leaveStay.waitForClickable({ timeout });
    await this.leaveStay.click();
    await this.leaveDialog.waitForDisplayed({ timeout, reverse: true });
  }

  async discard(timeout = 10000): Promise<void> {
    await this.leaveDiscard.waitForClickable({ timeout });
    await this.leaveDiscard.click();
  }

  // ---- Clear dues dialog -----------------------------------------------------
  get clearDialog(): ChainablePromiseElement {
    return byTestId('clear-dues-dialog');
  }

  get clearAmount(): ChainablePromiseElement {
    return byTestId('clear-dues-amount');
  }

  get clearResult(): ChainablePromiseElement {
    return byTestId('clear-dues-result');
  }

  async waitForClearDialog(timeout = 15000): Promise<void> {
    await this.clearDialog.waitForDisplayed({ timeout });
    await this.clearAmount.waitForDisplayed({ timeout });
  }

  /** The amount the dialog proposes (the patient's dues). */
  async clearAmountValue(timeout = 15000): Promise<string> {
    await browser.waitUntil(async () => (await this.clearAmount.getValue()) !== '', {
      timeout,
      timeoutMsg: 'Clear dues never prefilled the dues amount',
    });
    return this.clearAmount.getValue();
  }

  /** Record the dues payment and wait for the result panel; returns its text. */
  async clearDues(mode: string, reference: string, timeout = 20000): Promise<string> {
    await byTestId('clear-dues-mode').selectByAttribute('value', mode);
    await byTestId('clear-dues-ref').setValue(reference);
    const submit = byTestId('clear-dues-submit');
    await submit.waitForClickable({ timeout });
    await submit.click();
    await this.clearResult.waitForDisplayed({ timeout });
    return this.clearResult.getText();
  }

  async closeClearDialog(timeout = 15000): Promise<void> {
    const done = byTestId('clear-dues-done');
    await done.waitForClickable({ timeout });
    await done.click();
    await this.clearDialog.waitForDisplayed({ timeout, reverse: true });
  }

  // ---- S16 receipt preview ---------------------------------------------------
  get receiptDocument(): ChainablePromiseElement {
    return byTestId('receipt-document');
  }

  async receipt(): Promise<{ number: string; words: string; total: string; paid: string; balance: string }> {
    await this.receiptDocument.waitForDisplayed({ timeout: 15000 });
    return {
      number: await byTestId('receipt-number').getText(),
      words: await byTestId('receipt-words').getText(),
      total: await byTestId('receipt-total').getText(),
      paid: await byTestId('receipt-paid').getText(),
      balance: await byTestId('receipt-balance').getText(),
    };
  }

  async receiptBack(timeout = 15000): Promise<void> {
    const b = byTestId('receipt-back');
    await b.waitForClickable({ timeout });
    await b.click();
  }

  // ---- entry points ----------------------------------------------------------
  /** Case form strip "Bill this visit" (unbilled visit) -> S15. */
  async billFromCaseForm(timeout = 20000): Promise<void> {
    const b = byTestId('case-form-bill-visit');
    try {
      await b.waitForClickable({ timeout });
    } catch (e) {
      // Observable failure: say what the strip showed instead (error, chip, nothing).
      const strip = await browser.execute(() => {
        const s = document.querySelector('[data-testid="case-form-billing"]');
        const btn = document.querySelector('[data-testid="case-form-bill-visit"]');
        const r = btn?.getBoundingClientRect();
        return JSON.stringify({
          strip: s === null ? null : (s.textContent ?? '').replace(/\s+/g, ' ').trim(),
          button: btn === null ? null : { x: r?.x, y: r?.y, w: r?.width, h: r?.height, vh: window.innerHeight },
          hash: window.location.hash,
        });
      });
      throw new Error(`case-form-bill-visit not clickable: ${strip} (${String(e)})`);
    }
    await b.click();
    await this.waitForScreen(timeout);
  }

  /** Dashboard visit-row bill chip (billed visit) -> S15. */
  async openFromDashboardChip(visitId: string, timeout = 20000): Promise<void> {
    const chip = byTestId(`patient-dash-visit-billchip-${visitId}`);
    await chip.waitForClickable({ timeout });
    await chip.click();
    await this.waitForScreen(timeout);
  }

  /** Dashboard visit-row Bill button (unbilled visit) -> S15 for THAT visit. */
  async openFromDashboardBill(visitId: string, timeout = 20000): Promise<void> {
    const btn = byTestId(`patient-dash-visit-bill-${visitId}`);
    await btn.waitForClickable({ timeout });
    await btn.click();
    await this.waitForScreen(timeout);
  }

  /** The dashboard dues badge text. */
  async dashboardDues(): Promise<string> {
    const d = byTestId('patient-dash-dues');
    await d.waitForDisplayed({ timeout: 15000 });
    return d.getText();
  }

  async waitForDashboardDues(text: string, timeout = 15000): Promise<void> {
    await browser.waitUntil(async () => (await this.dashboardDues()).includes(text), {
      timeout,
      timeoutMsg: `dashboard dues never read ${text}`,
    });
  }

  async openClearDuesFromDashboard(timeout = 15000): Promise<void> {
    const b = byTestId('patient-dash-clear-dues');
    await b.waitForClickable({ timeout });
    await b.click();
    await this.waitForClearDialog(timeout);
  }

  // ---- shell exits used by the leave-guard checks ---------------------------
  get statusBackupChip(): ChainablePromiseElement {
    return byTestId('status-backup');
  }

  async clickStatusBackup(timeout = 15000): Promise<void> {
    await this.statusBackupChip.waitForClickable({ timeout });
    await this.statusBackupChip.click();
  }

  async hash(): Promise<string> {
    return browser.execute(() => window.location.hash);
  }

  async waitForHash(pred: (h: string) => boolean, what: string, timeout = 15000): Promise<string> {
    let last = '';
    await browser.waitUntil(
      async () => {
        last = await this.hash();
        return pred(last);
      },
      { timeout, timeoutMsg: `${what}: hash stayed ${last}` },
    );
    return last;
  }
}

export const billingPage = new BillingPage();
