// R5 — S15 Invoice: a freshly added blank line must not blank the totals.
// Regression for the manual-test bug on the installed build: clicking
// "+ medicine" (invoice-add-medicine) or "+ other line" (invoice-add-line)
// turned the Total (and Subtotal, Discount and every per-line amount) into a
// dash instead of the cumulative amount of the lines that are valid.
//
// Expected rule (docs/ui/S15-invoice.md "Discount ... the total and balance
// recompute live"; BILL-001; ADR 0021 documents NO dash state): the totals
// always show the sum of the VALID lines. A blank or half-typed line is
// ignored until it is valid. The dash is only for a bill with no lines at all.
// The UI never sums money itself (R-ARCH-003): every amount still comes from
// `invoiceComputeTotals`, so the fake backend below validates like the real
// `hc_domain::billing::compute_totals` (non-empty description, qty >= 1) and
// rejects a request that contains a blank line.
//
// CUT: the REAL <InvoiceScreen />. Only `@/bindings` is faked. Synthetic data.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { invoiceGetForVisit, invoiceComputeTotals, invoiceUpiQr } = vi.hoisted(
  () => ({
    invoiceGetForVisit: vi.fn(),
    invoiceComputeTotals: vi.fn(),
    invoiceUpiQr: vi.fn(),
  }),
);

vi.mock('@/bindings', () => ({
  commands: {
    invoiceGetForVisit,
    invoiceComputeTotals,
    invoiceSave: vi.fn(),
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
import { InvoiceScreen } from './InvoiceScreen';

const DASH = '—';
const TOTALS_DEBOUNCE_MS = 100;

const byPrefix = (prefix: string) =>
  screen.getAllByTestId(new RegExp(`^${prefix}\\d+$`));

const total = () => screen.getByTestId('invoice-total');

/** Mirrors the real backend validation (A18) + arithmetic. */
function backendTotals(req: ComputeTotalsRequest) {
  if (req.lines.length === 0) return fail('invalid_billing_input');
  for (const l of req.lines) {
    if (l.description.trim() === '' || l.qty < 1) {
      return fail('invalid_billing_input', 'Check the bill lines.');
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
  return ok({
    lineAmountsPaise: amounts,
    subtotalPaise: subtotal,
    discountPaise: discount,
    totalPaise: subtotal - discount,
  });
}

/** Let the screen's 100 ms totals debounce fire and its response land. */
async function afterDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, TOTALS_DEBOUNCE_MS * 3));
  });
}

/**
 * The total is `amount` and was never a dash: use when the edit must not
 * change the displayed total (a blank or half-typed line was added/edited).
 */
async function expectTotalStays(amount: string): Promise<void> {
  expect(total()).not.toHaveTextContent(DASH);
  await expectTotalSettles(amount);
}

/**
 * The total settles on `amount` (e.g. '450.00') after the backend round trip
 * and stays there, never a dash once settled. Use when the edit legitimately
 * changes the total (a line became valid, was removed, or its qty changed).
 */
async function expectTotalSettles(amount: string): Promise<void> {
  await waitFor(() => expect(total()).toHaveTextContent(amount));
  await afterDebounce();
  expect(total()).toHaveTextContent(amount);
  expect(total()).not.toHaveTextContent(DASH);
}

const remedyLine = {
  id: null,
  kind: 'medicine' as const,
  description: 'Test Remedy 30C',
  qty: 1,
  ratePaise: 15000,
};

function twoValidLines() {
  invoiceGetForVisit.mockResolvedValue(
    ok(unbilledScreen({ proposal: [consultationLine, remedyLine] })),
  );
}

async function renderInvoice(lineCount = 1) {
  render(<InvoiceScreen patientId="p-1" visitId="v-1" />);
  await waitFor(() =>
    expect(screen.getAllByTestId(/^invoice-line-desc-\d+$/)).toHaveLength(
      lineCount,
    ),
  );
  // The proposal's own totals have landed.
  await waitFor(() => expect(total()).not.toHaveTextContent(DASH));
}

beforeEach(() => {
  for (const f of [invoiceGetForVisit, invoiceComputeTotals, invoiceUpiQr]) {
    f.mockReset();
  }
  invoiceGetForVisit.mockResolvedValue(ok(unbilledScreen()));
  invoiceComputeTotals.mockImplementation(async (req) => backendTotals(req));
  invoiceUpiQr.mockResolvedValue(ok(upiQr));
});

describe('S15 Invoice — adding a blank line keeps the cumulative total', () => {
  it('keeps the total (not a dash) after clicking "+ medicine"', async () => {
    const user = userEvent.setup();
    await renderInvoice();
    expect(total()).toHaveTextContent('300.00');

    await user.click(screen.getByTestId('invoice-add-medicine'));

    expect(byPrefix('invoice-line-desc-')).toHaveLength(2);
    await expectTotalStays('300.00');
  });

  it('keeps the total (not a dash) after clicking "+ other line"', async () => {
    const user = userEvent.setup();
    await renderInvoice();

    await user.click(screen.getByTestId('invoice-add-line'));

    expect(byPrefix('invoice-line-kind-')[1]).toHaveValue('other');
    await expectTotalStays('300.00');
  });

  it('keeps subtotal, discount and the amounts of the valid lines, not dashes', async () => {
    const user = userEvent.setup();
    twoValidLines();
    await renderInvoice(2);
    expect(total()).toHaveTextContent('450.00');

    await user.click(screen.getByTestId('invoice-add-medicine'));

    await expectTotalStays('450.00');
    expect(screen.getByTestId('invoice-subtotal')).toHaveTextContent('450.00');
    expect(screen.getByTestId('invoice-discount-amount')).not.toHaveTextContent(
      DASH,
    );
    const amounts = byPrefix('invoice-line-amount-');
    expect(amounts).toHaveLength(3);
    expect(amounts[0]).toHaveTextContent('300.00');
    expect(amounts[1]).toHaveTextContent('150.00');
  });

  it('keeps the total after adding several blank lines in a row', async () => {
    const user = userEvent.setup();
    twoValidLines();
    await renderInvoice(2);

    await user.click(screen.getByTestId('invoice-add-medicine'));
    await user.click(screen.getByTestId('invoice-add-line'));
    await user.click(screen.getByTestId('invoice-add-medicine'));

    expect(byPrefix('invoice-line-desc-')).toHaveLength(5);
    await expectTotalStays('450.00');
  });

  it('keeps the discounted total when a blank line is added', async () => {
    const user = userEvent.setup();
    twoValidLines();
    await renderInvoice(2);
    await user.click(
      within(screen.getByTestId('invoice-discount-type')).getByRole('radio', {
        name: /percent|%/i,
      }),
    );
    await user.type(screen.getByTestId('invoice-discount-value'), '5');
    await waitFor(() => expect(total()).toHaveTextContent('427.50'));

    await user.click(screen.getByTestId('invoice-add-line'));

    await expectTotalStays('427.50');
  });

  it('keeps the total of an already saved bill when a blank line is added', async () => {
    const user = userEvent.setup();
    invoiceGetForVisit.mockResolvedValue(ok(billedScreen()));
    render(<InvoiceScreen patientId="p-1" visitId="v-1" />);
    await screen.findByTestId('invoice-number');
    expect(total()).toHaveTextContent('427.50');

    await user.click(screen.getByTestId('invoice-add-medicine'));

    expect(byPrefix('invoice-line-desc-')).toHaveLength(3);
    await expectTotalStays('427.50');
  });
});

describe('S15 Invoice — a line that is being filled in', () => {
  it('keeps the total while the new line has a description but no rate yet', async () => {
    const user = userEvent.setup();
    await renderInvoice();
    await user.click(screen.getByTestId('invoice-add-medicine'));

    await user.type(byPrefix('invoice-line-desc-')[1]!, 'Test Remedy 30C');

    await expectTotalStays('300.00');
  });

  it('drops the new line from the total again when its typed rate is cleared', async () => {
    const user = userEvent.setup();
    await renderInvoice();
    await user.click(screen.getByTestId('invoice-add-medicine'));
    await user.type(byPrefix('invoice-line-desc-')[1]!, 'Test Remedy 30C');
    await user.type(byPrefix('invoice-line-rate-')[1]!, '150');
    await expectTotalSettles('450.00');

    await user.clear(byPrefix('invoice-line-rate-')[1]!);

    await expectTotalSettles('300.00');
    expect(byPrefix('invoice-line-amount-')[1]).toHaveTextContent(DASH);
  });

  it('keeps the total while the new line has a rate but no description yet', async () => {
    const user = userEvent.setup();
    await renderInvoice();
    await user.click(screen.getByTestId('invoice-add-line'));

    await user.type(byPrefix('invoice-line-rate-')[1]!, '150');

    await expectTotalStays('300.00');
  });

  it('keeps the total while the new line quantity is cleared', async () => {
    const user = userEvent.setup();
    await renderInvoice();
    await user.click(screen.getByTestId('invoice-add-medicine'));
    await user.type(byPrefix('invoice-line-desc-')[1]!, 'Test Remedy 30C');
    await user.type(byPrefix('invoice-line-rate-')[1]!, '150');
    await waitFor(() => expect(total()).toHaveTextContent('450.00'));

    await user.clear(byPrefix('invoice-line-qty-')[1]!);

    await expectTotalSettles('300.00');
  });

  it('adds the new line to the total once description and rate are typed', async () => {
    const user = userEvent.setup();
    await renderInvoice();
    await user.click(screen.getByTestId('invoice-add-medicine'));

    await user.type(byPrefix('invoice-line-desc-')[1]!, 'Test Remedy 30C');
    await user.type(byPrefix('invoice-line-rate-')[1]!, '150');

    await expectTotalSettles('450.00');
    expect(byPrefix('invoice-line-amount-')[1]).toHaveTextContent('150.00');
    expect(byPrefix('invoice-line-amount-')[0]).toHaveTextContent('300.00');
  });

  it('multiplies by the typed quantity once the new line is valid', async () => {
    const user = userEvent.setup();
    await renderInvoice();
    await user.click(screen.getByTestId('invoice-add-medicine'));
    await user.type(byPrefix('invoice-line-desc-')[1]!, 'Test Remedy 30C');
    await user.type(byPrefix('invoice-line-rate-')[1]!, '150');

    await user.clear(byPrefix('invoice-line-qty-')[1]!);
    await user.type(byPrefix('invoice-line-qty-')[1]!, '3');

    await expectTotalSettles('750.00');
    expect(byPrefix('invoice-line-amount-')[1]).toHaveTextContent('450.00');
  });
});

describe('S15 Invoice — removing lines with a blank line present', () => {
  it('removing the blank line leaves the cumulative total of the valid lines', async () => {
    const user = userEvent.setup();
    twoValidLines();
    await renderInvoice(2);
    await user.click(screen.getByTestId('invoice-add-line'));
    await expectTotalStays('450.00');

    await user.click(byPrefix('invoice-remove-line-')[2]!);

    expect(byPrefix('invoice-line-desc-')).toHaveLength(2);
    await expectTotalStays('450.00');
  });

  it('removing a valid line while a blank line is present drops only that amount', async () => {
    const user = userEvent.setup();
    twoValidLines();
    await renderInvoice(2);
    await user.click(screen.getByTestId('invoice-add-medicine'));

    await user.click(byPrefix('invoice-remove-line-')[1]!);

    expect(byPrefix('invoice-line-desc-')).toHaveLength(2);
    await expectTotalSettles('300.00');
  });
});

describe('S15 Invoice — the dash that stays', () => {
  it('shows the dash only when the bill has no lines at all', async () => {
    const user = userEvent.setup();
    await renderInvoice();

    await user.click(byPrefix('invoice-remove-line-')[0]!);

    expect(screen.queryAllByTestId(/^invoice-line-desc-\d+$/)).toHaveLength(0);
    await waitFor(() => expect(total()).toHaveTextContent(DASH));
  });
});
