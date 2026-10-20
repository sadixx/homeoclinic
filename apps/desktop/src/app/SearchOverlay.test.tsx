// Component tests for the S04 global patient search overlay (HC-MVP1-050, 051;
// docs/ui/S04-global-search.md). CUT: the real <SearchOverlay /> component.
//
// The ONLY fake is the dependency: the typed Tauri bindings
// (`vi.mock('@/bindings')`, R-TEST-002). Visible strings come from en.json
// (R-UI-007); controls are found by their spec data-testid (R-UI-003). The
// 80 ms debounce is driven with fake timers so a burst of keystrokes collapses
// to a single query (PSR-001) and the in-flight query is cancelled on the next
// keystroke.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { patientSearch, patientRecent } = vi.hoisted(() => ({
  patientSearch: vi.fn(),
  patientRecent: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    patientSearch,
    patientRecent,
  },
}));

import en from '@/locales/en.json';
import { SearchOverlay } from './SearchOverlay';

function row(overrides: Record<string, unknown> = {}) {
  return {
    patientId: 'p-123',
    code: 'HC-000123',
    name: 'Ramesh Kumar',
    ageLabel: '34y',
    sex: 'M',
    mobile: '9876543210',
    city: 'Pune',
    lastVisitAt: null,
    duesPaise: 0,
    matchType: 'exact_name',
    photoPath: null,
    ...overrides,
  };
}

beforeEach(() => {
  patientSearch.mockReset();
  patientSearch.mockResolvedValue({ results: [row()], nextCursor: null });
  patientRecent.mockReset();
  patientRecent.mockResolvedValue({ results: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SearchOverlay (S04) — recent patients when empty (PSR-007)', () => {
  it('shows the recent list on open with an empty query', async () => {
    patientRecent.mockResolvedValue({
      results: [
        row({
          patientId: 'p-87',
          code: 'HC-000087',
          name: 'Sita Devi',
          sex: 'F',
          ageLabel: '51y',
        }),
      ],
    });
    render(<SearchOverlay open onClose={vi.fn()} onOpenPatient={vi.fn()} />);

    const recent = await screen.findByTestId('search-recent');
    expect(recent).toHaveTextContent(en['search.recent.title']);
    expect(recent).toHaveTextContent('Sita Devi');
    expect(patientSearch).not.toHaveBeenCalled();
  });
});

describe('SearchOverlay (S04) — live search with 80ms debounce (PSR-001)', () => {
  it('collapses a burst of keystrokes into one query', async () => {
    // Real timers: userEvent v14 deadlocks when a component schedules its own
    // async work on mount (the recent-list load) while timers are faked, so we
    // drive the real 80ms debounce directly. A burst of six keystrokes must
    // still collapse to exactly ONE query, and no late second query may fire.
    const user = userEvent.setup();
    render(<SearchOverlay open onClose={vi.fn()} onOpenPatient={vi.fn()} />);

    const input = screen.getByTestId('search-input');
    await user.type(input, 'ram ku');
    // The whole burst debounces into a single query carrying the final text.
    await waitFor(() => expect(patientSearch).toHaveBeenCalledTimes(1));
    expect(patientSearch.mock.calls[0]![0].query).toBe('ram ku');

    // Nothing more fires from the same burst once the debounce has settled.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(patientSearch).toHaveBeenCalledTimes(1);
  });

  it('renders a result row with the match-type tag as TEXT (conventions §5)', async () => {
    const user = userEvent.setup();
    render(<SearchOverlay open onClose={vi.fn()} onOpenPatient={vi.fn()} />);

    await user.type(screen.getByTestId('search-input'), 'ramesh');
    const tag = await screen.findByTestId('search-result-matchtype');
    expect(tag).toHaveTextContent(en['search.matchtype.exact_name']);
    expect(screen.getByTestId('search-result-row')).toHaveTextContent(
      'HC-000123',
    );
  });
});

describe('SearchOverlay (S04) — keyboard (PSR-006)', () => {
  it('Enter opens the highlighted patient dashboard', async () => {
    const onOpenPatient = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchOverlay open onClose={vi.fn()} onOpenPatient={onOpenPatient} />,
    );

    await user.type(screen.getByTestId('search-input'), 'ramesh');
    await screen.findByTestId('search-result-row');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onOpenPatient).toHaveBeenCalledWith('p-123');
  });

  it('Esc closes the overlay', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SearchOverlay open onClose={onClose} onOpenPatient={vi.fn()} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SearchOverlay (S04) — no results', () => {
  it('shows a plain-language empty message and a New patient action', async () => {
    patientSearch.mockResolvedValue({ results: [], nextCursor: null });
    const onNewPatient = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchOverlay
        open
        onClose={vi.fn()}
        onOpenPatient={vi.fn()}
        onNewPatient={onNewPatient}
      />,
    );

    await user.type(screen.getByTestId('search-input'), 'zzzzz');
    const empty = await screen.findByTestId('search-empty');
    expect(empty).toHaveTextContent(en['search.empty.prefix']);
    await user.click(screen.getByTestId('search-empty-new-patient'));
    expect(onNewPatient).toHaveBeenCalled();
  });
});
