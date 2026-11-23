// R5 — S15 Invoice: races and mid-edit states of the live totals.
// Review findings on 9e6fda9 (invoice totals are now requested for the
// COMPLETE lines only and mapped back to rows by line key). Each test below
// is a user-visible edge case of that change and is written FAILING-FIRST
// against the current screen.
//
//   A (hc-review-1)  A totals request still in flight when Save succeeds must
//                    not blank the saved rows when its late response lands.
//   B (hc-review-2)  While any line is incomplete the screen must not show a
//                    backend error banner (e.g. "discount exceeds subtotal"
//                    caused by the half-typed line being left out of the sum).
//   C (hc-review-3)  A failed Save's "fill in every line" message must not be
//                    wiped by an unrelated successful totals response while an
//                    incomplete line is still on the bill.
//   D (hc-review-4)  After a dirty draft is restored, no row may show the
//                    amount of a DIFFERENT loaded line that merely shares the
//                    same row key, until the recompute for the draft lands.
//
// Timing: fake timers (the screen's 100 ms debounce is elapsed explicitly,
// never slept) and a controllable fake `invoiceComputeTotals` whose responses
// can be held and released by the test. No real sleeps.
//
// CUT: the REAL <InvoiceScreen />. Only `@/bindings` is faked. The fake totals
// backend validates like `hc_domain::billing::compute_totals` (non-empty
// description, qty >= 1) and rejects a discount larger than the subtotal.
// Synthetic data.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { invoiceGetForVisit, invoiceComputeTotals, invoiceSave, invoiceUpiQr } =
  vi.hoisted(() => ({
    invoiceGetForVisit: vi.fn(),
    invoiceComputeTotals: vi.fn(),
    invoiceSave: vi.fn(),
    invoiceUpiQr: vi.fn(),
  }));

vi.mock('@/bindings', () => ({
  commands: {
    invoiceGetForVisit,
    invoiceComputeTotals,
    invoiceSave,
    paymentAdd: vi.fn(),
    paymentVoid: vi.fn(),
    invoiceVoid: vi.fn(),
    invoiceUpiQr,
  },
}));

import type { ComputeTotalsRequest } from '@/bindings';
import {
  billedScreen,
  consultationLine,
  fail,
  ok,
  unbilledScreen,
  upiQr,
} from '@/test/billingFixtures';
import { clearInvoiceDraft, holdInvoiceDraft } from './invoiceDraft';
import { InvoiceScreen } from './InvoiceScreen';

const DASH = '—';
const TOTALS_DEBOUNCE_MS = 100;
/** en.json `billing.error.lines`. */
const LINES_ERROR = 'Fill in the description, quantity and rate of every line.';

const byPrefix = (prefix: string) =>
  screen.getAllByTestId(new RegExp(`^${prefix}\\d+$`));

const total = () => screen.getByTestId('invoice-total');
const amountOf = (n: number) => screen.getByTestId(`invoice-line-amount-${n}`);
const banner = () => screen.queryByTestId('invoice-save-error');

/** Mirrors the real backend validation (A18) + arithmetic + discount rule. */
function backendTotals(req: ComputeTotalsRequest) {
  if (req.lines.length === 0) return fail('validation', 'No lines.');
  for (const l of req.lines) {
    if (l.description.trim() === '' || l.qty < 1) {
      return fail('validation', 'Check the bill lines.');
    }
  }
  const amounts = req.lines.map((l) => l.qty * l.ratePaise);
  const subtotal = amounts.reduce((a, b) => a + b, 0);
  const discount =
    req.discount.kind === 'amount'
      ? req.discount.paise
      : req.discount.kind === 'percent'
        ? Math.floor((subtotal * req.discount.basisPoints + 5000) / 10000)
        : 0;
  if (discount > subtotal) {
    return fail('validation', 'discount exceeds subtotal');
  }
  return ok({
    lineAmountsPaise: amounts,
    subtotalPaise: subtotal,
    discountPaise: discount,
    totalPaise: subtotal - discount,
  });
}

/** A totals request that the test holds back until it releases it. */
interface Held {
  readonly req: ComputeTotalsRequest;
  readonly release: () => void;
}
let holding = false;
let held: Held[] = [];

/** Elapse fake time (the screen's debounce) and let its response land. */
async function elapse(ms = TOTALS_DEBOUNCE_MS * 3): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Release every held totals response, in request order, and let it land. */
async function releaseHeld(): Promise<void> {
  const batch = held;
  held = [];
  await act(async () => {
    for (const h of batch) h.release();
    await vi.advanceTimersByTimeAsync(0);
  });
}

function user() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
}

async function renderUnbilled() {
  render(<InvoiceScreen patientId="p-1" visitId="v-1" />);
  await waitFor(() =>
    expect(screen.getAllByTestId(/^invoice-line-desc-\d+$/)).toHaveLength(1),
  );
  // The proposal's own totals have landed.
  await waitFor(() => expect(total()).toHaveTextContent('300.00'));
}

const remedy = {
  id: 'l-2',
  kind: 'medicine' as const,
  description: 'Test Remedy 30C',
  qty: 1,
  ratePaise: 5000,
};

/** A saved bill: consultation 300.00 + remedy 50.00, amount discount 100.00. */
function billWithAmountDiscount() {
  return billedScreen({
    lines: [{ ...consultationLine, id: 'l-1' }, remedy],
    discount: { kind: 'amount', paise: 10000 },
    totals: {
      lineAmountsPaise: [30000, 5000],
      subtotalPaise: 35000,
      discountPaise: 10000,
      totalPaise: 25000,
    },
  });
}

async function renderSavedBill(screenData = billWithAmountDiscount()) {
  invoiceGetForVisit.mockResolvedValue(ok(screenData));
  render(<InvoiceScreen patientId="p-1" visitId="v-1" />);
  await screen.findByTestId('invoice-number');
  await waitFor(() => expect(total()).not.toHaveTextContent(DASH));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  holding = false;
  held = [];
  clearInvoiceDraft();
  for (const f of [
    invoiceGetForVisit,
    invoiceComputeTotals,
    invoiceSave,
    invoiceUpiQr,
  ]) {
    f.mockReset();
  }
  invoiceGetForVisit.mockResolvedValue(ok(unbilledScreen()));
  invoiceComputeTotals.mockImplementation((req: ComputeTotalsRequest) =>
    holding
      ? new Promise((resolve) => {
          held.push({ req, release: () => resolve(backendTotals(req)) });
        })
      : Promise.resolve(backendTotals(req)),
  );
  invoiceUpiQr.mockResolvedValue(ok(upiQr));
});

afterEach(() => {
  vi.useRealTimers();
  clearInvoiceDraft();
});

describe('S15 Invoice — a stale totals response after Save (A, hc-review-1)', () => {
  /**
   * Edit the bill (add "Test Remedy 30C" at 150.00) with the totals response
   * held in flight, then Save. Save succeeds and adopts the saved bill, whose
   * rows get NEW keys. Returns once the saved bill is on screen.
   */
  async function saveWhileTotalsInFlight() {
    const u = user();
    await renderUnbilled();
    holding = true;
    await u.click(screen.getByTestId('invoice-add-medicine'));
    await u.type(byPrefix('invoice-line-desc-')[1]!, 'Test Remedy 30C');
    await u.type(byPrefix('invoice-line-rate-')[1]!, '150');
    await elapse();
    expect(held.length).toBeGreaterThanOrEqual(1);

    invoiceSave.mockResolvedValue(ok(billedScreen()));
    await u.click(screen.getByTestId('invoice-save'));
    await waitFor(() =>
      expect(screen.getByTestId('invoice-number')).toHaveTextContent(
        '2026-27/0001',
      ),
    );
    // The saved bill (Rs 450 at 5% = Rs 427.50) is shown before the late
    // response arrives.
    expect(amountOf(1)).toHaveTextContent('300.00');
    expect(amountOf(2)).toHaveTextContent('150.00');
  }

  it('keeps every saved row amount (no dashes) when the late response lands', async () => {
    await saveWhileTotalsInFlight();

    await releaseHeld();
    await elapse();

    expect(byPrefix('invoice-line-amount-')).toHaveLength(2);
    expect(amountOf(1)).toHaveTextContent('300.00');
    expect(amountOf(2)).toHaveTextContent('150.00');
    expect(amountOf(1)).not.toHaveTextContent(DASH);
    expect(amountOf(2)).not.toHaveTextContent(DASH);
  });

  it('keeps the saved bill total, not the pre-save request total, after the late response', async () => {
    await saveWhileTotalsInFlight();
    expect(total()).toHaveTextContent('427.50');

    await releaseHeld();
    await elapse();

    // The late response was computed for the pre-save bill (no discount,
    // total 450.00); the saved bill has the 5% discount.
    expect(total()).toHaveTextContent('427.50');
    expect(total()).not.toHaveTextContent(DASH);
  });
});

describe('S15 Invoice — no backend error banner while a line is incomplete (B, hc-review-2)', () => {
  it('shows no banner while a line is incomplete, and the right total once it is complete again', async () => {
    const u = user();
    await renderSavedBill();
    expect(total()).toHaveTextContent('250.00');
    expect(screen.getByTestId('invoice-discount-value')).toHaveValue('100.00');

    // Clear the consultation rate: the remaining subtotal (50.00) is smaller
    // than the 100.00 discount, which the backend rejects.
    await u.clear(byPrefix('invoice-line-rate-')[0]!);
    await elapse();
    expect(banner()).not.toBeInTheDocument();

    // Still no banner after more mid-edit keystrokes on the other line.
    await u.type(byPrefix('invoice-line-desc-')[1]!, ' x');
    await elapse();
    expect(banner()).not.toBeInTheDocument();

    // The line is complete again: no banner, the correct total.
    await u.type(byPrefix('invoice-line-rate-')[0]!, '300');
    await elapse();
    expect(banner()).not.toBeInTheDocument();
    expect(total()).toHaveTextContent('250.00');
    expect(total()).not.toHaveTextContent(DASH);
    expect(amountOf(1)).toHaveTextContent('300.00');
  });

  it('still shows the error for a genuine discount larger than the subtotal with every line complete', async () => {
    const u = user();
    await renderSavedBill();

    await u.clear(screen.getByTestId('invoice-discount-value'));
    await u.type(screen.getByTestId('invoice-discount-value'), '500');
    await elapse();

    expect(await screen.findByTestId('invoice-save-error')).toBeInTheDocument();
    expect(banner()).toHaveTextContent(/missing or invalid/i);
  });
});

describe('S15 Invoice — the failed-Save message survives an unrelated totals response (C, hc-review-3)', () => {
  /** Add a blank line and press Save: the lines message is shown. */
  async function failSaveWithBlankLine(u: ReturnType<typeof user>) {
    await renderUnbilled();
    await u.click(screen.getByTestId('invoice-add-medicine'));
    await u.click(screen.getByTestId('invoice-save'));
    expect(await screen.findByTestId('invoice-save-error')).toHaveTextContent(
      LINES_ERROR,
    );
    expect(invoiceSave).not.toHaveBeenCalled();
  }

  it('keeps the message after an edit of another line gets a successful totals response', async () => {
    const u = user();
    await failSaveWithBlankLine(u);

    // Quantity 1 -> 12 on the valid consultation line. The blank line is
    // still on the bill.
    await u.type(byPrefix('invoice-line-qty-')[0]!, '2');
    await elapse();

    // The totals response did land (12 x 300.00)...
    expect(total()).toHaveTextContent('3,600.00');
    // ...but the incomplete line is still there, so the message must stay.
    expect(byPrefix('invoice-line-desc-')).toHaveLength(2);
    expect(banner()).toHaveTextContent(LINES_ERROR);
  });

  it('clears the message once every line is complete', async () => {
    const u = user();
    await failSaveWithBlankLine(u);

    await u.type(byPrefix('invoice-line-desc-')[1]!, 'Test Remedy 30C');
    await u.type(byPrefix('invoice-line-rate-')[1]!, '150');
    await elapse();

    expect(total()).toHaveTextContent('450.00');
    expect(banner()).not.toBeInTheDocument();
  });

  it('clears the message on a successful Save once the line is filled in', async () => {
    const u = user();
    await failSaveWithBlankLine(u);
    await u.type(byPrefix('invoice-line-desc-')[1]!, 'Test Remedy 30C');
    await u.type(byPrefix('invoice-line-rate-')[1]!, '150');
    await elapse();
    invoiceSave.mockResolvedValue(ok(billedScreen()));

    await u.click(screen.getByTestId('invoice-save'));

    await waitFor(() => expect(invoiceSave).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('invoice-number')).toHaveTextContent(
        '2026-27/0001',
      ),
    );
    expect(banner()).not.toBeInTheDocument();
  });
});

describe("S15 Invoice — a restored draft never shows another line's amount (D, hc-review-4)", () => {
  it('shows a dash or its own amount, never the loaded line that shares its key, until the recompute lands', async () => {
    // The saved bill: row key 1 = consultation 300.00, key 2 = remedy 150.00
    // (a fresh screen numbers the loaded rows 1, 2). The parked draft was typed
    // on the same bill version; its only row ALSO has key 1 but is a different
    // line (remedy at 75.00), so its amount is 75.00, never 300.00.
    holdInvoiceDraft({
      route: '/patient/p-1/visit/v-1/invoice',
      visitId: 'v-1',
      baseInvoiceId: 'inv-1',
      baseRowVersion: 1,
      lines: [
        {
          key: 1,
          id: 'l-2',
          kind: 'medicine',
          description: 'Test Remedy 30C',
          qty: '1',
          rate: '75.00',
        },
      ],
      discountKind: 'none',
      discountValue: '',
      paid: '',
      mode: 'cash',
      reference: '',
      paidOn: '2026-10-16',
      dirty: true,
      paymentTouched: false,
    });
    // Hold the recompute for the restored draft so the "until it lands"
    // window is fully under the test's control.
    holding = true;
    invoiceGetForVisit.mockResolvedValue(ok(billedScreen()));

    render(<InvoiceScreen patientId="p-1" visitId="v-1" />);
    expect(await screen.findByTestId('invoice-draft-notice')).toHaveTextContent(
      /kept while HomeoClinic was locked/i,
    );
    expect(byPrefix('invoice-line-desc-')).toHaveLength(1);
    expect(byPrefix('invoice-line-desc-')[0]).toHaveValue('Test Remedy 30C');

    // Before the recompute lands: never the other line's amount.
    expect(amountOf(1)).not.toHaveTextContent('300.00');
    expect(amountOf(1)).not.toHaveTextContent('150.00');

    // Even once the debounce has fired but the response is still in flight.
    await elapse();
    expect(held).toHaveLength(1);
    expect(amountOf(1)).not.toHaveTextContent('300.00');
    expect(amountOf(1)).not.toHaveTextContent('150.00');

    // The recompute lands: the draft line's own amount.
    await releaseHeld();
    expect(amountOf(1)).toHaveTextContent('75.00');
  });
});
