// RED tests for M3-RW Slice C — ADAPTIVE full-resolution layout on the
// follow-up visit (Slice C4). Design: docs/adr/0018-case-big-box-dated-log.md
// (cross-cutting §UX shell), docs/ui/S08-case-form.md S09 delta (the follow-up
// shares the same full-width journal shell as S08).
//
// CUT: the REAL <FollowupVisit /> (apps/desktop/src/visit/FollowupVisit.tsx).
// The ONLY faked thing is the generated binding `@/bindings` (a dependency,
// R-TEST-002), created with `vi.hoisted` (see FollowupVisit.test.tsx).
//
// Red-first state: the follow-up content area is not yet marked as an adaptive,
// full-width region — there is no `followup-content` region carrying
// `data-adaptive="true"`. So `findByTestId('followup-content')` rejects and
// these FAIL on the query, not at import. After hc-ui-dev makes the follow-up
// fill the full content width (no narrow centered column) these must pass.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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

/** True when the element's own class list caps width AND centers it. */
function isNarrowCenteredColumn(el: HTMLElement): boolean {
  const cls = el.className;
  return /\bmax-w-/.test(cls) && /\bmx-auto\b/.test(cls);
}

beforeEach(() => {
  createFollowup.mockReset();
  createFollowup.mockResolvedValue({
    visitId: 'v-f1',
    visitAt: '2026-10-16T10:42:00Z',
    prevComplaints: [{ key: 'c1', text: 'Headache', location: 'right temple' }],
  });
  autosave.mockReset();
  autosave.mockResolvedValue({ savedAt: '2026-10-16T10:42:30Z' });
  setNextFollowup.mockReset();
  setNextFollowup.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('FollowupVisit (S09) — adaptive full-width layout (Slice C4)', () => {
  it('exposes the follow-up body as a named adaptive content region', async () => {
    renderFollowup();
    await screen.findByTestId('followup-screen');
    const region = await screen.findByTestId('followup-content');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('data-adaptive', 'true');
  });

  it('does not cap the follow-up body to a narrow centered column', async () => {
    renderFollowup();
    await screen.findByTestId('followup-screen');
    const region = await screen.findByTestId('followup-content');
    expect(isNarrowCenteredColumn(region)).toBe(false);
  });
});
