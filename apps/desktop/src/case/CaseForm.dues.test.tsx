// R5 — S08 case-form billing strip (R5 design §9; HC-MVP1-149, BILL-001/002).
// Replaces the R3 Slice C6 "dues placeholder" (billing is now built): once the
// visit is saved the strip shows the patient's REAL dues, this visit's bill
// state with "Bill this visit" / "Open bill", and an ENABLED Clear dues when
// dues > 0 (same ClearDuesDialog as the dashboard). The placeholder is gone.
//
// CUT: the REAL <CaseForm /> (with the REAL ClearDuesDialog). Fake: the
// generated binding `@/bindings` only (R-TEST-002), via `vi.hoisted`.
// RED: CaseForm still renders the R3 disabled placeholder.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  openOrCreate,
  autosave,
  listAttachments,
  billingVisitStatus,
  patientDuesGet,
  patientClearDues,
} = vi.hoisted(() => ({
  openOrCreate: vi.fn(),
  autosave: vi.fn(),
  listAttachments: vi.fn(),
  billingVisitStatus: vi.fn(),
  patientDuesGet: vi.fn(),
  patientClearDues: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    caseVisitOpenOrCreate: openOrCreate,
    caseVisitAutosave: autosave,
    visitListAttachments: listAttachments,
    billingVisitStatus,
    patientDuesGet,
    patientClearDues,
  },
}));

import { clearAll, ok, patientDues } from '@/test/billingFixtures';
import { CaseForm } from './CaseForm';

function journalDoc() {
  return {
    schema: 'case-journal',
    version: 2,
    complaints: [
      {
        id: 'cc1',
        title: 'Headache',
        entries: [
          {
            entry_date: '2026-10-16',
            visit_id: 'v-1',
            blocks: [{ kind: 'text', id: 'b1', text: 'Throbbing' }],
          },
        ],
      },
    ],
    sections: {},
  };
}

function renderCase(props: Record<string, unknown> = {}) {
  return render(
    <CaseForm
      patientId="p-123"
      visitId="v-1"
      sex="male"
      ageYears={34}
      {...props}
    />,
  );
}

async function saveCase(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByTestId('case-form');
  await user.click(screen.getByTestId('case-form-save'));
  await waitFor(() => expect(autosave).toHaveBeenCalled());
}

const unbilled = {
  visitId: 'v-1',
  patientId: 'p-123',
  patientDuesPaise: 67750,
  bill: null,
};
const billed = {
  ...unbilled,
  bill: {
    invoiceId: 'inv-1',
    number: '2026-27/0001',
    totalPaise: 42750,
    balancePaise: 22750,
  },
};

beforeEach(() => {
  openOrCreate.mockReset();
  openOrCreate.mockResolvedValue({
    visitId: 'v-1',
    templateId: 'journal_default',
    dataJson: JSON.stringify(journalDoc()),
    vitalsJson: '{}',
    visitAt: '2026-10-16T10:42:00Z',
    nextFollowupOn: null,
  });
  autosave.mockReset();
  autosave.mockResolvedValue({ savedAt: '2026-10-16T10:42:30Z' });
  listAttachments.mockReset();
  listAttachments.mockResolvedValue({ attachments: [] });
  billingVisitStatus.mockReset();
  billingVisitStatus.mockResolvedValue(ok(unbilled));
  patientDuesGet.mockReset();
  patientDuesGet.mockResolvedValue(ok(patientDues()));
  patientClearDues.mockReset();
  patientClearDues.mockResolvedValue(ok(clearAll));
});

describe('CaseForm (S08) — billing strip on save (R5)', () => {
  it('shows the real patient dues for this visit once saved, and no placeholder', async () => {
    const user = userEvent.setup();
    renderCase();
    await saveCase(user);

    const strip = await screen.findByTestId('case-form-billing');
    expect(billingVisitStatus).toHaveBeenCalledWith({ visitId: 'v-1' });
    await waitFor(() =>
      expect(screen.getByTestId('case-form-dues')).toHaveTextContent('677.50'),
    );
    expect(strip).toBeInTheDocument();
    expect(screen.queryByTestId('case-form-dues-placeholder')).toBeNull();
  });

  it('"Bill this visit" opens the invoice of this visit when it is not billed', async () => {
    const user = userEvent.setup();
    const onOpenInvoice = vi.fn();
    renderCase({ onOpenInvoice });
    await saveCase(user);
    const bill = await screen.findByTestId('case-form-bill-visit');
    expect(bill).toBeEnabled();
    await user.click(bill);
    expect(onOpenInvoice).toHaveBeenCalledWith('p-123', 'v-1');
  });

  it('"Open bill" shows the receipt number when the visit is already billed', async () => {
    const user = userEvent.setup();
    const onOpenInvoice = vi.fn();
    billingVisitStatus.mockResolvedValue(ok(billed));
    renderCase({ onOpenInvoice });
    await saveCase(user);
    const open = await screen.findByTestId('case-form-open-bill');
    expect(screen.getByTestId('case-form-billing')).toHaveTextContent(
      '2026-27/0001',
    );
    expect(screen.queryByTestId('case-form-bill-visit')).toBeNull();
    await user.click(open);
    expect(onOpenInvoice).toHaveBeenCalledWith('p-123', 'v-1');
  });

  it('Clear dues is enabled when there are dues and opens the Clear-dues dialog', async () => {
    const user = userEvent.setup();
    renderCase();
    await saveCase(user);
    const clear = await screen.findByTestId('case-form-dues-clear');
    await waitFor(() => expect(clear).toBeEnabled());
    await user.click(clear);
    expect(await screen.findByTestId('clear-dues-dialog')).toBeInTheDocument();
    expect(patientDuesGet).toHaveBeenCalledWith({ patientId: 'p-123' });
  });

  it('Clear dues is disabled when the patient owes nothing', async () => {
    const user = userEvent.setup();
    billingVisitStatus.mockResolvedValue(
      ok({ ...unbilled, patientDuesPaise: 0 }),
    );
    renderCase();
    await saveCase(user);
    await waitFor(() =>
      expect(screen.getByTestId('case-form-dues')).toHaveTextContent('0.00'),
    );
    expect(screen.getByTestId('case-form-dues-clear')).toBeDisabled();
  });
});
