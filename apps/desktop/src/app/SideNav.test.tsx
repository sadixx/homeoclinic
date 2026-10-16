// RED test for the left nav (HC-MVP1-009, design §5c, R-UI-007, NFR-030).
//
// CUT: the real <SideNav /> component. Strings come from locales/en.json via the
// typed accessor (R-UI-007) — the test asserts the localized labels, not
// hardcoded English, so a hardcoded string also fails this test.
//
// Red-first state: until hc-ui-dev creates `./SideNav`, the module cannot be
// resolved. Once it exists, the assertions on the nav testids (§3f) and the
// en.json labels (§3d) are what must hold.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import en from '@/locales/en.json';
import { SideNav } from './SideNav';

describe('SideNav', () => {
  it('shows Today, Patients and Settings nav items with localized labels', () => {
    render(<SideNav />);

    const today = screen.getByTestId('nav-today');
    const patients = screen.getByTestId('nav-patients');
    const settings = screen.getByTestId('nav-settings');

    expect(today).toBeInTheDocument();
    expect(patients).toBeInTheDocument();
    expect(settings).toBeInTheDocument();

    expect(today).toHaveTextContent(en['nav.today']);
    expect(patients).toHaveTextContent(en['nav.patients']);
    expect(settings).toHaveTextContent(en['nav.settings']);
  });
});
