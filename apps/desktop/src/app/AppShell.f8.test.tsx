// r5-review-8 (R-UI-004 / design R5 §9): F8 "bill" is ignored inside text
// controls (like F5 / Alt+Left), and on a dashboard with no visit it explains
// "Start a visit first" instead of silently doing nothing. On a dashboard
// with visits it still opens the latest visit's invoice.
//
// CUT: the REAL <AppShell /> (+ real PatientsPage / PatientDashboard). The
// ONLY fake is the generated binding `@/bindings` (R-TEST-002). Synthetic
// data only.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  act,
  fireEvent,
  waitFor,
} from '@testing-library/react';

const { patientGetDashboard } = vi.hoisted(() => ({
  patientGetDashboard: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    setupGetState: vi.fn(async () => ({
      completed: true,
      currentStep: 4,
      dataDir: '/tmp/hc',
    })),
    authGetLockState: vi.fn(async () => ({
      locked: false,
      autolockMinutes: 15,
    })),
    settingsGet: vi.fn(() => new Promise(() => {})),
    appInfo: vi.fn(async () => ({
      name: 'HomeoClinic',
      version: '0.1.0',
      build_profile: 'debug' as const,
    })),
    getBackupStatus: vi.fn(() => new Promise(() => {})),
    getLicenceStatus: vi.fn(() => new Promise(() => {})),
    patientRecent: vi.fn(async () => ({ results: [] })),
    patientSearch: vi.fn(async () => ({ results: [], nextCursor: null })),
    todayGetOverview: vi.fn(async () => ({
      dueToday: [],
      overdue: [],
      registeredToday: [],
      backupWarning: null,
      licenceReminder: null,
    })),
    patientGetDashboard,
    patientTouchRecent: vi.fn(async () => null),
    visitHasSavedFirstCase: vi.fn(async () => ({ hasSavedFirstCase: true })),
    patientListAttachments: vi.fn(async () => ({ attachments: [] })),
    invoiceGetForVisit: vi.fn(() => new Promise(() => {})),
    invoiceComputeTotals: vi.fn(() => new Promise(() => {})),
    invoiceUpiQr: vi.fn(() => new Promise(() => {})),
  },
}));

import { AppShell } from './AppShell';

function dashboard(visits: unknown[]): Record<string, unknown> {
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
    duesPaise: 0,
    visits,
    lastPrescription: null,
    family: [],
  };
}

const VISIT = {
  visitId: 'v-2',
  visitAt: '2026-10-16T05:00:00Z',
  kind: 'follow_up',
  headlineRemedyLabel: null,
  bill: null,
};

async function openDashboard(): Promise<void> {
  render(<AppShell />);
  await screen.findByTestId('today-screen');
  act(() => {
    window.location.hash = '#/patients?id=p-1';
  });
  await screen.findByTestId('patient-dash-demographics');
}

let stray: HTMLInputElement | null = null;

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
  patientGetDashboard.mockReset();
});

afterEach(() => {
  stray?.remove();
  stray = null;
});

describe('F8 bill shortcut (r5-review-8)', () => {
  it('on a dashboard with no visit explains "Start a visit first"', async () => {
    patientGetDashboard.mockResolvedValue(dashboard([]));
    await openDashboard();

    fireEvent.keyDown(document.body, { key: 'F8' });

    expect(await screen.findByTestId('app-open-error')).toHaveTextContent(
      /start a visit first/i,
    );
    expect(window.location.hash).toBe('#/patients?id=p-1');
  });

  it('is ignored while typing in a text control', async () => {
    patientGetDashboard.mockResolvedValue(dashboard([VISIT]));
    await openDashboard();
    const calls = patientGetDashboard.mock.calls.length;
    stray = document.createElement('input');
    document.body.appendChild(stray);
    stray.focus();

    fireEvent.keyDown(stray, { key: 'F8' });

    // Give a (wrong) async open the chance to run before asserting.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(patientGetDashboard.mock.calls.length).toBe(calls);
    expect(window.location.hash).toBe('#/patients?id=p-1');
  });

  it('on a dashboard with visits opens the latest visit invoice', async () => {
    patientGetDashboard.mockResolvedValue(dashboard([VISIT]));
    await openDashboard();

    fireEvent.keyDown(document.body, { key: 'F8' });

    await waitFor(() =>
      expect(window.location.hash).toBe('#/patient/p-1/visit/v-2/invoice'),
    );
  });
});
