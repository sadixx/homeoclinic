// Tests for the app shell (HC-MVP1-009, design §5c, NFR-030/034, R-UI-003) and
// the Slice-E launch boot-gate (SET-001, SET-004; handoff 34).
//
// CUT: the real <AppShell /> component. The ONLY faked thing is the generated
// binding `@/bindings` — a dependency, not the CUT (hc-unit-testing; R-TEST-002).
//
// Boot-gate (RED until hc-ui-dev wires it): on first mount AppShell reads
// commands.setupGetState() + commands.authGetLockState() and routes to /setup
// (setup not completed), /lock (completed + locked) or /today (completed +
// unlocked), showing an `app-boot` splash while the two reads are in flight —
// Today must never flash first. The two reads are mocked via vi.hoisted so each
// test controls the resolved value (bare object; `run` tolerates it, per
// @/shared/command). appInfo (TopBar) and getBackupStatus (StatusBar) are
// mocked so the shell chrome renders once routed to Today.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock fns created via `vi.hoisted` so they are reachable inside the hoisted
// `vi.mock` factory (Vitest hoists vi.mock to the top of the module) — the
// Slice C pattern. setupGetState / authGetLockState are the boot reads under
// test; each test sets their resolved value in `beforeEach` or inline.
const { setupGetState, authGetLockState } = vi.hoisted(() => ({
  setupGetState: vi.fn(),
  authGetLockState: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    // Boot reads (CUT drives these on mount).
    setupGetState,
    authGetLockState,
    // Shell chrome dependencies, so a Today-routed render completes.
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
  },
}));

import { AppShell } from './AppShell';

/** A never-resolving promise to hold the boot reads "pending". */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

beforeEach(() => {
  setupGetState.mockReset();
  authGetLockState.mockReset();
  // Default happy path: setup done, unlocked. Individual tests override.
  setupGetState.mockResolvedValue({
    completed: true,
    currentStep: 4,
    dataDir: '/tmp/hc',
  });
  authGetLockState.mockResolvedValue({ locked: false, autolockMinutes: 15 });
});

describe('AppShell', () => {
  it('renders the shell with the top bar, search box and status bar', async () => {
    // Default boot: completed + unlocked -> lands on Today inside the shell.
    render(<AppShell />);

    expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('topbar-search')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
  });

  describe('launch boot-gate (SET-001, SET-004)', () => {
    it('routes to /setup when setup is not completed', async () => {
      setupGetState.mockResolvedValue({
        completed: false,
        currentStep: 1,
        dataDir: '/tmp/hc',
      });
      authGetLockState.mockResolvedValue({ locked: true, autolockMinutes: 15 });

      render(<AppShell />);

      // Fresh install -> first-run wizard (SET-001), never Today or lock.
      expect(await screen.findByTestId('setup-wizard')).toBeInTheDocument();
      expect(screen.queryByTestId('today-screen')).not.toBeInTheDocument();
      expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument();
    });

    it('routes to /lock when completed and locked', async () => {
      setupGetState.mockResolvedValue({
        completed: true,
        currentStep: 4,
        dataDir: '/tmp/hc',
      });
      authGetLockState.mockResolvedValue({ locked: true, autolockMinutes: 15 });

      render(<AppShell />);

      // Reopen a configured, locked install -> unlock with PIN (SET-004).
      expect(await screen.findByTestId('lock-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('today-screen')).not.toBeInTheDocument();
      expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument();
    });

    it('routes to /today when completed and unlocked', async () => {
      setupGetState.mockResolvedValue({
        completed: true,
        currentStep: 4,
        dataDir: '/tmp/hc',
      });
      authGetLockState.mockResolvedValue({
        locked: false,
        autolockMinutes: 15,
      });

      render(<AppShell />);

      // Already-unlocked install -> straight to Today inside the shell.
      expect(await screen.findByTestId('today-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument();
      expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument();
      // Today here is the BOOT DECISION, not the unknown-route fallback: the
      // gate must have read both commands before landing on Today. Without
      // this, the pre-boot-gate fallback would flash Today and pass falsely.
      expect(setupGetState).toHaveBeenCalledTimes(1);
      expect(authGetLockState).toHaveBeenCalledTimes(1);
    });

    // Regression (handoff 46): a fresh/unprovisioned install that hits a
    // boot-read REJECT must still land on /setup, never /lock. The generated
    // bindings' typedError re-throws a transport/serialization IPC reject as a
    // plain Error; run() propagates it; the boot-gate catch currently routes
    // ANY thrown read to /lock — stranding a brand-new (PIN-less) user on the
    // lock screen. These reproduce the exact user-reported defect (SET-001).
    it('routes a fresh install to /setup when the lock read rejects with a transport error', async () => {
      // Fresh install: setup not completed...
      setupGetState.mockResolvedValue({
        completed: false,
        currentStep: 1,
        dataDir: '/tmp/hc',
      });
      // ...and the lock read rejects like the real cold-launch transport
      // reject (typedError re-throw of an `instanceof Error`).
      authGetLockState.mockRejectedValue(new Error('IPC transport closed'));

      render(<AppShell />);

      // Not provisioned (no keystore record) => wizard, never the PIN-less
      // dead end. Current code dumps this on /lock (the defect).
      expect(await screen.findByTestId('setup-wizard')).toBeInTheDocument();
      expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument();
      expect(screen.queryByTestId('today-screen')).not.toBeInTheDocument();
    });

    it('routes a fresh install to /setup when the setup read itself rejects', async () => {
      // Provisioning is UNKNOWN because the setup read threw; the lock read is
      // irrelevant. A brand-new user must never be stranded on /lock, so an
      // uncertain provisioning state must default to /setup.
      setupGetState.mockRejectedValue(new Error('IPC transport closed'));
      authGetLockState.mockResolvedValue({ locked: true, autolockMinutes: 15 });

      render(<AppShell />);

      expect(await screen.findByTestId('setup-wizard')).toBeInTheDocument();
      expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument();
      expect(screen.queryByTestId('today-screen')).not.toBeInTheDocument();
    });

    it('keeps a provisioned, locked install on /lock when the lock read rejects', async () => {
      // Security-intent guard (SET-004): a KNOWN-provisioned install whose
      // lock read is uncertain must still fail safe to /lock. The fix must
      // NARROW the fail-safe to provisioned installs, not remove it.
      setupGetState.mockResolvedValue({
        completed: true,
        currentStep: 4,
        dataDir: '/tmp/hc',
      });
      authGetLockState.mockRejectedValue(new Error('IPC transport closed'));

      render(<AppShell />);

      expect(await screen.findByTestId('lock-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument();
      expect(screen.queryByTestId('today-screen')).not.toBeInTheDocument();
    });

    it('shows the app-boot splash while the boot reads are pending', () => {
      // Hold both reads in flight: the decision cannot be made yet.
      setupGetState.mockReturnValue(pending());
      authGetLockState.mockReturnValue(pending());

      render(<AppShell />);

      // Splash is shown and Today has NOT flashed (no Today-then-redirect).
      expect(screen.getByTestId('app-boot')).toBeInTheDocument();
      expect(screen.queryByTestId('today-screen')).not.toBeInTheDocument();
      expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument();
      expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument();
    });
  });
});
