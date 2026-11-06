// MS — the shell side of S18 (design §5, §6, §8 wiring): the /settings route
// is reachable from the nav; the saved font size applies app-wide (document
// root font size = 14/16/18 px x zoom) after unlock and immediately after a
// Save; the saved auto-lock drives the idle timer (F5 fix: not the value read
// while locked).
//
// CUT: the REAL <AppShell /> (+ real useZoom, AppPrefsProvider, SettingsScreen).
// The ONLY fake is the generated binding `@/bindings` (R-TEST-002). Synthetic
// data only.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { setupGetState, authGetLockState, settingsGet, settingsSaveGeneral } =
  vi.hoisted(() => ({
    setupGetState: vi.fn(),
    authGetLockState: vi.fn(),
    settingsGet: vi.fn(),
    settingsSaveGeneral: vi.fn(),
  }));

vi.mock('@/bindings', () => ({
  commands: {
    setupGetState,
    authGetLockState,
    settingsGet,
    settingsSaveGeneral,
    settingsPickDataFolder: vi.fn(async () => ({ parentPath: null })),
    settingsMoveDataFolder: vi.fn(),
    appInfo: vi.fn(async () => ({
      name: 'HomeoClinic',
      version: '0.1.0',
      build_profile: 'debug' as const,
    })),
    getBackupStatus: vi.fn(async () => ({
      lastBackupAt: null,
      lastBackupOk: false,
      daysSinceGood: null,
      autoEnabled: false,
      retention: { daily: 14, weekly: 8, monthly: 12 },
      stale: true,
    })),
    listRemovableDrives: vi.fn(async () => ({ drives: [] })),
    patientRecent: vi.fn(async () => ({ results: [] })),
    patientSearch: vi.fn(async () => ({ results: [], nextCursor: null })),
    todayGetOverview: vi.fn(async () => ({
      dueToday: [],
      overdue: [],
      registeredToday: [],
      backupWarning: null,
      licenceReminder: null,
    })),
  },
}));

import type { FontSize, SettingsView } from '@/bindings';
import { AppShell } from './AppShell';
import { ZOOM_STEP } from './useZoom';

function makeView(fontSize: FontSize, autolockMinutes: number): SettingsView {
  return {
    doctor: {
      name: 'Test Doctor 001',
      qualification: 'BHMS',
      regNo: 'TESTREG-001',
      regCouncil: 'Test Council',
      phone: null,
      email: null,
    },
    clinic: {
      name: 'Test Clinic 001',
      address: '1 Test Street',
      timings: null,
      gstin: null,
      feeFirstPaise: 50000,
      feeFollowupPaise: 30000,
      upiVpa: null,
    },
    app: { idPrefix: 'HC-', autolockMinutes, fontSize, defaultCamera: null },
    nextNumber: '000001',
    dataFolder: '/tmp/hc',
    identityLocked: false,
  };
}

function rootPx(): number {
  return Number.parseFloat(document.documentElement.style.fontSize);
}

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
  document.documentElement.style.fontSize = '';
  document.documentElement.removeAttribute('data-hc-font-size');
  setupGetState.mockReset();
  setupGetState.mockResolvedValue({
    completed: true,
    currentStep: 4,
    dataDir: '/tmp/hc',
  });
  authGetLockState.mockReset();
  // The lock state is read while LOCKED at boot: it still says 15 (F5).
  authGetLockState.mockResolvedValue({ locked: false, autolockMinutes: 15 });
  settingsGet.mockReset();
  settingsGet.mockResolvedValue(makeView('normal', 15));
  settingsSaveGeneral.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.style.fontSize = '';
});

describe('S18 in the shell (MS)', () => {
  it('opens Settings from the left nav', async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await screen.findByTestId('today-screen');
    const nav = screen.getByTestId('nav-settings');
    expect(nav).toBeEnabled();
    await user.click(nav);
    expect(await screen.findByTestId('settings-screen')).toBeInTheDocument();
  });

  it('applies the saved font size app-wide, with zoom on top and Ctrl+0 back to it', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(makeView('large', 15));
    render(<AppShell />);
    await screen.findByTestId('today-screen');

    await waitFor(() => expect(rootPx()).toBeCloseTo(16, 5));
    expect(document.documentElement).toHaveAttribute(
      'data-hc-font-size',
      'large',
    );
    await user.click(await screen.findByTestId('app-bar-zoom-in'));
    expect(rootPx()).toBeCloseTo(16 * (1 + ZOOM_STEP), 5);
    await act(async () => {
      await user.keyboard('{Control>}0{/Control}');
    });
    expect(rootPx()).toBeCloseTo(16, 5);
  });

  it('a Save in Settings changes the font size immediately', async () => {
    const user = userEvent.setup();
    settingsSaveGeneral.mockResolvedValue({
      settings: makeView('xlarge', 15),
      changed: true,
    });
    render(<AppShell />);
    await screen.findByTestId('today-screen');
    await user.click(screen.getByTestId('nav-settings'));
    await user.click(await screen.findByTestId('settings-fontsize-xlarge'));
    await user.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(rootPx()).toBeCloseTo(18, 5));
  });

  it('locks after the SAVED auto-lock minutes, not the boot value', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    settingsGet.mockResolvedValue(makeView('normal', 5));
    render(<AppShell />);
    await screen.findByTestId('today-screen');
    await waitFor(() => expect(settingsGet).toHaveBeenCalled());

    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
    });

    expect(await screen.findByTestId('lock-screen')).toBeInTheDocument();
  });
});
