// RED component tests for HC-MVP1-M3vis (1): a Next follow-up control in the
// CASE header, for first AND follow-up visits (VIS-004).
//
// Today the header only DISPLAYS `case-form-next-followup`; the retired S09
// screen (visit/FollowupVisit.tsx) was the only place with the 7d/15d/1m/2m/
// custom buttons, and it is off the nav path. So the doctor cannot schedule a
// follow-up and Today's Due / Overdue lists never fill for new visits.
//
// Contract asserted (role-first so the layout stays free to fit 1366x768):
//  - a `role=group` whose accessible name is "Next follow-up";
//  - inside it buttons named "7 days", "15 days", "1 month", "2 months",
//    "Clear" whose VISIBLE text is that name (WCAG 2.5.3), and a date input
//    with a VISIBLE "Custom date" label (testid `case-form-next-custom`);
//  - a click sends commands.visitSetNextFollowup({ visitId, nextFollowupOn })
//    with a LOCAL YYYY-MM-DD date (shared/datetime), and the header
//    `case-form-next-followup` then shows that date as DD-MM-YYYY;
//  - a custom date is committed on blur / Enter / a short pause, never on
//    every intermediate change; before local today it is rejected with an
//    inline role=alert and NO command call; today itself is allowed;
//  - one command in flight at a time; the last choice wins;
//  - Clear sends null and the header shows the "none" text.
// If the implementation puts the group behind a disclosure button (to save
// header width), the `nextFollowupGroup()` helper opens it via the button
// named /next follow-up/i first.
//
// Clock: `Date` is faked (`vi.useFakeTimers({ toFake: ['Date'] })`), so
// userEvent and React scheduling run on real timers (no fake-timer deadlock).
// The custom-date pause tests additionally fake setTimeout/clearTimeout in a
// short synchronous window (see `fakePauseTimer`). The only other fake is the
// typed bindings dependency. Synthetic data only.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  openOrCreate,
  autosave,
  pickReportFile,
  attachReport,
  listAttachments,
  openAttachment,
  deleteAttachment,
  setNextFollowup,
  patientListAttachments,
} = vi.hoisted(() => ({
  openOrCreate: vi.fn(),
  autosave: vi.fn(),
  pickReportFile: vi.fn(),
  attachReport: vi.fn(),
  listAttachments: vi.fn(),
  openAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  setNextFollowup: vi.fn(),
  patientListAttachments: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    caseVisitOpenOrCreate: openOrCreate,
    caseVisitAutosave: autosave,
    visitPickReportFile: pickReportFile,
    visitAttachReport: attachReport,
    visitListAttachments: listAttachments,
    visitOpenAttachment: openAttachment,
    visitDeleteAttachment: deleteAttachment,
    visitSetNextFollowup: setNextFollowup,
    patientListAttachments,
  },
}));

import { CaseForm } from './CaseForm';
import { CUSTOM_COMMIT_MS } from './NextFollowupControl';
import en from '@/locales/en.json';

// Local wall clock 00:30 on 4 Nov 2026. In a UTC+ zone (the clinic's IST, or
// EET on the dev box) the UTC date is still 3 Nov, so a `toISOString()`-based
// implementation lands one day early and fails; in a UTC CI runner the local
// and UTC dates coincide and the arithmetic is still checked.
const NOW_LOCAL = new Date(2026, 10, 4, 0, 30, 0);

function caseDoc(): string {
  return JSON.stringify({
    schema: 'case-journal',
    version: 2,
    complaints: [
      {
        id: 'cc1',
        title: 'Headache',
        entries: [{ entry_date: '2026-11-04', visit_id: 'v-1', blocks: [] }],
      },
    ],
    sections: {},
  });
}

function openResp(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    visitId: 'v-1',
    templateId: 'journal_default',
    dataJson: caseDoc(),
    vitalsJson: '{}',
    visitAt: '2026-11-04T09:00:00Z',
    nextFollowupOn: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_LOCAL);
  openOrCreate.mockReset();
  openOrCreate.mockResolvedValue(openResp());
  autosave.mockReset();
  autosave.mockResolvedValue({ savedAt: '2026-11-04T09:00:30Z' });
  listAttachments.mockReset();
  listAttachments.mockResolvedValue({ attachments: [] });
  patientListAttachments.mockReset();
  patientListAttachments.mockResolvedValue({ attachments: [] });
  pickReportFile.mockReset();
  pickReportFile.mockResolvedValue({ sourcePath: null });
  attachReport.mockReset();
  openAttachment.mockReset();
  deleteAttachment.mockReset();
  setNextFollowup.mockReset();
  setNextFollowup.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type VisitType = 'first' | 'follow_up';

async function renderForm(visitType: VisitType = 'first'): Promise<void> {
  render(
    <CaseForm
      patientId="p-123"
      visitId="v-1"
      sex="male"
      ageYears={34}
      visitType={visitType}
    />,
  );
  await screen.findByTestId('case-form', undefined, { timeout: 1500 });
}

/** The Next follow-up group, opening a disclosure first if there is one. */
function nextFollowupGroup(): HTMLElement {
  const name = /^next follow-up$/i;
  const existing = screen.queryByRole('group', { name });
  if (existing !== null) return existing;
  const toggle = screen.queryByRole('button', { name: /next follow-up/i });
  if (toggle !== null) fireEvent.click(toggle);
  return screen.getByRole('group', { name });
}

function headerText(): string {
  return screen.getByTestId('case-form-next-followup').textContent ?? '';
}

function customInput(group: HTMLElement): HTMLInputElement {
  return within(group).getByLabelText(/custom date/i) as HTMLInputElement;
}

describe.each<VisitType>(['first', 'follow_up'])(
  'M3vis Next follow-up control (%s visit)',
  (visitType) => {
    it('renders a labelled group with 7 days / 15 days / 1 month / 2 months / Clear and a custom date input', async () => {
      await renderForm(visitType);
      const group = nextFollowupGroup();
      for (const name of [
        '7 days',
        '15 days',
        '1 month',
        '2 months',
        'Clear',
      ]) {
        expect(
          within(group).getByRole('button', {
            name: new RegExp(`^${name}$`, 'i'),
          }),
        ).toBeInTheDocument();
      }
      const input = customInput(group);
      expect(input).toHaveAttribute('type', 'date');
      expect(input).toHaveAttribute('data-testid', 'case-form-next-custom');
    });

    it('7 days sends today+7 as a local YYYY-MM-DD date and the header shows it', async () => {
      const user = userEvent.setup();
      await renderForm(visitType);
      await user.click(
        within(nextFollowupGroup()).getByRole('button', { name: /^7 days$/i }),
      );
      await waitFor(() =>
        expect(setNextFollowup).toHaveBeenCalledWith({
          visitId: 'v-1',
          nextFollowupOn: '2026-11-11',
        }),
      );
      await waitFor(() => expect(headerText()).toContain('11-11-2026'));
    });
  },
);

describe('M3vis Next follow-up control: date maths, custom, past, clear', () => {
  it.each([
    ['15 days', '2026-11-19', '19-11-2026'],
    ['1 month', '2026-12-04', '04-12-2026'],
    ['2 months', '2027-01-04', '04-01-2027'], // year rollover
  ])('%s sends %s and shows %s', async (name, iso, shown) => {
    const user = userEvent.setup();
    await renderForm();
    await user.click(
      within(nextFollowupGroup()).getByRole('button', {
        name: new RegExp(`^${name}$`, 'i'),
      }),
    );
    await waitFor(() =>
      expect(setNextFollowup).toHaveBeenCalledWith({
        visitId: 'v-1',
        nextFollowupOn: iso,
      }),
    );
    await waitFor(() => expect(headerText()).toContain(shown));
  });

  it('a custom future date is sent and shown in the header', async () => {
    await renderForm();
    const input = customInput(nextFollowupGroup());
    fireEvent.change(input, { target: { value: '2026-11-20' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(setNextFollowup).toHaveBeenCalledWith({
        visitId: 'v-1',
        nextFollowupOn: '2026-11-20',
      }),
    );
    await waitFor(() => expect(headerText()).toContain('20-11-2026'));
  });

  it('a custom date of TODAY is allowed (a patient can be due today)', async () => {
    await renderForm();
    const input = customInput(nextFollowupGroup());
    fireEvent.change(input, { target: { value: '2026-11-04' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(setNextFollowup).toHaveBeenCalledWith({
        visitId: 'v-1',
        nextFollowupOn: '2026-11-04',
      }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a custom date in the past is rejected inline and never sent', async () => {
    openOrCreate.mockResolvedValue(openResp({ nextFollowupOn: '2026-11-25' }));
    await renderForm();
    await waitFor(() => expect(headerText()).toContain('25-11-2026'));
    const group = nextFollowupGroup();

    // Yesterday in LOCAL time (UTC "today" would be 3 Nov at this instant).
    fireEvent.change(customInput(group), { target: { value: '2026-11-03' } });
    fireEvent.blur(customInput(group));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent?.trim() ?? '').not.toBe('');
    expect(setNextFollowup).not.toHaveBeenCalled();
    expect(headerText(), 'header keeps the saved date').toContain('25-11-2026');
  });

  it('Clear sends null and the header shows no date', async () => {
    const user = userEvent.setup();
    openOrCreate.mockResolvedValue(openResp({ nextFollowupOn: '2026-11-25' }));
    await renderForm();
    await waitFor(() => expect(headerText()).toContain('25-11-2026'));

    await user.click(
      within(nextFollowupGroup()).getByRole('button', { name: /^clear$/i }),
    );

    await waitFor(() =>
      expect(setNextFollowup).toHaveBeenCalledWith({
        visitId: 'v-1',
        nextFollowupOn: null,
      }),
    );
    await waitFor(() =>
      expect(headerText()).toBe(en['case.form.nextFollowup.none']),
    );
  });

  it('is keyboard operable: Enter on a focused quick button schedules it', async () => {
    const user = userEvent.setup();
    await renderForm();
    const btn = within(nextFollowupGroup()).getByRole('button', {
      name: /^1 month$/i,
    });
    btn.focus();
    expect(document.activeElement).toBe(btn);
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(setNextFollowup).toHaveBeenCalledWith({
        visitId: 'v-1',
        nextFollowupOn: '2026-12-04',
      }),
    );
  });
});

// --- Review fixes (review-nextfollowup.json a11y-1, a11y-2, data-1, ux-1) ---

// The custom-date pause (CUSTOM_COMMIT_MS) is elapsed on a FAKE clock, never
// slept on (R-TEST-006). The form is first rendered and loaded on real timers
// (findBy/waitFor and the editor need them); then `fakePauseTimer()` also
// fakes setTimeout/clearTimeout at the same fake instant, the control is
// driven with fireEvent (synchronous, wrapped in act) and the pause is
// elapsed with `elapseCommitPause()`. A write is observable synchronously:
// the control calls the command inside the timer / event handler. RTL
// waitFor/findBy MUST NOT run inside this window (they schedule on
// setTimeout), so `realPauseTimer()` goes back before any async wait. Only
// the control's own timer can be armed in the window (no editor input is
// dispatched there), so no ProseMirror work depends on the fake clock.

/** Also fake setTimeout/clearTimeout, keeping the current fake date. */
function fakePauseTimer(): void {
  const now = Date.now();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(now);
}

/** Elapse exactly the custom-date pause; an armed commit timer fires. */
function elapseCommitPause(): void {
  act(() => {
    vi.advanceTimersByTime(CUSTOM_COMMIT_MS);
  });
}

/** Back to real timers (Date stays faked at the current instant). */
function realPauseTimer(): void {
  const now = Date.now();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
}

/** A promise with its resolve/reject exposed (a command still in flight). */
function deferred(): {
  promise: Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
} {
  let resolve: (v: unknown) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('M3vis Next follow-up control: visible labels (a11y-1, a11y-2)', () => {
  it('the custom date input sits inside a <label> whose VISIBLE text is "Custom date"', async () => {
    await renderForm();
    const input = screen.getByTestId('case-form-next-custom');
    const label = input.closest('label');
    expect(label, 'input is wrapped in a <label>').not.toBeNull();
    expect(screen.getByTestId('case-form-next-custom-label').textContent).toBe(
      en['case.form.nextFollowup.custom'],
    );
    // The name comes from the visible label, not a hidden aria-label.
    expect(input).not.toHaveAttribute('aria-label');
    expect(customInput(nextFollowupGroup())).toBe(input);
  });

  it.each([
    ['7d', '7 days'],
    ['15d', '15 days'],
    ['1m', '1 month'],
    ['2m', '2 months'],
    ['clear', 'Clear'],
  ])(
    'button %s shows "%s" as visible text, which is its accessible name',
    async (id, name) => {
      await renderForm();
      const btn = screen.getByTestId(`case-form-next-${id}`);
      expect(btn.textContent).toBe(name);
      expect(btn).not.toHaveAttribute('aria-label');
      expect(
        within(nextFollowupGroup()).getByRole('button', {
          name: new RegExp(`^${name}$`),
        }),
      ).toBe(btn);
    },
  );
});

describe('M3vis Next follow-up control: custom date commit (data-1)', () => {
  it('segment-by-segment edits write only the final date, once, on blur', async () => {
    await renderForm();
    const input = customInput(nextFollowupGroup());
    fakePauseTimer();
    // Typing the day "1", "5" in a native date input: 12-01 then 12-15.
    fireEvent.change(input, { target: { value: '2026-12-01' } });
    fireEvent.change(input, { target: { value: '2026-12-15' } });
    expect(setNextFollowup).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(setNextFollowup).toHaveBeenCalledTimes(1);
    expect(setNextFollowup).toHaveBeenCalledWith({
      visitId: 'v-1',
      nextFollowupOn: '2026-12-15',
    });
    elapseCommitPause();
    expect(
      setNextFollowup,
      'no extra write after the pause',
    ).toHaveBeenCalledTimes(1);
    realPauseTimer();
    await waitFor(() => expect(headerText()).toContain('15-12-2026'));
  });

  it('Enter commits the custom date at once', async () => {
    await renderForm();
    const input = customInput(nextFollowupGroup());
    fireEvent.change(input, { target: { value: '2026-11-20' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(setNextFollowup).toHaveBeenCalledTimes(1);
    expect(setNextFollowup).toHaveBeenCalledWith({
      visitId: 'v-1',
      nextFollowupOn: '2026-11-20',
    });
    // Settle the write inside the test (its header update is the marker).
    await waitFor(() => expect(headerText()).toContain('20-11-2026'));
  });

  it('a calendar pick with focus left in the field is committed after a short pause, once', async () => {
    await renderForm();
    const input = customInput(nextFollowupGroup());
    fakePauseTimer();
    fireEvent.change(input, { target: { value: '2026-11-20' } });
    expect(setNextFollowup).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(CUSTOM_COMMIT_MS - 1);
    });
    expect(
      setNextFollowup,
      'not committed before the pause has elapsed',
    ).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(setNextFollowup).toHaveBeenCalledTimes(1);
    expect(setNextFollowup).toHaveBeenCalledWith({
      visitId: 'v-1',
      nextFollowupOn: '2026-11-20',
    });
    fireEvent.blur(input);
    expect(
      setNextFollowup,
      'blur after the pause does not re-send',
    ).toHaveBeenCalledTimes(1);
    realPauseTimer();
    await waitFor(() => expect(headerText()).toContain('20-11-2026'));
  });

  it('a partial / invalid value and a past date are never written, even after blur and the pause', async () => {
    await renderForm();
    const input = customInput(nextFollowupGroup());
    fakePauseTimer();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: '2026-11-01' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    fireEvent.blur(input);
    elapseCommitPause();
    expect(setNextFollowup).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      en['case.form.nextFollowup.error.past'],
    );
    realPauseTimer();
  });

  it('re-committing the already saved date sends nothing', async () => {
    openOrCreate.mockResolvedValue(openResp({ nextFollowupOn: '2026-11-25' }));
    await renderForm();
    await waitFor(() => expect(headerText()).toContain('25-11-2026'));
    const input = customInput(nextFollowupGroup());
    fakePauseTimer();
    fireEvent.change(input, { target: { value: '2026-11-25' } });
    fireEvent.blur(input);
    elapseCommitPause();
    expect(setNextFollowup).not.toHaveBeenCalled();
    realPauseTimer();
  });

  it('a quick button after an uncommitted custom date wins (the custom date is not sent later)', async () => {
    await renderForm();
    const group = nextFollowupGroup();
    fakePauseTimer();
    fireEvent.change(customInput(group), { target: { value: '2026-11-20' } });
    // Click without a blur first (a pointer click on the button).
    fireEvent.click(within(group).getByRole('button', { name: /^7 days$/i }));
    elapseCommitPause();
    expect(setNextFollowup).toHaveBeenCalledTimes(1);
    expect(setNextFollowup).toHaveBeenCalledWith({
      visitId: 'v-1',
      nextFollowupOn: '2026-11-11',
    });
    realPauseTimer();
    await waitFor(() => expect(headerText()).toContain('11-11-2026'));
  });
});

describe('M3vis Next follow-up control: in-flight guard, last write wins (ux-1)', () => {
  it('rapid 7 days, 1 month, 2 months: one command at a time, intermediate choice dropped, last choice stays', async () => {
    const first = deferred();
    const second = deferred();
    setNextFollowup.mockReset();
    setNextFollowup
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockResolvedValue({ ok: true });
    await renderForm();
    const group = nextFollowupGroup();

    fireEvent.click(within(group).getByRole('button', { name: /^7 days$/i }));
    fireEvent.click(within(group).getByRole('button', { name: /^1 month$/i }));
    fireEvent.click(within(group).getByRole('button', { name: /^2 months$/i }));

    // Only the first is in flight; the others wait.
    expect(setNextFollowup).toHaveBeenCalledTimes(1);
    expect(setNextFollowup).toHaveBeenLastCalledWith({
      visitId: 'v-1',
      nextFollowupOn: '2026-11-11',
    });

    first.resolve({ ok: true });

    await waitFor(() => expect(setNextFollowup).toHaveBeenCalledTimes(2));
    expect(setNextFollowup).toHaveBeenLastCalledWith({
      visitId: 'v-1',
      nextFollowupOn: '2027-01-04',
    });
    // The first write's result is shown while the last one is in flight.
    await waitFor(() => expect(headerText()).toContain('11-11-2026'));

    // Settle the last write; the loop then finds the queue empty and ends.
    // Its header update is the visible marker that the loop has drained (a
    // re-sent intermediate choice would be a 3rd call made before it).
    await act(async () => {
      second.resolve({ ok: true });
      await second.promise;
    });
    await waitFor(() => expect(headerText()).toContain('04-01-2027'));
    expect(setNextFollowup).toHaveBeenCalledTimes(2);
    expect(headerText()).toContain('04-01-2027');
  });

  it('a failed in-flight write does not lose the queued last choice', async () => {
    const first = deferred();
    setNextFollowup.mockReset();
    setNextFollowup
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue({ ok: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderForm();
    const group = nextFollowupGroup();

    fireEvent.click(within(group).getByRole('button', { name: /^7 days$/i }));
    fireEvent.click(within(group).getByRole('button', { name: /^15 days$/i }));
    first.reject(new Error('synthetic failure'));

    await waitFor(() => expect(setNextFollowup).toHaveBeenCalledTimes(2));
    expect(setNextFollowup).toHaveBeenLastCalledWith({
      visitId: 'v-1',
      nextFollowupOn: '2026-11-19',
    });
    await waitFor(() => expect(headerText()).toContain('19-11-2026'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
