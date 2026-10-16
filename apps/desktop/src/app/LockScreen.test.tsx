// RED test for the lock-screen stub (HC-MVP1-009, design §5c, S02 R0 slice).
//
// CUT: the real <LockScreen /> component. At R0 it is a stub: a centered card
// with a PIN field that is present but DISABLED (no verify logic yet).
//
// Red-first state: until hc-ui-dev creates `./LockScreen`, the module cannot be
// resolved. Once it exists, the `lock-card` and `lock-pin` testids (§3f) must
// be present and the PIN input must be disabled (R0 stub, no verify).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { LockScreen } from './LockScreen';

describe('LockScreen', () => {
  it('renders the lock stub card with a disabled PIN field', () => {
    render(<LockScreen />);

    expect(screen.getByTestId('lock-card')).toBeInTheDocument();

    const pin = screen.getByTestId('lock-pin');
    expect(pin).toBeInTheDocument();
    expect(pin).toBeDisabled();
  });
});
