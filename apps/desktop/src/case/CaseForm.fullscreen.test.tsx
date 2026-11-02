// C9 regression — the case / follow-up body must fill the window, never sit in
// a narrow centered column at fullscreen. Design: docs/adr/0018-case-big-box-
// dated-log.md (cross-cutting §UX shell: "the case body uses the full content
// width instead of a narrow centered column"), docs/ui/S08-case-form.md
// ("Full-width content area, adaptive to the window (no narrow centered
// column); usable down to 1280x720 at Large font").
//
// WHAT THIS PINS: the confirmed C9 defect is a narrow centered column at
// FULLSCREEN, which a capping `max-w-*` on an ANCESTOR (or a `max-w-*` without
// `mx-auto`, or an inline width) produces just as well. So this test walks the
// WHOLE ancestor chain from the full-width content region up to the screen root
// and fails if ANY ancestor caps the width to a narrow fixed column OR centers
// it, and asserts the content region is a width-filling flex child (`flex-1`).
//
// RWv2: the content region is the single rich-editor wrapper `case-form-content`
// (the removed v2 journal box no longer exists), and for the follow-up it is
// `followup-content`.
//
// CUT: the REAL <CaseForm /> and <FollowupVisit />. The ONLY faked thing is the
// generated binding `@/bindings` (a dependency, R-TEST-002).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const {
  caseOpenOrCreate,
  caseAutosave,
  caseListAttachments,
  createFollowup,
  followupAutosave,
  setNextFollowup,
} = vi.hoisted(() => ({
  caseOpenOrCreate: vi.fn(),
  caseAutosave: vi.fn(),
  caseListAttachments: vi.fn(),
  createFollowup: vi.fn(),
  followupAutosave: vi.fn(),
  setNextFollowup: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    caseVisitOpenOrCreate: caseOpenOrCreate,
    caseVisitAutosave: caseAutosave,
    visitListAttachments: caseListAttachments,
    visitCreateFollowup: createFollowup,
    visitAutosave: followupAutosave,
    visitSetNextFollowup: setNextFollowup,
  },
}));

import { CaseForm } from '@/case/CaseForm';
import { FollowupVisit } from '@/visit/FollowupVisit';

/** A v2 case-journal doc with one complaint + one dated entry. */
function journalDoc() {
  return {
    schema: 'case-journal',
    version: 2,
    complaints: [
      {
        id: 'cc1',
        title: 'Headache',
        entries: [
          {
            entry_date: '2026-10-16',
            visit_id: 'v-1',
            blocks: [
              { kind: 'text', id: 'b1', text: 'Throbbing right temple' },
            ],
          },
        ],
      },
    ],
    sections: {},
  };
}

/**
 * A class that caps width to a NARROW fixed column (`max-w-*`, excluding the
 * benign `max-w-full` / `max-w-none`), i.e. the thing that leaves a narrow
 * centered column at fullscreen.
 */
function capsNarrowWidth(cls: string): boolean {
  return /\bmax-w-(?!full\b|none\b)[^\s]+/.test(cls);
}

/** A class that horizontally centers a block (`mx-auto`). */
function centersBlock(cls: string): boolean {
  return /\bmx-auto\b/.test(cls);
}

/**
 * Walk from `el` up to (and including) `root`, returning the first ancestor
 * that caps the width to a narrow column (which, combined with the layout,
 * parks a narrow centered column at fullscreen). Null when none caps width.
 */
function narrowCappingAncestor(
  el: HTMLElement,
  root: HTMLElement,
): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur !== null) {
    const cls = cur.className ?? '';
    const inlineMaxW =
      cur.style.maxWidth !== '' && cur.style.maxWidth !== 'none';
    if (capsNarrowWidth(cls) || centersBlock(cls) || inlineMaxW) {
      return cur;
    }
    if (cur === root) break;
    cur = cur.parentElement;
  }
  return null;
}

function renderCase() {
  return render(
    <CaseForm patientId="p-123" visitId="v-1" sex="male" ageYears={34} />,
  );
}

function renderFollowup() {
  return render(
    <FollowupVisit patientId="p-123" visitId="v-f1" prevVisitId="v-prev" />,
  );
}

beforeEach(() => {
  caseOpenOrCreate.mockReset();
  caseOpenOrCreate.mockResolvedValue({
    visitId: 'v-1',
    templateId: 'journal_default',
    dataJson: JSON.stringify(journalDoc()),
    vitalsJson: '{}',
    visitAt: '2026-10-16T10:42:00Z',
    nextFollowupOn: null,
  });
  caseAutosave.mockReset();
  caseAutosave.mockResolvedValue({ savedAt: '2026-10-16T10:42:30Z' });
  caseListAttachments.mockReset();
  caseListAttachments.mockResolvedValue({ attachments: [] });

  createFollowup.mockReset();
  createFollowup.mockResolvedValue({
    visitId: 'v-f1',
    visitAt: '2026-10-16T10:42:00Z',
    prevComplaints: [{ key: 'c1', text: 'Headache', location: 'right temple' }],
  });
  followupAutosave.mockReset();
  followupAutosave.mockResolvedValue({ savedAt: '2026-10-16T10:42:30Z' });
  setNextFollowup.mockReset();
  setNextFollowup.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('C9 — case/follow-up content fills the window (no narrow centered column)', () => {
  it('the case content area has no width-capping / centering ancestor up to the screen', async () => {
    renderCase();
    const screenRoot = await screen.findByTestId('case-form');
    // RWv2: the removed v2 journal box no longer exists; the single rich editor
    // lives in the full-width content region `case-form-content`. C9 is pinned by
    // walking that region's ancestor chain for any narrow/centering cap.
    const content = await screen.findByTestId('case-form-content');

    const offender = narrowCappingAncestor(content, screenRoot);
    expect(
      offender,
      offender === null
        ? ''
        : `a narrow/centered ancestor caps the case content (C9): "${offender.getAttribute('data-testid') ?? offender.tagName}" class="${offender.className}"`,
    ).toBeNull();

    // The content region itself is a width-FILLING flex child (fills the window
    // at any resolution rather than sitting in a fixed column).
    expect(/\bflex-1\b/.test(content.className)).toBe(true);
  });

  it('the follow-up journal body has no width-capping / centering ancestor up to the screen', async () => {
    renderFollowup();
    const screenRoot = await screen.findByTestId('followup-screen');
    const content = await screen.findByTestId('followup-content');

    const offender = narrowCappingAncestor(content, screenRoot);
    expect(
      offender,
      offender === null
        ? ''
        : `a narrow/centered ancestor caps the follow-up body (C9): "${offender.getAttribute('data-testid') ?? offender.tagName}" class="${offender.className}"`,
    ).toBeNull();

    expect(/\bflex-1\b/.test(content.className)).toBe(true);
  });
});
