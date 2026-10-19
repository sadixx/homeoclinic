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
import {
  render,
  screen,
  act,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock fns created via `vi.hoisted` so they are reachable inside the hoisted
// `vi.mock` factory (Vitest hoists vi.mock to the top of the module) — the
// Slice C pattern. setupGetState / authGetLockState are the boot reads under
// test; each test sets their resolved value in `beforeEach` or inline.
const {
  setupGetState,
  authGetLockState,
  setupSaveDoctorProfile,
  setupSaveClinicProfile,
  setupSetPin,
  setupStartTrial,
  setupComplete,
} = vi.hoisted(() => ({
  setupGetState: vi.fn(),
  authGetLockState: vi.fn(),
  // Write-path commands the real SetupWizard invokes as the doctor advances
  // through the four steps and clicks Finish. They are DEPENDENCIES of the CUT
  // (the generated bindings), faked so Finish resolves and fires onComplete.
  setupSaveDoctorProfile: vi.fn(),
  setupSaveClinicProfile: vi.fn(),
  setupSetPin: vi.fn(),
  setupStartTrial: vi.fn(),
  setupComplete: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    // Boot reads (CUT drives these on mount).
    setupGetState,
    authGetLockState,
    // Setup write-path commands the real wizard invokes on its way to Finish.
    setupSaveDoctorProfile,
    setupSaveClinicProfile,
    setupSetPin,
    setupStartTrial,
    setupComplete,
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
    // BackupScreen enumerates drives on mount; mock it so that under the
    // CURRENT (unguarded) code the BackupScreen actually renders and the
    // guard assertions fail on the assertion (backup-screen present) rather
    // than on an unmocked binding reject.
    listRemovableDrives: vi.fn(async () => ({ drives: [] })),
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
  setupSaveDoctorProfile.mockReset();
  setupSaveClinicProfile.mockReset();
  setupSetPin.mockReset();
  setupStartTrial.mockReset();
  setupComplete.mockReset();
  // BootRouter seeds window.location.hash; reset it so a prior test's decision
  // route does not leak into the next render.
  window.location.hash = '';
  // Default happy path: setup done, unlocked. Individual tests override.
  setupGetState.mockResolvedValue({
    completed: true,
    currentStep: 4,
    dataDir: '/tmp/hc',
  });
  authGetLockState.mockResolvedValue({ locked: false, autolockMinutes: 15 });
  // Wizard write-path defaults: every step persists successfully and setting
  // the PIN hands back a recovery code so step 3 can be acknowledged.
  setupSaveDoctorProfile.mockResolvedValue(undefined);
  setupSaveClinicProfile.mockResolvedValue(undefined);
  setupSetPin.mockResolvedValue({ recoveryCode: 'TEST-RECOVERY-CODE' });
  setupStartTrial.mockResolvedValue(undefined);
  setupComplete.mockResolvedValue(undefined);
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

  // Completion route-guard (defect: /backup and /today render even when
  // setup_get_state().completed === false). The boot-gate seeds the launch
  // route, but nothing re-checks completion once the router is mounted, so an
  // in-app navigation (the premature wizard link), a stale hash, or a deep
  // link can reach the shell BEFORE the licence/trial is activated. Rule
  // (user): until setup is finished, nothing else is accessible. A completion
  // guard must redirect shell routes to /setup while completed === false,
  // consistent with useBootDecision. These FAIL on current code (no guard:
  // the shell renders BackupScreen / TodayScreen on the stale hash).
  describe('completion route-guard (SET-001)', () => {
    /**
     * Drive an in-app navigation the way a stale hash / deep link / stray
     * in-wizard link would: push the hash and fire the hashchange the
     * HashRouter listens for. Wrapped in act() so React flushes the resulting
     * navigation + guard effects.
     */
    async function navigateViaHash(hash: string): Promise<void> {
      await act(async () => {
        window.location.hash = hash;
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    }

    it('redirects /backup back to /setup when setup is not completed', async () => {
      setupGetState.mockResolvedValue({
        completed: false,
        currentStep: 1,
        dataDir: '/tmp/hc',
      });
      authGetLockState.mockResolvedValue({
        locked: false,
        autolockMinutes: 15,
      });

      render(<AppShell />);

      // Boot lands on the wizard (not provisioned).
      expect(await screen.findByTestId('setup-wizard')).toBeInTheDocument();

      // A stale hash / deep link / stray link tries to open Backup directly.
      await navigateViaHash('#/backup');

      // The guard must hold the user on the wizard; Backup must NOT render.
      await waitFor(() => {
        expect(screen.getByTestId('setup-wizard')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('backup-screen')).not.toBeInTheDocument();
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
    });

    it('redirects /today back to /setup when setup is not completed', async () => {
      setupGetState.mockResolvedValue({
        completed: false,
        currentStep: 1,
        dataDir: '/tmp/hc',
      });
      authGetLockState.mockResolvedValue({
        locked: false,
        autolockMinutes: 15,
      });

      render(<AppShell />);

      expect(await screen.findByTestId('setup-wizard')).toBeInTheDocument();

      await navigateViaHash('#/today');

      await waitFor(() => {
        expect(screen.getByTestId('setup-wizard')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('today-screen')).not.toBeInTheDocument();
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
    });

    it('allows /backup once setup is completed (guard only blocks the incomplete case)', async () => {
      // Completed + unlocked: the guard must NOT interfere with the shell.
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

      // Boots into the shell on Today.
      expect(await screen.findByTestId('today-screen')).toBeInTheDocument();

      await navigateViaHash('#/backup');

      // Setup is complete, so Backup is reachable — no redirect to the wizard.
      expect(await screen.findByTestId('backup-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument();
    });
  });

  // Regression (user-reported defect, SET-001): on a FRESH install the boot
  // decision resolves completed:false and seeds /setup. Finishing the wizard
  // calls onComplete -> navigate('/today'), but ShellRoute reads the FROZEN
  // boot-time completed=false and bounces /today back to /setup, so the doctor
  // never lands in the app and is forced to close/reopen + PIN-unlock. The
  // completion guard must use a LIVE signal updated when the wizard finishes.
  // This FAILS on current code (the guard uses the frozen boot value).
  describe('finish-wizard completion (SET-001 — user-reported defect)', () => {
    /**
     * Drive the REAL SetupWizard through its four steps with valid synthetic
     * data and click Finish, exactly as the doctor does on first run. Uses
     * data-testids (locale-independent). Step 3 is two-phase: the first Next
     * sets the PIN and reveals the recovery code; acknowledging it then
     * advances to the licence step.
     */
    async function completeWizardAndFinish(): Promise<void> {
      const user = userEvent.setup();

      // Step 1 — doctor profile (synthetic data only).
      fireEvent.change(screen.getByTestId('setup-doctor-name'), {
        target: { value: 'Test Doctor 001' },
      });
      fireEvent.change(screen.getByTestId('setup-doctor-qualification'), {
        target: { value: 'BHMS' },
      });
      fireEvent.change(screen.getByTestId('setup-doctor-regno'), {
        target: { value: 'REG-0001' },
      });
      fireEvent.change(screen.getByTestId('setup-doctor-council'), {
        target: { value: 'Test Council' },
      });
      await user.click(screen.getByTestId('setup-next'));

      // Step 2 — clinic profile; fees in rupees (UI parses to integer paise).
      await screen.findByTestId('setup-clinic-name');
      fireEvent.change(screen.getByTestId('setup-clinic-name'), {
        target: { value: 'Test Clinic 001' },
      });
      fireEvent.change(screen.getByTestId('setup-clinic-address'), {
        target: { value: '1 Test Street' },
      });
      fireEvent.change(screen.getByTestId('setup-clinic-fee-first'), {
        target: { value: '500' },
      });
      fireEvent.change(screen.getByTestId('setup-clinic-fee-followup'), {
        target: { value: '300' },
      });
      await user.click(screen.getByTestId('setup-next'));

      // Step 3 phase 1 — set the PIN; the Next here reveals the recovery code.
      await screen.findByTestId('setup-pin');
      fireEvent.change(screen.getByTestId('setup-pin'), {
        target: { value: '1234' },
      });
      fireEvent.change(screen.getByTestId('setup-pin-confirm'), {
        target: { value: '1234' },
      });
      await user.click(screen.getByTestId('setup-next'));

      // Step 3 phase 2 — acknowledge the revealed recovery code, then advance.
      await screen.findByTestId('setup-recovery-ack');
      await user.click(screen.getByTestId('setup-recovery-ack'));
      await user.click(screen.getByTestId('setup-next'));

      // Step 4 — licence (development trial is preselected) -> Finish.
      await screen.findByTestId('setup-finish');
      await user.click(screen.getByTestId('setup-finish'));
    }

    it('lands on Today and stays there after the wizard Finish on a fresh install', async () => {
      // Fresh install: boot decision -> /setup (completed:false, frozen).
      setupGetState.mockResolvedValue({
        completed: false,
        currentStep: 1,
        dataDir: '/tmp/hc',
      });
      authGetLockState.mockResolvedValue({
        locked: false,
        autolockMinutes: 15,
      });

      render(<AppShell />);

      // Boots into the first-run wizard.
      expect(await screen.findByTestId('setup-wizard')).toBeInTheDocument();

      await completeWizardAndFinish();

      // Finish persisted setup (trial started, setup completed).
      await waitFor(() => {
        expect(setupStartTrial).toHaveBeenCalledTimes(1);
        expect(setupComplete).toHaveBeenCalledTimes(1);
      });

      // The doctor must now be INSIDE the app on Today — not bounced back to
      // the wizard. On current code ShellRoute reads the frozen boot-time
      // completed=false and redirects /today -> /setup, so these FAIL.
      expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
      expect(await screen.findByTestId('today-screen')).toBeInTheDocument();

      // And it must STAY there (no flicker back to the wizard).
      await waitFor(() => {
        expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument();
      });
    });

    it('still blocks /today before completion (guard holds a genuinely incomplete install)', async () => {
      // Fresh install that NEVER finishes the wizard: the completion guard
      // (commit 216cfed, the earlier Backup-bypass fix) must still block the
      // shell. Guards against a "fix" that simply deletes the guard.
      setupGetState.mockResolvedValue({
        completed: false,
        currentStep: 1,
        dataDir: '/tmp/hc',
      });
      authGetLockState.mockResolvedValue({
        locked: false,
        autolockMinutes: 15,
      });

      render(<AppShell />);

      expect(await screen.findByTestId('setup-wizard')).toBeInTheDocument();

      // A stale hash / deep link tries to open Today before Finish.
      await act(async () => {
        window.location.hash = '#/today';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });

      // The guard must hold the user on the wizard; Today/shell must NOT render.
      await waitFor(() => {
        expect(screen.getByTestId('setup-wizard')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('today-screen')).not.toBeInTheDocument();
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
      // Setup was never finished, so no trial/complete writes happened.
      expect(setupStartTrial).not.toHaveBeenCalled();
      expect(setupComplete).not.toHaveBeenCalled();
    });
  });
});
