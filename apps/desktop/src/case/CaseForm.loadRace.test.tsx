// <CaseForm /> load race regression (M3-RWv6 flake,
// .worklog/HC-MVP1-M3/handoffs/M3-RWv6-flake.md).
//
// useEditor(..., [doc !== null]) replaces the pre-load (EMPTY) editor with the
// loaded one in a passive effect that runs AFTER the commit that first renders
// the loaded form. When React's scheduler yields between that commit and the
// effect (CPU load), the form used to be live while backed by the empty
// editor: "Add new complaint" then named the empty doc and the autosave
// carried ONE complaint, overwriting the opened case.
//
// This test FORCES that interleaving: `performance.now` (React scheduler's
// clock) jumps 50 ms per read so the scheduler yields after every task, and a
// MutationObserver acts the instant `case-form` enters the DOM (a microtask
// between the commit task and the passive-effect task).
//
// FAKES: ONLY the generated typed bindings `@/bindings` (R-TEST-002).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const { openOrCreate, autosave, listAttachments } = vi.hoisted(() => ({
  openOrCreate: vi.fn(),
  autosave: vi.fn(),
  listAttachments: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    caseVisitOpenOrCreate: openOrCreate,
    caseVisitAutosave: autosave,
    visitPickReportFile: vi.fn(),
    visitAttachReport: vi.fn(),
    visitListAttachments: listAttachments,
    visitOpenAttachment: vi.fn(),
    visitDeleteAttachment: vi.fn(),
    visitSetNextFollowup: vi.fn(),
  },
}));

import { CaseForm } from './CaseForm';

/** A v2 single-complaint journal the backend returns on open (upcast to v3). */
function journalDoc(): unknown {
  return {
    schema: 'case-journal',
    version: 2,
    complaints: [
      {
        id: 'cc1',
        title: 'Headache',
        entries: [{ entry_date: '2026-10-02', visit_id: 'v-1', blocks: [] }],
      },
    ],
    sections: {},
  };
}

beforeEach(() => {
  openOrCreate.mockReset();
  openOrCreate.mockResolvedValue({
    visitId: 'v-1',
    templateId: 'journal_default',
    dataJson: JSON.stringify(journalDoc()),
    vitalsJson: '{}',
    visitAt: '2026-10-02T09:00:00Z',
    nextFollowupOn: '2026-11-02',
  });
  autosave.mockReset();
  autosave.mockResolvedValue({ savedAt: '2026-10-02T09:00:30Z' });
  listAttachments.mockReset();
  listAttachments.mockResolvedValue({ attachments: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function complaintCount(call: unknown[] | undefined): number {
  if (call === undefined) throw new Error('caseVisitAutosave was never called');
  const saved = JSON.parse((call[0] as { dataJson: string }).dataJson) as {
    complaints: unknown[];
  };
  return saved.complaints.length;
}

describe('CaseForm — load race (M3-RWv6 flake)', () => {
  it('never exposes a live form backed by the pre-load empty editor, so Add new complaint right after load keeps the opened complaint', async () => {
    // Make React's scheduler yield after every task (its clock is
    // performance.now), opening the commit -> editor-swap window.
    let clock = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 50));

    let editorTextAtFirstForm: string | null = null;
    const observer = new MutationObserver(() => {
      if (editorTextAtFirstForm !== null) return;
      if (document.querySelector('[data-testid="case-form"]') === null) return;
      const editorRegion = document.querySelector(
        '[data-testid="case-form-editor-cc1"]',
      );
      editorTextAtFirstForm = editorRegion?.textContent ?? '';
      const title = document.querySelector(
        '[data-testid="case-form-complaint-title"]',
      );
      const add = document.querySelector(
        '[data-testid="case-form-add-complaint"]',
      );
      if (title === null || add === null) return;
      fireEvent.change(title, { target: { value: 'Acidity' } });
      fireEvent.click(add);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    try {
      render(
        <CaseForm patientId="p-123" visitId="v-1" sex="male" ageYears={34} />,
      );
      await waitFor(() => expect(autosave).toHaveBeenCalled());
    } finally {
      observer.disconnect();
    }

    // The first time the form is live, its editor already holds the case.
    expect(editorTextAtFirstForm).toContain('Headache');
    // Every save carries the opened complaint plus the new one, never only 1.
    for (const call of autosave.mock.calls) {
      expect(complaintCount(call)).toBeGreaterThanOrEqual(2);
    }
  });
});
