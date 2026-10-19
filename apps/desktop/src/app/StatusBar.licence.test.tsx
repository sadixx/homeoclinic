// RED tests for the StatusBar licence chip (Feature 1, HC-MVP1-M1a).
//
// CUT: the real <StatusBar /> component. The ONLY faked thing is the generated
// binding `@/bindings` — a dependency, not the CUT (hc-unit-testing; R-TEST-002).
//
// Today the licence chip (testid `status-licence`) renders a hardcoded dash
// ("Licence: —"). After the dev trial starts it must call
// commands.getLicenceStatus() and render the trial kind with the days remaining
// AND the expiry date, e.g. "Licence: Trial — expires 31-01-2026 (29 days left)".
// A failed read must fall back gracefully to the dash (never throw into the
// shell). These tests fail until hc-ui-dev wires the chip to the new command.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock fns via vi.hoisted so they are reachable inside the hoisted vi.mock
// factory (the project's Slice C pattern). getLicenceStatus is the new read the
// chip must drive; getBackupStatus + appInfo are existing chrome dependencies.
const { getLicenceStatus, getBackupStatus, appInfo } = vi.hoisted(() => ({
  getLicenceStatus: vi.fn(),
  getBackupStatus: vi.fn(),
  appInfo: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    getLicenceStatus,
    getBackupStatus,
    appInfo,
  },
}));

import { StatusBar } from './StatusBar';

beforeEach(() => {
  vi.clearAllMocks();
  // Chrome dependencies resolve to quiet defaults so the bar renders.
  appInfo.mockResolvedValue({
    name: 'HomeoClinic',
    version: '0.1.0',
    build_profile: 'debug',
  });
  getBackupStatus.mockResolvedValue({
    lastBackupAt: null,
    lastBackupOk: false,
    daysSinceGood: null,
    autoEnabled: false,
    retention: { daily: 14, weekly: 8, monthly: 12 },
    stale: true,
  });
});

describe('StatusBar licence chip (Feature 1)', () => {
  it('renders the trial kind with days remaining and the expiry date', async () => {
    getLicenceStatus.mockResolvedValue({
      kind: 'trial',
      daysRemaining: 29,
      validUntil: '2026-01-31T00:00:00Z',
      expired: false,
    });

    render(<StatusBar />);

    const chip = await screen.findByTestId('status-licence');
    await waitFor(() => {
      // Not the hardcoded dash any more.
      expect(chip).not.toHaveTextContent('Licence: —');
      // Shows the trial kind…
      expect(chip).toHaveTextContent(/Trial/i);
      // …the days remaining…
      expect(chip).toHaveTextContent(/29/);
      // …and the expiry date in the app's DD-MM-YYYY display format.
      expect(chip).toHaveTextContent(/31-01-2026/);
    });
  });

  it('falls back to the dash placeholder when the licence read fails', async () => {
    getLicenceStatus.mockRejectedValue({
      code: 'not_found',
      message: 'No licence.',
      suggestedAction: 'n/a',
    });

    render(<StatusBar />);

    const chip = await screen.findByTestId('status-licence');
    // The chip stays present and shows the dash; it never throws into the shell.
    await waitFor(() => {
      expect(chip).toHaveTextContent('—');
    });
    expect(screen.getByTestId('status-licence')).toBeInTheDocument();
  });
});
