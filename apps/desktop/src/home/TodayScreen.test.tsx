// RED test for the Today empty state (HC-MVP1-009, design §5c, S03 R0 slice).
//
// CUT: the real <TodayScreen /> component. en.json strings asserted (R-UI-007).
//
// Red-first state: until hc-ui-dev creates `../home/TodayScreen`, the module
// cannot be resolved. Once it exists, the empty-state testid (`today-empty`),
// its localized message, and the primary action (`today-new-patient`) from §3f
// are what must hold.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import en from '@/locales/en.json';
import { TodayScreen } from './TodayScreen';

describe('TodayScreen', () => {
  it('shows the empty state message and the New patient action', () => {
    render(<TodayScreen />);

    const empty = screen.getByTestId('today-empty');
    expect(empty).toBeInTheDocument();
    expect(empty).toHaveTextContent(en['today.empty.message']);

    const action = screen.getByTestId('today-new-patient');
    expect(action).toBeInTheDocument();
    expect(action).toHaveTextContent(en['today.empty.action']);
  });
});
