// r5-review-1 (design R5 §7, no dead end): a payment typed on S15 but not yet
// saved is unsaved work. The screen's own Back must show the Save/Discard
// prompt, and Print receipt / Ctrl+P must stay disabled until it is saved, so
// a receipt never prints with a stale Paid / Balance.
//
// CUT: the REAL <InvoiceScreen />. The ONLY fake is the generated binding
// `@/bindings` (R-TEST-002). Synthetic data only (R-TEST-004).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  invoiceGetForVisit,
  invoiceComputeTotals,
  invoiceSave,
  paymentAdd,
  invoiceUpiQr,
} = vi.hoisted(() => ({
  invoiceGetForVisit: vi.fn(),
  invoiceComputeTotals: vi.fn(),
  invoiceSave: vi.fn(),
  paymentAdd: vi.fn(),
  invoiceUpiQr: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    invoiceGetForVisit,
    invoiceComputeTotals,
    invoiceSave,
    paymentAdd,
    paymentVoid: vi.fn(),
    invoiceVoid: vi.fn(),
    invoiceUpiQr,
  },
}));

import { billedScreen, ok, upiQr } from '@/test/billingFixtures';
import { InvoiceScreen } from './InvoiceScreen';

function renderSaved(props: Record<string, unknown> = {}) {
  return render(<InvoiceScreen patientId="p-1" visitId="v-1" {...props} />);
}

beforeEach(() => {
  for (const f of [
    invoiceGetForVisit,
    invoiceComputeTotals,
    invoiceSave,
    paymentAdd,
    invoiceUpiQr,
  ]) {
    f.mockReset();
  }
  invoiceGetForVisit.mockResolvedValue(ok(billedScreen()));
  invoiceComputeTotals.mockResolvedValue(ok(billedScreen().invoice!.totals));
  invoiceUpiQr.mockResolvedValue(ok(upiQr));
});

describe('S15 Invoice — a typed payment is unsaved work (r5-review-1)', () => {
  it('Back with a typed payment amount asks Save/Discard instead of leaving', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderSaved({ onBack });
    await screen.findByTestId('invoice-number');

    await user.type(screen.getByTestId('invoice-paid'), '100');
    await user.click(screen.getByTestId('invoice-back'));

    expect(screen.getByTestId('invoice-leave-dialog')).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('Back after editing only the payment reference also asks first', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderSaved({ onBack });
    await screen.findByTestId('invoice-number');

    await user.type(screen.getByTestId('invoice-ref'), 'UTR999');
    await user.click(screen.getByTestId('invoice-back'));

    expect(screen.getByTestId('invoice-leave-dialog')).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('Back after changing only the payment mode also asks first', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderSaved({ onBack });
    await screen.findByTestId('invoice-number');

    await user.click(
      within(screen.getByTestId('invoice-mode')).getByRole('radio', {
        name: /upi/i,
      }),
    );
    await user.click(screen.getByTestId('invoice-back'));

    expect(screen.getByTestId('invoice-leave-dialog')).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('Discard in the prompt leaves without saving the payment', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderSaved({ onBack });
    await screen.findByTestId('invoice-number');

    await user.type(screen.getByTestId('invoice-paid'), '100');
    await user.click(screen.getByTestId('invoice-back'));
    await user.click(screen.getByTestId('invoice-leave-discard'));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(paymentAdd).not.toHaveBeenCalled();
    expect(invoiceSave).not.toHaveBeenCalled();
  });

  it('the UPI hint "Open settings" link asks first too (r5-review-16)', async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    // No clinic UPI ID: the hint with its Settings link shows on the bill.
    invoiceGetForVisit.mockResolvedValue(
      ok(billedScreen({}, { upiConfigured: false })),
    );
    renderSaved({ onOpenSettings });
    await screen.findByTestId('invoice-number');

    await user.type(screen.getByTestId('invoice-paid'), '100');
    await user.click(screen.getByTestId('invoice-upi-open-settings'));

    expect(screen.getByTestId('invoice-leave-dialog')).toBeInTheDocument();
    expect(onOpenSettings).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('invoice-leave-discard'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('disables Print receipt and ignores Ctrl+P while a payment is typed', async () => {
    const user = userEvent.setup();
    const onPrintReceipt = vi.fn();
    renderSaved({ onPrintReceipt });
    await screen.findByTestId('invoice-number');
    expect(screen.getByTestId('invoice-print')).toBeEnabled();

    await user.type(screen.getByTestId('invoice-paid'), '100');
    expect(screen.getByTestId('invoice-print')).toBeDisabled();
    await user.keyboard('{Control>}p{/Control}');
    expect(onPrintReceipt).not.toHaveBeenCalled();
  });

  it('is clean again once the payment is added: Print enabled, Back leaves', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    paymentAdd.mockResolvedValue(
      ok(billedScreen({ paidPaise: 30000, balancePaise: 12750 })),
    );
    renderSaved({ onBack });
    await screen.findByTestId('invoice-number');

    await user.type(screen.getByTestId('invoice-paid'), '100');
    await user.click(screen.getByTestId('invoice-add-payment'));
    await waitFor(() => expect(paymentAdd).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('invoice-print')).toBeEnabled(),
    );

    await user.click(screen.getByTestId('invoice-back'));
    expect(screen.queryByTestId('invoice-leave-dialog')).toBeNull();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
