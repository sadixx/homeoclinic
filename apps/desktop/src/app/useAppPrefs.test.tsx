// MS (SET-004/005/007) shell preferences provider. CUT: the REAL
// `AppPrefsProvider` + `useAppPrefs()`. The only fake is the generated binding
// `@/bindings` (settingsGet). Synthetic data only.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { settingsGet } = vi.hoisted(() => ({ settingsGet: vi.fn() }));
vi.mock('@/bindings', () => ({ commands: { settingsGet } }));

import { AppPrefsProvider, useAppPrefs } from './useAppPrefs';

function view(app: Record<string, unknown>): unknown {
  return {
    doctor: {
      name: 'Test Doctor 001',
      qualification: 'BHMS',
      regNo: 'TESTREG-001',
      regCouncil: 'Test Council',
      phone: null,
      email: null,
    },
    clinic: {
      name: 'Test Clinic 001',
      address: '1 Test Street',
      timings: null,
      gstin: null,
      feeFirstPaise: 50000,
      feeFollowupPaise: 30000,
    },
    app: {
      idPrefix: 'HC-',
      autolockMinutes: 15,
      fontSize: 'normal',
      defaultCamera: null,
      ...app,
    },
    nextNumber: '000001',
    dataFolder: '/tmp/hc',
    identityLocked: false,
  };
}

/** Renders the prefs the shell would read, plus an applySaved trigger. */
function Probe(): JSX.Element {
  const prefs = useAppPrefs();
  return (
    <div>
      <span data-testid="prefs-font">{prefs.fontSize}</span>
      <span data-testid="prefs-autolock">{prefs.autolockMinutes}</span>
      <span data-testid="prefs-camera">
        {prefs.defaultCamera?.deviceId ?? 'system'}
      </span>
      <button
        type="button"
        data-testid="prefs-apply"
        onClick={() =>
          prefs.applySaved({
            idPrefix: 'HC-',
            autolockMinutes: 5,
            fontSize: 'xlarge',
            defaultCamera: { deviceId: 'cam-1', label: 'Test Camera 1' },
          })
        }
      />
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  settingsGet.mockReset();
});

describe('AppPrefsProvider (SET-004/005/007)', () => {
  it('reads the saved prefs once on mount (defaults without a provider)', async () => {
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId('prefs-font')).toHaveTextContent('normal');
    expect(screen.getByTestId('prefs-autolock')).toHaveTextContent('15');
    expect(screen.getByTestId('prefs-camera')).toHaveTextContent('system');
    unmount();

    settingsGet.mockResolvedValue(
      view({
        fontSize: 'large',
        autolockMinutes: 30,
        defaultCamera: { deviceId: 'cam-2', label: 'Test Camera 2' },
      }),
    );
    render(
      <AppPrefsProvider>
        <Probe />
      </AppPrefsProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('prefs-font')).toHaveTextContent('large'),
    );
    expect(screen.getByTestId('prefs-autolock')).toHaveTextContent('30');
    expect(screen.getByTestId('prefs-camera')).toHaveTextContent('cam-2');
    expect(settingsGet).toHaveBeenCalledTimes(1);
  });

  it('applies a saved change immediately (no reload)', async () => {
    const user = userEvent.setup();
    settingsGet.mockResolvedValue(view({}));
    render(
      <AppPrefsProvider>
        <Probe />
      </AppPrefsProvider>,
    );
    await waitFor(() => expect(settingsGet).toHaveBeenCalled());
    await user.click(screen.getByTestId('prefs-apply'));
    expect(screen.getByTestId('prefs-font')).toHaveTextContent('xlarge');
    expect(screen.getByTestId('prefs-autolock')).toHaveTextContent('5');
    expect(screen.getByTestId('prefs-camera')).toHaveTextContent('cam-1');
  });

  it('keeps the defaults (no crash) when the settings read fails', async () => {
    settingsGet.mockResolvedValue({
      status: 'error',
      error: { code: 'not_found', message: 'x', suggestedAction: 'y' },
    });
    render(
      <AppPrefsProvider>
        <Probe />
      </AppPrefsProvider>,
    );
    await waitFor(() => expect(settingsGet).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('prefs-font')).toHaveTextContent('normal');
    expect(screen.getByTestId('prefs-autolock')).toHaveTextContent('15');
  });

  it('paints the last saved font size before the read returns (no flash)', () => {
    window.localStorage.setItem('hc.fontSize', 'large');
    settingsGet.mockReturnValue(new Promise(() => undefined));
    render(
      <AppPrefsProvider>
        <Probe />
      </AppPrefsProvider>,
    );
    expect(screen.getByTestId('prefs-font')).toHaveTextContent('large');
  });
});
