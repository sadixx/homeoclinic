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
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Typed-bindings dependency fake. setup_set_pin returns a one-time recovery
// code; setup_complete returns the home route.
//
// The mock fns are created via `vi.hoisted` so they are available inside the
// hoisted `vi.mock` factory (Vitest hoists vi.mock to the top of the module).
const { setPin, complete, saveDoctor } = vi.hoisted(() => ({
  setPin: vi.fn(),
  complete: vi.fn(),
  saveDoctor: vi.fn(),
}));
vi.mock('@/bindings', () => ({
  commands: {
    setupGetState: vi.fn(async () => ({
      completed: false,
      currentStep: 1,
      dataDir: '/tmp/hc',
    })),
    setupSaveDoctorProfile: saveDoctor,
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
  saveDoctor.mockReset();
  saveDoctor.mockResolvedValue({ doctorId: 'doc-1' });
});

// Pick a council for the flow tests. fireEvent.change sets the control's
// value directly, so it works for the registration-council <select> (value is
// one of the listed labels).
function fillCouncil(): void {
  // Selected by option text so these flow tests do not depend on the label
  // format (the label format is asserted by the council tests below).
  const control = screen.getByTestId(
    'setup-doctor-council',
  ) as HTMLSelectElement;
  const option = Array.from(control.options).find((o) =>
    (o.textContent ?? '').startsWith('Maharashtra'),
  );
  fireEvent.change(control, { target: { value: option?.value ?? '' } });
}

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
    fillCouncil();
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
    fillCouncil();
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

  // Regression (defect: premature in-wizard Backup link bypasses completion).
  // The licence step must NOT render a "go to Backup" control: the wizard's
  // only forward exit is Finish, which runs setup_complete + setup_start_trial
  // and routes to Today. The S01 spec links to S17 only ONCE setup is complete,
  // so the link belongs on Today/StatusBar, never mid-wizard (before the trial
  // is activated). An onGoToBackup prop is deliberately passed here: even when
  // the host offers navigation, the licence step must not expose a pre-
  // completion jump to Backup. FAILS on current code (the button renders
  // whenever onGoToBackup is defined).
  it('does not render a go-to-Backup link on the licence step (completion is the only forward exit)', async () => {
    const user = userEvent.setup();
    const onGoToBackup = vi.fn();
    render(<SetupWizard onGoToBackup={onGoToBackup} />);

    // Walk to the licence step (step 4).
    await user.type(screen.getByTestId('setup-doctor-name'), 'Test Doctor 001');
    await user.type(screen.getByTestId('setup-doctor-qualification'), 'BHMS');
    await user.type(screen.getByTestId('setup-doctor-regno'), 'REG-0001');
    fillCouncil();
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

    // We are on the licence step (Finish is shown).
    expect(screen.getByTestId('setup-finish')).toBeInTheDocument();

    // The premature Backup jump must be gone — no control, no wiring path.
    expect(screen.queryByTestId('setup-backup-link')).not.toBeInTheDocument();
    expect(screen.queryByText(en['setup.backup.link'])).not.toBeInTheDocument();
    expect(onGoToBackup).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HC-MVP1-M3set — registration council dropdown (Step 1, doctor profile).
//
// Contract under test (RED until hc-ui-dev implements it):
// - `setup-doctor-council` is a native <select> (role combobox, like the
//   language / auto-lock selects in this wizard), labelled by
//   en['setup.doctor.council'], starting with no council chosen (an optional
//   empty-value placeholder option is allowed and is not counted).
// - Its non-placeholder options are EXACTLY the verified list below, in this
//   order, followed by a final 'Other (type manually)' option whose text comes
//   from en.json (i18n).
// - Choosing a listed council stores that exact label in
//   SaveDoctorProfileRequest.regCouncil (existing String field; no binding
//   change).
// - Choosing Other reveals a required, labelled text input
//   `setup-doctor-council-other`; its trimmed text is stored. Empty /
//   whitespace-only Other blocks Next with the inline required message at
//   `setup-doctor-council-other-error`.
// - Returning to step 1 (Back) re-opens the stored value: a listed label shows
//   as selected; any other text shows as Other with the text preserved.
//
// Source of the list: Ministry of AYUSH reply to Rajya Sabha Unstarred
// Q.1768 (02.08.2022), Annexure II, plus the national registers. Himachal
// Pradesh is deliberately excluded (no authority name in the source).
// ---------------------------------------------------------------------------

const VERIFIED_COUNCILS: readonly string[] = [
  'Andhra Pradesh: Andhra Boards for Ayurveda and Homoeopathy',
  'Arunachal Pradesh: Arunachal Pradesh Homoeopathy Council',
  'Assam: Board of Homoeopathic System of Medicine, Assam',
  'Bihar: Bihar Homoeopathic Board of Medicine',
  'Chandigarh (UT): Council of Homoeopathic System of Medicine, Chandigarh',
  'Chhattisgarh: State Council of Homoeopathy, Chhattisgarh',
  'Delhi: Board of Homoeopathic System of Medicine, Delhi',
  'Goa: Goa Board of Indian System of Medicine & Homoeopathy',
  'Gujarat: Council of Homoeopathic System of Medicine, Gujarat State',
  'Haryana: Council of Homoeopathic System of Medicine, Haryana',
  'Jammu & Kashmir: Jammu & Kashmir Board of Homoeopathic System of Medicine',
  'Jharkhand: Jharkhand State AYUSH Medical Council',
  'Karnataka: Karnataka Board of Homoeopathic System of Medicine',
  'Kerala: Kerala State Medical Council',
  'Madhya Pradesh: State Council of Homoeopathy, Madhya Pradesh',
  'Maharashtra: Maharashtra Council of Homoeopathy',
  'Meghalaya: Board of Homoeopathic Medicine, Meghalaya',
  'Nagaland: Board of Homoeopathic System of Medicine, Nagaland',
  'Odisha: Directorate of AYUSH, Odisha (registering authority)',
  'Punjab: Council of Homoeopathic System of Medicine, Punjab',
  'Rajasthan: Rajasthan Board of Homoeopathic Chikitsa Board',
  'Tamil Nadu: Tamil Nadu Homoeopathic Medical Council',
  'Telangana: Boards of Indian Medicines, Telangana',
  'Tripura: Council of Homoeopathic Medicine, Tripura',
  'Uttar Pradesh: Homoeopathic Medicine Board, Uttar Pradesh',
  'Uttarakhand: Homoeopathic Medicine Board, Uttarakhand',
  'West Bengal: Council of Homoeopathic Medicine, West Bengal',
  'National: National Commission for Homoeopathy (National Register)',
  'National (legacy): Central Council of Homoeopathy (pre-2020)',
];
const OTHER_LABEL = 'Other (type manually)';
const SYNTHETIC_OTHER = 'Test Council for Sikkim';

function councilControl(): HTMLElement {
  return screen.getByTestId('setup-doctor-council');
}

/** Visible labels of the selectable (non-placeholder) options, in order. */
function listedOptionLabels(control: HTMLElement): string[] {
  return within(control)
    .getAllByRole('option', { hidden: true })
    .filter((o) => (o as HTMLOptionElement).value !== '')
    .map((o) => (o.textContent ?? '').trim());
}

async function fillDoctorExceptCouncil(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.type(screen.getByTestId('setup-doctor-name'), 'Test Doctor 001');
  await user.type(screen.getByTestId('setup-doctor-qualification'), 'BHMS');
  await user.type(screen.getByTestId('setup-doctor-regno'), 'REG-0001');
}

function savedCouncil(): unknown {
  expect(saveDoctor).toHaveBeenCalledOnce();
  return (saveDoctor.mock.calls[0]?.[0] as { regCouncil?: unknown })
    ?.regCouncil;
}

describe('SetupWizard registration council dropdown (HC-MVP1-M3set)', () => {
  it('offers exactly the verified registering authorities followed by a final Other option', () => {
    render(<SetupWizard />);
    const control = councilControl();
    expect(control).toHaveRole('combobox');

    const labels = listedOptionLabels(control);
    expect(labels).toHaveLength(30);
    expect(labels).toEqual([...VERIFIED_COUNCILS, OTHER_LABEL]);
    expect(labels).toContain('Maharashtra: Maharashtra Council of Homoeopathy');
    expect(labels).toContain('Kerala: Kerala State Medical Council');
    expect(labels).toContain(
      'Odisha: Directorate of AYUSH, Odisha (registering authority)',
    );
    expect(labels.at(-1)).toBe(OTHER_LABEL);
    // Not confirmed by the source: must not be offered.
    expect(labels.some((l) => /himachal/i.test(l))).toBe(false);
    // The Other label is UI copy and lives in the locale file (R-UI-007).
    expect(Object.values(en)).toContain(OTHER_LABEL);
  });

  it('starts with no council chosen and blocks Next with an inline required message', async () => {
    const user = userEvent.setup();
    render(<SetupWizard />);
    const control = councilControl();
    expect(control).toHaveRole('combobox');
    expect(control).toHaveValue('');

    await fillDoctorExceptCouncil(user);
    await user.click(screen.getByTestId('setup-next'));

    expect(screen.getByTestId('setup-doctor-council-error')).toHaveTextContent(
      en['setup.error.required'],
    );
    expect(saveDoctor).not.toHaveBeenCalled();
    expect(screen.queryByTestId('setup-clinic-name')).not.toBeInTheDocument();
  });

  it.each([
    'Odisha: Directorate of AYUSH, Odisha (registering authority)',
    'National: National Commission for Homoeopathy (National Register)',
  ])(
    'stores the chosen listed label verbatim in the doctor profile: %s',
    async (label) => {
      const user = userEvent.setup();
      render(<SetupWizard />);
      await fillDoctorExceptCouncil(user);
      const control = councilControl();
      expect(control).toHaveRole('combobox');

      await user.selectOptions(control, label);
      // No free-text box for a listed council.
      expect(
        screen.queryByTestId('setup-doctor-council-other'),
      ).not.toBeInTheDocument();
      await user.click(screen.getByTestId('setup-next'));

      expect(savedCouncil()).toBe(label);
      expect(
        await screen.findByTestId('setup-clinic-name'),
      ).toBeInTheDocument();
    },
  );

  it('reveals a required labelled text box for Other and stores the typed text (trimmed)', async () => {
    const user = userEvent.setup();
    render(<SetupWizard />);
    await fillDoctorExceptCouncil(user);
    const control = councilControl();
    expect(control).toHaveRole('combobox');
    expect(
      screen.queryByTestId('setup-doctor-council-other'),
    ).not.toBeInTheDocument();

    await user.selectOptions(control, OTHER_LABEL);
    const other = screen.getByTestId('setup-doctor-council-other');
    expect(other).toHaveRole('textbox');
    expect(other).toBeRequired();
    expect(other).toHaveAccessibleName(/\S/);

    await user.type(other, `  ${SYNTHETIC_OTHER}  `);
    await user.click(screen.getByTestId('setup-next'));

    // The typed text is stored, never the 'Other' placeholder label.
    expect(savedCouncil()).toBe(SYNTHETIC_OTHER);
    expect(await screen.findByTestId('setup-clinic-name')).toBeInTheDocument();
  });

  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
  ])(
    'blocks Next with an inline required message when Other is %s',
    async (_case, typed) => {
      const user = userEvent.setup();
      render(<SetupWizard />);
      await fillDoctorExceptCouncil(user);
      const control = councilControl();
      expect(control).toHaveRole('combobox');

      await user.selectOptions(control, OTHER_LABEL);
      if (typed !== '') {
        await user.type(
          screen.getByTestId('setup-doctor-council-other'),
          typed,
        );
      }
      await user.click(screen.getByTestId('setup-next'));

      expect(
        screen.getByTestId('setup-doctor-council-other-error'),
      ).toHaveTextContent(en['setup.error.required']);
      expect(saveDoctor).not.toHaveBeenCalled();
      expect(screen.queryByTestId('setup-clinic-name')).not.toBeInTheDocument();
    },
  );

  it('switching from Other back to a listed council hides the text box and stores the listed label, not the stale text', async () => {
    const user = userEvent.setup();
    render(<SetupWizard />);
    await fillDoctorExceptCouncil(user);
    const control = councilControl();
    expect(control).toHaveRole('combobox');

    await user.selectOptions(control, OTHER_LABEL);
    await user.type(
      screen.getByTestId('setup-doctor-council-other'),
      SYNTHETIC_OTHER,
    );
    await user.selectOptions(control, 'Kerala: Kerala State Medical Council');
    expect(
      screen.queryByTestId('setup-doctor-council-other'),
    ).not.toBeInTheDocument();
    await user.click(screen.getByTestId('setup-next'));

    expect(savedCouncil()).toBe('Kerala: Kerala State Medical Council');
  });

  // Re-open path. The wizard has no profile pre-fill (SetupState carries no
  // doctor profile), so the in-product re-open is Back from step 2: the stored
  // value must come back as Other with the text intact, never dropped.
  it('re-opens a typed council (not in the list) as Other with the text preserved', async () => {
    const user = userEvent.setup();
    render(<SetupWizard />);
    await fillDoctorExceptCouncil(user);
    const control = councilControl();
    expect(control).toHaveRole('combobox');
    await user.selectOptions(control, OTHER_LABEL);
    await user.type(
      screen.getByTestId('setup-doctor-council-other'),
      SYNTHETIC_OTHER,
    );
    await user.click(screen.getByTestId('setup-next'));
    await screen.findByTestId('setup-clinic-name');

    await user.click(screen.getByTestId('setup-back'));

    expect(councilControl()).toHaveDisplayValue(OTHER_LABEL);
    expect(screen.getByTestId('setup-doctor-council-other')).toHaveValue(
      SYNTHETIC_OTHER,
    );
    // Advancing again re-sends the same preserved text.
    await user.click(screen.getByTestId('setup-next'));
    expect(saveDoctor).toHaveBeenCalledTimes(2);
    expect(
      (saveDoctor.mock.calls[1]?.[0] as { regCouncil?: unknown })?.regCouncil,
    ).toBe(SYNTHETIC_OTHER);
  });

  it('re-opens a listed council as that option selected (no Other box)', async () => {
    const user = userEvent.setup();
    render(<SetupWizard />);
    await fillDoctorExceptCouncil(user);
    const control = councilControl();
    expect(control).toHaveRole('combobox');
    await user.selectOptions(
      control,
      'Maharashtra: Maharashtra Council of Homoeopathy',
    );
    await user.click(screen.getByTestId('setup-next'));
    await screen.findByTestId('setup-clinic-name');

    await user.click(screen.getByTestId('setup-back'));

    expect(councilControl()).toHaveDisplayValue(
      'Maharashtra: Maharashtra Council of Homoeopathy',
    );
    expect(
      screen.queryByTestId('setup-doctor-council-other'),
    ).not.toBeInTheDocument();
  });

  it('is a labelled combobox reachable by keyboard, with the Other box next in tab order', async () => {
    const user = userEvent.setup();
    render(<SetupWizard />);
    const control = councilControl();
    expect(control).toHaveRole('combobox');
    expect(control).toHaveAccessibleName(en['setup.doctor.council']);
    expect(control).toBeRequired();

    // Tab from the registration number lands on the council control.
    await user.click(screen.getByTestId('setup-doctor-regno'));
    await user.tab();
    expect(control).toHaveFocus();

    await user.selectOptions(control, OTHER_LABEL);
    control.focus();
    await user.tab();
    expect(screen.getByTestId('setup-doctor-council-other')).toHaveFocus();
  });
});
