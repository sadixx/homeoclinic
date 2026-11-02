// RED component tests for M3-RWv6 items 1-3 on the REAL <SetupWizard />.
//
//  (1) The council dropdown shows no em/en dash in any option.
//  (2) Phone is asked ONCE, on Step 1 (`setup-doctor-phone`). Step 2 has no
//      phone input. The Step-1 number is saved as BOTH the doctor phone and
//      the clinic phone (SaveClinicProfileRequest.phone). No schema change.
//  (3) Clinic timings: the free-text field is replaced by Morning / Evening
//      tabs. Proposed testids (contract for hc-ui-dev):
//        tabs   setup-clinic-timings-tab-morning | -tab-evening  (role=tab)
//        inputs setup-clinic-timings-<session>-<from|to>-<hour|minute>
//        AM/PM  setup-clinic-timings-<session>-<from|to>-ampm   (text AM|PM)
//        errors setup-clinic-timings-<session>-<from|to>-<hour|minute>-error
//               setup-clinic-timings-<session>-error  (To not after From)
//      Hour accepts 1-12, minute 0-59, each with an inline error. Morning is
//      AM except 12 and a To hour earlier than From (PM). Evening is PM.
//      Saved string: 'Morning 9:30 AM-1:00 PM; Evening 5:00 PM-8:30 PM';
//      empty sessions allowed (timings null when both empty).
//
// The only fake is the typed bindings dependency (`vi.mock('@/bindings')`).
// Synthetic data only. New en.json keys are not referenced via t().
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { saveDoctor, saveClinic } = vi.hoisted(() => ({
  saveDoctor: vi.fn(),
  saveClinic: vi.fn(),
}));
vi.mock('@/bindings', () => ({
  commands: {
    setupGetState: vi.fn(async () => ({
      completed: false,
      currentStep: 1,
      dataDir: '/tmp/hc',
    })),
    setupSaveDoctorProfile: saveDoctor,
    setupSaveClinicProfile: saveClinic,
    setupSetPin: vi.fn(async () => ({ recoveryCode: 'x' })),
    setupStartTrial: vi.fn(async () => ({
      trialValidUntil: '2026-01-31T00:00:00Z',
      trialDaysRemaining: 30,
    })),
    setupComplete: vi.fn(async () => ({ homeRoute: '/today' })),
  },
}));

import { SetupWizard } from './SetupWizard';

const PHONE = '9876543210';
const COUNCIL = 'Maharashtra: Maharashtra Council of Homoeopathy';

beforeEach(() => {
  saveDoctor.mockReset();
  saveDoctor.mockResolvedValue({ doctorId: 'doc-1' });
  saveClinic.mockReset();
  saveClinic.mockResolvedValue({ clinicId: 'cln-1' });
});

type User = ReturnType<typeof userEvent.setup>;

async function fillStep1(user: User, phone = PHONE): Promise<void> {
  await user.type(screen.getByTestId('setup-doctor-name'), 'Test Doctor 001');
  await user.type(screen.getByTestId('setup-doctor-qualification'), 'BHMS');
  await user.type(screen.getByTestId('setup-doctor-regno'), 'REG-0001');
  // Pick Maharashtra by its option text so this flow does not depend on the
  // label format (item 1 is asserted separately).
  const council = screen.getByTestId(
    'setup-doctor-council',
  ) as HTMLSelectElement;
  const option = Array.from(council.options).find((o) =>
    (o.textContent ?? '').startsWith('Maharashtra'),
  );
  fireEvent.change(council, { target: { value: option?.value ?? '' } });
  if (phone !== '') {
    await user.type(screen.getByTestId('setup-doctor-phone'), phone);
  }
}

async function toStep2(user: User, phone = PHONE): Promise<void> {
  render(<SetupWizard />);
  await fillStep1(user, phone);
  await user.click(screen.getByTestId('setup-next'));
  await screen.findByTestId('setup-clinic-name');
}

async function fillClinicRequired(user: User): Promise<void> {
  await user.type(screen.getByTestId('setup-clinic-name'), 'Test Clinic 001');
  await user.type(screen.getByTestId('setup-clinic-address'), '1 Test Road');
  await user.type(screen.getByTestId('setup-clinic-fee-first'), '500');
  await user.type(screen.getByTestId('setup-clinic-fee-followup'), '300');
}

function tid(session: string, edge: string, part: string): string {
  return `setup-clinic-timings-${session}-${edge}-${part}`;
}

async function openTab(user: User, session: 'morning' | 'evening') {
  await user.click(screen.getByTestId(`setup-clinic-timings-tab-${session}`));
}

/** Type one session's From/To times (hour + minute boxes). */
async function typeSession(
  user: User,
  session: 'morning' | 'evening',
  from: readonly [string, string],
  to: readonly [string, string],
): Promise<void> {
  await openTab(user, session);
  await user.type(screen.getByTestId(tid(session, 'from', 'hour')), from[0]);
  await user.type(screen.getByTestId(tid(session, 'from', 'minute')), from[1]);
  await user.type(screen.getByTestId(tid(session, 'to', 'hour')), to[0]);
  await user.type(screen.getByTestId(tid(session, 'to', 'minute')), to[1]);
}

function savedClinic(): Record<string, unknown> {
  expect(saveClinic).toHaveBeenCalledOnce();
  return saveClinic.mock.calls[0]![0] as Record<string, unknown>;
}

// ===========================================================================
// (1) council options carry no dashes
// ===========================================================================

describe('SetupWizard RWv6 item 1: council options without dashes', () => {
  it('no council option text contains an em dash or an en dash', () => {
    render(<SetupWizard />);
    const control = screen.getByTestId('setup-doctor-council');
    const texts = within(control)
      .getAllByRole('option', { hidden: true })
      .map((o) => o.textContent ?? '');
    const offenders = texts.filter((s) => /[\u2013\u2014]/.test(s));
    expect(offenders).toEqual([]);
    expect(texts).toContain(COUNCIL);
  });
});

// ===========================================================================
// (2) phone asked once
// ===========================================================================

describe('SetupWizard RWv6 item 2: phone is asked once', () => {
  it('Step 1 shows the phone field and Step 2 has NO phone input', async () => {
    const user = userEvent.setup();
    render(<SetupWizard />);
    expect(screen.getByTestId('setup-doctor-phone')).toBeInTheDocument();
    await fillStep1(user);
    await user.click(screen.getByTestId('setup-next'));
    await screen.findByTestId('setup-clinic-name');
    expect(screen.queryByTestId('setup-clinic-phone')).not.toBeInTheDocument();
    expect(screen.queryByTestId('setup-doctor-phone')).not.toBeInTheDocument();
  });

  it('saves the Step-1 phone as both the doctor phone and the clinic phone', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await fillClinicRequired(user);
    await user.click(screen.getByTestId('setup-next'));

    expect(saveDoctor).toHaveBeenCalledOnce();
    expect(
      (saveDoctor.mock.calls[0]![0] as Record<string, unknown>)['phone'],
    ).toBe(PHONE);
    expect(savedClinic()['phone']).toBe(PHONE);
  });

  it('an empty Step-1 phone saves null for the clinic phone too', async () => {
    const user = userEvent.setup();
    await toStep2(user, '');
    await fillClinicRequired(user);
    await user.click(screen.getByTestId('setup-next'));
    expect(savedClinic()['phone']).toBeNull();
  });
});

// ===========================================================================
// (3) clinic timings: Morning / Evening clock boxes
// ===========================================================================

describe('SetupWizard RWv6 item 3: clinic timings tabs', () => {
  it('replaces the free-text timings field with Morning and Evening tabs', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    const legacy = screen.queryByTestId('setup-clinic-timings');
    expect(
      legacy === null || legacy.tagName !== 'INPUT',
      'the free-text timings <input> must be gone',
    ).toBe(true);
    const morning = screen.getByTestId('setup-clinic-timings-tab-morning');
    const evening = screen.getByTestId('setup-clinic-timings-tab-evening');
    expect(morning).toHaveRole('tab');
    expect(evening).toHaveRole('tab');
    expect(morning).toHaveAccessibleName();
    expect(evening).toHaveAccessibleName();
  });

  it.each(['morning', 'evening'] as const)(
    'the %s tab has labelled From/To hour and minute inputs',
    async (session) => {
      const user = userEvent.setup();
      await toStep2(user);
      await openTab(user, session);
      for (const edge of ['from', 'to']) {
        for (const part of ['hour', 'minute']) {
          const el = screen.getByTestId(tid(session, edge, part));
          expect(el.tagName).toBe('INPUT');
          expect(el, `${session} ${edge} ${part}`).toHaveAccessibleName();
        }
      }
    },
  );

  it('shows AM/PM automatically: Morning 9:30 to 1:00 reads AM then PM; Evening 5:00 to 8:30 reads PM, PM', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await typeSession(user, 'morning', ['9', '30'], ['1', '00']);
    expect(
      screen.getByTestId(tid('morning', 'from', 'ampm')),
    ).toHaveTextContent('AM');
    expect(screen.getByTestId(tid('morning', 'to', 'ampm'))).toHaveTextContent(
      'PM',
    );
    await typeSession(user, 'evening', ['5', '00'], ['8', '30']);
    expect(
      screen.getByTestId(tid('evening', 'from', 'ampm')),
    ).toHaveTextContent('PM');
    expect(screen.getByTestId(tid('evening', 'to', 'ampm'))).toHaveTextContent(
      'PM',
    );
  });

  it('a morning hour of 12 reads PM', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await typeSession(user, 'morning', ['10', '00'], ['12', '00']);
    expect(
      screen.getByTestId(tid('morning', 'from', 'ampm')),
    ).toHaveTextContent('AM');
    expect(screen.getByTestId(tid('morning', 'to', 'ampm'))).toHaveTextContent(
      'PM',
    );
  });

  it.each([
    ['hour', '13'],
    ['hour', '0'],
    ['minute', '60'],
  ] as const)(
    'an out-of-range %s (%s) shows an inline error and blocks Next',
    async (part, value) => {
      const user = userEvent.setup();
      await toStep2(user);
      await fillClinicRequired(user);
      const bad: [string, string] =
        part === 'hour' ? [value, '30'] : ['9', value];
      await typeSession(user, 'morning', bad, ['1', '00']);
      await user.click(screen.getByTestId('setup-next'));
      const err = await screen.findByTestId(
        tid('morning', 'from', `${part}-error`),
      );
      expect(err).toHaveAttribute('role', 'alert');
      expect((err.textContent ?? '').trim()).not.toBe('');
      expect(saveClinic).not.toHaveBeenCalled();
      expect(screen.getByTestId('setup-clinic-name')).toBeInTheDocument();
    },
  );

  it('To not after From shows the session error and blocks Next', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await fillClinicRequired(user);
    await typeSession(user, 'evening', ['8', '30'], ['5', '00']);
    await user.click(screen.getByTestId('setup-next'));
    const err = await screen.findByTestId('setup-clinic-timings-evening-error');
    expect(err).toHaveAttribute('role', 'alert');
    expect(saveClinic).not.toHaveBeenCalled();
  });

  it('saves both sessions as "Morning 9:30 AM-1:00 PM; Evening 5:00 PM-8:30 PM"', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await fillClinicRequired(user);
    await typeSession(user, 'morning', ['9', '30'], ['1', '00']);
    await typeSession(user, 'evening', ['5', '00'], ['8', '30']);
    await user.click(screen.getByTestId('setup-next'));
    expect(savedClinic()['timings']).toBe(
      'Morning 9:30 AM-1:00 PM; Evening 5:00 PM-8:30 PM',
    );
  });

  it('allows an empty Morning session (saves the Evening only)', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await fillClinicRequired(user);
    await typeSession(user, 'evening', ['5', '00'], ['8', '30']);
    await user.click(screen.getByTestId('setup-next'));
    expect(savedClinic()['timings']).toBe('Evening 5:00 PM-8:30 PM');
  });

  it('allows both sessions empty (timings saved as null, Next proceeds)', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await fillClinicRequired(user);
    await user.click(screen.getByTestId('setup-next'));
    expect(savedClinic()['timings']).toBeNull();
  });

  it('Back from Step 3 re-opens the typed timings in their boxes', async () => {
    const user = userEvent.setup();
    await toStep2(user);
    await fillClinicRequired(user);
    await typeSession(user, 'morning', ['9', '30'], ['1', '00']);
    await user.click(screen.getByTestId('setup-next'));
    await screen.findByTestId('setup-pin');
    await user.click(screen.getByTestId('setup-back'));
    await openTab(user, 'morning');
    const value = (part: string, edge = 'from'): string =>
      (screen.getByTestId(tid('morning', edge, part)) as HTMLInputElement)
        .value;
    expect(value('hour')).toBe('9');
    expect(value('minute')).toBe('30');
    expect(value('hour', 'to')).toBe('1');
  });
});
