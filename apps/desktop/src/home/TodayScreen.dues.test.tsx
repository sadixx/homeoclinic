// R5 — S03 Today: Clear dues + registered-visit bill chips (R5 design §9;
// HC-MVP1-149, BILL-001/002). Replaces the R3 Slice C6 disabled placeholder:
// "Clear dues" is now ENABLED and opens the S05 patient list filtered to
// dues > 0 (`/patients?dues=1`); due/overdue rows show the real dues; each
// registered-today row shows its bill chip and a Bill button for that visit.
//
// CUT: the REAL <TodayScreen />. Fake: `@/bindings` only (R-TEST-002).
// RED: Today still renders the disabled R3 placeholder and no bill chips.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { todayGetOverview } = vi.hoisted(() => ({ todayGetOverview: vi.fn() }));

vi.mock('@/bindings', () => ({ commands: { todayGetOverview } }));

import { todayIsoDate } from '@/shared/datetime';
import { TodayScreen } from './TodayScreen';

const dueRow = {
  patientId: 'p-1',
  code: 'HC-000001',
  name: 'Test Patient R5',
  ageLabel: '34 y',
  sex: 'male',
  photoPath: null,
  nextFollowupOn: todayIsoDate(),
  duesPaise: 12750,
};

const registered = [
  {
    visitId: 'v-billed',
    patientId: 'p-1',
    code: 'HC-000001',
    name: 'Test Patient R5',
    photoPath: null,
    visitAt: `${todayIsoDate()}T05:00:00Z`,
    type: 'follow_up',
    bill: {
      invoiceId: 'inv-1',
      number: '2026-27/0001',
      totalPaise: 42750,
      balancePaise: 12750,
    },
  },
  {
    visitId: 'v-new',
    patientId: 'p-2',
    code: 'HC-000002',
    name: 'Test Patient R5 B',
    photoPath: null,
    visitAt: `${todayIsoDate()}T06:00:00Z`,
    type: 'first',
    bill: null,
  },
];

beforeEach(() => {
  todayGetOverview.mockReset();
  todayGetOverview.mockResolvedValue({
    dueToday: [dueRow],
    overdue: [],
    registeredToday: registered,
    backupWarning: null,
    licenceReminder: null,
  });
});

describe('TodayScreen (S03) — Clear dues (R5)', () => {
  it('Clear dues is enabled and opens the dues > 0 patient list', async () => {
    const user = userEvent.setup();
    const onOpenDuesList = vi.fn();
    render(<TodayScreen onOpenDuesList={onOpenDuesList} />);
    const clear = await screen.findByTestId('today-clear-dues');
    expect(clear).toBeEnabled();
    expect(clear).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(clear);
    expect(onOpenDuesList).toHaveBeenCalledTimes(1);
  });

  it('due-today rows show the real dues', async () => {
    render(<TodayScreen />);
    expect(await screen.findByText(/127\.50/)).toBeInTheDocument();
  });
});

describe('TodayScreen (S03) — registered-today bill chips (R5)', () => {
  it('shows the receipt number for a billed visit and a Bill button for an unbilled one', async () => {
    const user = userEvent.setup();
    const onOpenInvoice = vi.fn();
    render(<TodayScreen onOpenInvoice={onOpenInvoice} />);
    const chip = await screen.findByTestId('today-visit-billchip-v-billed');
    expect(chip).toHaveTextContent('2026-27/0001');
    expect(screen.getByTestId('today-visit-billchip-v-new')).toHaveTextContent(
      /not billed/i,
    );

    await user.click(screen.getByTestId('today-visit-bill-v-new'));
    expect(onOpenInvoice).toHaveBeenCalledWith('p-2', 'v-new');
  });
});

describe('TodayScreen (S03) — per-row Bill buttons are distinguishable (r5-review-12)', () => {
  it('names each Bill / Open bill button with its patient for screen readers', async () => {
    render(<TodayScreen onOpenInvoice={vi.fn()} />);
    const billed = await screen.findByTestId('today-visit-bill-v-billed');
    const unbilled = screen.getByTestId('today-visit-bill-v-new');
    expect(unbilled).toHaveAccessibleName(/^bill\b.*Test Patient R5 B/i);
    expect(billed).toHaveAccessibleName(/^open bill\b.*Test Patient R5\b/i);
    expect(billed).not.toHaveAccessibleName(/Test Patient R5 B/);
  });
});
