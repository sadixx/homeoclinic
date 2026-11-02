// RED component tests for M3-RWv6 item 9 on the REAL <PatientDashboard />:
// after a case / follow-up is saved, the dashboard shows it.
//
//  - VISITS (NEWEST FIRST): one `patient-dash-visit-row` per visit, in the
//    order the backend returns (newest first), each with its DD-MM-YYYY date
//    and a human visit-type label from en.json (`followup.type.first` /
//    `followup.type.followup`), never the raw `follow_up` code.
//  - Last visit date: proposed testid `patient-dash-last-visit` showing the
//    newest visit's date (ASSUMPTION, flagged to the orchestrator: the task
//    says "the last visit date must update"; the dashboard shows none today).
//  - LAST PRESCRIPTION: the backend's `itemsPreview` (medicine, potency,
//    dosage) inside `patient-dash-last-rx`, labelled as an R4 preview via the
//    proposed `patient-dash-last-rx-preview` note (role=note).
//
// The only fake is the typed bindings dependency. Synthetic data only.
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const { getDashboard, touchRecent, hasSavedFirstCase, patientListAttachments } =
  vi.hoisted(() => ({
    getDashboard: vi.fn(),
    touchRecent: vi.fn(),
    hasSavedFirstCase: vi.fn(),
    patientListAttachments: vi.fn(),
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
  },
}));

vi.mock('@/shared/features', () => ({ features: { case: true } }));

import en from '@/locales/en.json';

import { PatientDashboard } from './PatientDashboard';

const VISITS = [
  {
    visitId: 'v-2',
    visitAt: '2026-10-30T10:00:00',
    kind: 'follow_up',
    headlineRemedyLabel: null,
  },
  {
    visitId: 'v-1',
    visitAt: '2026-10-24T09:00:00',
    kind: 'first',
    headlineRemedyLabel: null,
  },
];

function dashboard(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    demographics: {
      code: 'HC-000123',
      name: 'Test Patient 001',
      ageLabel: '34y',
      sex: 'M',
      mobile: '9876543210',
      city: 'Pune',
      referredBy: null,
      photoPath: null,
      maritalStatus: null,
    },
    allergies: null,
    alerts: null,
    duesPaise: 0,
    visits: VISITS,
    lastPrescription: {
      prescriptionId: 'v-2',
      printedAt: null,
      itemsPreview: 'Bryonia alba 200C, 4 pills twice a day',
    },
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
});

async function renderDash(): Promise<void> {
  render(<PatientDashboard patientId="p-123" />);
  await screen.findByTestId('patient-dash-demographics');
}

describe('PatientDashboard RWv6 item 9: visits, last visit and last prescription', () => {
  it('lists the saved visits newest first with their date and a human type label', async () => {
    await renderDash();
    const rows = within(
      screen.getByTestId('patient-dash-timeline'),
    ).getAllByTestId('patient-dash-visit-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('30-10-2026');
    expect(rows[0]).toHaveTextContent(en['followup.type.followup']);
    expect(rows[1]).toHaveTextContent('24-10-2026');
    expect(rows[1]).toHaveTextContent(en['followup.type.first']);
    for (const r of rows) {
      expect(r.textContent ?? '', 'no raw visit-type code').not.toMatch(
        /follow_up/,
      );
    }
    expect(
      screen.queryByText(en['patient.dash.visits.empty']),
    ).not.toBeInTheDocument();
  });

  it('shows the last visit date (the newest visit)', async () => {
    await renderDash();
    const last = await screen.findByTestId('patient-dash-last-visit');
    expect(last).toHaveTextContent('30-10-2026');
  });

  it('shows the last prescription (medicine, potency, dosage) labelled as an R4 preview', async () => {
    await renderDash();
    const card = screen.getByTestId('patient-dash-last-rx');
    expect(card).toHaveTextContent('Bryonia alba 200C, 4 pills twice a day');
    const note = within(card).getByTestId('patient-dash-last-rx-preview');
    expect(note).toHaveAttribute('role', 'note');
    expect(note.textContent ?? '').toMatch(/R4/);
    expect(note.textContent ?? '').toMatch(/preview/i);
  });

  it('GUARD: no prescription keeps the honest empty text and no preview note', async () => {
    getDashboard.mockResolvedValue(dashboard({ lastPrescription: null }));
    await renderDash();
    const card = screen.getByTestId('patient-dash-last-rx');
    expect(card).toHaveTextContent(en['patient.dash.lastRx.none']);
    expect(
      within(card).queryByTestId('patient-dash-last-rx-preview'),
    ).not.toBeInTheDocument();
  });
});
