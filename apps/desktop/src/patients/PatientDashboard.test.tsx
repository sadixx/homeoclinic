// Component tests for the S07 patient dashboard (HC-MVP1-040, 041, 042, 043;
// docs/ui/S07-patient-dashboard.md). CUT: the real <PatientDashboard />.
//
// The ONLY fake is the dependency: the typed Tauri bindings
// (`vi.mock('@/bindings')`, R-TEST-002). Visible strings from en.json
// (R-UI-007); controls by their spec data-testid (R-UI-003). R2 slice: visits
// timeline is HONEST-EMPTY (0), dues badge is Rs 0, and the four consultation
// quick buttons (New visit / Repertorise / Prescribe / Bill) are HIDDEN (no
// dead end, ADR-0002); demographics / alerts / family / recycle / export are
// real.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  getDashboard,
  softDelete,
  restore,
  exportPdf,
  exportJson,
  touchRecent,
} = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
  exportPdf: vi.fn(),
  exportJson: vi.fn(),
  touchRecent: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    patientGetDashboard: getDashboard,
    patientSoftDelete: softDelete,
    patientRestore: restore,
    patientExportPdf: exportPdf,
    patientExportJson: exportJson,
    patientTouchRecent: touchRecent,
  },
}));

import en from '@/locales/en.json';
import { PatientDashboard } from './PatientDashboard';

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    demographics: {
      code: 'HC-000123',
      name: 'Ramesh Kumar',
      ageLabel: '34y',
      sex: 'M',
      mobile: '9876543210',
      city: 'Pune',
      referredBy: 'Dr Rao',
      photoPath: null,
    },
    allergies: 'Penicillin',
    alerts: null,
    duesPaise: 0,
    visits: [],
    lastPrescription: null,
    family: [{ patientId: 'p-87', name: 'Sita Devi', relation: 'Wife' }],
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
});

describe('PatientDashboard (S07) — load + demographics', () => {
  it('renders demographics, alerts (text + not colour) and dues Rs 0 (R2)', async () => {
    render(<PatientDashboard patientId="p-123" />);
    const demo = await screen.findByTestId('patient-dash-demographics');
    expect(demo).toHaveTextContent('Ramesh Kumar');
    expect(demo).toHaveTextContent('HC-000123');

    const alerts = screen.getByTestId('patient-dash-alerts');
    expect(alerts).toHaveTextContent('Penicillin');
    expect(alerts).toHaveAttribute('role', 'alert');

    expect(screen.getByTestId('patient-dash-dues')).toHaveTextContent('0');
  });

  it('shows the HONEST-EMPTY visit timeline for R2 (no dead end)', async () => {
    render(<PatientDashboard patientId="p-123" />);
    await screen.findByTestId('patient-dash-demographics');
    expect(screen.getByTestId('patient-dash-timeline')).toHaveTextContent(
      en['patient.dash.visits.empty'],
    );
  });

  it('HIDES the four consultation quick buttons at R2 (ADR-0002)', async () => {
    render(<PatientDashboard patientId="p-123" />);
    await screen.findByTestId('patient-dash-demographics');
    expect(
      screen.queryByTestId('patient-dash-new-visit'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('patient-dash-prescribe'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('patient-dash-bill')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('patient-dash-repertorise'),
    ).not.toBeInTheDocument();
  });

  it('records the open in the recent list (PSR-007)', async () => {
    render(<PatientDashboard patientId="p-123" />);
    await screen.findByTestId('patient-dash-demographics');
    await waitFor(() =>
      expect(touchRecent).toHaveBeenCalledWith({ patientId: 'p-123' }),
    );
  });
});

describe('PatientDashboard (S07) — family quick switch (PAT-006)', () => {
  it('switches to the linked patient dashboard', async () => {
    const onOpenPatient = vi.fn();
    const user = userEvent.setup();
    render(
      <PatientDashboard patientId="p-123" onOpenPatient={onOpenPatient} />,
    );
    await screen.findByTestId('patient-dash-demographics');

    await user.click(screen.getByTestId('patient-dash-family-switch-p-87'));
    expect(onOpenPatient).toHaveBeenCalledWith('p-87');
  });
});

describe('PatientDashboard (S07) — recycle bin + restore (PAT-008)', () => {
  it('confirms by name before soft-deleting, then shows restore', async () => {
    const user = userEvent.setup();
    render(<PatientDashboard patientId="p-123" />);
    await screen.findByTestId('patient-dash-demographics');

    await user.click(screen.getByTestId('patient-dash-delete'));
    // Confirm dialog names the patient.
    const confirm = await screen.findByTestId('patient-dash-delete-dialog');
    expect(confirm).toHaveTextContent('Ramesh Kumar');
    expect(confirm).toHaveTextContent('HC-000123');
    expect(softDelete).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('patient-dash-delete-confirm'));
    await waitFor(() =>
      expect(softDelete).toHaveBeenCalledWith({ patientId: 'p-123' }),
    );
    // Now in the bin: a restore control is shown.
    expect(
      await screen.findByTestId('patient-dash-restore'),
    ).toBeInTheDocument();
  });

  it('restores a soft-deleted patient (PAT-008)', async () => {
    getDashboard.mockResolvedValue(
      dashboard({ deletedAt: '2026-10-20T00:00:00Z' }),
    );
    const user = userEvent.setup();
    render(<PatientDashboard patientId="p-123" initiallyDeleted />);
    await screen.findByTestId('patient-dash-demographics');

    await user.click(await screen.findByTestId('patient-dash-restore'));
    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith({ patientId: 'p-123' }),
    );
  });
});

describe('PatientDashboard (S07) — export + edit (PAT-011)', () => {
  it('exports PDF and JSON through the typed commands', async () => {
    const user = userEvent.setup();
    render(<PatientDashboard patientId="p-123" />);
    await screen.findByTestId('patient-dash-demographics');

    await user.click(screen.getByTestId('patient-dash-export-pdf'));
    await waitFor(() =>
      expect(exportPdf).toHaveBeenCalledWith({ patientId: 'p-123' }),
    );

    await user.click(screen.getByTestId('patient-dash-export-json'));
    await waitFor(() =>
      expect(exportJson).toHaveBeenCalledWith({ patientId: 'p-123' }),
    );
  });

  it('opens the edit form (S06)', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(<PatientDashboard patientId="p-123" onEdit={onEdit} />);
    await screen.findByTestId('patient-dash-demographics');

    await user.click(screen.getByTestId('patient-dash-edit'));
    expect(onEdit).toHaveBeenCalledWith('p-123');
  });
});
