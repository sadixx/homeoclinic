// RED component tests for the S09 follow-up visit screen (HC-MVP1-069..071;
// docs/ui/S09-follow-up-visit.md). CUT: the real <FollowupVisit /> component in
// this module (apps/desktop/src/visit), route
// /patient/:patientId/visit/:visitId/followup.
//
// The ONLY fake is the dependency: the typed Tauri bindings
// (`vi.mock('@/bindings')`, R-TEST-002) — never the component. Mock fns are
// created with `vi.hoisted` so they are reachable inside the hoisted
// `vi.mock` factory (the established Slice-C pattern, see
// case/CaseForm.test.tsx, patients/PatientForm.test.tsx). Every control is
// found by its S09 spec data-testid (R-UI-003).
//
// Red-first state: until hc-ui-dev creates `../visit/FollowupVisit`, the module
// cannot be resolved and every test fails at import. Once it exists, the
// behaviours below (M3-A command contracts in @/bindings) are what must hold:
//   - visit_create_followup pre-loads previous complaints, each row UNSET
//     (VIS-002)
//   - status segmented control + improvement % slider + note per complaint
//     (VIS-002)
//   - add new complaint (VIS-002)
//   - remedy-response radio, six Hering-aware options (VIS-003)
//   - next-follow-up quick buttons 7d/15d/1m/2m + custom -> visit_set_next_followup
//     with the computed next_followup_on (VIS-004)
//   - autosave 2s + blur -> visit_autosave with the full follow-up payload
//     (CASE-005 clinical-form pattern)
//   - progress chart NOT rendered (R9 flag off); Prescribe present but inert
//     (S13 is R4 — rendered disabled/flagged, no dead end, ADR-0002)
//
// The M3-A command contracts (from @/bindings):
//   visitCreateFollowup(req: { patientId, prevVisitId })
//     -> { visitId, visitAt, prevComplaints: { key, text, location }[] }
//   visitAutosave(req: { visitId, type, complaintStatusJson, improvementPctJson,
//                        remedyResponse, vitalsJson, observations }) -> { savedAt }
//   visitSetNextFollowup(req: { visitId, nextFollowupOn }) -> { ok }
//
// Autosave uses fireEvent.change + vi.useFakeTimers (NOT user.type): userEvent
// v14 schedules keystrokes on the event loop, which deadlocks under fake timers
// + React 18 and times out (the known Slice-C deadlock, see
// CaseForm.test.tsx). fireEvent.change exercises the same onChange ->
// scheduleSave path the real control fires.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { createFollowup, autosave, setNextFollowup } = vi.hoisted(() => ({
  createFollowup: vi.fn(),
  autosave: vi.fn(),
  setNextFollowup: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    visitCreateFollowup: createFollowup,
    visitAutosave: autosave,
    visitSetNextFollowup: setNextFollowup,
  },
}));

import { FollowupVisit } from './FollowupVisit';

// Two pre-loaded complaints as the M3-A visit_create_followup contract returns
// them: { key, text, location }. Synthetic data only.
const PREV_COMPLAINTS = [
  { key: 'c1', text: 'Headache', location: 'right temple' },
  { key: 'c2', text: 'Acidity', location: '' },
];

function createResp(overrides: Record<string, unknown> = {}) {
  return {
    visitId: 'v-f1',
    visitAt: '2026-10-16T10:42:00Z',
    prevComplaints: PREV_COMPLAINTS,
    ...overrides,
  };
}

// Anchor "today" so quick-button date maths is deterministic: 16-10-2026.
const TODAY_ISO = '2026-10-16T09:00:00.000Z';

function renderFollowup(props: Record<string, unknown> = {}) {
  return render(
    <FollowupVisit
      patientId="p-123"
      visitId="v-f1"
      prevVisitId="v-prev"
      {...props}
    />,
  );
}

beforeEach(() => {
  createFollowup.mockReset();
  createFollowup.mockResolvedValue(createResp());
  autosave.mockReset();
  autosave.mockResolvedValue({ savedAt: '2026-10-16T10:42:30Z' });
  setNextFollowup.mockReset();
  setNextFollowup.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('FollowupVisit (S09) — pre-loads previous complaints (069/VIS-002)', () => {
  it('calls visit_create_followup with the patient and previous visit on open', async () => {
    renderFollowup();
    await waitFor(() => expect(createFollowup).toHaveBeenCalledTimes(1));
    const arg = createFollowup.mock.calls[0]![0];
    expect(arg.patientId).toBe('p-123');
    expect(arg.prevVisitId).toBe('v-prev');
  });

  it('renders one complaint row per pre-loaded complaint with its text', async () => {
    renderFollowup();
    const row1 = await screen.findByTestId('followup-complaint-1');
    const row2 = await screen.findByTestId('followup-complaint-2');
    expect(row1).toHaveTextContent('Headache');
    expect(row2).toHaveTextContent('Acidity');
  });

  it('leaves each pre-loaded complaint status UNSET for the doctor to mark', async () => {
    // VIS-002: pre-loaded complaints arrive with an unset status. No status
    // segment is pre-selected (aria-pressed/checked) on load.
    renderFollowup();
    const status1 = await screen.findByTestId('followup-status-1');
    const pressed = within(status1)
      .getAllByRole('button')
      .filter(
        (b) =>
          b.getAttribute('aria-pressed') === 'true' ||
          b.getAttribute('aria-checked') === 'true',
      );
    expect(pressed).toHaveLength(0);
  });
});

describe('FollowupVisit (S09) — per-complaint status / improvement / note (069/VIS-002)', () => {
  it('offers the five status options Better / Same / Worse / New / Resolved', async () => {
    renderFollowup();
    const status1 = await screen.findByTestId('followup-status-1');
    for (const label of ['Better', 'Same', 'Worse', 'New', 'Resolved']) {
      expect(
        within(status1).getByRole('button', { name: new RegExp(label, 'i') }),
      ).toBeInTheDocument();
    }
  });

  it('marks a complaint Better when its status segment is chosen', async () => {
    const user = userEvent.setup();
    renderFollowup();
    const status1 = await screen.findByTestId('followup-status-1');
    const better = within(status1).getByRole('button', { name: /better/i });
    await user.click(better);
    expect(
      better.getAttribute('aria-pressed') === 'true' ||
        better.getAttribute('aria-checked') === 'true',
    ).toBe(true);
  });

  it('exposes an improvement % slider from 0 to 100 defaulting to 0', async () => {
    renderFollowup();
    const slider1 = (await screen.findByTestId(
      'followup-improve-1',
    )) as HTMLInputElement;
    expect(slider1.min).toBe('0');
    expect(slider1.max).toBe('100');
    expect(slider1.value).toBe('0');
  });

  it('renders a free-text note input per complaint', async () => {
    renderFollowup();
    expect(await screen.findByTestId('followup-note-1')).toBeInTheDocument();
    expect(screen.getByTestId('followup-note-2')).toBeInTheDocument();
  });

  it('pre-loads a Resolved-last-time complaint and still shows it (VIS-OQ-1 = keep, shown Resolved)', async () => {
    // Recorded assumption VIS-OQ-1: a complaint resolved last visit STILL
    // pre-loads this visit, shown with a Resolved status. Drive it via the
    // mocked command returning the row; the CUT must still render a row for it.
    createFollowup.mockResolvedValue(
      createResp({
        prevComplaints: [
          ...PREV_COMPLAINTS,
          { key: 'c3', text: 'Old cough', location: 'chest' },
        ],
      }),
    );
    renderFollowup();
    const row3 = await screen.findByTestId('followup-complaint-3');
    expect(row3).toHaveTextContent('Old cough');
    // Its status control is present so the doctor can mark/confirm Resolved.
    expect(screen.getByTestId('followup-status-3')).toBeInTheDocument();
  });
});

describe('FollowupVisit (S09) — add a new complaint (069/VIS-002)', () => {
  it('appends a new complaint row when Add new complaint is clicked', async () => {
    const user = userEvent.setup();
    renderFollowup();
    await screen.findByTestId('followup-complaint-2');
    // No third row yet (only two pre-loaded).
    expect(
      screen.queryByTestId('followup-complaint-3'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByTestId('followup-add-complaint'));
    expect(screen.getByTestId('followup-complaint-3')).toBeInTheDocument();
  });
});

describe('FollowupVisit (S09) — remedy response, six Hering-aware options (070/VIS-003)', () => {
  it('renders a remedy-response radio group with exactly six options', async () => {
    renderFollowup();
    const group = await screen.findByTestId('followup-remedy-response');
    expect(within(group).getAllByRole('radio')).toHaveLength(6);
  });

  it('offers the six Hering-aware response wordings', async () => {
    // VIS-003: the six options follow Hering's-law-aware wording. The S09
    // wireframe lists: Amelioration, Agg then amel, No change, Aggravation,
    // New symptoms, Old symptoms returned.
    renderFollowup();
    const group = await screen.findByTestId('followup-remedy-response');
    for (const label of [
      /amelioration/i,
      /agg.*amel/i,
      /no change/i,
      /aggravation/i,
      /new symptom/i,
      /old symptom/i,
    ]) {
      expect(
        within(group).getByRole('radio', { name: label }),
      ).toBeInTheDocument();
    }
  });

  it('lets the doctor select one remedy response', async () => {
    const user = userEvent.setup();
    renderFollowup();
    const group = await screen.findByTestId('followup-remedy-response');
    const amel = within(group).getByRole('radio', { name: /amelioration/i });
    await user.click(amel);
    expect(amel).toBeChecked();
  });
});

describe('FollowupVisit (S09) — next follow-up quick buttons + custom (071/VIS-004)', () => {
  it('renders the 7d / 15d / 1m / 2m quick buttons and a custom date input', async () => {
    renderFollowup();
    expect(await screen.findByTestId('followup-next-7d')).toBeInTheDocument();
    expect(screen.getByTestId('followup-next-15d')).toBeInTheDocument();
    expect(screen.getByTestId('followup-next-1m')).toBeInTheDocument();
    expect(screen.getByTestId('followup-next-2m')).toBeInTheDocument();
    expect(screen.getByTestId('followup-next-custom')).toBeInTheDocument();
  });

  it('computes today+7 days and calls visit_set_next_followup when 7d is chosen', async () => {
    // Anchor the clock so the computed date is deterministic: today = 16-10-2026
    // -> +7d = 23-10-2026. The command receives an RFC3339 date.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TODAY_ISO));
    renderFollowup();

    await vi.waitFor(() =>
      expect(screen.getByTestId('followup-next-7d')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('followup-next-7d'));

    await vi.waitFor(() => expect(setNextFollowup).toHaveBeenCalledTimes(1));
    const arg = setNextFollowup.mock.calls[0]![0];
    expect(arg.visitId).toBe('v-f1');
    expect(arg.nextFollowupOn).toContain('2026-10-23');
  });

  it('computes today+1 month when 1m is chosen', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TODAY_ISO));
    renderFollowup();

    await vi.waitFor(() =>
      expect(screen.getByTestId('followup-next-1m')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('followup-next-1m'));

    await vi.waitFor(() => expect(setNextFollowup).toHaveBeenCalledTimes(1));
    const arg = setNextFollowup.mock.calls[0]![0];
    expect(arg.nextFollowupOn).toContain('2026-11-16');
  });

  it('sets next_followup_on from a typed custom date', async () => {
    renderFollowup();
    const custom = (await screen.findByTestId(
      'followup-next-custom',
    )) as HTMLInputElement;
    // A native date input carries an ISO (YYYY-MM-DD) value.
    fireEvent.change(custom, { target: { value: '2026-11-30' } });

    await waitFor(() => expect(setNextFollowup).toHaveBeenCalled());
    const arg = setNextFollowup.mock.calls.at(-1)![0];
    expect(arg.visitId).toBe('v-f1');
    expect(arg.nextFollowupOn).toContain('2026-11-30');
  });
});

describe('FollowupVisit (S09) — autosave 2s + blur (VIS-002/003, CASE-005)', () => {
  it('autosaves the full follow-up payload within the 2s debounce', async () => {
    // fireEvent + fake timers (NOT user.type) to avoid the known userEvent x
    // fake-timer deadlock. Changing the observations field opens the debounce.
    vi.useFakeTimers();
    renderFollowup();

    await vi.waitFor(() =>
      expect(screen.getByTestId('followup-complaint-1')).toBeInTheDocument(),
    );

    const observations = screen.getByTestId('followup-observations') as
      | HTMLTextAreaElement
      | HTMLInputElement;
    fireEvent.change(observations, { target: { value: 'Much improved' } });

    // No autosave before the debounce elapses.
    expect(autosave).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);

    await vi.waitFor(() => expect(autosave).toHaveBeenCalledTimes(1));
    const arg = autosave.mock.calls[0]![0];
    // The M3-A visit_autosave contract carries every follow-up field.
    expect(arg.visitId).toBe('v-f1');
    // The visit type must be the backend wire value 'follow_up' (NOT 'followup')
    // — the backend validate_visit_type rejects 'followup', which silently broke
    // autosave in the first build. Assert the exact value, not just presence.
    expect(arg.type).toBe('follow_up');
    expect(arg).toHaveProperty('complaintStatusJson');
    expect(arg).toHaveProperty('improvementPctJson');
    expect(arg).toHaveProperty('remedyResponse');
    expect(arg).toHaveProperty('vitalsJson');
    expect(arg.observations).toContain('Much improved');
  });

  it('includes the chosen per-complaint status in complaint_status_json on autosave', async () => {
    const user = userEvent.setup();
    renderFollowup();
    const status1 = await screen.findByTestId('followup-status-1');
    await user.click(within(status1).getByRole('button', { name: /better/i }));

    // Blur flushes the pending autosave before the 2s window (CASE-005).
    await user.tab();

    await waitFor(() => expect(autosave).toHaveBeenCalled());
    const arg = autosave.mock.calls.at(-1)![0];
    // The complaint key c1 is recorded as Better in the status JSON.
    expect(arg.complaintStatusJson).toMatch(/better/i);
  });
});

describe('FollowupVisit (S09) — scope guardrails (R-DEL-002, ADR-0002)', () => {
  it('does not render the progress chart (VIS-007 is R9, flagged off)', async () => {
    renderFollowup();
    await screen.findByTestId('followup-complaint-1');
    expect(
      screen.queryByTestId('followup-progress-chart'),
    ).not.toBeInTheDocument();
  });

  it('renders a Prescribe button that is present but disabled (S13 is R4 — no dead end)', async () => {
    renderFollowup();
    const prescribe = await screen.findByTestId('followup-prescribe');
    // Present for layout coherence, but inert until R4: native disabled +
    // aria-disabled, so it is not a dead-end navigation (ADR-0002).
    expect(prescribe).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// HC-MVP1-M3ux — UX1 back navigation (RED).
//
// FollowupVisit (S09) must expose a first-class Back control
// (`followup-back`) that calls an `onBack` prop, so the shell can route the
// doctor back to the patient dashboard (00-conventions §3; Back never
// discards data — the follow-up form already autosaves). The current build
// renders only an `sr-only` affordance wired to `onOpenPatient`, so clicking a
// visible `followup-back` does NOT invoke `onBack` and these FAIL.
// ---------------------------------------------------------------------------
describe('FollowupVisit (S09) — UX1 back navigation (HC-MVP1-M3ux)', () => {
  it('renders a Back control that calls the onBack prop', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    renderFollowup({ onBack });
    const back = await screen.findByTestId('followup-back');

    await user.click(back);

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
