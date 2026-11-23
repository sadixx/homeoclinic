// r5-review-7 (R-UI-008 no stuck state; design R5 §9): the case-form billing
// strip shows an error with Retry when `billing_visit_status` fails (never
// "Loading…" forever), and its Clear dues result links to the receipt like
// the dashboard does.
//
// CUT: the REAL <VisitBillingStrip /> (+ real ClearDuesDialog). The ONLY fake
// is the generated binding `@/bindings` (R-TEST-002). Synthetic data only.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { billingVisitStatus, patientDuesGet, patientClearDues } = vi.hoisted(
  () => ({
    billingVisitStatus: vi.fn(),
    patientDuesGet: vi.fn(),
    patientClearDues: vi.fn(),
  }),
);

vi.mock('@/bindings', () => ({
  commands: { billingVisitStatus, patientDuesGet, patientClearDues },
}));

import type { VisitBillingStatus } from '@/bindings';
import { clearAll, fail, ok, patientDues } from '@/test/billingFixtures';
import { VisitBillingStrip } from './VisitBillingStrip';

const status: VisitBillingStatus = {
  visitId: 'v-1',
  patientId: 'p-1',
  bill: null,
  patientDuesPaise: 67750,
};

beforeEach(() => {
  billingVisitStatus.mockReset();
  patientDuesGet.mockReset();
  patientDuesGet.mockResolvedValue(ok(patientDues()));
  patientClearDues.mockReset();
  patientClearDues.mockResolvedValue(ok(clearAll));
});

describe('Case-form billing strip (r5-review-7)', () => {
  it('shows an error with Retry when the status read fails, and Retry recovers', async () => {
    const user = userEvent.setup();
    billingVisitStatus.mockResolvedValueOnce(fail('internal'));
    billingVisitStatus.mockResolvedValueOnce(ok(status));
    render(<VisitBillingStrip patientId="p-1" visitId="v-1" />);

    expect(
      await screen.findByTestId('case-form-billing-error'),
    ).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('case-form-dues')).not.toHaveTextContent(
      /loading/i,
    );

    await user.click(screen.getByTestId('case-form-billing-retry'));
    expect(await screen.findByTestId('case-form-billchip')).toBeInTheDocument();
    expect(screen.getByTestId('case-form-dues')).toHaveTextContent('677.50');
    expect(screen.queryByTestId('case-form-billing-error')).toBeNull();
    expect(billingVisitStatus).toHaveBeenCalledTimes(2);
  });

  it('Clear dues from the case form offers the receipt of each paid bill', async () => {
    const user = userEvent.setup();
    const onPrintReceipt = vi.fn();
    billingVisitStatus.mockResolvedValue(ok(status));
    render(
      <VisitBillingStrip
        patientId="p-1"
        visitId="v-1"
        onPrintReceipt={onPrintReceipt}
      />,
    );
    await screen.findByTestId('case-form-billchip');

    await user.click(screen.getByTestId('case-form-dues-clear'));
    await screen.findAllByTestId(/^clear-dues-open-\d+$/);
    await user.click(screen.getByTestId('clear-dues-submit'));
    await user.click(await screen.findByTestId('clear-dues-receipt-inv-1'));

    expect(onPrintReceipt).toHaveBeenCalledWith('p-1', 'inv-1');
  });
});
