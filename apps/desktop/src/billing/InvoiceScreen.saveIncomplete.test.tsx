// R5 — S15 Invoice: Save must still reject an incomplete line.
// Regression guard for the totals fix (9e6fda9): the live totals now skip an
// incomplete line instead of blanking, but the SAVE path (`onSave` ->
// `toDtos`) stays all-or-nothing. A bill with a blank, rate-less or
// quantity-less line must show `billing.error.lines` and must NOT call the
// save/issue command (`invoiceSave`), so an incomplete line is never saved or
// issued silently.
//
// CUT: the REAL <InvoiceScreen />. Only `@/bindings` is faked. The fake
// totals backend validates like `hc_domain::billing::compute_totals`
// (non-empty description, qty >= 1). Synthetic data.

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import type { ComputeTotalsRequest, InvoiceSaveRequest } from '@/bindings';
import { todayIsoDate } from '@/shared/datetime';
import {
  billedScreen,
  consultationLine,
  fail,
  ok,
  unbilledScreen,
  upiQr,
} from '@/test/billingFixtures';
import { InvoiceScreen } from './InvoiceScreen';

const DASH = '—';
const TOTALS_DEBOUNCE_MS = 100;
/** en.json `billing.error.lines`. */
const LINES_ERROR = 'Fill in the description, quantity and rate of every line.';

const byPrefix = (prefix: string) =>
  screen.getAllByTestId(new RegExp(`^${prefix}\\d+$`));

const total = () => screen.getByTestId('invoice-total');

/** Mirrors the real backend validation + arithmetic (no discount in these tests). */
function backendTotals(req: ComputeTotalsRequest) {
  if (req.lines.length === 0) return fail('invalid_billing_input');
  for (const l of req.lines) {
    if (l.description.trim() === '' || l.qty < 1) {
      return fail('invalid_billing_input', 'Check the bill lines.');
    }
  }
  const amounts = req.lines.map((l) => l.qty * l.ratePaise);
  const subtotal = amounts.reduce((a, b) => a + b, 0);
  return ok({
    lineAmountsPaise: amounts,
    subtotalPaise: subtotal,
    discountPaise: 0,
    totalPaise: subtotal,
  });
}

/** Let the screen's 100 ms totals debounce fire and its response land. */
async function afterDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, TOTALS_DEBOUNCE_MS * 3));
  });
}

/** The total settles on `amount` and stays there, never a dash. */
async function expectTotalSettles(amount: string): Promise<void> {
  await waitFor(() => expect(total()).toHaveTextContent(amount));
  await afterDebounce();
  expect(total()).toHaveTextContent(amount);
  expect(total()).not.toHaveTextContent(DASH);
}

/** Press Save and assert the line-validation error with NO backend save. */
async function saveIsRejected(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByTestId('invoice-save'));
  expect(await screen.findByTestId('invoice-save-error')).toHaveTextContent(
    LINES_ERROR,
  );
  await afterDebounce();
  expect(invoiceSave).not.toHaveBeenCalled();
  expect(screen.getByTestId('invoice-save-error')).toHaveTextContent(
    LINES_ERROR,
  );
}

async function renderInvoice() {
  render(<InvoiceScreen patientId="p-1" visitId="v-1" />);
  await waitFor(() =>
    expect(screen.getAllByTestId(/^invoice-line-desc-\d+$/)).toHaveLength(1),
  );
  // The proposal's own totals have landed.
  await waitFor(() => expect(total()).toHaveTextContent('300.00'));
}

beforeEach(() => {
  for (const f of [
    invoiceGetForVisit,
    invoiceComputeTotals,
    invoiceSave,
    invoiceUpiQr,
  ]) {
    f.mockReset();
  }
  invoiceGetForVisit.mockResolvedValue(ok(unbilledScreen()));
  invoiceComputeTotals.mockImplementation(async (req) => backendTotals(req));
  invoiceSave.mockResolvedValue(ok(billedScreen()));
  invoiceUpiQr.mockResolvedValue(ok(upiQr));
});

describe('S15 Invoice — Save rejects a bill with an incomplete line', () => {
  it('rejects a blank line added with "+ medicine" while the total shows the valid amount', async () => {
    const user = userEvent.setup();
    await renderInvoice();

    await user.click(screen.getByTestId('invoice-add-medicine'));
    expect(byPrefix('invoice-line-desc-')).toHaveLength(2);
    await expectTotalSettles('300.00');

    await saveIsRejected(user);
    expect(total()).toHaveTextContent('300.00');
  });

  it('rejects a line that has a description but no rate', async () => {
    const user = userEvent.setup();
    await renderInvoice();
    await user.click(screen.getByTestId('invoice-add-medicine'));
    await user.type(byPrefix('invoice-line-desc-')[1]!, 'Test Remedy 30C');
    await expectTotalSettles('300.00');

    await saveIsRejected(user);
  });

  it('rejects a line whose quantity was cleared', async () => {
    const user = userEvent.setup();
    await renderInvoice();
    await user.click(screen.getByTestId('invoice-add-medicine'));
    await user.type(byPrefix('invoice-line-desc-')[1]!, 'Test Remedy 30C');
    await user.type(byPrefix('invoice-line-rate-')[1]!, '150');
    await expectTotalSettles('450.00');

    await user.clear(byPrefix('invoice-line-qty-')[1]!);
    await expectTotalSettles('300.00');

    await saveIsRejected(user);
  });

  it('saves once the incomplete line is filled in, sending exactly the full line list', async () => {
    const user = userEvent.setup();
    await renderInvoice();
    await user.click(screen.getByTestId('invoice-add-medicine'));
    await expectTotalSettles('300.00');
    await saveIsRejected(user);

    await user.type(byPrefix('invoice-line-desc-')[1]!, 'Test Remedy 30C');
    await user.type(byPrefix('invoice-line-rate-')[1]!, '150');
    await expectTotalSettles('450.00');
    await user.click(screen.getByTestId('invoice-save'));

    await waitFor(() => expect(invoiceSave).toHaveBeenCalledTimes(1));
    const expected: InvoiceSaveRequest = {
      visitId: 'v-1',
      invoiceId: null,
      expectedRowVersion: null,
      lines: [
        consultationLine,
        {
          id: null,
          kind: 'medicine',
          description: 'Test Remedy 30C',
          qty: 1,
          ratePaise: 15000,
        },
      ],
      discount: { kind: 'none' },
      payment: null,
      localToday: todayIsoDate(),
    };
    expect(invoiceSave.mock.calls[0]![0]).toEqual(expected);
    expect(await screen.findByTestId('invoice-number')).toHaveTextContent(
      '2026-27/0001',
    );
    expect(screen.queryByTestId('invoice-save-error')).not.toBeInTheDocument();
  });

  it('shows a dash total and rejects Save when the only line is incomplete', async () => {
    const user = userEvent.setup();
    await renderInvoice();

    await user.clear(byPrefix('invoice-line-rate-')[0]!);

    await waitFor(() => expect(total()).toHaveTextContent(DASH));
    await saveIsRejected(user);
    expect(total()).toHaveTextContent(DASH);
  });
});
