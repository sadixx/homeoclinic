// RED tests for M3-RW Slice C — DUES PLACEHOLDER on home (Slice C6). Design:
// docs/adr/0018-case-big-box-dated-log.md (cross-cutting §UX shell: "Dues auto-
// shown on save + Clear-dues on home are PLACEHOLDERS (billing is R5 / M8,
// BILL-001..002)"). The slice plan C6 says render a clearly-disabled
// placeholder with a "Billing arrives in R5" tooltip (no dead-end, R-DEL-002),
// with NO fake money / math / network.
//
// CUT: the REAL <TodayScreen /> (apps/desktop/src/home/TodayScreen.tsx). The
// ONLY faked thing is the generated binding `@/bindings` (a dependency,
// R-TEST-002), created with `vi.hoisted` (see TodayScreen.test.tsx).
//
// Red-first state: Today has no "Clear dues" control at all, so
// `findByTestId('today-clear-dues')` rejects and these FAIL on the query, not
// at import. After hc-ui-dev adds the labelled, disabled placeholder these pass.
//
// The assertions are deliberately NARROW: the control is present, is clearly a
// PLACEHOLDER (its label/tooltip says so), is DISABLED, and clicking it is a
// NO-OP that calls NO binding (no fake clearing, no money math, no network).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { todayGetOverview } = vi.hoisted(() => ({
  todayGetOverview: vi.fn(),
}));

// Record every binding call so a no-op placeholder can be proven to touch none.
const invokedCommands: string[] = [];

vi.mock('@/bindings', () => ({
  commands: new Proxy(
    { todayGetOverview },
    {
      get(_target: Record<string, unknown>, prop: string) {
        if (prop === 'todayGetOverview') return todayGetOverview;
        // Any OTHER command access returns a spy that records the call, so a
        // placeholder that wrongly invokes a binding is caught.
        return () => {
          invokedCommands.push(prop);
          return Promise.resolve(undefined);
        };
      },
    },
  ),
}));

import { TodayScreen } from './TodayScreen';

beforeEach(() => {
  invokedCommands.length = 0;
  todayGetOverview.mockReset();
  todayGetOverview.mockResolvedValue({
    dueToday: [],
    overdue: [],
    registeredToday: [],
    backupWarning: null,
    licenceReminder: null,
  });
});

describe('TodayScreen (S03) — Clear-dues placeholder (Slice C6)', () => {
  it('renders a Clear-dues control on home', async () => {
    render(<TodayScreen />);
    await screen.findByTestId('today-screen');
    expect(await screen.findByTestId('today-clear-dues')).toBeInTheDocument();
  });

  it('marks the Clear-dues control as a disabled PLACEHOLDER (billing is R5)', async () => {
    render(<TodayScreen />);
    await screen.findByTestId('today-screen');
    const clear = await screen.findByTestId('today-clear-dues');

    // Clearly a placeholder, not a live control: disabled + aria-disabled.
    expect(clear).toBeDisabled();
    expect(clear).toHaveAttribute('aria-disabled', 'true');
    // A tooltip / accessible hint that says billing is not here yet (R5). The
    // exact wording is hc-ui-dev's en.json string; assert a non-empty tooltip
    // referencing a later release rather than a hardcoded sentence.
    const title = clear.getAttribute('title') ?? '';
    expect(title).not.toBe('');
    expect(title).toMatch(/R5|later|billing/i);
  });

  it('clicking Clear-dues is a NO-OP: it calls NO binding (no money math, no network)', async () => {
    const user = userEvent.setup();
    render(<TodayScreen />);
    await screen.findByTestId('today-screen');
    const clear = await screen.findByTestId('today-clear-dues');

    // Only the mount-time overview read is allowed; nothing else.
    const before = invokedCommands.slice();
    await user.click(clear);
    expect(invokedCommands).toEqual(before);
    // And specifically no clear-dues / billing binding fired.
    expect(invokedCommands.some((c) => /dues|bill|clear/i.test(c))).toBe(false);
  });
});
