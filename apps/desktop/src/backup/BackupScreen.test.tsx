// Component tests for the S17 backup/restore screen (HC-MVP1-030..034,
// docs/ui/S17-backup-restore.md). CUT: the real <BackupScreen /> component.
//
// The ONLY fake is the dependency: the typed Tauri bindings
// (`vi.mock('@/bindings')`, R-TEST-002) — never the component. Asserts
// behaviour and visible en.json strings (R-TEST-003, R-UI-007); every control
// is found by its spec data-testid (R-UI-003). The mock fns are created with
// `vi.hoisted` so they are reachable inside the hoisted `vi.mock` factory.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  getStatus,
  setAuto,
  listDrives,
  backupNow,
  restorePreview,
  restoreApply,
} = vi.hoisted(() => ({
  getStatus: vi.fn(),
  setAuto: vi.fn(),
  listDrives: vi.fn(),
  backupNow: vi.fn(),
  restorePreview: vi.fn(),
  restoreApply: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    getBackupStatus: getStatus,
    setAutoBackup: setAuto,
    listRemovableDrives: listDrives,
    backupNow,
    restorePreview,
    restoreApply,
  },
}));

import en from '@/locales/en.json';
import { BackupScreen } from './BackupScreen';

/** A healthy, recent, auto-on status with a prior backup (not first-time). */
function healthyStatus(overrides: Record<string, unknown> = {}) {
  return {
    lastBackupAt: '2026-10-17T09:10:00Z',
    lastBackupOk: true,
    daysSinceGood: 0,
    autoEnabled: true,
    retention: { daily: 14, weekly: 8, monthly: 12 },
    stale: false,
    ...overrides,
  };
}

beforeEach(() => {
  getStatus.mockReset();
  getStatus.mockResolvedValue(healthyStatus());
  setAuto.mockReset();
  setAuto.mockResolvedValue({ ok: true });
  listDrives.mockReset();
  listDrives.mockResolvedValue({
    drives: [{ path: '/run/media/doc/USB', label: 'USB', freeBytes: 1000 }],
  });
  backupNow.mockReset();
  backupNow.mockResolvedValue({
    ok: true,
    filePath: '/run/media/doc/USB/patients-2026-10-17.hcbak',
    sizeBytes: 2048,
    verified: true,
  });
  restorePreview.mockReset();
  restoreApply.mockReset();
});

describe('BackupScreen (S17) — health', () => {
  it('shows the last backup, checked result and the 14/8/12 retention line', async () => {
    render(<BackupScreen />);

    // Wait for the RESOLVED text, not just the element's existence: the
    // status element renders a placeholder ("Last backup: —") before the
    // mocked getBackupStatus promise resolves, so asserting on existence alone
    // races the async re-render.
    await waitFor(() =>
      expect(screen.getByTestId('backup-status-last')).toHaveTextContent(
        en['backup.health.checkedOk'],
      ),
    );
    expect(screen.getByTestId('backup-retention')).toHaveTextContent(
      en['backup.health.retention'],
    );
    // Not stale: no banner.
    expect(screen.queryByTestId('backup-stale-banner')).not.toBeInTheDocument();
  });

  it('shows the stale banner as TEXT (not colour alone) when stale (BAK-004)', async () => {
    getStatus.mockResolvedValue(
      healthyStatus({ daysSinceGood: 9, stale: true }),
    );
    render(<BackupScreen />);

    const banner = await screen.findByTestId('backup-stale-banner');
    expect(banner).toHaveTextContent(en['backup.health.staleBanner']);
    expect(banner).toHaveAttribute('role', 'alert');
  });

  it('shows the empty-state message and the never-backed-up banner when there is no backup', async () => {
    getStatus.mockResolvedValue(
      healthyStatus({
        lastBackupAt: null,
        lastBackupOk: false,
        daysSinceGood: null,
        stale: true,
      }),
    );
    render(<BackupScreen />);

    // Wait for the RESOLVED never-backed-up text, not just the element's
    // existence: the status element first renders a placeholder before the
    // mocked getBackupStatus promise resolves. The stale-never banner likewise
    // only mounts once stale === true after resolution, so gate on the
    // resolved text first, then assert the banner.
    await waitFor(() =>
      expect(screen.getByTestId('backup-status-last')).toHaveTextContent(
        en['backup.health.never'],
      ),
    );
    expect(screen.getByTestId('backup-stale-banner')).toHaveTextContent(
      en['backup.health.staleNever'],
    );
  });

  it('toggles automatic daily backup through the typed command', async () => {
    const user = userEvent.setup();
    render(<BackupScreen />);

    const toggle = await screen.findByTestId('backup-auto-toggle');
    // Wait for the resolved status (autoEnabled: true) to drive the checkbox
    // before clicking: the toggle renders unchecked in its placeholder state
    // before getBackupStatus resolves, so clicking too early would send the
    // opposite value. Gate on the checked state, then toggle off.
    await waitFor(() => expect(toggle).toBeChecked());
    await user.click(toggle);
    expect(setAuto).toHaveBeenCalledWith(false);
  });
});

describe('BackupScreen (S17) — back up now', () => {
  it('blocks with an inline message when no destination is chosen', async () => {
    const user = userEvent.setup();
    render(<BackupScreen />);
    await screen.findByTestId('backup-status-last');

    await user.click(screen.getByTestId('backup-run'));

    expect(screen.getByTestId('backup-dest-error')).toHaveTextContent(
      en['backup.now.error.destRequired'],
    );
    expect(backupNow).not.toHaveBeenCalled();
  });

  it('requires a password of at least 8 characters (OQ-S17-2)', async () => {
    const user = userEvent.setup();
    render(<BackupScreen />);
    await screen.findByTestId('backup-status-last');

    await user.click(screen.getByTestId('backup-choose-usb'));
    await user.click(
      await screen.findByTestId('backup-usb-option-/run/media/doc/USB'),
    );
    await user.type(screen.getByTestId('backup-password'), 'short');
    await user.click(screen.getByTestId('backup-run'));

    expect(screen.getByTestId('backup-password-error')).toHaveTextContent(
      en['backup.now.error.passwordShort'],
    );
    expect(backupNow).not.toHaveBeenCalled();
  });

  it('runs a backup to the chosen USB drive and shows the verified result (BAK-002)', async () => {
    const user = userEvent.setup();
    render(<BackupScreen />);
    await screen.findByTestId('backup-status-last');

    await user.click(screen.getByTestId('backup-choose-usb'));
    await user.click(
      await screen.findByTestId('backup-usb-option-/run/media/doc/USB'),
    );
    await user.type(screen.getByTestId('backup-password'), 'longenough1');
    await user.click(screen.getByTestId('backup-run'));

    await waitFor(() =>
      expect(backupNow).toHaveBeenCalledWith(
        '/run/media/doc/USB',
        'longenough1',
        true,
      ),
    );
    expect(await screen.findByTestId('backup-done')).toHaveTextContent(
      en['backup.now.done'],
    );
  });

  it('shows the confirm-password field first time (no prior backup) and enforces match', async () => {
    getStatus.mockResolvedValue(
      healthyStatus({
        lastBackupAt: null,
        lastBackupOk: false,
        daysSinceGood: null,
        stale: true,
      }),
    );
    const user = userEvent.setup();
    render(<BackupScreen />);
    await screen.findByTestId('backup-status-last');

    await user.click(screen.getByTestId('backup-choose-usb'));
    await user.click(
      await screen.findByTestId('backup-usb-option-/run/media/doc/USB'),
    );
    // The confirm field only mounts once the resolved status (lastBackupAt:
    // null => firstTime) has loaded, so wait for it to appear rather than a
    // synchronous getByTestId that races the async re-render.
    const confirm = await screen.findByTestId('backup-password-confirm');
    expect(confirm).toBeInTheDocument();

    await user.type(screen.getByTestId('backup-password'), 'longenough1');
    await user.type(confirm, 'different22');
    await user.click(screen.getByTestId('backup-run'));

    expect(
      screen.getByTestId('backup-password-confirm-error'),
    ).toHaveTextContent(en['backup.now.error.passwordMismatch']);
    expect(backupNow).not.toHaveBeenCalled();
  });

  it('surfaces a plain-language error with Details when the destination is unavailable (OQ-S17-5)', async () => {
    backupNow.mockRejectedValue({
      code: 'backup_destination_unavailable',
      message: 'internal',
      suggestedAction: 'Reconnect the drive.',
    });
    const user = userEvent.setup();
    render(<BackupScreen />);
    await screen.findByTestId('backup-status-last');

    await user.click(screen.getByTestId('backup-choose-usb'));
    await user.click(
      await screen.findByTestId('backup-usb-option-/run/media/doc/USB'),
    );
    await user.type(screen.getByTestId('backup-password'), 'longenough1');
    await user.click(screen.getByTestId('backup-run'));

    const err = await screen.findByTestId('backup-error');
    expect(err).toHaveTextContent(en['backup.error.destUnavailable']);
    // Details carries the suggested action, never a path or stack trace.
    expect(screen.getByTestId('backup-error-details')).toHaveTextContent(
      'Reconnect the drive.',
    );
  });
});

describe('BackupScreen (S17) — restore wizard', () => {
  async function openStep1() {
    const user = userEvent.setup();
    render(<BackupScreen />);
    await screen.findByTestId('backup-status-last');
    await user.click(screen.getByTestId('backup-restore-choose'));
    await screen.findByTestId('backup-restore-step1-title');
    return user;
  }

  it('refuses a wrong password INLINE on step 1 and does not advance (AC4)', async () => {
    restorePreview.mockRejectedValue({
      code: 'wrong_backup_password',
      message: 'internal',
      suggestedAction: 'Try again.',
    });
    const user = await openStep1();

    await user.type(
      screen.getByTestId('backup-restore-password'),
      'longenough1',
    );
    await user.click(screen.getByTestId('backup-restore-next'));

    expect(
      await screen.findByTestId('backup-restore-password-error'),
    ).toHaveTextContent(en['backup.error.wrongPassword']);
    // Still on step 1: no preview panel.
    expect(
      screen.queryByTestId('backup-restore-preview'),
    ).not.toBeInTheDocument();
    expect(restoreApply).not.toHaveBeenCalled();
  });

  it('previews counts and dates WITHOUT mutating, then confirms a restore (BAK-003)', async () => {
    restorePreview.mockResolvedValue({
      patientCount: 1284,
      visitCount: 5902,
      lastVisitDate: '2026-10-15',
      createdAt: '2026-10-16T09:10:00Z',
      appVersion: '1.0.3',
    });
    restoreApply.mockResolvedValue({
      ok: true,
      preRestoreBackupPath: '/data/pre-restore.hcbak',
    });
    const user = await openStep1();

    await user.type(
      screen.getByTestId('backup-restore-password'),
      'longenough1',
    );
    await user.click(screen.getByTestId('backup-restore-next'));

    // Step 2 preview: nothing applied yet.
    const preview = await screen.findByTestId('backup-restore-preview');
    expect(preview).toHaveTextContent('1,284');
    expect(preview).toHaveTextContent('5,902');
    expect(
      screen.getByTestId('backup-restore-preview-version'),
    ).toHaveTextContent('1.0.3');
    expect(restoreApply).not.toHaveBeenCalled();

    // Step 3 confirm -> apply.
    await user.click(screen.getByTestId('backup-restore-next'));
    await screen.findByTestId('backup-restore-step3-title');
    await user.click(screen.getByTestId('backup-restore-confirm'));

    await waitFor(() =>
      expect(restoreApply).toHaveBeenCalledWith(
        '/run/media/doc/USB',
        'longenough1',
      ),
    );
    expect(await screen.findByTestId('backup-restore-done')).toHaveTextContent(
      en['backup.restore.done'],
    );
  });
});

describe('BackupScreen (S17) — move to new computer (BAK-005 deferred)', () => {
  it('renders the move button disabled with a no-dead-end note (OQ-S17-4)', async () => {
    render(<BackupScreen />);
    const move = await screen.findByTestId('backup-move-start');
    expect(move).toBeDisabled();
    expect(screen.getByTestId('backup-move-deferred')).toHaveTextContent(
      en['backup.move.deferred'],
    );
  });
});
