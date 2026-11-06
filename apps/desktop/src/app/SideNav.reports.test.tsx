// R5 — SideNav Reports item (R5 design §9/§10; S16, BILL-004). Always enabled
// in R5 and navigates to /reports. There is deliberately NO "Billing" item:
// billing is reached per visit / per patient (design A11).
//
// CUT: the real <SideNav />. No fakes. RED: there is no `nav-reports` yet.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SideNav } from './SideNav';

describe('SideNav — Reports (R5)', () => {
  it('shows an enabled Reports item that navigates to /reports', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<SideNav onNavigate={onNavigate} />);
    const reports = screen.getByTestId('nav-reports');
    expect(reports).toBeEnabled();
    expect(reports).toHaveTextContent(/reports/i);
    await user.click(reports);
    expect(onNavigate).toHaveBeenCalledWith('/reports');
  });

  it('has no Billing nav item (no invoice-list screen spec)', () => {
    render(<SideNav />);
    expect(screen.queryByTestId('nav-billing')).toBeNull();
  });
});
