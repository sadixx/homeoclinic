// Regression test for E2E defect b15-r1-f1 (M3-RWv5 build-15), run against the
// REAL <CaseForm /> wired through caseRich.ts / caseRichEditor.ts / TipTap.
//
// On a fresh case, "Add new complaint" with a typed name names the leading
// complaint. caseRichEditor re-sets the whole doc with TipTap `setContent`,
// which does not emit onUpdate. Before the fix, the derived structure state
// was never refreshed, so `case-form-complaint-empty-prompt` stayed visible and
// the complaint remove (x) control did not appear until the next edit.
//
// The checks run straight after the click, with no further edit or waitFor
// that a later editor update could satisfy. The only fake is the typed
// bindings dependency. No clinical/PII values are logged.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

beforeEach(() => {
  openOrCreate.mockReset();
  openOrCreate.mockResolvedValue({
    visitId: 'v-1',
    templateId: 'journal_default',
    dataJson: '',
    vitalsJson: '{}',
    visitAt: '2026-10-24T09:00:00Z',
    nextFollowupOn: null,
  });
  autosave.mockReset();
  autosave.mockResolvedValue({ savedAt: '2026-10-24T09:00:30Z' });
  listAttachments.mockReset();
  listAttachments.mockResolvedValue({ attachments: [] });
  patientListAttachments.mockReset();
  patientListAttachments.mockResolvedValue({ attachments: [] });
  pickReportFile.mockReset();
  pickReportFile.mockResolvedValue({ sourcePath: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function complaintRemoveControls(): Element[] {
  return Array.from(
    screen
      .getByTestId('case-form')
      .querySelectorAll('[data-testid^="case-form-complaint-remove-"]'),
  );
}

describe('CaseForm b15-r1-f1: naming the leading complaint refreshes structure', () => {
  it('hides the empty prompt and shows the remove control immediately after Add new complaint', async () => {
    render(
      <CaseForm patientId="p-123" visitId="v-1" sex="male" ageYears={34} />,
    );
    const region = await screen.findByTestId(
      'case-form-editor-cc1',
      undefined,
      {
        timeout: 1500,
      },
    );
    await waitFor(() =>
      expect(region.querySelector('.ProseMirror')).not.toBeNull(),
    );

    // Fresh case: the prompt is shown and no NAMED complaint can be removed
    // yet. The loaded spine keeps one unnamed placeholder complaint, so at most
    // one unlabelled remove control may exist (same contract as the E2E
    // case-rwv5-per-entry-tables C step). M3-RWv6 flake fix: the old "0
    // controls" check only held because findByTestId resolved while the form
    // was still backed by the pre-load EMPTY editor.
    expect(screen.getByTestId('case-form-complaint-empty-prompt')).toBeTruthy();
    const before = complaintRemoveControls();
    expect(before.length).toBeLessThanOrEqual(1);
    for (const b of before) {
      expect(b.getAttribute('aria-label') ?? '').not.toMatch(/Headache/);
    }

    fireEvent.change(screen.getByTestId('case-form-complaint-title'), {
      target: { value: 'Headache' },
    });
    fireEvent.click(screen.getByTestId('case-form-add-complaint'));

    // Immediately, with no further edit: the prompt is gone and the named
    // complaint's remove control is present.
    expect(screen.queryByTestId('case-form-complaint-empty-prompt')).toBeNull();
    const removes = complaintRemoveControls();
    expect(removes).toHaveLength(1);
    expect(removes[0]?.getAttribute('aria-label') ?? '').toMatch(/Headache/);
  });
});
