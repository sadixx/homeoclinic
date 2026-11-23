// R5 — Clear-dues dialog (R5 design §9; HC-MVP1-149, BILL-002). Lists the
// open bills oldest first, defaults the amount to the total dues (editable
// down), records ONE payment through `patient_clear_dues` with the dues the
// dialog opened with (stale-dialog guard), then reports the allocation.
//
// CUT: the REAL <ClearDuesDialog />. Fake: `@/bindings` only (R-TEST-002).
// RED: the §13 stub renders nothing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { patientDuesGet, patientClearDues } = vi.hoisted(() => ({
  patientDuesGet: vi.fn(),
  patientClearDues: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: { patientDuesGet, patientClearDues },
}));

import { todayIsoDate } from '@/shared/datetime';
import { clearAll, fail, ok, patientDues } from '@/test/billingFixtures';
import { ClearDuesDialog } from './ClearDuesDialog';

function renderDialog(props: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  const onCleared = vi.fn();
  render(
    <ClearDuesDialog
      patientId="p-1"
      open
      onClose={onClose}
      onCleared={onCleared}
      {...props}
    />,
  );
  return { onClose, onCleared };
}

beforeEach(() => {
  patientDuesGet.mockReset();
  patientDuesGet.mockResolvedValue(ok(patientDues()));
  patientClearDues.mockReset();
  patientClearDues.mockResolvedValue(ok(clearAll));
});

describe('Clear dues dialog', () => {
  it('lists the open bills oldest first and defaults the amount to the total dues', async () => {
    renderDialog();
    expect(await screen.findByTestId('clear-dues-dialog')).toBeInTheDocument();
    expect(patientDuesGet).toHaveBeenCalledWith({ patientId: 'p-1' });
    const rows = await screen.findAllByTestId(/^clear-dues-open-\d+$/);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('2026-27/0001');
    expect(rows[0]).toHaveTextContent('227.50');
    expect(rows[1]).toHaveTextContent('2026-27/0002');
    expect(
      (screen.getByTestId('clear-dues-amount') as HTMLInputElement).value,
    ).toMatch(/^677\.50$|^677\.5$/);
    expect(screen.getByTestId('clear-dues-dialog')).toHaveTextContent('677.50');
  });

  it('records one payment with mode, reference, date and the expected dues', async () => {
    const user = userEvent.setup();
    const { onCleared } = renderDialog();
    await screen.findAllByTestId(/^clear-dues-open-\d+$/);

    const amount = screen.getByTestId('clear-dues-amount');
    await user.clear(amount);
    await user.type(amount, '100');
    // Select or radio group: either is fine for the design (§9).
    const mode = screen.getByTestId('clear-dues-mode');
    if (mode.tagName === 'SELECT') await user.selectOptions(mode, 'upi');
    else await user.click(within(mode).getByRole('radio', { name: /upi/i }));
    await user.type(screen.getByTestId('clear-dues-ref'), 'UTR123');
    await user.click(screen.getByTestId('clear-dues-submit'));

    await waitFor(() =>
      expect(patientClearDues).toHaveBeenCalledWith({
        patientId: 'p-1',
        payment: {
          amountPaise: 10000,
          mode: 'upi',
          reference: 'UTR123',
          paidOn: todayIsoDate(),
        },
        expectedDuesPaise: 67750,
      }),
    );
    expect(onCleared).toHaveBeenCalledWith(clearAll);
  });

  it('shows which bills the money went to', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findAllByTestId(/^clear-dues-open-\d+$/);
    await user.click(screen.getByTestId('clear-dues-submit'));
    expect(await screen.findByText(/2026-27\/0001/)).toBeInTheDocument();
    expect(screen.getAllByText(/0002/).length).toBeGreaterThan(0);
  });

  it('shows the stale-dues conflict inline and keeps the dialog open', async () => {
    const user = userEvent.setup();
    patientClearDues.mockResolvedValue(
      fail('conflict', 'This was changed somewhere else since you opened it.'),
    );
    const { onCleared } = renderDialog();
    await screen.findAllByTestId(/^clear-dues-open-\d+$/);
    await user.click(screen.getByTestId('clear-dues-submit'));
    expect(
      await screen.findByText(/changed somewhere else/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('clear-dues-dialog')).toBeInTheDocument();
    expect(onCleared).not.toHaveBeenCalled();
  });

  it('Cancel closes without paying', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog();
    await screen.findByTestId('clear-dues-dialog');
    await user.click(screen.getByTestId('clear-dues-cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(patientClearDues).not.toHaveBeenCalled();
  });
});
