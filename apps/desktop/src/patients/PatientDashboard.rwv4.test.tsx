// RED component tests for the M3-RWv4 "Lab reports & Scans" PANEL on the S07
// patient dashboard (ADR 0019 "Increment M3-RWv4"; .worklog/HC-MVP1-M3/handoffs/
// M3-RWv4-design.md §5.4; docs/ui/S07-patient-dashboard.md).
//
// LEADER DECISION: Lab reports & Scans is a PANEL embedded in the existing S07
// dashboard, NOT a new screen/route. So these tests assert a panel rendered
// inside <PatientDashboard /> that lists the patient's attachments via the NEW
// typed command `patient_list_attachments` (the shared two-way store) and offers
// a delete-everywhere behind a confirm — NOT a `/patient/:id/lab-reports` route.
//
// CUT: the REAL `apps/desktop/src/patients/PatientDashboard.tsx`. The panel +
// the `patientListAttachments` call do not exist yet, so the assertions FAIL on
// the real CUT being incomplete (vitest transpiles; no stand-in). The ONLY fake
// is the dependency: the typed bindings (`vi.mock('@/bindings')`, R-TEST-002).
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const {
  getDashboard,
  softDelete,
  restore,
  exportPdf,
  exportJson,
  touchRecent,
  hasSavedFirstCase,
  patientListAttachments,
  visitDeleteAttachment,
  visitOpenAttachment,
} = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
  exportPdf: vi.fn(),
  exportJson: vi.fn(),
  touchRecent: vi.fn(),
  hasSavedFirstCase: vi.fn(),
  patientListAttachments: vi.fn(),
  visitDeleteAttachment: vi.fn(),
  visitOpenAttachment: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    patientGetDashboard: getDashboard,
    patientSoftDelete: softDelete,
    patientRestore: restore,
    patientExportPdf: exportPdf,
    patientExportJson: exportJson,
    patientTouchRecent: touchRecent,
    visitHasSavedFirstCase: hasSavedFirstCase,
    patientListAttachments,
    visitDeleteAttachment,
    visitOpenAttachment,
  },
}));

// features.case gates the consult entry; the panel must render regardless, but
// keep the feature on so the dashboard renders its full surface.
vi.mock('@/shared/features', () => ({ features: { case: true } }));

import { PatientDashboard } from './PatientDashboard';

function dashboard(overrides: Record<string, unknown> = {}) {
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
    },
    allergies: null,
    alerts: null,
    duesPaise: 0,
    visits: [],
    lastPrescription: null,
    family: [],
    ...overrides,
  };
}

function attachment(
  n: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    attachmentId: `att-${n}`,
    patientId: 'p-123',
    visitId: 'v-1',
    mime: 'application/pdf',
    caption: null,
    originalName: `CBC-Test Patient 001-24-10-2026`,
    byteSize: 10,
    createdAt: '2026-10-24T09:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  getDashboard.mockReset();
  getDashboard.mockResolvedValue(dashboard());
  softDelete.mockReset();
  softDelete.mockResolvedValue({ recycleUntil: '2026-11-19T00:00:00Z' });
  restore.mockReset();
  restore.mockResolvedValue(null);
  exportPdf.mockReset();
  exportPdf.mockResolvedValue({ filePath: '/exports/p.pdf' });
  exportJson.mockReset();
  exportJson.mockResolvedValue({ filePath: '/exports/p.json' });
  touchRecent.mockReset();
  touchRecent.mockResolvedValue(null);
  hasSavedFirstCase.mockReset();
  hasSavedFirstCase.mockResolvedValue({ hasSavedFirstCase: false });
  patientListAttachments.mockReset();
  patientListAttachments.mockResolvedValue({
    attachments: [attachment(1), attachment(2, { mime: 'image/png' })],
  });
  visitDeleteAttachment.mockReset();
  visitDeleteAttachment.mockResolvedValue({ ok: true });
  visitOpenAttachment.mockReset();
  visitOpenAttachment.mockResolvedValue({
    mime: 'application/pdf',
    originalName: 'CBC-Test Patient 001-24-10-2026',
    dataBase64: '',
  });
});

describe('PatientDashboard RWv4 D5 — Lab reports & Scans panel (S07 panel, not a route)', () => {
  it('renders a Lab reports & Scans panel that lists the patient attachments from patient_list_attachments', async () => {
    render(<PatientDashboard patientId="p-123" />);
    await screen.findByTestId('patient-dash-demographics');

    // the panel is on the dashboard itself (not behind a route)
    const panel = await screen.findByTestId('patient-dash-lab-reports-panel');
    expect(panel).toBeInTheDocument();

    // it asked the shared patient-level store (the two-way list command)
    await waitFor(() =>
      expect(patientListAttachments).toHaveBeenCalledWith({
        patientId: 'p-123',
      }),
    );

    // both patient attachments are listed
    await waitFor(() => {
      expect(
        screen.getByTestId('patient-dash-lab-reports-item-1'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('patient-dash-lab-reports-item-2'),
      ).toBeInTheDocument();
    });
    // the display label (not the opaque blob id) is shown
    expect(panel.textContent ?? '').toContain(
      'CBC-Test Patient 001-24-10-2026',
    );
  });

  it('deleting a report from the panel calls visit_delete_attachment behind a confirm (removes everywhere)', async () => {
    render(<PatientDashboard patientId="p-123" />);
    await screen.findByTestId('patient-dash-demographics');
    await screen.findByTestId('patient-dash-lab-reports-panel');
    await waitFor(() =>
      expect(
        screen.getByTestId('patient-dash-lab-reports-item-1'),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('patient-dash-lab-reports-delete-1'));
    // a confirm dialog guards the destructive delete
    expect(
      screen.getByTestId('patient-dash-lab-reports-delete-dialog'),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId('patient-dash-lab-reports-delete-confirm'),
    );

    await waitFor(() =>
      expect(visitDeleteAttachment).toHaveBeenCalledWith({
        attachmentId: 'att-1',
      }),
    );
  });

  it('shows an honest-empty state when the patient has no attachments', async () => {
    patientListAttachments.mockResolvedValue({ attachments: [] });
    render(<PatientDashboard patientId="p-123" />);
    await screen.findByTestId('patient-dash-demographics');
    await screen.findByTestId('patient-dash-lab-reports-panel');
    await waitFor(() =>
      expect(
        screen.getByTestId('patient-dash-lab-reports-empty'),
      ).toBeInTheDocument(),
    );
  });
});
