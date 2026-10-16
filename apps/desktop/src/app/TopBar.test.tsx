// RED test for the top bar IPC path (HC-MVP1-011, design §5c, R-UI-002, §1d).
//
// CUT: the real <TopBar /> component. The generated binding `@/bindings` is the
// faked dependency (R-TEST-002); the test proves the UI reaches the backend
// THROUGH the typed wrapper `commands.appInfo()` and never raw `invoke`
// (R-UI-002), and that it renders the returned version (R-TEST-003: asserts the
// rendered value, not just that a call happened).
//
// The mock fn is created via `vi.hoisted` so it is available inside the
// hoisted `vi.mock` factory (Vitest hoists vi.mock to the top of the module).
//
// Red-first state: until hc-ui-dev creates `./TopBar`, the module cannot be
// resolved. Once it exists, the mock must be invoked and the version "7.7.7"
// must render; the search testid (§3f) must be present.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { appInfo } = vi.hoisted(() => ({
  appInfo: vi.fn(async () => ({
    name: 'HomeoClinic',
    version: '7.7.7',
    build_profile: 'debug' as const,
  })),
}));

vi.mock('@/bindings', () => ({
  commands: { appInfo },
}));

import { TopBar } from './TopBar';

describe('TopBar', () => {
  beforeEach(() => {
    appInfo.mockClear();
  });

  it('calls commands.appInfo and shows the version', async () => {
    render(<TopBar />);

    // F2 search target must exist (§3f).
    expect(screen.getByTestId('topbar-search')).toBeInTheDocument();

    // The returned version is rendered (proves the full UI -> binding path).
    expect(await screen.findByText(/7\.7\.7/)).toBeInTheDocument();

    // UI reaches the backend through the typed wrapper, never raw invoke.
    expect(appInfo).toHaveBeenCalledTimes(1);
  });
});
