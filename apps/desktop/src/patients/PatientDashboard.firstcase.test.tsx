// RED tests for M3-RW Slice C — FIRST-CASE gating on the patient dashboard
// (Slice C5). Design: docs/adr/0018-case-big-box-dated-log.md (cross-cutting
// "First-case gating": once the patient's first case (type `first`) is saved,
// "New visit" resolves to follow-up only; starting a brand-new first case is
// greyed out). Signal: the Slice A command `visit_has_saved_first_case`
// (@/bindings: visitHasSavedFirstCase -> { hasSavedFirstCase: boolean }).
//
// CUT: the REAL <PatientDashboard /> (apps/desktop/src/patients/PatientDashboard.tsx).
// The ONLY faked thing is the generated binding `@/bindings` (a dependency,
// R-TEST-002), created with `vi.hoisted` (see PatientDashboard.test.tsx).
//
// Red-first state: the dashboard renders "New visit" ALWAYS enabled when
// features.case && !deleted, and never calls visit_has_saved_first_case. So:
//   - it never invokes the gating command (test 19 FAILS)
//   - after a saved first case, New visit is NOT disabled and has no tooltip
//     (test 18 FAILS)
//   - a Follow-up affordance is not surfaced when gated (test 20 FAILS)
// The "enabled before" case (test 17) may currently pass by accident (always
// enabled) — it is kept so the green phase proves the gate flips the control
// rather than hiding it, and documents the pre-gate behaviour.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { getDashboard, touchRecent, hasSavedFirstCase } = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  touchRecent: vi.fn(),
  hasSavedFirstCase: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    patientGetDashboard: getDashboard,
    patientTouchRecent: touchRecent,
    visitHasSavedFirstCase: hasSavedFirstCase,
    // Unused-by-these-tests commands the component may reference; faked so the
    // module resolves without an unmocked-binding reject.
    patientSoftDelete: vi.fn(),
    patientRestore: vi.fn(),
    patientExportPdf: vi.fn(),
    patientExportJson: vi.fn(),
  },
}));

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

beforeEach(() => {
  getDashboard.mockReset();
  getDashboard.mockResolvedValue(dashboard());
  touchRecent.mockReset();
  touchRecent.mockResolvedValue(null);
  hasSavedFirstCase.mockReset();
  hasSavedFirstCase.mockResolvedValue({ hasSavedFirstCase: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PatientDashboard (S07) — first-case gating (Slice C5)', () => {
  it('leaves New visit ENABLED before any first case is saved (hasSavedFirstCase=false)', async () => {
    hasSavedFirstCase.mockResolvedValue({ hasSavedFirstCase: false });
    render(<PatientDashboard patientId="p-123" onTakeCase={vi.fn()} />);
    await screen.findByTestId('patient-dash-demographics');

    const newVisit = await screen.findByTestId('patient-dash-new-visit');
    // A fresh patient can start their first case — not greyed out.
    await waitFor(() => expect(newVisit).not.toBeDisabled());
    expect(newVisit).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('DISABLES/greys New visit with a tooltip once a first case is saved (hasSavedFirstCase=true)', async () => {
    hasSavedFirstCase.mockResolvedValue({ hasSavedFirstCase: true });
    render(<PatientDashboard patientId="p-123" onTakeCase={vi.fn()} />);
    await screen.findByTestId('patient-dash-demographics');

    const newVisit = await screen.findByTestId('patient-dash-new-visit');
    // The first case is done (ADR 0018): starting another first case is greyed.
    await waitFor(() => expect(newVisit).toBeDisabled());
    // A tooltip explains why (00-conventions read-only/disabled pattern).
    expect(newVisit).toHaveAttribute('title');
    expect(newVisit.getAttribute('title')).not.toBe('');
  });

  it('queries visit_has_saved_first_case for the open patient', async () => {
    render(<PatientDashboard patientId="p-123" onTakeCase={vi.fn()} />);
    await screen.findByTestId('patient-dash-demographics');

    // The gate must come from the typed Slice A command, not a client guess.
    await waitFor(() =>
      expect(hasSavedFirstCase).toHaveBeenCalledWith({ patientId: 'p-123' }),
    );
  });

  it('still offers a Follow-up path when the first case is gated (no dead end)', async () => {
    hasSavedFirstCase.mockResolvedValue({ hasSavedFirstCase: true });
    const onNewFollowup = vi.fn();
    render(
      <PatientDashboard
        patientId="p-123"
        onTakeCase={vi.fn()}
        onNewFollowup={onNewFollowup}
      />,
    );
    await screen.findByTestId('patient-dash-demographics');

    // When starting a new first case is greyed, the doctor must still have a
    // Follow-up affordance offered (ADR 0018: "offer Follow-up instead").
    expect(
      await screen.findByTestId('patient-dash-followup'),
    ).toBeInTheDocument();
  });

  // D1 regression (user-reported dead click): right after the first case is
  // saved the dashboard's `data.visits` is EMPTY/stale, so the old
  // `prev !== undefined` guard made the Follow-up click a silent no-op — the
  // follow-up never opened. The backend resolves the prior visit itself
  // (open_or_create -> latest_visit_for_patient), so the click must fire with
  // the patient id alone, regardless of `data.visits`.
  it('fires onNewFollowup with EMPTY visits when the gated Follow-up button is clicked (D1)', async () => {
    hasSavedFirstCase.mockResolvedValue({ hasSavedFirstCase: true });
    // Dashboard with NO prior visit rows (the exact empty/stale state after a
    // just-saved first case): the follow-up must still fire.
    getDashboard.mockResolvedValue(dashboard({ visits: [] }));
    const onNewFollowup = vi.fn();
    const user = userEvent.setup();
    render(
      <PatientDashboard
        patientId="p-123"
        onTakeCase={vi.fn()}
        onNewFollowup={onNewFollowup}
      />,
    );
    await screen.findByTestId('patient-dash-demographics');

    const followup = await screen.findByTestId('patient-dash-followup');
    await user.click(followup);

    // Fired unconditionally with the patient id (prevVisitId is vestigial).
    await waitFor(() => expect(onNewFollowup).toHaveBeenCalledTimes(1));
    expect(onNewFollowup).toHaveBeenCalledWith('p-123');
  });
});
