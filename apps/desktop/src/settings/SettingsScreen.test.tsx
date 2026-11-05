// MS — S18 Settings screen (docs/ui/S18-settings.md; design §8, §8.1 testids).
// SET-002/003/004/005/006/007, PAT-002, LIC-006, R-DEL-002.
//
// CUT: the REAL <SettingsScreen /> (General form, camera card, data-folder
// card, tab bar). Fakes are dependencies only (R-TEST-002):
//   - `@/bindings` (settingsGet / settingsSaveGeneral / settingsPickDataFolder /
//     settingsMoveDataFolder), returning the typed wire shapes;
//   - `@/shared/camera` `listCameras` (webview enumeration; camera.test.ts
//     covers the real one);
//   - `@/app/useAppPrefs` (to observe that a Save pushes prefs into the shell;
//     useAppPrefs.test.tsx covers the real provider).
// Controls are found by their design §8.1 testids. Synthetic data only.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const {
  settingsGet,
  settingsSaveGeneral,
  settingsPickDataFolder,
  settingsMoveDataFolder,
  listCameras,
  applySaved,
} = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsSaveGeneral: vi.fn(),
  settingsPickDataFolder: vi.fn(),
  settingsMoveDataFolder: vi.fn(),
  listCameras: vi.fn(),
  applySaved: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    settingsGet,
    settingsSaveGeneral,
    settingsPickDataFolder,
    settingsMoveDataFolder,
  },
}));

vi.mock('@/shared/camera', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/camera')>()),
  listCameras,
}));

vi.mock('@/app/useAppPrefs', () => ({
  useAppPrefs: () => ({
    fontSize: 'normal',
    autolockMinutes: 15,
    defaultCamera: null,
    applySaved,
  }),
  AppPrefsProvider: ({ children }: { children: unknown }) => children,
}));

import type { SettingsView } from '@/bindings';
import { formatClinicTimings } from '@/setup/clinicTimings';
import { REGISTRATION_COUNCIL_LABELS } from '@/setup/registrationCouncils';
import { t } from '@/shared/strings';
import { SettingsScreen } from './SettingsScreen';

const COUNCIL = REGISTRATION_COUNCIL_LABELS[0]!;
const TIMINGS = formatClinicTimings({
  morning: { from: { hour: 9, minute: 0 }, to: { hour: 11, minute: 30 } },
  evening: null,
});
const DATA_FOLDER = '/home/test/.local/share/homeoclinic';

function makeView(over: Partial<SettingsView> = {}): SettingsView {
  return {
    doctor: {
      name: 'Test Doctor 001',
      qualification: 'BHMS',
      regNo: 'TESTREG-001',
      regCouncil: COUNCIL,
      phone: '9876500001',
      email: 'doctor001@example.test',
    },
    clinic: {
      name: 'Test Clinic 001',
      address: '1 Test Street',
      timings: TIMINGS,
      gstin: null,
      feeFirstPaise: 50000,
      feeFollowupPaise: 30000,
    },
    app: {
      idPrefix: 'HC-',
      autolockMinutes: 15,
      fontSize: 'normal',
      defaultCamera: null,
    },
    nextNumber: '000124',
    dataFolder: DATA_FOLDER,
    identityLocked: false,
    ...over,
  };
}

const ok = <T,>(data: T) => ({ status: 'ok' as const, data });
const err = (code: string) => ({
  status: 'error' as const,
  error: { code, message: 'Safe message.', suggestedAction: 'Try again.' },
});

function renderScreen(): void {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/lock" element={<div data-testid="lock-probe" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Render and wait until the loaded values are on screen. */
async function loaded(): Promise<void> {
  renderScreen();
  await waitFor(() =>
    expect(screen.getByTestId('settings-doctor-name')).toHaveValue(
      'Test Doctor 001',
    ),
  );
}

async function retype(
  user: ReturnType<typeof userEvent.setup>,
  testid: string,
  text: string,
): Promise<void> {
  const el = screen.getByTestId(testid);
  await user.clear(el);
  if (text !== '') await user.type(el, text);
}

/** The single request sent by the last Save. */
function savedRequest(): {
  doctor: SettingsView['doctor'];
  clinic: SettingsView['clinic'];
  app: SettingsView['app'];
} {
  expect(settingsSaveGeneral).toHaveBeenCalledTimes(1);
  return settingsSaveGeneral.mock.calls[0]![0];
}

beforeEach(() => {
  settingsGet.mockReset();
  settingsGet.mockResolvedValue(ok(makeView()));
  settingsSaveGeneral.mockReset();
  settingsSaveGeneral.mockImplementation(async (req) =>
    ok({ settings: makeView({ ...req }), changed: true }),
  );
  settingsPickDataFolder.mockReset();
  settingsMoveDataFolder.mockReset();
  listCameras.mockReset();
  listCameras.mockResolvedValue({ status: 'none' });
  applySaved.mockReset();
});

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

describe('S18 General — loads current values', () => {
  it('shows every section filled from settings_get', async () => {
    await loaded();
    expect(screen.getByTestId('settings-doctor-qual')).toHaveValue('BHMS');
    expect(screen.getByTestId('settings-doctor-regno')).toHaveValue(
      'TESTREG-001',
    );
    expect(screen.getByTestId('settings-doctor-council')).toHaveValue(COUNCIL);
    expect(screen.getByTestId('settings-doctor-phone')).toHaveValue(
      '9876500001',
    );
    expect(screen.getByTestId('settings-doctor-email')).toHaveValue(
      'doctor001@example.test',
    );
    expect(screen.getByTestId('settings-clinic-name')).toHaveValue(
      'Test Clinic 001',
    );
    expect(screen.getByTestId('settings-clinic-address')).toHaveValue(
      '1 Test Street',
    );
    expect(
      screen.getByTestId('settings-clinic-timings-morning-from-hour'),
    ).toHaveValue('9');
    expect(
      screen.getByTestId('settings-clinic-timings-morning-to-minute'),
    ).toHaveValue('30');
    expect(
      (screen.getByTestId('settings-fee-consult') as HTMLInputElement).value,
    ).toMatch(/^500(\.00)?$/);
    expect(
      (screen.getByTestId('settings-fee-followup') as HTMLInputElement).value,
    ).toMatch(/^300(\.00)?$/);
    expect(screen.getByTestId('settings-id-prefix')).toHaveValue('HC-');
    expect(screen.getByTestId('settings-next-id')).toHaveTextContent(
      'HC-000124',
    );
    expect(screen.getByTestId('settings-autolock')).toHaveValue('15');
    expect(screen.getByTestId('settings-fontsize-normal')).toBeChecked();
    expect(screen.getByTestId('settings-datafolder')).toHaveTextContent(
      DATA_FOLDER,
    );
  });

  it('shows the fee currency from the strings file (SET-003, R-UI-007)', async () => {
    await loaded();
    for (const id of ['settings-fee-consult', 'settings-fee-followup']) {
      const row = screen.getByTestId(id).parentElement as HTMLElement;
      expect(row).toHaveTextContent(t('settings.clinic.feeCurrency'));
      expect(row.textContent).not.toContain('₹');
    }
  });

  it('reads back the saved font size and camera', async () => {
    settingsGet.mockResolvedValue(
      ok(
        makeView({
          app: {
            idPrefix: 'HC-',
            autolockMinutes: 30,
            fontSize: 'xlarge',
            defaultCamera: { deviceId: 'cam-2', label: 'Test Camera 2' },
          },
        }),
      ),
    );
    listCameras.mockResolvedValue({
      status: 'ok',
      cameras: [
        { deviceId: 'cam-1', label: 'Test Camera 1' },
        { deviceId: 'cam-2', label: 'Test Camera 2' },
      ],
    });
    await loaded();
    expect(screen.getByTestId('settings-fontsize-xlarge')).toBeChecked();
    expect(screen.getByTestId('settings-autolock')).toHaveValue('30');
    await waitFor(() =>
      expect(screen.getByTestId('settings-camera-select')).toHaveValue('cam-2'),
    );
  });
});

// ---------------------------------------------------------------------------
// Save / Cancel
// ---------------------------------------------------------------------------

describe('S18 General — Save and Cancel', () => {
  it('saves the whole form once (paise, uppercase prefix, phone once) and confirms', async () => {
    const user = userEvent.setup();
    await loaded();

    await retype(user, 'settings-doctor-qual', 'MD (Hom)');
    await retype(user, 'settings-doctor-phone', '9876500009');
    await retype(user, 'settings-fee-consult', '750');
    await retype(user, 'settings-fee-followup', '400.50');
    await retype(user, 'settings-id-prefix', 'kc-');
    await user.selectOptions(screen.getByTestId('settings-autolock'), '30');
    await user.click(screen.getByTestId('settings-fontsize-large'));
    await user.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(settingsSaveGeneral).toHaveBeenCalledTimes(1));
    const req = savedRequest();
    expect(req.doctor.qualification).toBe('MD (Hom)');
    expect(req.doctor.phone).toBe('9876500009');
    expect(req.doctor.name).toBe('Test Doctor 001');
    expect(req.clinic.feeFirstPaise).toBe(75000);
    expect(req.clinic.feeFollowupPaise).toBe(40050);
    expect(req.clinic.timings).toBe(TIMINGS);
    expect(req.app).toEqual({
      idPrefix: 'KC-',
      autolockMinutes: 30,
      fontSize: 'large',
      defaultCamera: null,
    });
    expect(await screen.findByTestId('settings-saved')).toHaveTextContent(
      /saved/i,
    );
    // Font size + auto-lock take effect immediately in the shell.
    expect(applySaved).toHaveBeenCalledWith(req.app);
  });

  it('Cancel puts back the loaded values and saves nothing', async () => {
    const user = userEvent.setup();
    await loaded();
    await retype(user, 'settings-doctor-qual', 'Changed');
    await retype(user, 'settings-fee-consult', '999');
    await user.click(screen.getByTestId('settings-fontsize-xlarge'));

    await user.click(screen.getByTestId('settings-cancel'));

    expect(screen.getByTestId('settings-doctor-qual')).toHaveValue('BHMS');
    expect(
      (screen.getByTestId('settings-fee-consult') as HTMLInputElement).value,
    ).toMatch(/^500(\.00)?$/);
    expect(screen.getByTestId('settings-fontsize-normal')).toBeChecked();
    expect(settingsSaveGeneral).not.toHaveBeenCalled();
  });

  it('previews the next patient ID with the edited prefix', async () => {
    const user = userEvent.setup();
    await loaded();
    await retype(user, 'settings-id-prefix', 'kc-');
    expect(screen.getByTestId('settings-next-id')).toHaveTextContent(
      'KC-000124',
    );
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('S18 General — inline validation', () => {
  it('shows inline errors and does not save invalid input', async () => {
    const user = userEvent.setup();
    await loaded();
    await retype(user, 'settings-doctor-name', '');
    await retype(user, 'settings-doctor-email', 'not-an-email');
    await retype(user, 'settings-fee-consult', 'abc');
    await retype(user, 'settings-fee-followup', '-5');
    await retype(user, 'settings-id-prefix', 'HC1');
    await retype(user, 'settings-clinic-timings-morning-from-hour', '13');

    await user.click(screen.getByTestId('settings-save'));

    for (const id of [
      'settings-doctor-name-error',
      'settings-doctor-email-error',
      'settings-fee-consult-error',
      'settings-fee-followup-error',
      'settings-id-prefix-error',
      'settings-clinic-timings-morning-from-hour-error',
    ]) {
      expect(await screen.findByTestId(id)).toBeInTheDocument();
    }
    expect(settingsSaveGeneral).not.toHaveBeenCalled();
    expect(screen.queryByTestId('settings-saved')).toBeNull();
  });

  // ms-review-3: the Evening error lives in a hidden tab panel while Morning
  // is showing. Save must bring the Evening tab forward (firstErrorSession)
  // and focus its first box, as the setup wizard does.
  it('switches to the Evening tab and focuses it when only the Evening timings are invalid', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByTestId('settings-clinic-timings-tab-evening'));
    await retype(user, 'settings-clinic-timings-evening-from-hour', '13');
    await retype(user, 'settings-clinic-timings-evening-from-minute', '00');
    await retype(user, 'settings-clinic-timings-evening-to-hour', '8');
    await retype(user, 'settings-clinic-timings-evening-to-minute', '00');
    await user.click(screen.getByTestId('settings-clinic-timings-tab-morning'));
    expect(
      screen.getByTestId('settings-clinic-timings-panel-evening'),
    ).not.toBeVisible();

    await user.click(screen.getByTestId('settings-save'));

    const error = await screen.findByTestId(
      'settings-clinic-timings-evening-from-hour-error',
    );
    expect(error).toBeVisible();
    expect(
      screen.getByTestId('settings-clinic-timings-tab-evening'),
    ).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(
        screen.getByTestId('settings-clinic-timings-evening-from-hour'),
      ).toHaveFocus(),
    );
    expect(settingsSaveGeneral).not.toHaveBeenCalled();
  });

  it('shows the Evening order error and focuses the Evening session (settings-clinic-timings-evening)', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByTestId('settings-clinic-timings-tab-evening'));
    await retype(user, 'settings-clinic-timings-evening-from-hour', '8');
    await retype(user, 'settings-clinic-timings-evening-from-minute', '30');
    await retype(user, 'settings-clinic-timings-evening-to-hour', '5');
    await retype(user, 'settings-clinic-timings-evening-to-minute', '00');
    await user.click(screen.getByTestId('settings-clinic-timings-tab-morning'));

    await user.click(screen.getByTestId('settings-save'));

    const error = await screen.findByTestId(
      'settings-clinic-timings-evening-error',
    );
    expect(error).toBeVisible();
    const evening = screen.getByTestId('settings-clinic-timings-evening');
    expect(evening).toBeVisible();
    await waitFor(() =>
      expect(evening).toContainElement(document.activeElement as HTMLElement),
    );
    expect(settingsSaveGeneral).not.toHaveBeenCalled();
  });

  // ms-review-9: every field links its inline error for screen readers.
  it('links the clinic address error to the address box (aria-describedby)', async () => {
    const user = userEvent.setup();
    await loaded();
    await retype(user, 'settings-clinic-address', '');
    await user.click(screen.getByTestId('settings-save'));
    await screen.findByTestId('settings-clinic-address-error');
    expect(screen.getByTestId('settings-clinic-address')).toHaveAttribute(
      'aria-describedby',
      'settings-clinic-address-error',
    );
  });

  it('shows a refused identity change inline on the name (identity_locked)', async () => {
    const user = userEvent.setup();
    settingsSaveGeneral.mockResolvedValue(err('identity_locked'));
    await loaded();
    await retype(user, 'settings-doctor-name', 'Test Doctor 999');
    await user.click(screen.getByTestId('settings-save'));
    expect(
      await screen.findByTestId('settings-doctor-name-error'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('settings-saved')).toBeNull();
    expect(applySaved).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Identity lock (LIC-006) + reused setup widgets
// ---------------------------------------------------------------------------

describe('S18 General — identity lock and reused setup widgets', () => {
  it('makes name, registration number and council read-only when licensed', async () => {
    settingsGet.mockResolvedValue(ok(makeView({ identityLocked: true })));
    await loaded();
    expect(screen.getByTestId('settings-doctor-name')).toHaveAttribute(
      'readonly',
    );
    expect(screen.getByTestId('settings-doctor-regno')).toHaveAttribute(
      'readonly',
    );
    expect(screen.getByTestId('settings-doctor-council')).toBeDisabled();
    expect(
      screen.getByTestId('settings-doctor-identity-locked'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('settings-doctor-qual')).not.toHaveAttribute(
      'readonly',
    );
  });

  it('shows the "locks on activation" note while unlicensed', async () => {
    await loaded();
    expect(
      screen.getByTestId('settings-doctor-identity-note'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('settings-doctor-identity-locked')).toBeNull();
    expect(screen.getByTestId('settings-doctor-name')).not.toHaveAttribute(
      'readonly',
    );
  });

  it('offers the setup council list with "Other" and saves a typed council', async () => {
    const user = userEvent.setup();
    await loaded();
    const select = screen.getByTestId('settings-doctor-council');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    for (const label of REGISTRATION_COUNCIL_LABELS) {
      expect(options).toContain(label);
    }
    const other = within(select)
      .getAllByRole('option')
      .find((o) => /other/i.test(o.textContent ?? ''));
    expect(other).toBeDefined();
    await user.selectOptions(select, other!);
    await user.type(
      await screen.findByTestId('settings-doctor-council-other'),
      'Test State Council',
    );
    await user.click(screen.getByTestId('settings-save'));
    await waitFor(() => expect(settingsSaveGeneral).toHaveBeenCalled());
    expect(savedRequest().doctor.regCouncil).toBe('Test State Council');
  });

  it('uses the Morning/Evening timings widget and asks the phone once', async () => {
    await loaded();
    expect(
      screen.getByTestId('settings-clinic-timings-tab-morning'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('settings-clinic-timings-tab-evening'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('settings-clinic-phone')).toBeNull();
    expect(screen.getAllByRole('textbox', { name: /phone/i })).toHaveLength(1);
  });

  it('shows the signature image as coming later (disabled)', async () => {
    await loaded();
    expect(screen.getByTestId('settings-doctor-signature')).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Later-feature tabs (R-DEL-002)
// ---------------------------------------------------------------------------

describe('S18 tabs — later features disabled with a note', () => {
  it('shows each later tab disabled with "Available in a later update" and no panel', async () => {
    const user = userEvent.setup();
    await loaded();
    const general = screen.getByTestId('settings-tab-general');
    expect(general).toHaveAttribute('aria-selected', 'true');
    for (const tab of [
      'templates',
      'advice',
      'print',
      'recycle',
      'audit',
      'maintenance',
    ]) {
      const el = screen.getByTestId(`settings-tab-${tab}`);
      expect(el).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByTestId(`settings-tab-${tab}-hint`)).toHaveTextContent(
        /available in a later update/i,
      );
      await user.click(el);
      expect(el).not.toHaveAttribute('aria-selected', 'true');
      expect(general).toHaveAttribute('aria-selected', 'true');
    }
    expect(screen.getByTestId('settings-doctor-name')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Camera (SET-007)
// ---------------------------------------------------------------------------

describe('S18 camera card (SET-007)', () => {
  it('lists the cameras and saves the chosen one', async () => {
    const user = userEvent.setup();
    listCameras.mockResolvedValue({
      status: 'ok',
      cameras: [
        { deviceId: 'cam-1', label: 'Test Camera 1' },
        { deviceId: 'cam-2', label: 'Test Camera 2' },
      ],
    });
    await loaded();
    const select = await screen.findByTestId('settings-camera-select');
    await waitFor(() =>
      expect(within(select).getAllByRole('option')).toHaveLength(3),
    );
    expect(
      within(select).getByRole('option', { name: 'Test Camera 2' }),
    ).toBeInTheDocument();
    await user.selectOptions(select, 'cam-2');
    await user.click(screen.getByTestId('settings-save'));
    await waitFor(() => expect(settingsSaveGeneral).toHaveBeenCalled());
    expect(savedRequest().app.defaultCamera).toEqual({
      deviceId: 'cam-2',
      label: 'Test Camera 2',
    });
  });

  it('says "No camera found" (file still works) and saves the system default', async () => {
    const user = userEvent.setup();
    await loaded();
    expect(await screen.findByTestId('settings-camera-none')).toHaveTextContent(
      /no camera found.*file/i,
    );
    await retype(user, 'settings-doctor-qual', 'MD (Hom)');
    await user.click(screen.getByTestId('settings-save'));
    await waitFor(() => expect(settingsSaveGeneral).toHaveBeenCalled());
    expect(savedRequest().app.defaultCamera).toBeNull();
  });

  // ms-review-13: before a grant the webview lists cameras with empty ids.
  // Those options must not collide with "System default" (value '') and
  // focusing the list must ask for the grant so the real cameras show.
  it('never lets an id-less camera select System default and unlocks the list on focus', async () => {
    const user = userEvent.setup();
    listCameras.mockImplementation(async (opts?: { unlockLabels?: boolean }) =>
      opts?.unlockLabels
        ? {
            status: 'ok',
            cameras: [
              { deviceId: 'cam-1', label: 'Test Camera 1' },
              { deviceId: 'cam-2', label: 'Test Camera 2' },
            ],
          }
        : {
            status: 'ok',
            cameras: [
              { deviceId: '', label: 'Camera 1' },
              { deviceId: '', label: 'Camera 2' },
            ],
          },
    );
    await loaded();
    const select = await screen.findByTestId('settings-camera-select');
    for (const name of ['Camera 1', 'Camera 2']) {
      expect(within(select).getByRole('option', { name })).toBeDisabled();
    }

    await user.click(select);

    expect(
      await within(select).findByRole('option', { name: 'Test Camera 2' }),
    ).toBeEnabled();
    expect(listCameras).toHaveBeenCalledWith({ unlockLabels: true });
    await user.selectOptions(select, 'cam-2');
    await user.click(screen.getByTestId('settings-save'));
    await waitFor(() => expect(settingsSaveGeneral).toHaveBeenCalled());
    expect(savedRequest().app.defaultCamera).toEqual({
      deviceId: 'cam-2',
      label: 'Test Camera 2',
    });
  });

  it('Refresh lists the cameras again', async () => {
    const user = userEvent.setup();
    await loaded();
    await screen.findByTestId('settings-camera-none');
    listCameras.mockResolvedValue({
      status: 'ok',
      cameras: [{ deviceId: 'cam-1', label: 'Test Camera 1' }],
    });
    await user.click(screen.getByTestId('settings-camera-refresh'));
    expect(
      await screen.findByRole('option', { name: 'Test Camera 1' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('settings-camera-none')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Data folder (SET-006)
// ---------------------------------------------------------------------------

describe('S18 data folder card (SET-006)', () => {
  it('does nothing when the folder picker is cancelled', async () => {
    const user = userEvent.setup();
    settingsPickDataFolder.mockResolvedValue(ok({ parentPath: null }));
    await loaded();
    await user.click(screen.getByTestId('settings-datafolder-change'));
    await waitFor(() => expect(settingsPickDataFolder).toHaveBeenCalled());
    expect(screen.queryByTestId('settings-datafolder-confirm')).toBeNull();
    expect(settingsMoveDataFolder).not.toHaveBeenCalled();
  });

  it('confirms, moves, shows both folders and re-reads the settings', async () => {
    const user = userEvent.setup();
    settingsPickDataFolder.mockResolvedValue(
      ok({ parentPath: '/media/test-usb' }),
    );
    settingsMoveDataFolder.mockResolvedValue(
      ok({
        dataFolder: '/media/test-usb/HomeoClinic',
        safetyCopyFolder: `${DATA_FOLDER}/moved-out-20261104T154718Z`,
      }),
    );
    await loaded();
    await user.click(screen.getByTestId('settings-datafolder-change'));
    const dialog = await screen.findByTestId('settings-datafolder-confirm');
    expect(
      within(dialog).getByTestId('settings-datafolder-target'),
    ).toHaveTextContent(/\/media\/test-usb.*HomeoClinic/);
    expect(settingsMoveDataFolder).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('settings-datafolder-move'));

    await waitFor(() =>
      expect(settingsMoveDataFolder).toHaveBeenCalledWith({
        parentPath: '/media/test-usb',
      }),
    );
    const result = await screen.findByTestId('settings-datafolder-result');
    expect(result).toHaveTextContent('/media/test-usb/HomeoClinic');
    expect(result).toHaveTextContent('moved-out-20261104T154718Z');
    await waitFor(() => expect(settingsGet).toHaveBeenCalledTimes(2));
  });

  // ms-review-8: the confirm dialog is modal. Tab must stay inside it and the
  // shell's window shortcuts must not act behind it, also while moving.
  it('traps Tab inside the confirm dialog and keeps shell shortcuts out, also while moving', async () => {
    const user = userEvent.setup();
    settingsPickDataFolder.mockResolvedValue(
      ok({ parentPath: '/media/test-usb' }),
    );
    let finish: (v: unknown) => void = () => undefined;
    settingsMoveDataFolder.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const shellKeys = vi.fn();
    window.addEventListener('keydown', shellKeys);
    try {
      await loaded();
      await user.click(screen.getByTestId('settings-datafolder-change'));
      const dialog = await screen.findByTestId('settings-datafolder-confirm');
      await waitFor(() =>
        expect(screen.getByTestId('settings-datafolder-move')).toHaveFocus(),
      );
      for (let i = 0; i < 4; i += 1) {
        await user.tab();
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
      }
      await user.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      expect(shellKeys).not.toHaveBeenCalled();

      screen.getByTestId('settings-datafolder-move').focus();
      await user.keyboard('{Enter}');
      await screen.findByTestId('settings-datafolder-busy');
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      await user.keyboard('{Control>}k{/Control}');
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      expect(shellKeys).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', shellKeys);
      finish(
        ok({
          dataFolder: '/media/test-usb/HomeoClinic',
          safetyCopyFolder: `${DATA_FOLDER}/moved-out-20261104T154718Z`,
        }),
      );
    }
    expect(
      await screen.findByTestId('settings-datafolder-result'),
    ).toBeInTheDocument();
  });

  it('shows an unusable folder inline and keeps the current folder', async () => {
    const user = userEvent.setup();
    settingsPickDataFolder.mockResolvedValue(
      ok({ parentPath: '/media/test-usb' }),
    );
    settingsMoveDataFolder.mockResolvedValue(err('data_folder_invalid'));
    await loaded();
    await user.click(screen.getByTestId('settings-datafolder-change'));
    await user.click(await screen.findByTestId('settings-datafolder-move'));
    expect(
      await screen.findByTestId('settings-datafolder-error'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('settings-datafolder')).toHaveTextContent(
      DATA_FOLDER,
    );
    expect(screen.queryByTestId('lock-probe')).toBeNull();
  });

  it('goes to the lock screen when the moved data must be reopened by PIN', async () => {
    const user = userEvent.setup();
    settingsPickDataFolder.mockResolvedValue(
      ok({ parentPath: '/media/test-usb' }),
    );
    settingsMoveDataFolder.mockResolvedValue(err('data_folder_reopen_failed'));
    await loaded();
    await user.click(screen.getByTestId('settings-datafolder-change'));
    await user.click(await screen.findByTestId('settings-datafolder-move'));
    expect(await screen.findByTestId('lock-probe')).toBeInTheDocument();
  });
});
