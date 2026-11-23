// MS reuse seam: the setup Morning/Evening timings widget rendered by S18 with
// its own id base (design §8 "Reuse"). CUT: the REAL <ClinicTimingsInput /> and
// `validateTimings()`. No fakes. The setup ids must stay byte-identical by
// default (SetupWizard tests and E2E rely on them).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  ClinicTimingsInput,
  TIMINGS_ID,
  timingsBoxesFor,
  validateTimings,
} from './ClinicTimingsInput';

const noop = (): void => undefined;

describe('ClinicTimingsInput idBase (S18 reuse)', () => {
  it('uses the given id base for every testid and keeps the setup ids by default', () => {
    const value = timingsBoxesFor('');
    const { unmount } = render(
      <ClinicTimingsInput
        idBase="settings-clinic-timings"
        value={value}
        onChange={noop}
        activeSession="morning"
        onActiveSessionChange={noop}
        errors={{}}
      />,
    );
    for (const id of [
      'settings-clinic-timings-group',
      'settings-clinic-timings-tab-morning',
      'settings-clinic-timings-tab-evening',
      'settings-clinic-timings-morning-from-hour',
      'settings-clinic-timings-morning-to-minute',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.queryByTestId(`${TIMINGS_ID}-group`)).toBeNull();
    unmount();

    render(
      <ClinicTimingsInput
        value={value}
        onChange={noop}
        activeSession="morning"
        onActiveSessionChange={noop}
        errors={{}}
      />,
    );
    expect(
      screen.getByTestId('setup-clinic-timings-group'),
    ).toBeInTheDocument();
  });

  it('keys validation errors with the given id base', () => {
    const boxes = {
      ...timingsBoxesFor(''),
      morning: {
        fromHour: '13',
        fromMinute: '00',
        toHour: '1',
        toMinute: '00',
      },
    };
    const v = validateTimings(boxes, 'settings-clinic-timings');
    expect(Object.keys(v.errors)).toContain(
      'settings-clinic-timings-morning-from-hour',
    );
    expect(
      Object.keys(v.errors).every((k) =>
        k.startsWith('settings-clinic-timings-'),
      ),
    ).toBe(true);
  });
});
