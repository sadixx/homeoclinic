// MS — "Data folder not available" boot screen (SET-006, ADR 0020 §7;
// docs/ui/S18-settings.md testid table).
//
// CUT: the REAL <DataFolderMissing />. Fakes are dependencies only
// (R-TEST-002): `@/bindings` (setupGetState / settingsRecheckDataFolder /
// settingsForgetDataFolder) returning the typed wire shapes. Synthetic data.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { setupGetState, settingsRecheckDataFolder, settingsForgetDataFolder } =
  vi.hoisted(() => ({
    setupGetState: vi.fn(),
    settingsRecheckDataFolder: vi.fn(),
    settingsForgetDataFolder: vi.fn(),
  }));

vi.mock('@/bindings', () => ({
  commands: {
    setupGetState,
    settingsRecheckDataFolder,
    settingsForgetDataFolder,
  },
}));

import { DataFolderMissing } from './DataFolderMissing';

const MISSING = '/media/test/USB001/HomeoClinic';
const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

function renderScreen(onResolved = vi.fn()): typeof onResolved {
  render(
    <MemoryRouter initialEntries={['/data-missing']}>
      <Routes>
        <Route
          path="/data-missing"
          element={<DataFolderMissing onResolved={onResolved} />}
        />
        <Route path="/lock" element={<div data-testid="lock-probe" />} />
        <Route path="/setup" element={<div data-testid="setup-probe" />} />
      </Routes>
    </MemoryRouter>,
  );
  return onResolved;
}

beforeEach(() => {
  setupGetState.mockReset();
  setupGetState.mockResolvedValue(
    ok({ completed: true, dataFolderMissing: MISSING }),
  );
  settingsRecheckDataFolder.mockReset();
  settingsForgetDataFolder.mockReset();
  settingsForgetDataFolder.mockResolvedValue(ok(null));
});

describe('Data folder missing — confirm step (SET-006)', () => {
  it('Cancel backs out of the confirm step without forgetting the folder', async () => {
    const user = userEvent.setup();
    const onResolved = renderScreen();
    await waitFor(() =>
      expect(screen.getByTestId('data-missing-path')).toHaveTextContent(
        MISSING,
      ),
    );

    await user.click(screen.getByTestId('data-missing-use-default'));
    expect(screen.getByTestId('data-missing-confirm')).toBeInTheDocument();

    await user.click(screen.getByTestId('data-missing-cancel'));

    expect(screen.queryByTestId('data-missing-confirm')).toBeNull();
    expect(screen.queryByTestId('data-missing-cancel')).toBeNull();
    expect(screen.getByTestId('data-missing-use-default')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('data-missing-retry')).toHaveFocus(),
    );
    expect(settingsForgetDataFolder).not.toHaveBeenCalled();
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.getByTestId('data-missing-screen')).toBeInTheDocument();
  });

  it('Confirm forgets the folder and continues to the lock screen', async () => {
    const user = userEvent.setup();
    const onResolved = renderScreen();
    await user.click(screen.getByTestId('data-missing-use-default'));
    await user.click(screen.getByTestId('data-missing-confirm'));

    await waitFor(() =>
      expect(screen.getByTestId('lock-probe')).toBeInTheDocument(),
    );
    expect(settingsForgetDataFolder).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith(true);
  });
});
