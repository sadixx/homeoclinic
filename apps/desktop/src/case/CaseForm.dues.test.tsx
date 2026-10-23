// RED tests for M3-RW Slice C — DUES PLACEHOLDER on save (Slice C6). Design:
// docs/adr/0018-case-big-box-dated-log.md (cross-cutting §UX shell: "Dues auto-
// shown on save ... are PLACEHOLDERS (billing is R5 / M8, BILL-001..002)").
// The slice plan C6: render a clearly-labelled, disabled placeholder with a
// "Billing arrives in R5" tooltip (no dead end, R-DEL-002) — NO fake money /
// math / network.
//
// CUT: the REAL <CaseForm /> (apps/desktop/src/case/CaseForm.tsx). The ONLY
// faked thing is the generated binding `@/bindings` (a dependency, R-TEST-002),
// created with `vi.hoisted` (see CaseForm.journal.test.tsx). Autosave/force-
// save go through caseVisitAutosave; the dues placeholder must NOT call any
// billing binding.
//
// Red-first state: the case form has no dues area on save — there is no
// `case-form-dues-placeholder`. So `findByTestId` rejects and these FAIL on the
// query, not at import. After hc-ui-dev adds the labelled, disabled placeholder
// shown on save these pass.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
            blocks: [{ kind: 'text', id: 'b1', text: 'Throbbing' }],
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

describe('CaseForm (S08) — dues placeholder on save (Slice C6)', () => {
  it('shows a dues area once the visit is saved', async () => {
    const user = userEvent.setup();
    renderCase();
    await screen.findByTestId('case-form');

    // Force-flush the save (the explicit Save button).
    await user.click(screen.getByTestId('case-form-save'));
    await waitFor(() => expect(autosave).toHaveBeenCalled());

    expect(
      await screen.findByTestId('case-form-dues-placeholder'),
    ).toBeInTheDocument();
  });

  it('marks the dues area as a clearly-labelled PLACEHOLDER (billing is R5)', async () => {
    const user = userEvent.setup();
    renderCase();
    await screen.findByTestId('case-form');

    await user.click(screen.getByTestId('case-form-save'));
    await waitFor(() => expect(autosave).toHaveBeenCalled());

    const dues = await screen.findByTestId('case-form-dues-placeholder');
    // It must read as a placeholder, not a live billing figure (no money math).
    expect(dues.textContent ?? '').toMatch(/R5|later|placeholder|billing/i);
  });

  it('the dues placeholder has no enabled action (no fake money / no-op)', async () => {
    const user = userEvent.setup();
    renderCase();
    await screen.findByTestId('case-form');

    await user.click(screen.getByTestId('case-form-save'));
    await waitFor(() => expect(autosave).toHaveBeenCalled());

    const dues = await screen.findByTestId('case-form-dues-placeholder');
    // Any button inside the dues placeholder must be disabled (no dead end,
    // no live clearing before R5). If it renders no button that is also fine;
    // what must NOT exist is an enabled, clickable dues action.
    const buttons = dues.querySelectorAll('button');
    buttons.forEach((b) => expect(b).toBeDisabled());
  });
});
