// R5 — receipt print preview (R5 design §8; HC-MVP1-150, BILL-003, BILL-005,
// BILL-006). Receipt with FY sequential number, amount in words, Indian
// number format, GSTIN only when set, UPI QR when there is a balance, a
// CANCELLED mark for a void bill; Print through the `printPage` seam.
//
// CUT: the REAL <ReceiptPreview /> (and the <ReceiptDocument /> it renders).
// Fakes (dependencies only, R-TEST-002): `@/bindings` (receiptGet) and the
// `@/shared/print` seam (window.print). Synthetic data only.
//
// RED: the §13 stubs render nothing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { receiptGet, printPage } = vi.hoisted(() => ({
  receiptGet: vi.fn(),
  printPage: vi.fn(),
}));

vi.mock('@/bindings', () => ({ commands: { receiptGet } }));
vi.mock('@/shared/print', () => ({ printPage }));

import { ok, receiptDoc } from '@/test/billingFixtures';
import { ReceiptPreview } from './ReceiptPreview';

function renderReceipt(props: Record<string, unknown> = {}) {
  return render(
    <ReceiptPreview patientId="p-1" invoiceId="inv-1" {...props} />,
  );
}

beforeEach(() => {
  receiptGet.mockReset();
  receiptGet.mockResolvedValue(ok(receiptDoc()));
  printPage.mockReset();
});

describe('Receipt — content', () => {
  it('shows the FY receipt number, clinic, doctor, patient and the line table', async () => {
    renderReceipt();
    expect(await screen.findByTestId('receipt-number')).toHaveTextContent(
      '2026-27/0001',
    );
    expect(receiptGet).toHaveBeenCalledWith({ invoiceId: 'inv-1' });
    for (const text of [
      'Test Clinic 001',
      '1 Test Street',
      'Test Doctor 001',
      'TESTREG-001',
      'Test Patient R5',
      'HC-000001',
      'Test Remedy 30C',
    ]) {
      expect(screen.getAllByText(new RegExp(text)).length).toBeGreaterThan(0);
    }
    // Dates print DD-MM-YYYY (00-conventions).
    expect(screen.getAllByText(/16-10-2026/).length).toBeGreaterThan(0);
  });

  it('shows total, paid, balance and "Received with thanks" in words', async () => {
    renderReceipt();
    expect(await screen.findByTestId('receipt-total')).toHaveTextContent(
      '427.50',
    );
    expect(screen.getByTestId('receipt-paid')).toHaveTextContent('200.00');
    expect(screen.getByTestId('receipt-balance')).toHaveTextContent('227.50');
    expect(screen.getByTestId('receipt-words')).toHaveTextContent(
      'Rupees Two Hundred Only',
    );
  });

  it('formats large amounts with Indian grouping (lakh)', async () => {
    receiptGet.mockResolvedValue(
      ok(
        receiptDoc({
          totals: {
            lineAmountsPaise: [12345675],
            subtotalPaise: 12345675,
            discountPaise: 0,
            totalPaise: 12345675,
          },
          paidPaise: 12345675,
          balancePaise: 0,
        }),
      ),
    );
    renderReceipt();
    expect(await screen.findByTestId('receipt-total')).toHaveTextContent(
      '1,23,456.75',
    );
  });

  it('prints the GSTIN only when it is set', async () => {
    const { unmount } = renderReceipt();
    await screen.findByTestId('receipt-number');
    expect(screen.queryByTestId('receipt-gstin')).toBeNull();
    unmount();

    receiptGet.mockResolvedValue(ok(receiptDoc({ gstin: '27AAAAA0000A1Z5' })));
    renderReceipt();
    expect(await screen.findByTestId('receipt-gstin')).toHaveTextContent(
      '27AAAAA0000A1Z5',
    );
  });

  it('shows the UPI QR when there is a balance and a clinic UPI ID', async () => {
    receiptGet.mockResolvedValue(
      ok(receiptDoc({ upiQrDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' })),
    );
    renderReceipt();
    const qr = await screen.findByTestId('receipt-qr');
    const img = qr.tagName === 'IMG' ? qr : within(qr).getByRole('img');
    expect(img).toHaveAttribute('src', 'data:image/svg+xml;base64,PHN2Zy8+');
  });

  it('marks a cancelled bill as CANCELLED', async () => {
    receiptGet.mockResolvedValue(ok(receiptDoc({ void: true })));
    renderReceipt();
    expect(await screen.findByTestId('receipt-void')).toHaveTextContent(
      /cancelled/i,
    );
  });
});

describe('Receipt — toolbar', () => {
  it('Print opens the OS print dialog through the print seam', async () => {
    const user = userEvent.setup();
    renderReceipt();
    await screen.findByTestId('receipt-number');
    await user.click(screen.getByTestId('receipt-print'));
    expect(printPage).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+P prints too', async () => {
    const user = userEvent.setup();
    renderReceipt();
    await screen.findByTestId('receipt-number');
    await user.keyboard('{Control>}p{/Control}');
    expect(printPage).toHaveBeenCalledTimes(1);
  });

  it('offers A5 (default) paper and no in-app Save PDF button (waits for R4)', async () => {
    renderReceipt();
    await screen.findByTestId('receipt-number');
    expect(screen.getByTestId('receipt-paper')).toHaveTextContent(/A5/);
    expect(screen.queryByRole('button', { name: /pdf/i })).toBeNull();
  });

  it('Back returns to the invoice', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderReceipt({ onBack });
    await screen.findByTestId('receipt-number');
    await user.click(screen.getByTestId('receipt-back'));
    expect(onBack).toHaveBeenCalled();
  });
});
