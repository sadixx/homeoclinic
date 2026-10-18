// RED tests for the S02 lock screen (HC-MVP1-027,
// docs/ui/S02-lock-unlock.md). CUT: the real <LockScreen /> component (R1:
// real PIN unlock + forgot-PIN recovery). SUPERSEDES the R0 stub test
// (disabled PIN field), which no longer describes the shipped behaviour.
//
// The ONLY fake is the dependency: the typed Tauri bindings
// (`vi.mock('@/bindings')`, R-TEST-002). Asserts behaviour + en.json strings
// (R-TEST-003, R-UI-007); controls found by spec data-testid (R-UI-003).
//
// Red-first: the component is an R1 stub with no unlock wiring, so these
// behaviour assertions fail until hc-ui-dev wires authUnlock /
// authRecoverWithCode.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The mock fns are created via `vi.hoisted` so they are available inside the
// hoisted `vi.mock` factory (Vitest hoists vi.mock to the top of the module).
const { unlock, recover } = vi.hoisted(() => ({
  unlock: vi.fn(),
  recover: vi.fn(),
}));
vi.mock('@/bindings', () => ({
  commands: {
    authGetLockState: vi.fn(async () => ({
      locked: true,
      autolockMinutes: 15,
    })),
    authUnlock: unlock,
    authLock: vi.fn(async () => undefined),
    authRecoverWithCode: recover,
  },
}));

import en from '@/locales/en.json';
import { LockScreen } from './LockScreen';

beforeEach(() => {
  unlock.mockReset();
  recover.mockReset();
});

describe('LockScreen (S02)', () => {
  it('unlocks on a correct PIN (one entry, SUX-003)', async () => {
    unlock.mockResolvedValue({ ok: true, attemptsRemaining: 0 });
    const onUnlocked = vi.fn();
    const user = userEvent.setup();
    render(<LockScreen onUnlocked={onUnlocked} />);

    await user.type(screen.getByTestId('lock-pin'), '1234');
    await user.click(screen.getByTestId('lock-unlock'));

    expect(unlock).toHaveBeenCalledOnce();
    expect(onUnlocked).toHaveBeenCalledOnce();
  });

  it('shows an inline error and stays on the lock screen for a wrong PIN (SUX-005)', async () => {
    // A wrong PIN surfaces as a thrown UserFacingError with code wrong_pin.
    unlock.mockRejectedValue({
      code: 'wrong_pin',
      message: en['lock.error.wrongPin'],
      suggestedAction: 'Check the PIN and try again.',
    });
    const onUnlocked = vi.fn();
    const user = userEvent.setup();
    render(<LockScreen onUnlocked={onUnlocked} />);

    await user.type(screen.getByTestId('lock-pin'), '0000');
    await user.click(screen.getByTestId('lock-unlock'));

    const error = await screen.findByTestId('lock-error');
    expect(error).toHaveTextContent(en['lock.error.wrongPin']);
    // No false lockout and no navigation away (SUX-005): still on the lock card.
    expect(screen.getByTestId('lock-card')).toBeInTheDocument();
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it('reveals the forgot-PIN recovery panel and submits a reset (SET-004)', async () => {
    recover.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<LockScreen />);

    await user.click(screen.getByTestId('lock-forgot'));

    // The recovery panel replaces the card (SET-004).
    await user.type(
      screen.getByTestId('lock-recovery-code'),
      '0a1b2c3d-4e5f6071-8293a4b5-c6d7e8f9',
    );
    await user.type(screen.getByTestId('lock-recovery-newpin'), '5678');
    await user.type(screen.getByTestId('lock-recovery-confirm'), '5678');
    await user.click(screen.getByTestId('lock-recovery-submit'));

    expect(recover).toHaveBeenCalledOnce();
  });
});
