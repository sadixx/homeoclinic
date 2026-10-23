// RED component tests for the M3-RWv3 COMPLAINT-SECTION restructure of the
// <CaseForm /> rich editor (ADR 0019 "Increment M3-RWv3";
// .worklog/HC-MVP1-M3/handoffs/M3-RWv3-complaint-sections.md; docs/ui/S08).
//
// CUT: the REAL `apps/desktop/src/case/CaseForm.tsx`, which today renders ONLY
// complaints[0] and a SINGLE "Add entry" button (`case-form-add-entry` with the
// `case.form.addEntry` label). RWv3 replaces that single button with THREE
// labelled buttons and renders N complaint sections. Every assertion below
// targets the NEW surface the current CUT does not yet render, so the tests
// COMPILE (vitest/esbuild) and FAIL on assertions — the RED is the real CUT
// being incomplete, never a stand-in.
//
// FAKES: ONLY the generated typed bindings `@/bindings` (a dependency,
// R-TEST-002), via `vi.hoisted` so they are reachable in the hoisted mock
// factory. TipTap + caseRich.ts are the REAL CUT. Timers follow the existing
// CaseForm.editor.test.tsx pattern (fireEvent + fake timers for the debounce).
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

const AUTOSAVE_DEBOUNCE_MS = 2000;

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

/** A v3 case-rich doc with TWO complaint sections (Headache, Acidity). */
function twoComplaintRichDoc(): unknown {
  const entry = (
    name: string,
    kind: 'first' | 'follow_up',
    date: string,
    display: string,
  ): unknown => ({
    type: 'heading',
    attrs: {
      level: 2,
      hcKind: 'entry',
      hcEntryKind: kind,
      hcComplaintName: name,
      hcDate: date,
      hcVisitId: 'v-1',
    },
    content: [{ type: 'text', text: display }],
  });
  return {
    schema: 'case-rich',
    version: 3,
    next_section_no: 1,
    sections: null,
    complaints: [
      {
        id: 'cc1',
        title: 'Headache',
        next_section_no: 1,
        doc: {
          type: 'doc',
          content: [
            entry('Headache', 'first', '2026-10-02', 'Headache — 02-10-2026'),
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Throbbing right temple.' }],
            },
          ],
        },
      },
      {
        id: 'cc2',
        title: 'Acidity',
        next_section_no: 1,
        doc: {
          type: 'doc',
          content: [
            entry('Acidity', 'first', '2026-10-20', 'Acidity — 20-10-2026'),
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Burning after meals.' }],
            },
          ],
        },
      },
    ],
  };
}

function openResp(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    visitId: 'v-1',
    templateId: 'journal_default',
    dataJson: JSON.stringify(journalDoc()),
    vitalsJson: '{}',
    visitAt: '2026-10-02T09:00:00Z',
    nextFollowupOn: '2026-11-02',
    ...overrides,
  };
}

function renderForm(
  props: Record<string, unknown> = {},
): ReturnType<typeof render> {
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
  openOrCreate.mockResolvedValue(openResp());
  autosave.mockReset();
  autosave.mockResolvedValue({ savedAt: '2026-10-02T09:00:30Z' });
  listAttachments.mockReset();
  listAttachments.mockResolvedValue({ attachments: [] });
});

afterEach(() => {
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---- helpers over the mocked autosave payload ------------------------------

function lastSavedJson(): Record<string, unknown> {
  const last = autosave.mock.calls.at(-1);
  if (last === undefined) throw new Error('caseVisitAutosave was never called');
  return JSON.parse((last[0] as { dataJson: string }).dataJson) as Record<
    string,
    unknown
  >;
}

function collectType(
  node: unknown,
  type: string,
  out: Record<string, unknown>[],
): void {
  if (node === null || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (n['type'] === type) out.push(n);
  const content = n['content'];
  if (Array.isArray(content))
    for (const c of content) collectType(c, type, out);
}

function savedNodesOfType(
  saved: Record<string, unknown>,
  type: string,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const complaints = saved['complaints'];
  if (Array.isArray(complaints)) {
    for (const c of complaints)
      collectType((c as Record<string, unknown>)['doc'], type, out);
  }
  return out;
}

function entryHeadings(
  saved: Record<string, unknown>,
): Record<string, unknown>[] {
  return savedNodesOfType(saved, 'heading').filter(
    (h) =>
      (h['attrs'] as Record<string, unknown> | undefined)?.['hcKind'] ===
      'entry',
  );
}

function attrs(node: Record<string, unknown>): Record<string, unknown> {
  return (node['attrs'] as Record<string, unknown>) ?? {};
}

async function waitForEditor(): Promise<HTMLElement> {
  return screen.findByTestId('case-form-editor-cc1', undefined, {
    timeout: 1500,
  });
}

async function getEditorFake(): Promise<HTMLElement> {
  await vi.waitFor(() =>
    expect(screen.getByTestId('case-form')).toBeInTheDocument(),
  );
  return screen.getByTestId('case-form-editor-cc1');
}

// ---------------------------------------------------------------------------
// C1. the THREE buttons replace the single "Add entry"
// ---------------------------------------------------------------------------

describe('CaseForm RWv3 — three complaint/entry buttons (spec §5)', () => {
  it('renders Add new entry / Add follow-up entry / Add new complaint and NOT the old single "Add entry" label', async () => {
    renderForm();
    await waitForEditor();

    const addEntry = screen.getByTestId('case-form-add-entry');
    const addFollowup = screen.getByTestId('case-form-add-followup-entry');
    const addComplaint = screen.getByTestId('case-form-add-complaint');

    expect(addEntry).toBeInTheDocument();
    expect(addFollowup).toBeInTheDocument();
    expect(addComplaint).toBeInTheDocument();

    // clear, accessible labels (not the single legacy "Add entry")
    expect(addEntry).toHaveTextContent(/add new entry/i);
    expect(addFollowup).toHaveTextContent(/add follow-up entry/i);
    expect(addComplaint).toHaveTextContent(/add new complaint/i);

    // the old single-button label is gone (replaced by "Add new entry")
    expect(screen.queryByText('Add entry')).toBeNull();

    // all three are real buttons (keyboard-focusable)
    for (const b of [addEntry, addFollowup, addComplaint]) {
      expect(b.tagName).toBe('BUTTON');
    }
  });
});

// ---------------------------------------------------------------------------
// C2. Add new complaint reads the name field -> new numbered complaint section
// ---------------------------------------------------------------------------

describe('CaseForm RWv3 — Add new complaint (spec §5)', () => {
  it('reads the complaint-name field and autosaves a NEW complaint section whose first entry header is "<name> — <today>"', async () => {
    vi.useFakeTimers();
    renderForm();
    await getEditorFake();

    // Name the new complaint in the complaint-title field, then add it.
    fireEvent.change(screen.getByTestId('case-form-complaint-title'), {
      target: { value: 'Acidity' },
    });
    fireEvent.click(screen.getByTestId('case-form-add-complaint'));

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedJson();
    const complaints = saved['complaints'] as Record<string, unknown>[];
    // a SECOND complaint section now exists (the opened doc had one)
    expect(complaints.length).toBeGreaterThanOrEqual(2);

    // its first entry is a FIRST entry headed with the new name + today's date
    const acidityFirst = entryHeadings(saved).find(
      (h) => attrs(h)['hcComplaintName'] === 'Acidity',
    );
    expect(
      acidityFirst,
      'the new complaint must start with a first entry headed by its name',
    ).toBeDefined();
    expect(attrs(acidityFirst!)['hcEntryKind']).toBe('first');

    // the fts mirror carries the new complaint name (searchable)
    expect(saved['text'] as string).toContain('Acidity');
  });
});

// ---------------------------------------------------------------------------
// C3. Add new entry -> a fresh FIRST dated entry under the current complaint
// ---------------------------------------------------------------------------

describe('CaseForm RWv3 — Add new entry (spec §5)', () => {
  it('appends a FIRST dated entry (no -follow-up) under the current complaint', async () => {
    vi.useFakeTimers();
    renderForm();
    await getEditorFake();

    fireEvent.click(screen.getByTestId('case-form-add-entry'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedJson();
    const firsts = entryHeadings(saved).filter(
      (h) => attrs(h)['hcEntryKind'] === 'first',
    );
    // the opened doc had one first entry; Add new entry makes a SECOND first entry
    expect(firsts.length).toBeGreaterThanOrEqual(2);
    // Add new entry never creates a follow-up
    const followups = entryHeadings(saved).filter(
      (h) => attrs(h)['hcEntryKind'] === 'follow_up',
    );
    expect(followups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// C4. Add follow-up entry -> a follow_up entry with the -follow-up header
// ---------------------------------------------------------------------------

describe('CaseForm RWv3 — Add follow-up entry (spec §5, option b)', () => {
  it('appends a follow_up entry under the SAME complaint, header carries the -follow-up suffix', async () => {
    vi.useFakeTimers();
    renderForm();
    await getEditorFake();

    fireEvent.click(screen.getByTestId('case-form-add-followup-entry'));
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedJson();
    const followup = entryHeadings(saved).find(
      (h) => attrs(h)['hcEntryKind'] === 'follow_up',
    );
    expect(
      followup,
      'a follow_up entry must be appended to the current complaint',
    ).toBeDefined();
    // it stays under the SAME (first) complaint — no new complaint created
    const complaints = saved['complaints'] as Record<string, unknown>[];
    expect(complaints).toHaveLength(1);
    // the follow-up header text carries the localisable -follow-up suffix
    const headerText = flatText(followup!);
    expect(headerText).toContain('-follow-up');
  });
});

/** Flatten every `text` leaf under a node into one space-joined string. */
function flatText(node: unknown): string {
  if (node === null || typeof node !== 'object') return '';
  const n = node as Record<string, unknown>;
  let s =
    n['type'] === 'text' && typeof n['text'] === 'string'
      ? (n['text'] as string)
      : '';
  const content = n['content'];
  if (Array.isArray(content)) for (const c of content) s += ` ${flatText(c)}`;
  return s;
}

// ---------------------------------------------------------------------------
// C5. opening TWO complaint sections renders both, numbered 1 and 2
// ---------------------------------------------------------------------------

describe('CaseForm RWv3 — renders N complaint sections (spec §2)', () => {
  it('renders both complaint sections (not only complaints[0]) numbered 1 and 2', async () => {
    openOrCreate.mockResolvedValue(
      openResp({ dataJson: JSON.stringify(twoComplaintRichDoc()) }),
    );
    renderForm();
    const region = await waitForEditor();

    // both complaint names appear in the rendered document
    await waitFor(() => {
      const text = region.textContent ?? '';
      expect(text).toContain('Headache');
      expect(text).toContain('Acidity');
    });
    const text = region.textContent ?? '';
    // numbered chronologically as "1. Headache" and "2. Acidity"
    expect(text).toContain('1. Headache');
    expect(text).toContain('2. Acidity');
    // second complaint's prose is visible (not clipped to complaints[0])
    expect(text).toContain('Burning after meals');
  });
});

// ---------------------------------------------------------------------------
// C6. Save with two complaints -> payload fts carries BOTH names (kill-restore)
// ---------------------------------------------------------------------------

describe('CaseForm RWv3 — Save serialises ALL complaints (CASE-005)', () => {
  it('an explicit Save with two complaints open writes a v3 payload whose text mirror carries both complaint names', async () => {
    openOrCreate.mockResolvedValue(
      openResp({ dataJson: JSON.stringify(twoComplaintRichDoc()) }),
    );
    renderForm();
    const region = await waitForEditor();
    await waitFor(() =>
      expect(region.textContent ?? '').toContain('Burning after meals'),
    );

    fireEvent.click(screen.getByTestId('case-form-save'));
    await waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedJson();
    expect(saved['schema']).toBe('case-rich');
    expect(saved['version']).toBe(3);
    // both complaints survive the serialise (reopen loses nothing)
    const complaints = saved['complaints'] as Record<string, unknown>[];
    expect(complaints.length).toBeGreaterThanOrEqual(2);
    const text = saved['text'] as string;
    expect(text).toContain('Headache');
    expect(text).toContain('Acidity');
    expect(text).toContain('Burning after meals');
  });
});

// ---------------------------------------------------------------------------
// C7. record-section tables still insert into the current entry
// ---------------------------------------------------------------------------

describe('CaseForm RWv3 — record tables still insert with multiple complaints (spec §5)', () => {
  it('Record vitals inserts a vitals table into the current entry', async () => {
    openOrCreate.mockResolvedValue(
      openResp({ dataJson: JSON.stringify(twoComplaintRichDoc()) }),
    );
    vi.useFakeTimers();
    renderForm();
    await getEditorFake();

    fireEvent.click(screen.getByTestId('case-form-record-vitals'));
    expect(screen.getByTestId('case-form-vitals-popup')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('case-vitals-bp-sys'), {
      target: { value: '120' },
    });
    fireEvent.change(screen.getByTestId('case-vitals-bp-dia'), {
      target: { value: '80' },
    });
    fireEvent.click(screen.getByTestId('case-form-record-vitals-confirm'));

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedJson();
    const vitals = savedNodesOfType(saved, 'table').filter(
      (t) => attrs(t)['hcTableType'] === 'vitals',
    );
    expect(vitals.length).toBeGreaterThanOrEqual(1);
    expect(flatText(vitals[0]!)).toContain('120');
    expect(flatText(vitals[0]!)).toContain('80');
    // the insert must not drop the OTHER complaint: both sections persist and
    // the second complaint's name still reaches the fts mirror (spec §2/§5).
    const complaints = saved['complaints'] as Record<string, unknown>[];
    expect(complaints.length).toBeGreaterThanOrEqual(2);
    expect(saved['text'] as string).toContain('Acidity');
  });
});
