// RED tests for the S01 first-run setup wizard (HC-MVP1-026,
// docs/ui/S01-first-run-setup.md). CUT: the real <SetupWizard /> component.
//
// The ONLY fake is the dependency: the typed Tauri bindings
// (`vi.mock('@/bindings')`, R-TEST-002) — never the component. Asserts
// behaviour and visible en.json strings (R-TEST-003, R-UI-007); every control
// is found by its spec data-testid (R-UI-003).
//
// Red-first: the component is a stub that renders only a placeholder, so these
// behaviour assertions fail until hc-ui-dev builds the 4-step wizard.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Typed-bindings dependency fake. setup_set_pin returns a one-time recovery
// code; setup_complete returns the home route.
//
// The mock fns are created via `vi.hoisted` so they are available inside the
// hoisted `vi.mock` factory (Vitest hoists vi.mock to the top of the module).
const { setPin, complete } = vi.hoisted(() => ({
  setPin: vi.fn(),
  complete: vi.fn(),
}));
vi.mock('@/bindings', () => ({
  commands: {
    setupGetState: vi.fn(async () => ({
      completed: false,
      currentStep: 1,
      dataDir: '/tmp/hc',
    })),
    setupSaveDoctorProfile: vi.fn(async () => ({ doctorId: 'doc-1' })),
    setupSaveClinicProfile: vi.fn(async () => ({ clinicId: 'cln-1' })),
    setupSetPin: setPin,
    setupStartTrial: vi.fn(async () => ({
      trialValidUntil: '2026-01-31T00:00:00Z',
      trialDaysRemaining: 30,
    })),
    setupComplete: complete,
    setupSetFontSize: vi.fn(async () => undefined),
    setupSetDataDir: vi.fn(async () => ({ dataDir: '/tmp/hc' })),
  },
}));

import en from '@/locales/en.json';
import { SetupWizard } from './SetupWizard';

beforeEach(() => {
  setPin.mockReset();
  setPin.mockResolvedValue({
    recoveryCode: '0a1b2c3d-4e5f6071-8293a4b5-c6d7e8f9',
  });
  complete.mockReset();
  complete.mockResolvedValue({ homeRoute: '/today' });
});

describe('SetupWizard (S01)', () => {
  it('renders four steps starting on Doctor (step 1 of 4)', () => {
    render(<SetupWizard />);
    // The step rail names all four steps (SET-001 four-step cap).
    for (const key of [
      'setup.step.doctor',
      'setup.step.clinic',
      'setup.step.security',
      'setup.step.licence',
    ] as const) {
      expect(screen.getByText(en[key])).toBeInTheDocument();
    }
    // Step 1 shows the doctor name field.
    expect(screen.getByTestId('setup-doctor-name')).toBeInTheDocument();
  });

  it('blocks Next with an inline message when a required field is empty', async () => {
    const user = userEvent.setup();
    render(<SetupWizard />);

    // Click Next with the doctor name empty.
    await user.click(screen.getByTestId('setup-next'));

    // Inline validation (conventions §4), not a toast: an inline message under
    // the field, and the wizard stays on step 1 (clinic field not shown).
    expect(screen.getByText(en['setup.error.required'])).toBeInTheDocument();
    expect(screen.queryByTestId('setup-clinic-name')).not.toBeInTheDocument();
  });

  it('reveals the recovery code once after PIN+confirm match and requires the ack', async () => {
    const user = userEvent.setup();
    render(<SetupWizard />);

    // Fill doctor (step 1) and advance.
    await user.type(screen.getByTestId('setup-doctor-name'), 'Test Doctor 001');
    await user.type(screen.getByTestId('setup-doctor-qualification'), 'BHMS');
    await user.type(screen.getByTestId('setup-doctor-regno'), 'REG-0001');
    await user.type(screen.getByTestId('setup-doctor-council'), 'Test Council');
    await user.click(screen.getByTestId('setup-next'));

    // Fill clinic (step 2) and advance.
    await user.type(screen.getByTestId('setup-clinic-name'), 'Test Clinic 001');
    await user.type(screen.getByTestId('setup-clinic-address'), '1 Test Road');
    await user.type(screen.getByTestId('setup-clinic-fee-first'), '1250');
    await user.type(screen.getByTestId('setup-clinic-fee-followup'), '500');
    await user.click(screen.getByTestId('setup-next'));

    // Security (step 3): set matching PIN, which calls setupSetPin and reveals
    // the recovery code exactly once (SET-004).
    await user.type(screen.getByTestId('setup-pin'), '1234');
    await user.type(screen.getByTestId('setup-pin-confirm'), '1234');
    await user.click(screen.getByTestId('setup-next'));

    expect(setPin).toHaveBeenCalledOnce();
    const code = await screen.findByTestId('setup-recovery-code');
    expect(code).toHaveTextContent('0a1b2c3d-4e5f6071-8293a4b5-c6d7e8f9');
    // The ack checkbox gates leaving step 3.
    expect(screen.getByTestId('setup-recovery-ack')).toBeInTheDocument();
    expect(screen.getByTestId('setup-recovery-print')).toBeInTheDocument();
  });

  it('completes to /today via Finish on the trial path (import hidden)', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<SetupWizard onComplete={onComplete} />);

    // Walk to the licence step.
    await user.type(screen.getByTestId('setup-doctor-name'), 'Test Doctor 001');
    await user.type(screen.getByTestId('setup-doctor-qualification'), 'BHMS');
    await user.type(screen.getByTestId('setup-doctor-regno'), 'REG-0001');
    await user.type(screen.getByTestId('setup-doctor-council'), 'Test Council');
    await user.click(screen.getByTestId('setup-next'));
    await user.type(screen.getByTestId('setup-clinic-name'), 'Test Clinic 001');
    await user.type(screen.getByTestId('setup-clinic-address'), '1 Test Road');
    await user.type(screen.getByTestId('setup-clinic-fee-first'), '1250');
    await user.type(screen.getByTestId('setup-clinic-fee-followup'), '500');
    await user.click(screen.getByTestId('setup-next'));
    await user.type(screen.getByTestId('setup-pin'), '1234');
    await user.type(screen.getByTestId('setup-pin-confirm'), '1234');
    await user.click(screen.getByTestId('setup-next'));
    await user.click(screen.getByTestId('setup-recovery-ack'));
    await user.click(screen.getByTestId('setup-next'));

    // Licence step: trial default, import option hidden behind the flag.
    expect(screen.getByTestId('setup-licence-choice')).toBeInTheDocument();
    expect(
      screen.queryByText(en['setup.licence.import']),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId('setup-finish'));

    expect(complete).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
