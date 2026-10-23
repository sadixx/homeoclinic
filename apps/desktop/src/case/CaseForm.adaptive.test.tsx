// RED tests for M3-RW Slice C — ADAPTIVE full-resolution layout on the case
// journal (Slice C4). Design: docs/adr/0018-case-big-box-dated-log.md
// (cross-cutting §UX shell: "the journal uses the full content width instead of
// a narrow centered column"), docs/ui/S08-case-form.md ("Full-width content
// area, adaptive to the window (no narrow centered column); usable down to
// 1280 x 720 at Large font").
//
// CUT: the REAL <CaseForm /> (apps/desktop/src/case/CaseForm.tsx). The ONLY
// faked thing is the generated binding `@/bindings` (a dependency, R-TEST-002),
// created with `vi.hoisted` (the established pattern; see CaseForm.journal.test.tsx).
//
// Red-first state: the case journal is not yet marked as an adaptive, full-
// width content region — there is no `case-form-content` region carrying
// `data-adaptive="true"`. So `findByTestId('case-form-content')` rejects and
// these FAIL (on the query, not at import). After hc-ui-dev makes the journal
// fill the full content width (no narrow centered column) these must pass.
//
// The assertions encode the REQUIREMENT, not today's accidental styling: the
// content region must (a) exist as a named adaptive region and (b) never be a
// narrow centered column (`max-w-*` + `mx-auto`), so fullscreen fills the
// resolution rather than parking a narrow column in the middle.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { openOrCreate, autosave, listAttachments } = vi.hoisted(() => ({
  openOrCreate: vi.fn(),
  autosave: vi.fn(),
  listAttachments: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    caseVisitOpenOrCreate: openOrCreate,
    caseVisitAutosave: autosave,
    visitListAttachments: listAttachments,
  },
}));

import { CaseForm } from './CaseForm';

/** A v2 case-journal doc with one complaint + one dated entry + a text block. */
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

function renderCase(props: Record<string, unknown> = {}) {
  return render(
    <CaseForm
      patientId="p-123"
      visitId="v-1"
      sex="male"
      ageYears={34}
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
  openOrCreate.mockReset();
  openOrCreate.mockResolvedValue({
    visitId: 'v-1',
    templateId: 'journal_default',
    dataJson: JSON.stringify(journalDoc()),
    vitalsJson: '{}',
    visitAt: '2026-10-16T10:42:00Z',
    nextFollowupOn: null,
  });
  autosave.mockReset();
  autosave.mockResolvedValue({ savedAt: '2026-10-16T10:42:30Z' });
  listAttachments.mockReset();
  listAttachments.mockResolvedValue({ attachments: [] });
});

describe('CaseForm (S08) — adaptive full-width journal (Slice C4)', () => {
  it('exposes the journal as a named adaptive content region', async () => {
    renderCase();
    const region = await screen.findByTestId('case-form-content');
    expect(region).toBeInTheDocument();
    // Explicitly marked adaptive so the design intent is testable and the
    // region cannot silently regress to a fixed-width column.
    expect(region).toHaveAttribute('data-adaptive', 'true');
  });

  it('does not cap the journal to a narrow centered column', async () => {
    renderCase();
    const region = await screen.findByTestId('case-form-content');
    // The adaptive region itself must not be a narrow centered column.
    expect(isNarrowCenteredColumn(region)).toBe(false);
    // And the journal box inside it must not be centered-narrow either, so a
    // wide window / fullscreen fills the resolution (ADR 0018 §UX shell).
    const box = await screen.findByTestId('case-form-journal-box');
    expect(isNarrowCenteredColumn(box)).toBe(false);
  });
});
