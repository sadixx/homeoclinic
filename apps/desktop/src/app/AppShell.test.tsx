// RED test for the app shell (HC-MVP1-009, design §5c, NFR-030/034, R-UI-003).
//
// CUT: the real <AppShell /> component. The ONLY faked thing is the generated
// binding `@/bindings` — a dependency, not the CUT (hc-unit-testing; R-TEST-002).
//
// Red-first state: until hc-ui-dev creates `./AppShell`, this fails because the
// module cannot be resolved. Once AppShell exists and renders the shell
// structure, the assertions on the data-testids (§3f) are what must hold; a
// missing shell/search/status-bar hook makes an ASSERTION fail (R-UI-003).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the generated binding (dependency, not CUT). Typed AppInfo result.
vi.mock('@/bindings', () => ({
  commands: {
    appInfo: vi.fn(async () => ({
      name: 'HomeoClinic',
      version: '0.1.0',
      build_profile: 'debug' as const,
    })),
  },
}));

import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('renders the shell with the top bar, search box and status bar', async () => {
    render(<AppShell />);

    expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('topbar-search')).toBeInTheDocument();
    expect(screen.getByTestId('status-bar')).toBeInTheDocument();
  });
});
