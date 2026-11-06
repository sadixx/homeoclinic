// R5 — S15 Invoice screen (docs/ui/S15-invoice.md; R5 design §7, §9).
// HC-MVP1-148 (lines, discount, payments by mode, balance), 151 (UPI QR),
// 152 (GSTIN line; tax breakdown deferred), BILL-001/002/005/006.
//
// CUT: the REAL <InvoiceScreen />. The ONLY fake is the generated binding
// `@/bindings` (dependency, R-TEST-002) returning typed wire shapes from
// src/test/billingFixtures.ts. The UI never does money maths: every total on
// screen comes from `invoiceComputeTotals` / the saved invoice (R-ARCH-003).
// Index-based testids (`invoice-line-desc-<n>`) are found by prefix so the
// test does not pin 0- vs 1-based numbering. Synthetic data only.
//
// RED: the §13 stub renders nothing, so every test fails on its first query.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  invoiceGetForVisit,
  invoiceComputeTotals,
  invoiceSave,
  paymentAdd,
  paymentVoid,
  invoiceVoid,
  invoiceUpiQr,
} = vi.hoisted(() => ({
  invoiceGetForVisit: vi.fn(),
  invoiceComputeTotals: vi.fn(),
  invoiceSave: vi.fn(),
  paymentAdd: vi.fn(),
  paymentVoid: vi.fn(),
  invoiceVoid: vi.fn(),
  invoiceUpiQr: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    invoiceGetForVisit,
    invoiceComputeTotals,
    invoiceSave,
    paymentAdd,
    paymentVoid,
    invoiceVoid,
    invoiceUpiQr,
  },
}));

import type { ComputeTotalsRequest, InvoiceSaveRequest } from '@/bindings';
import { todayIsoDate } from '@/shared/datetime';
import {
  billedScreen,
  demoInvoice,
  fail,
  ok,
  unbilledScreen,
  upiQr,
} from '@/test/billingFixtures';
import { InvoiceScreen } from './InvoiceScreen';

const byPrefix = (prefix: string) =>
  screen.getAllByTestId(new RegExp(`^${prefix}\\d+$`));

function renderInvoice(props: Record<string, unknown> = {}) {
  return render(<InvoiceScreen patientId="p-1" visitId="v-1" {...props} />);
}

/** Totals the fake backend returns for whatever lines it is sent. */
function echoTotals(req: ComputeTotalsRequest) {
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

function lastTotalsReq(): ComputeTotalsRequest {
  const calls = invoiceComputeTotals.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
}

beforeEach(() => {
  for (const f of [
    invoiceGetForVisit,
    invoiceComputeTotals,
    invoiceSave,
    paymentAdd,
    paymentVoid,
    invoiceVoid,
    invoiceUpiQr,
  ]) {
    f.mockReset();
  }
  invoiceGetForVisit.mockResolvedValue(ok(unbilledScreen()));
  invoiceComputeTotals.mockImplementation(async (req) => echoTotals(req));
  invoiceUpiQr.mockResolvedValue(ok(upiQr));
});

describe('S15 Invoice — load + consultation default', () => {
  it('loads the visit with the local date and prefills the consultation fee line', async () => {
    renderInvoice();
    const desc = await screen.findByTestId(/^invoice-line-desc-\d+$/);
    expect(invoiceGetForVisit).toHaveBeenCalledWith({
      visitId: 'v-1',
      localToday: todayIsoDate(),
    });
    expect(desc).toHaveValue('Consultation (follow-up)');
    expect(
      (byPrefix('invoice-line-rate-')[0] as HTMLInputElement).value,
    ).toMatch(/^300(\.00)?$/);
    expect(byPrefix('invoice-line-amount-')[0]).toHaveTextContent('300.00');
    // No number until the first Save (design §7).
    expect(screen.getByTestId('invoice-number')).not.toHaveTextContent(
      '2026-27',
    );
    expect(screen.getByText(/test patient r5/i)).toBeInTheDocument();
  });

  it('keeps Print receipt disabled until the bill is saved', async () => {
    renderInvoice();
    await screen.findByTestId(/^invoice-line-desc-\d+$/);
    expect(screen.getByTestId('invoice-print')).toBeDisabled();
  });
});

describe('S15 Invoice — lines and discount (totals from the backend)', () => {
  it('adds a medicine line and shows the backend total', async () => {
    const user = userEvent.setup();
    renderInvoice();
    await screen.findByTestId(/^invoice-line-desc-\d+$/);

    await user.click(screen.getByTestId('invoice-add-medicine'));
    expect(byPrefix('invoice-line-desc-')).toHaveLength(2);
    await user.type(byPrefix('invoice-line-desc-')[1]!, 'Test Remedy 30C');
    await user.clear(byPrefix('invoice-line-rate-')[1]!);
    await user.type(byPrefix('invoice-line-rate-')[1]!, '150');

    await waitFor(() =>
      expect(lastTotalsReq().lines).toEqual([
        expect.objectContaining({
          kind: 'consultation',
          qty: 1,
          ratePaise: 30000,
        }),
        expect.objectContaining({
          kind: 'medicine',
          description: 'Test Remedy 30C',
          qty: 1,
          ratePaise: 15000,
        }),
      ]),
    );
    await waitFor(() =>
      expect(screen.getByTestId('invoice-total')).toHaveTextContent('450.00'),
    );
    expect(byPrefix('invoice-line-amount-')[1]).toHaveTextContent('150.00');
  });

  it('"Add line" adds an Other line and Remove line drops it', async () => {
    const user = userEvent.setup();
    renderInvoice();
    await screen.findByTestId(/^invoice-line-desc-\d+$/);
    await user.click(screen.getByTestId('invoice-add-line'));
    expect(byPrefix('invoice-line-kind-')[1]).toHaveValue('other');

    await user.click(byPrefix('invoice-remove-line-')[1]!);
    expect(byPrefix('invoice-line-desc-')).toHaveLength(1);
  });

  it('sends a percent discount in basis points and shows the discounted total', async () => {
    const user = userEvent.setup();
    invoiceGetForVisit.mockResolvedValue(
      ok(
        unbilledScreen({
          proposal: [
            {
              id: null,
              kind: 'consultation',
              description: 'Consultation',
              qty: 1,
              ratePaise: 30000,
            },
            {
              id: null,
              kind: 'medicine',
              description: 'Test Remedy 30C',
              qty: 1,
              ratePaise: 15000,
            },
          ],
        }),
      ),
    );
    renderInvoice();
    // Two proposal lines render: wait for all of them (a single-match query
    // would throw "Found multiple elements").
    expect(
      await screen.findAllByTestId(/^invoice-line-desc-\d+$/),
    ).toHaveLength(2);

    await user.click(
      within(screen.getByTestId('invoice-discount-type')).getByRole('radio', {
        name: /percent|%/i,
      }),
    );
    await user.type(screen.getByTestId('invoice-discount-value'), '5');
    await waitFor(() =>
      expect(lastTotalsReq().discount).toEqual({
        kind: 'percent',
        basisPoints: 500,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('invoice-total')).toHaveTextContent('427.50'),
    );
  });

  it('sends an amount discount in paise', async () => {
    const user = userEvent.setup();
    renderInvoice();
    await screen.findByTestId(/^invoice-line-desc-\d+$/);
    await user.click(
      within(screen.getByTestId('invoice-discount-type')).getByRole('radio', {
        name: /amount|rs/i,
      }),
    );
    await user.type(screen.getByTestId('invoice-discount-value'), '50');
    await waitFor(() =>
      expect(lastTotalsReq().discount).toEqual({ kind: 'amount', paise: 5000 }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('invoice-total')).toHaveTextContent('250.00'),
    );
  });
});

describe('S15 Invoice — first Save with a partial payment', () => {
  it('issues the bill with the payment in one save and shows number + balance', async () => {
    const user = userEvent.setup();
    const onPrintReceipt = vi.fn();
    invoiceSave.mockResolvedValue(ok(billedScreen()));
    renderInvoice({ onPrintReceipt });
    await screen.findByTestId(/^invoice-line-desc-\d+$/);

    await user.type(screen.getByTestId('invoice-paid'), '200');
    await user.click(
      within(screen.getByTestId('invoice-mode')).getByRole('radio', {
        name: /cash/i,
      }),
    );
    await user.click(screen.getByTestId('invoice-save'));

    await waitFor(() => expect(invoiceSave).toHaveBeenCalledTimes(1));
    const req: InvoiceSaveRequest = invoiceSave.mock.calls[0]![0];
    expect(req.visitId).toBe('v-1');
    expect(req.invoiceId ?? null).toBeNull();
    expect(req.localToday).toBe(todayIsoDate());
    expect(req.lines[0]).toEqual(
      expect.objectContaining({ kind: 'consultation', ratePaise: 30000 }),
    );
    expect(req.payment).toEqual({
      amountPaise: 20000,
      mode: 'cash',
      reference: null,
      paidOn: todayIsoDate(),
    });

    expect(await screen.findByTestId('invoice-number')).toHaveTextContent(
      '2026-27/0001',
    );
    expect(screen.getByTestId('invoice-balance')).toHaveTextContent('227.50');
    expect(screen.getByText(/bill saved/i)).toBeInTheDocument();

    const print = screen.getByTestId('invoice-print');
    expect(print).toBeEnabled();
    await user.click(print);
    expect(onPrintReceipt).toHaveBeenCalledWith('inv-1');
  });

  it('shows the backend error inline when the payment exceeds the total', async () => {
    const user = userEvent.setup();
    invoiceSave.mockResolvedValue(
      fail(
        'payment_exceeds_balance',
        'The payment is more than the amount due.',
      ),
    );
    renderInvoice();
    await screen.findByTestId(/^invoice-line-desc-\d+$/);
    await user.type(screen.getByTestId('invoice-paid'), '999');
    await user.click(screen.getByTestId('invoice-save'));
    expect(
      await screen.findByText(/more than the amount due/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('invoice-number')).not.toHaveTextContent(
      '2026-27',
    );
  });
});

describe('S15 Invoice — saved bill: balance, dues, payments', () => {
  it('shows the saved number, balance, payments and the patient running dues', async () => {
    invoiceGetForVisit.mockResolvedValue(
      ok(billedScreen({}, { patientDuesPaise: 67750 })),
    );
    renderInvoice();
    expect(await screen.findByTestId('invoice-number')).toHaveTextContent(
      '2026-27/0001',
    );
    expect(screen.getByTestId('invoice-total')).toHaveTextContent('427.50');
    expect(screen.getByTestId('invoice-balance')).toHaveTextContent('227.50');
    expect(screen.getByTestId('invoice-dues')).toHaveTextContent('677.50');
    const rows = byPrefix('invoice-payment-row-');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('200.00');
    expect(rows[0]).toHaveTextContent(/cash/i);
  });

  it('Add payment records a UPI payment with its reference', async () => {
    const user = userEvent.setup();
    invoiceGetForVisit.mockResolvedValue(ok(billedScreen()));
    paymentAdd.mockResolvedValue(
      ok(
        billedScreen(
          { paidPaise: 30000, balancePaise: 12750 },
          { patientDuesPaise: 12750 },
        ),
      ),
    );
    renderInvoice();
    await screen.findByTestId('invoice-number');

    await user.type(screen.getByTestId('invoice-paid'), '100');
    await user.click(
      within(screen.getByTestId('invoice-mode')).getByRole('radio', {
        name: /upi/i,
      }),
    );
    await user.type(screen.getByTestId('invoice-ref'), 'UTR123');
    await user.click(screen.getByTestId('invoice-add-payment'));

    await waitFor(() =>
      expect(paymentAdd).toHaveBeenCalledWith({
        invoiceId: 'inv-1',
        payment: {
          amountPaise: 10000,
          mode: 'upi',
          reference: 'UTR123',
          paidOn: todayIsoDate(),
        },
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('invoice-balance')).toHaveTextContent('127.50'),
    );
  });

  it('Cancel bill asks for a reason, voids with the row version and shows the CANCELLED banner', async () => {
    const user = userEvent.setup();
    invoiceGetForVisit.mockResolvedValue(ok(billedScreen()));
    invoiceVoid.mockResolvedValue(
      ok(
        billedScreen(
          {
            status: 'void',
            voidReason: 'Billed wrong patient',
            payments: demoInvoice().payments.map((p) => ({
              ...p,
              voided: true,
            })),
          },
          { patientDuesPaise: 0 },
        ),
      ),
    );
    renderInvoice();
    await screen.findByTestId('invoice-number');

    await user.click(screen.getByTestId('invoice-void'));
    await user.type(
      screen.getByTestId('invoice-void-reason'),
      'Billed wrong patient',
    );
    await user.click(screen.getByTestId('invoice-void-confirm'));

    await waitFor(() =>
      expect(invoiceVoid).toHaveBeenCalledWith({
        invoiceId: 'inv-1',
        reason: 'Billed wrong patient',
        expectedRowVersion: 1,
      }),
    );
    expect(await screen.findByTestId('invoice-void-banner')).toHaveTextContent(
      /cancelled/i,
    );
    expect(screen.getByTestId('invoice-number')).toHaveTextContent(
      '2026-27/0001',
    );
    expect(screen.getByTestId('invoice-rebill')).toBeEnabled();
    expect(screen.queryByTestId('invoice-add-payment')).toBeNull();
  });
});

describe('S15 Invoice — UPI QR (P1) and GST (P2)', () => {
  it('renders the clinic UPI QR for the balance when a UPI ID is set', async () => {
    invoiceGetForVisit.mockResolvedValue(
      ok(billedScreen({}, { upiConfigured: true })),
    );
    renderInvoice();
    const panel = await screen.findByTestId('invoice-upi-qr');
    await waitFor(() =>
      expect(invoiceUpiQr).toHaveBeenCalledWith({ invoiceId: 'inv-1' }),
    );
    const img = await within(panel).findByRole('img');
    expect(img).toHaveAttribute('src', upiQr.qrDataUrl);
    expect(img).toHaveAccessibleName(/.+/);
    expect(panel).toHaveTextContent('227.50');
    expect(screen.queryByTestId('invoice-upi-hint')).toBeNull();
  });

  it('shows a Settings hint (no dead end) instead of a QR when no UPI ID is set', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    invoiceGetForVisit.mockResolvedValue(
      ok(billedScreen({}, { upiConfigured: false })),
    );
    renderInvoice({ onOpenSettings });
    const hint = await screen.findByTestId('invoice-upi-hint');
    expect(hint).toHaveTextContent(/upi id/i);
    expect(within(hint).queryByRole('img')).toBeNull();
    await user.click(within(hint).getByRole('link', { name: /settings/i }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('hides the QR for a fully paid bill', async () => {
    invoiceGetForVisit.mockResolvedValue(
      ok(
        billedScreen(
          { paidPaise: 42750, balancePaise: 0 },
          { upiConfigured: true },
        ),
      ),
    );
    renderInvoice();
    await screen.findByTestId('invoice-number');
    expect(screen.queryByTestId('invoice-upi-qr')).toBeNull();
  });

  it('prints the GSTIN line when set and renders no tax-breakdown inputs (deferred)', async () => {
    invoiceGetForVisit.mockResolvedValue(
      ok(billedScreen({}, { gstin: '27AAAAA0000A1Z5' })),
    );
    renderInvoice();
    await screen.findByTestId('invoice-number');
    expect(screen.getByText(/27AAAAA0000A1Z5/)).toBeInTheDocument();
    // BILL-006 breakdown is deferred (design §1, §9): not rendered, so there
    // is no dead control.
    expect(screen.queryByTestId('invoice-gst')).toBeNull();
  });

  it('shows no GSTIN line when the clinic has none', async () => {
    invoiceGetForVisit.mockResolvedValue(ok(billedScreen()));
    renderInvoice();
    await screen.findByTestId('invoice-number');
    expect(screen.queryByText(/gstin/i)).toBeNull();
  });
});
