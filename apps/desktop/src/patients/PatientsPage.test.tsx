// Container test for the Patients route (docs/ui/S05/S06/S07). CUT: the real
// <PatientsPage /> which owns the view switching between the list (S05), the
// register/edit form (S06) and the dashboard (S07), all consuming ONLY typed
// bindings. The ONLY fake is `@/bindings` (R-TEST-002).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  listQuery,
  exportCsv,
  nextCode,
  checkDuplicate,
  createPatient,
  updatePatient,
  getDashboard,
  softDelete,
  restore,
  exportPdf,
  exportJson,
  touchRecent,
} = vi.hoisted(() => ({
  listQuery: vi.fn(),
  exportCsv: vi.fn(),
  nextCode: vi.fn(),
  checkDuplicate: vi.fn(),
  createPatient: vi.fn(),
  updatePatient: vi.fn(),
  getDashboard: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
  exportPdf: vi.fn(),
  exportJson: vi.fn(),
  touchRecent: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    patientListQuery: listQuery,
    patientListExportCsv: exportCsv,
    patientNextCode: nextCode,
    patientCheckDuplicate: checkDuplicate,
    patientCreate: createPatient,
    patientUpdate: updatePatient,
    patientGetDashboard: getDashboard,
    patientSoftDelete: softDelete,
    patientRestore: restore,
    patientExportPdf: exportPdf,
    patientExportJson: exportJson,
    patientTouchRecent: touchRecent,
  },
}));

import { PatientsPage } from './PatientsPage';

function dashboard() {
  return {
    demographics: {
      code: 'HC-000123',
      name: 'Ramesh Kumar',
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
  };
}

beforeEach(() => {
  listQuery.mockReset();
  listQuery.mockResolvedValue({
    rows: [
      {
        patientId: 'p-123',
        code: 'HC-000123',
        name: 'Ramesh Kumar',
        ageLabel: '34y',
        sex: 'M',
        mobile: '9876543210',
        city: 'Pune',
        lastVisitAt: null,
        duesPaise: 0,
        matchType: '',
        photoPath: null,
      },
    ],
    total: 1,
    nextCursor: null,
  });
  nextCode.mockReset();
  nextCode.mockResolvedValue({ code: 'HC-000312' });
  checkDuplicate.mockReset();
  checkDuplicate.mockResolvedValue({ matches: [] });
  createPatient.mockReset();
  createPatient.mockResolvedValue({ patientId: 'p-new', code: 'HC-000312' });
  getDashboard.mockReset();
  getDashboard.mockResolvedValue(dashboard());
  touchRecent.mockReset();
  touchRecent.mockResolvedValue(null);
});

describe('PatientsPage — list is the default view (S05)', () => {
  it('renders the list screen first', async () => {
    render(<PatientsPage />);
    expect(await screen.findByTestId('patient-list-title')).toBeInTheDocument();
    expect(await screen.findByTestId('patient-list-row')).toBeInTheDocument();
  });
});

describe('PatientsPage — open a patient from the list opens the dashboard (S07)', () => {
  it('switches to the dashboard view', async () => {
    const user = userEvent.setup();
    render(<PatientsPage />);
    await user.click(await screen.findByTestId('patient-list-row'));
    expect(
      await screen.findByTestId('patient-dash-demographics'),
    ).toBeInTheDocument();
  });
});

describe('PatientsPage — deep-link to a patient id opens the dashboard', () => {
  it('opens the dashboard for an initial patientId', async () => {
    render(<PatientsPage initialPatientId="p-123" />);
    expect(
      await screen.findByTestId('patient-dash-demographics'),
    ).toBeInTheDocument();
  });
});

describe('PatientsPage — register a new patient then land on its dashboard', () => {
  it('opens the form and after save shows the new dashboard', async () => {
    const user = userEvent.setup();
    render(<PatientsPage initialView="new" />);

    await screen.findByTestId('patient-form-code');
    await user.type(screen.getByTestId('patient-form-name'), 'New Person');
    await user.type(screen.getByTestId('patient-form-age'), '20');
    await user.click(screen.getByTestId('patient-form-save'));

    await waitFor(() => expect(createPatient).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByTestId('patient-dash-demographics'),
    ).toBeInTheDocument();
  });
});
