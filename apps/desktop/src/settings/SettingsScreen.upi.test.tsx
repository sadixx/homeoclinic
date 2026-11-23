// R5 — S18 Settings "Clinic UPI ID" field (R5 design §6.3 settings delta, §9;
// HC-MVP1-151, BILL-005). Same harness as SettingsScreen.test.tsx. The UPI ID
// is saved in the same single Save as the rest of the General form; a
// malformed ID is refused inline (settings-clinic-upi-error) without a save.
// RED: the field does not exist yet (GeneralSettings sends upiVpa: null).
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
import { render, screen, waitFor } from '@testing-library/react';
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
      upiVpa: null,
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
// R5: Clinic UPI ID
// ---------------------------------------------------------------------------

describe('S18 General — Clinic UPI ID (R5)', () => {
  it('shows the stored clinic UPI ID', async () => {
    settingsGet.mockResolvedValue(
      ok(
        makeView({
          clinic: { ...makeView().clinic, upiVpa: 'testclinic@upi' },
        }),
      ),
    );
    await loaded();
    expect(screen.getByTestId('settings-clinic-upi')).toHaveValue(
      'testclinic@upi',
    );
  });

  it('saves a typed UPI ID (trimmed) in the single General Save', async () => {
    const user = userEvent.setup();
    await loaded();
    await retype(user, 'settings-clinic-upi', '  testclinic@upi ');
    await user.click(screen.getByTestId('settings-save'));
    await waitFor(() => expect(settingsSaveGeneral).toHaveBeenCalled());
    expect(savedRequest().clinic.upiVpa).toBe('testclinic@upi');
  });

  it('sends null when the UPI ID is cleared', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(
      ok(
        makeView({
          clinic: { ...makeView().clinic, upiVpa: 'testclinic@upi' },
        }),
      ),
    );
    await loaded();
    await retype(user, 'settings-clinic-upi', '');
    await user.click(screen.getByTestId('settings-save'));
    await waitFor(() => expect(settingsSaveGeneral).toHaveBeenCalled());
    expect(savedRequest().clinic.upiVpa).toBeNull();
  });

  it('refuses a malformed UPI ID inline and does not save', async () => {
    const user = userEvent.setup();
    await loaded();
    await retype(user, 'settings-clinic-upi', 'testclinic');
    await user.click(screen.getByTestId('settings-save'));
    expect(
      await screen.findByTestId('settings-clinic-upi-error'),
    ).toHaveTextContent(/upi/i);
    expect(settingsSaveGeneral).not.toHaveBeenCalled();
  });
});
