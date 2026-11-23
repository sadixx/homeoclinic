// R5 — S07 dashboard billing (R5 design §9; HC-MVP1-149, BILL-001/002).
// Replaces the R2 "Dues Rs 0" placeholder: the badge shows the REAL running
// balance, Clear dues records a payment (and the badge refreshes), the Bill
// quick button opens the latest visit's invoice (disabled with a hint when
// there is no visit), and each timeline row carries a bill chip.
//
// CUT: the REAL <PatientDashboard /> with the REAL <ClearDuesDialog /> inside.
// Fake: `@/bindings` only (R-TEST-002). Synthetic data only.
// RED: the dashboard still renders the R2 dues badge with no billing controls.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  getDashboard,
  touchRecent,
  hasSavedFirstCase,
  patientListAttachments,
  patientDuesGet,
  patientClearDues,
} = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  touchRecent: vi.fn(),
  hasSavedFirstCase: vi.fn(),
  patientListAttachments: vi.fn(),
  patientDuesGet: vi.fn(),
  patientClearDues: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    patientGetDashboard: getDashboard,
    patientSoftDelete: vi.fn(),
    patientRestore: vi.fn(),
    patientExportPdf: vi.fn(),
    patientExportJson: vi.fn(),
    patientTouchRecent: touchRecent,
    visitHasSavedFirstCase: hasSavedFirstCase,
    patientListAttachments,
    visitDeleteAttachment: vi.fn(),
    visitOpenAttachment: vi.fn(),
    patientDuesGet,
    patientClearDues,
  },
}));

vi.mock('@/shared/features', () => ({ features: { case: true } }));

import { formatDate } from '@/shared/datetime';
import { clearAll, ok, patientDues } from '@/test/billingFixtures';
import { PatientDashboard } from './PatientDashboard';

const VISITS = [
  {
    visitId: 'v-2',
    visitAt: '2026-10-16T05:00:00Z',
    kind: 'follow_up',
    headlineRemedyLabel: null,
    bill: null,
  },
  {
    visitId: 'v-1',
    visitAt: '2026-10-15T05:00:00Z',
    kind: 'first',
    headlineRemedyLabel: null,
    bill: {
      invoiceId: 'inv-1',
      number: '2026-27/0001',
      totalPaise: 42750,
      balancePaise: 22750,
    },
  },
  {
    visitId: 'v-0',
    visitAt: '2026-10-01T05:00:00Z',
    kind: 'first',
    headlineRemedyLabel: null,
    bill: {
      invoiceId: 'inv-0',
      number: '2026-27/0000',
      totalPaise: 30000,
      balancePaise: 0,
    },
  },
];

function dashboard(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    demographics: {
      code: 'HC-000001',
      name: 'Test Patient R5',
      ageLabel: '34y',
      sex: 'M',
      mobile: '9876500001',
      city: 'Pune',
      referredBy: null,
      photoPath: null,
      maritalStatus: null,
    },
    allergies: null,
    alerts: null,
    duesPaise: 67750,
    visits: VISITS,
    lastPrescription: null,
    family: [],
    ...over,
  };
}

beforeEach(() => {
  getDashboard.mockReset();
  getDashboard.mockResolvedValue(dashboard());
  touchRecent.mockReset();
  touchRecent.mockResolvedValue(null);
  hasSavedFirstCase.mockReset();
  hasSavedFirstCase.mockResolvedValue({ hasSavedFirstCase: true });
  patientListAttachments.mockReset();
  patientListAttachments.mockResolvedValue({ attachments: [] });
  patientDuesGet.mockReset();
  patientDuesGet.mockResolvedValue(ok(patientDues()));
  patientClearDues.mockReset();
  patientClearDues.mockResolvedValue(ok(clearAll));
});

async function renderDash(props: Record<string, unknown> = {}): Promise<void> {
  render(<PatientDashboard patientId="p-123" {...props} />);
  await screen.findByTestId('patient-dash-demographics');
}

describe('S07 dashboard — running dues', () => {
  it('shows the real patient balance in the dues badge', async () => {
    await renderDash();
    expect(screen.getByTestId('patient-dash-dues')).toHaveTextContent('677.50');
  });

  it('shows Clear dues only when there are dues', async () => {
    await renderDash();
    expect(screen.getByTestId('patient-dash-clear-dues')).toBeEnabled();
  });

  it('hides Clear dues when dues are zero (badge reads 0.00)', async () => {
    getDashboard.mockResolvedValue(dashboard({ duesPaise: 0 }));
    await renderDash();
    expect(screen.getByTestId('patient-dash-dues')).toHaveTextContent('0.00');
    expect(screen.queryByTestId('patient-dash-clear-dues')).toBeNull();
  });

  it('Clear dues records a payment and refreshes the badge', async () => {
    const user = userEvent.setup();
    await renderDash();
    getDashboard.mockResolvedValue(dashboard({ duesPaise: 0 }));

    await user.click(screen.getByTestId('patient-dash-clear-dues'));
    expect(await screen.findByTestId('clear-dues-dialog')).toBeInTheDocument();
    expect(patientDuesGet).toHaveBeenCalledWith({ patientId: 'p-123' });
    await screen.findAllByTestId(/^clear-dues-open-\d+$/);
    await user.click(screen.getByTestId('clear-dues-submit'));

    await waitFor(() =>
      expect(patientClearDues).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'p-123',
          expectedDuesPaise: 67750,
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('patient-dash-dues')).toHaveTextContent('0.00'),
    );
  });
});

describe('S07 dashboard — Bill entry points', () => {
  it('Bill opens the invoice of the latest visit', async () => {
    const user = userEvent.setup();
    const onOpenInvoice = vi.fn();
    await renderDash({ onOpenInvoice });
    const bill = screen.getByTestId('patient-dash-bill');
    expect(bill).toBeEnabled();
    await user.click(bill);
    expect(onOpenInvoice).toHaveBeenCalledWith('p-123', 'v-2');
  });

  it('Bill is disabled with a "Start a visit first" hint when there is no visit', async () => {
    getDashboard.mockResolvedValue(dashboard({ visits: [], duesPaise: 0 }));
    await renderDash();
    const bill = screen.getByTestId('patient-dash-bill');
    expect(bill).toBeDisabled();
    const hint =
      (bill.getAttribute('title') ?? '') +
      (bill.getAttribute('aria-describedby')
        ? (document.getElementById(bill.getAttribute('aria-describedby')!)
            ?.textContent ?? '')
        : '');
    expect(hint).toMatch(/start a visit first/i);
  });

  it('timeline rows show the bill chip (number + due / paid) or a Bill link', async () => {
    const user = userEvent.setup();
    const onOpenInvoice = vi.fn();
    await renderDash({ onOpenInvoice });

    const due = screen.getByTestId('patient-dash-visit-billchip-v-1');
    expect(due).toHaveTextContent('2026-27/0001');
    expect(due).toHaveTextContent('227.50');
    expect(
      screen.getByTestId('patient-dash-visit-billchip-v-0'),
    ).toHaveTextContent(/paid/i);

    expect(
      screen.getByTestId('patient-dash-visit-billchip-v-2'),
    ).toHaveTextContent(/not billed/i);
    await user.click(screen.getByTestId('patient-dash-visit-bill-v-2'));
    expect(onOpenInvoice).toHaveBeenCalledWith('p-123', 'v-2');

    await user.click(due);
    expect(onOpenInvoice).toHaveBeenCalledWith('p-123', 'v-1');
  });
});

describe('S07 dashboard — timeline Bill buttons are distinguishable (r5-review-12)', () => {
  it('names the per-visit Bill button with the visit date for screen readers', async () => {
    await renderDash({ onOpenInvoice: vi.fn() });
    const bill = screen.getByTestId('patient-dash-visit-bill-v-2');
    const date = formatDate('2026-10-16T05:00:00Z');
    expect(date).not.toBeNull();
    expect(bill).toHaveAccessibleName(/^bill\b/i);
    expect(bill.getAttribute('aria-label') ?? '').toContain(date!);
  });
});
