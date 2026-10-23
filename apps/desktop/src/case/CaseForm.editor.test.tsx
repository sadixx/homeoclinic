// RED component tests for the M3-RWv2 case RICH-TEXT editor UI (Slices A–D +
// wiring). CUT: the NEW TipTap `@tiptap/react` editor inside the REAL
// <CaseForm /> (apps/desktop/src/case/CaseForm.tsx), wired THROUGH the already-
// landed pure module `apps/desktop/src/case/caseRich.ts` (v3 `case-rich`
// serialize/deserialize/upcast/builders + autosave kernel).
//
// Spec: docs/ui/S08-case-form.md · docs/adr/0019-case-rich-editor.md ·
// .worklog/HC-MVP1-M3/handoffs/M3-RWv2-serialization-v3.md.
//
// WHY THIS IS RED NOW (the R-DEL-003 gap): the backend + serialization half
// landed green (caseRich.ts, 226 vitest pass) but the EDITOR UI was not built —
// CaseForm is still the v2 plain-textarea JournalBox with a structured side-
// section rail, so caseRich.ts is dead code. Every assertion below targets the
// NEW editor surface per S08 (the `case-form-editor-<complaintId>` region, the
// record-family / numbered-section / two-column-family behaviour, the v3
// `case-rich` autosave payload) which the current CUT does not render, so the
// tests COMPILE (vitest transpiles) and FAIL on assertions — the red comes from
// the real CUT being incomplete, never from a stand-in.
//
// TIPTAP IN JSDOM: @tiptap/react renders, and its command chains (setHorizontal
// Rule / insertTable / insertContent) + getJSON work under jsdom (verified by a
// throwaway probe before writing these). No jsdom shim is required, so a
// missing editor surface FAILS the assertion rather than crashing at render.
//
// FAKES: ONLY the generated typed bindings `@/bindings` (a dependency,
// R-TEST-002), created with `vi.hoisted` so they are reachable in the hoisted
// `vi.mock` factory. TipTap and caseRich.ts are the REAL CUT, never faked.
//
// TIMERS: the 2 s autosave debounce is asserted with vi.useFakeTimers and
// fireEvent (NOT userEvent.type — userEvent v14 + fake timers deadlocks under
// React 18, see CaseForm.journal.test.tsx). Editor prose changes are driven by
// firing a native `input`/`beforeinput` on the contenteditable and, as a
// ProseMirror-safe fallback, by typing through the editor's own content region;
// both exercise the real onChange -> schedule-save path the UI wires.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';

const {
  openOrCreate,
  autosave,
  pickReportFile,
  attachReport,
  listAttachments,
  openAttachment,
  deleteAttachment,
  setNextFollowup,
} = vi.hoisted(() => ({
  openOrCreate: vi.fn(),
  autosave: vi.fn(),
  pickReportFile: vi.fn(),
  attachReport: vi.fn(),
  listAttachments: vi.fn(),
  openAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  setNextFollowup: vi.fn(),
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
  },
}));

import { CaseForm } from './CaseForm';

// Mirrors the production autosave debounce (CaseForm.tsx AUTOSAVE_DEBOUNCE_MS).
// Kept as a named local so the fake-timer advance reads as "advance one full
// debounce window" rather than a bare magic number.
const AUTOSAVE_DEBOUNCE_MS = 2000;

// A fresh v2 `case-journal` document the backend returns on open; the UI's v3
// read-time upcast (caseRich.parseCaseDoc) must turn this into a `case-rich`
// editor with one complaint ("cc1") and one dated entry (schema §8a).
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
  pickReportFile.mockReset();
  pickReportFile.mockResolvedValue({ sourcePath: '/tmp/lab.pdf' });
  attachReport.mockReset();
  attachReport.mockResolvedValue({
    attachmentId: 'att-1',
    mime: 'application/pdf',
    sha256: 'a'.repeat(64),
    originalName: 'lab.pdf',
    byteSize: 1000,
  });
  listAttachments.mockReset();
  listAttachments.mockResolvedValue({ attachments: [] });
  openAttachment.mockReset();
  openAttachment.mockResolvedValue({
    mime: 'application/pdf',
    originalName: 'lab.pdf',
    dataBase64: 'JVBERi0=',
  });
  deleteAttachment.mockReset();
  deleteAttachment.mockResolvedValue({ ok: true });
  setNextFollowup.mockReset();
  setNextFollowup.mockResolvedValue({ ok: true });
});

afterEach(() => {
  // Clear any debounce timer still pending from a fake-timer test BEFORE
  // switching back to real timers, so a stray autosave `setTimeout` can never
  // leak across the parallel suite into a later test's `autosave` mock.
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---- helpers over the mocked autosave payload ------------------------------

/** The parsed `data_json` of the most recent `caseVisitAutosave` call. */
function lastSavedJson(): Record<string, unknown> {
  const calls = autosave.mock.calls;
  const last = calls.at(-1);
  if (last === undefined) throw new Error('caseVisitAutosave was never called');
  return JSON.parse((last[0] as { dataJson: string }).dataJson) as Record<
    string,
    unknown
  >;
}

/** Deep-collect every node of `type` under an opaque ProseMirror JSON tree. */
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

/** All v3 ProseMirror docs across complaints of a parsed `case-rich` payload. */
function allDocs(saved: Record<string, unknown>): unknown[] {
  const complaints = saved['complaints'];
  if (!Array.isArray(complaints)) return [];
  return complaints.map((c) => (c as Record<string, unknown>)['doc']);
}

/** Collect every node of `type` across all complaint docs of the payload. */
function savedNodesOfType(
  saved: Record<string, unknown>,
  type: string,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const doc of allDocs(saved)) collectType(doc, type, out);
  return out;
}

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

/** The single contenteditable editor region for the first complaint (cc1). */
async function findEditorRegion(): Promise<HTMLElement> {
  // S08: the rich editor's content region carries testid
  // `case-form-editor-<complaintId>`; the first complaint is `cc1`. Bounded so
  // the RED (missing editor) fails fast instead of hanging the default timeout.
  return screen.findByTestId('case-form-editor-cc1', undefined, {
    timeout: 1500,
  });
}

/**
 * Synchronous editor-region getter for fake-timer tests: the component loads on
 * a resolved `caseVisitOpenOrCreate` microtask (awaited via the always-present
 * `case-form` root), after which the editor region must be present. `getByTestId`
 * throws immediately when it is missing, so the RED is a crisp assertion rather
 * than a 5 s fake-timer hang (awaiting `findBy*` under fake timers never ticks).
 */
async function getEditorRegionWithFakeTimers(): Promise<HTMLElement> {
  // The screen root renders once the open command resolves; flush microtasks.
  await vi.waitFor(() =>
    expect(screen.getByTestId('case-form')).toBeInTheDocument(),
  );
  return screen.getByTestId('case-form-editor-cc1');
}

/** The actual ProseMirror contenteditable inside the editor region. */
function proseMirrorEl(region: HTMLElement): HTMLElement {
  const pm =
    region.querySelector<HTMLElement>('.ProseMirror') ??
    region.querySelector<HTMLElement>('[contenteditable="true"]');
  if (pm === null)
    throw new Error('no ProseMirror contenteditable in editor region');
  return pm;
}

/** Type prose into the editor by firing the native input ProseMirror listens to. */
function typeProse(region: HTMLElement, text: string): void {
  const pm = proseMirrorEl(region);
  pm.focus();
  // ProseMirror reacts to beforeinput/input on the contenteditable.
  fireEvent.input(pm, { target: { textContent: text } });
  fireEvent(
    pm,
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    }),
  );
}

// ---------------------------------------------------------------------------
// (1) ONE TipTap rich editor per complaint; the old v2 plain box is gone.
// ---------------------------------------------------------------------------

describe('CaseForm rich editor — one WYSIWYG notepad per complaint (ADR 0019 #5)', () => {
  it('renders a TipTap editor content region for the complaint and NOT the old v2 plain textarea box', async () => {
    renderForm();
    const region = await findEditorRegion();
    expect(region).toBeInTheDocument();
    // a real contenteditable ProseMirror surface, not a <textarea> block
    expect(proseMirrorEl(region)).toBeInTheDocument();
    // the v2 plain journal box + its text-block textareas are removed
    expect(screen.queryByTestId('case-form-journal-box')).toBeNull();
    expect(screen.queryByTestId('case-block-cc1-b1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (2) typing prose -> autosave with a v3 case-rich payload whose text mirror
//     contains the typed words.
// ---------------------------------------------------------------------------

describe('CaseForm rich editor — autosave serialises v3 through caseRich.ts', () => {
  it('typing prose debounces and autosaves a case-rich v3 doc whose text mirror has the typed text', async () => {
    // ROOT-CAUSE FIX (R-DEL-003, 3rd attempt — NOT a timer-value tweak):
    // ProseMirror dispatches its `onUpdate` transaction on its OWN async view
    // cycle, OUTSIDE React's act()/event batching. So neither wrapping
    // `typeProse` in act() nor advancing fake timers can guarantee the
    // `onUpdate -> scheduleSave -> setTimeout(2 s)` chain has RUN before the
    // advance — under parallel load the update lands AFTER the advance, the
    // debounce timer does not exist yet to fire, and autosave is never called.
    // The two prior fixes tried to out-run that race by tweaking the advance;
    // this one SYNCHRONISES on the editor's own state transition instead.
    //
    // We keep REAL timers for the whole test (no vi.useFakeTimers here), so the
    // production 2 s debounce stays exactly as shipped (debounce intact) and
    // real-timer `findBy*`/`waitFor` can actually tick. After typing we WAIT for
    // the save-status to flip to its pending "Saving…" value — that flip is set
    // SYNCHRONOUSLY inside `scheduleSave`, the SAME call that registers the
    // debounce `setTimeout`. So once the pending marker is observable the timer
    // is known-registered: we are no longer racing the ProseMirror view cycle,
    // we are gated behind it. Only THEN do we wait for the real debounce to fire
    // and call autosave.
    renderForm();
    const region = await findEditorRegion();

    // Drive the real onChange -> scheduleSave path.
    typeProse(region, 'migraine worse at noon');

    // Synchronise on the pending transition: `scheduleSave` sets status->saving
    // and registers the 2 s setTimeout in the same synchronous call, so the
    // "Saving…" marker appearing PROVES the debounce timer is registered. This
    // real-timer `findByText` polls until ProseMirror's async onUpdate has run —
    // the deterministic gate that replaces the lost fake-timer/advance race.
    await screen.findByText('Saving…');

    // The debounce timer is now known-registered. Wait out the real 2 s debounce
    // and the flushSave microtask chain; a generous timeout covers the full
    // production debounce window plus the autosave promise under parallel load.
    await waitFor(() => expect(autosave).toHaveBeenCalled(), {
      timeout: AUTOSAVE_DEBOUNCE_MS + 2000,
    });

    const saved = lastSavedJson();
    expect(saved['schema']).toBe('case-rich');
    expect(saved['version']).toBe(3);
    // v3 §7: the top-level plain-text mirror (visit_fts) carries the doctor's words
    expect(typeof saved['text']).toBe('string');
    expect(saved['text'] as string).toContain('migraine worse at noon');
  });
});

// ---------------------------------------------------------------------------
// (3) Record vitals popup -> inserts an editable table with BP cells; a cell
//     edit is reflected in the next autosave payload.
// ---------------------------------------------------------------------------

describe('CaseForm — Record vitals inserts an editable in-document table (ADR 0019 #6/#7)', () => {
  it('opens a popup with systolic/diastolic/weight/height and inserts a vitals table with the BP cells', async () => {
    renderForm();
    await findEditorRegion();

    fireEvent.click(await screen.findByTestId('case-form-record-vitals'));
    const popup = await screen.findByTestId('case-form-vitals-popup');
    expect(popup).toHaveAttribute('role', 'dialog');

    fireEvent.change(screen.getByTestId('case-vitals-bp-sys'), {
      target: { value: '120' },
    });
    fireEvent.change(screen.getByTestId('case-vitals-bp-dia'), {
      target: { value: '80' },
    });
    fireEvent.change(screen.getByTestId('case-vitals-weight'), {
      target: { value: '68' },
    });
    fireEvent.change(screen.getByTestId('case-vitals-height'), {
      target: { value: '172' },
    });
    fireEvent.click(screen.getByTestId('case-form-record-vitals-confirm'));

    // The inserted table node appears in the editor DOM with the BP cells.
    const region = await findEditorRegion();
    await waitFor(() => expect(region.querySelector('table')).not.toBeNull());
    const table = region.querySelector('table') as HTMLTableElement;
    const tableText = table.textContent ?? '';
    expect(tableText).toContain('BP (sys)');
    expect(tableText).toContain('BP (dia)');
    expect(tableText).toContain('120');
    expect(tableText).toContain('80');
    // never a single combined 120/80 cell
    expect(tableText).not.toContain('120/80');
  });

  it('an inserted vitals cell is editable in place and the edit reaches the next autosave payload', async () => {
    vi.useFakeTimers();
    renderForm();
    await getEditorRegionWithFakeTimers();

    fireEvent.click(screen.getByTestId('case-form-record-vitals'));
    // The popup mounts synchronously on the click; a sync getBy is required
    // because `findBy*` polls on a real timer that never ticks under
    // vi.useFakeTimers (it would dead-hang to the 5 s test timeout).
    expect(screen.getByTestId('case-form-vitals-popup')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('case-vitals-bp-sys'), {
      target: { value: '120' },
    });
    fireEvent.change(screen.getByTestId('case-vitals-bp-dia'), {
      target: { value: '80' },
    });
    fireEvent.click(screen.getByTestId('case-form-record-vitals-confirm'));

    const region = await getEditorRegionWithFakeTimers();
    await vi.waitFor(() =>
      expect(region.querySelector('table')).not.toBeNull(),
    );

    // Edit a body cell in place (contenteditable cell), then let autosave fire.
    const cells = Array.from(region.querySelectorAll('td'));
    const sysCell = cells.find((c) => (c.textContent ?? '').includes('120'));
    expect(
      sysCell,
      'the systolic body cell must be present and editable',
    ).toBeDefined();
    (sysCell as HTMLElement).focus();
    fireEvent.input(sysCell as HTMLElement, { target: { textContent: '128' } });
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedJson();
    const vitalsTables = savedNodesOfType(saved, 'table').filter(
      (t) =>
        (t['attrs'] as Record<string, unknown> | undefined)?.['hcTableType'] ===
        'vitals',
    );
    expect(vitalsTables.length).toBeGreaterThanOrEqual(1);
    expect(flatText(vitalsTables[0])).toContain('128');
  });
});

// ---------------------------------------------------------------------------
// (4) Record family history popup: Maternal + Paternal tabs -> two-column table.
// ---------------------------------------------------------------------------

describe('CaseForm — Record family history inserts a two-column Maternal|Paternal table (ADR 0019 #7)', () => {
  it('has Maternal + Paternal tabs and inserts a two-column table carrying the entered values', async () => {
    renderForm();
    await findEditorRegion();

    fireEvent.click(await screen.findByTestId('case-form-record-family'));
    // Maternal + Paternal are independent tabs (S08 §D).
    const maternalTab = await screen.findByTestId('case-family-maternal');
    const paternalTab = await screen.findByTestId('case-family-paternal');
    expect(maternalTab).toBeInTheDocument();
    expect(paternalTab).toBeInTheDocument();

    // Enter Maternal then switch to Paternal and enter its value.
    fireEvent.click(maternalTab);
    fireEvent.change(screen.getByTestId('case-form-family-maternal-input'), {
      target: { value: 'Diabetes' },
    });
    fireEvent.click(paternalTab);
    fireEvent.change(screen.getByTestId('case-form-family-paternal-input'), {
      target: { value: 'Hypertension' },
    });
    fireEvent.click(screen.getByTestId('case-form-record-family-confirm'));

    const region = await findEditorRegion();
    await waitFor(() => {
      const famTable = Array.from(region.querySelectorAll('table')).find(
        (tbl) => (tbl.textContent ?? '').includes('Maternal'),
      );
      expect(
        famTable,
        'a two-column family-history table must be inserted',
      ).toBeDefined();
    });
    const famTable = Array.from(region.querySelectorAll('table')).find((tbl) =>
      (tbl.textContent ?? '').includes('Maternal'),
    ) as HTMLTableElement;
    const text = famTable.textContent ?? '';
    expect(text).toContain('Maternal');
    expect(text).toContain('Paternal');
    expect(text).toContain('Diabetes');
    expect(text).toContain('Hypertension');
    // a two-column table: the header row has exactly two cells
    const headerCells = famTable.querySelectorAll(
      'tr:first-child th, tr:first-child td',
    );
    expect(headerCells.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (5) Each inserted section: hr separator + sequential NUMBER that increments.
// ---------------------------------------------------------------------------

describe('CaseForm — inserted sections carry a hr separator and a monotonic number (S08 §Numbering, v3 §4)', () => {
  it('inserting two sections stamps hcSectionNo 1 then 2, each preceded by a horizontalRule', async () => {
    vi.useFakeTimers();
    renderForm();
    await getEditorRegionWithFakeTimers();

    // First section: vitals.
    fireEvent.click(screen.getByTestId('case-form-record-vitals'));
    // Sync getBy under fake timers (findBy would dead-hang; the popup is sync).
    expect(screen.getByTestId('case-form-vitals-popup')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('case-vitals-bp-sys'), {
      target: { value: '120' },
    });
    fireEvent.change(screen.getByTestId('case-vitals-bp-dia'), {
      target: { value: '80' },
    });
    fireEvent.click(screen.getByTestId('case-form-record-vitals-confirm'));

    // Second section: prescription (placeholder).
    fireEvent.click(screen.getByTestId('case-form-add-prescription'));
    // the prescription popup seeds the first row; confirm it
    const rxConfirm = screen.getByTestId('case-form-add-prescription-confirm');
    fireEvent.click(rxConfirm);

    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedJson();
    const sectionHeadings = savedNodesOfType(saved, 'heading').filter(
      (h) =>
        (h['attrs'] as Record<string, unknown> | undefined)?.['hcKind'] ===
        'section',
    );
    const numbers = sectionHeadings
      .map((h) => (h['attrs'] as Record<string, unknown>)['hcSectionNo'])
      .filter((n): n is number => typeof n === 'number')
      .sort((a, b) => a - b);
    expect(numbers).toContain(1);
    expect(numbers).toContain(2);
    // a number is never reused: the two sections have DISTINCT numbers
    expect(new Set(numbers).size).toBe(numbers.length);

    // each inserted section is preceded by a full-width horizontal rule.
    const rules = savedNodesOfType(saved, 'horizontalRule');
    expect(rules.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// (6) 'Add entry' inserts a dated-entry heading node.
// ---------------------------------------------------------------------------

describe('CaseForm — Add entry inserts a dated-entry heading (ADR 0019 #5)', () => {
  it('appends a heading node with hcKind=entry on Add entry', async () => {
    vi.useFakeTimers();
    renderForm();
    await getEditorRegionWithFakeTimers();

    fireEvent.click(screen.getByTestId('case-form-add-entry'));
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedJson();
    const entryHeadings = savedNodesOfType(saved, 'heading').filter(
      (h) =>
        (h['attrs'] as Record<string, unknown> | undefined)?.['hcKind'] ===
        'entry',
    );
    // the brand-new doc already has one dated entry; Add entry makes a SECOND.
    expect(entryHeadings.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// (7) 'Add prescription' inserts a table marked the R4 placeholder.
// ---------------------------------------------------------------------------

describe('CaseForm — Add prescription inserts a labelled R4 placeholder table (ADR 0019 #11)', () => {
  it('marks the inserted prescription table hcRxPlaceholder=true and shows the placeholder hint', async () => {
    vi.useFakeTimers();
    renderForm();
    await getEditorRegionWithFakeTimers();

    fireEvent.click(screen.getByTestId('case-form-add-prescription'));
    const rxConfirm = screen.getByTestId('case-form-add-prescription-confirm');
    fireEvent.click(rxConfirm);

    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedJson();
    const rxTables = savedNodesOfType(saved, 'table').filter(
      (t) =>
        (t['attrs'] as Record<string, unknown> | undefined)?.['hcTableType'] ===
        'prescription',
    );
    expect(rxTables.length).toBeGreaterThanOrEqual(1);
    expect(
      (rxTables[0]!['attrs'] as Record<string, unknown>)['hcRxPlaceholder'],
    ).toBe(true);

    // visible "not yet a prescription" hint (R4 boundary).
    expect(
      screen.getByTestId('case-form-rx-placeholder-hint'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (8) explicit Save force-flushes immediately and shows Saved.
// ---------------------------------------------------------------------------

describe('CaseForm — explicit Save force-flushes (CASE-005)', () => {
  it('Save flushes the pending autosave immediately (before the 2 s debounce) and shows Saved', async () => {
    vi.useFakeTimers();
    renderForm();
    const region = await getEditorRegionWithFakeTimers();

    typeProse(region, 'needs saving now');
    // do NOT wait the debounce; press Save to force-flush.
    fireEvent.click(screen.getByTestId('case-form-save'));
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const status = screen.getByTestId('case-form-save-status');
    await vi.waitFor(() => expect(status.textContent ?? '').toMatch(/Saved/i));
  });
});

// ---------------------------------------------------------------------------
// (9) Case summary button is ABSENT (ADR 0018 #5 carried into S08).
// ---------------------------------------------------------------------------

describe('CaseForm — Case summary entry point stays absent', () => {
  it('does not render a Case summary button', async () => {
    renderForm();
    await findEditorRegion();
    expect(screen.queryByTestId('case-form-case-summary')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (10) PAT-009 investigations lab-report uploader — the full lifecycle,
// RE-HOMED from the retired CaseForm.journal.test.tsx. In RWv2 the uploader is
// a permanent SIDE control (ADR 0019 #11), no longer gated behind a v2
// "Submitted" investigations tab; the `case-form-investigations-*` testids and
// the typed-binding contract are unchanged, so the coverage carries over
// verbatim against the rich-editor surface. Each test pins a real data effect
// (a binding call with the right args, a rendered row, an inline safe error),
// never status-only.
// ---------------------------------------------------------------------------

/** One attachment summary row as the backend returns it (PAT-009). */
function att(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attachmentId: 'att-1',
    mime: 'application/pdf',
    caption: null,
    originalName: 'lab-report.pdf',
    byteSize: 12_345,
    createdAt: '2026-10-02T09:00:00Z',
    ...overrides,
  };
}

describe('CaseForm — PAT-009 lab-report uploader survives the rich-editor rework', () => {
  it('renders the uploader side control and an empty state with no reports', async () => {
    listAttachments.mockResolvedValue({ attachments: [] });
    renderForm();
    await findEditorRegion();

    // The uploader is a permanent side control, not editor content.
    expect(
      await screen.findByTestId('case-form-investigations-upload'),
    ).toBeInTheDocument();
    expect(
      await screen.findByTestId('case-form-investigations-empty'),
    ).toHaveTextContent(/no reports attached/i);
  });

  it('lists the visit attachments with original name, a type badge and the caption', async () => {
    listAttachments.mockResolvedValue({
      attachments: [
        att({
          attachmentId: 'att-pdf',
          mime: 'application/pdf',
          originalName: 'cbc-report.pdf',
          caption: 'CBC 16 Oct',
        }),
        att({
          attachmentId: 'att-img',
          mime: 'image/png',
          originalName: 'ultrasound.png',
          caption: 'USG abdomen',
        }),
      ],
    });
    renderForm();
    await findEditorRegion();

    const list = await screen.findByTestId('case-form-investigations-list');
    expect(list).toBeInTheDocument();

    const item1 = screen.getByTestId('case-form-investigations-item-1');
    expect(item1).toHaveTextContent('cbc-report.pdf');
    expect(item1).toHaveTextContent('CBC 16 Oct');
    expect(
      within(item1).getByTestId('case-form-investigations-badge-1'),
    ).toHaveTextContent(/pdf/i);

    const item2 = screen.getByTestId('case-form-investigations-item-2');
    expect(item2).toHaveTextContent('ultrasound.png');
    expect(item2).toHaveTextContent('USG abdomen');
    expect(
      within(item2).getByTestId('case-form-investigations-badge-2'),
    ).toHaveTextContent(/image/i);

    // The empty state is gone once there are attachments.
    expect(
      screen.queryByTestId('case-form-investigations-empty'),
    ).not.toBeInTheDocument();
  });

  it('uploads a report: picks a file, attaches it for THIS visit, then reloads the list', async () => {
    pickReportFile.mockResolvedValue({ sourcePath: '/tmp/cbc-report.pdf' });
    attachReport.mockResolvedValue({
      attachmentId: 'att-pdf',
      mime: 'application/pdf',
      sha256: 'b'.repeat(64),
      originalName: 'cbc-report.pdf',
      byteSize: 2_048,
    });
    // First load empty; after the attach the reload returns the new row.
    listAttachments
      .mockResolvedValueOnce({ attachments: [] })
      .mockResolvedValue({
        attachments: [
          att({ attachmentId: 'att-pdf', originalName: 'cbc-report.pdf' }),
        ],
      });
    renderForm();
    await findEditorRegion();
    await screen.findByTestId('case-form-investigations-empty');

    fireEvent.click(screen.getByTestId('case-form-investigations-upload'));

    // The picker is asked for the path; the UI never builds one itself.
    await waitFor(() => expect(pickReportFile).toHaveBeenCalled());
    // The chosen path is handed to the typed attach command for this visit.
    await waitFor(() => expect(attachReport).toHaveBeenCalled());
    const arg = attachReport.mock.calls[0]![0] as {
      visitId: string;
      sourcePath: string;
    };
    expect(arg.visitId).toBe('v-1');
    expect(arg.sourcePath).toBe('/tmp/cbc-report.pdf');

    // After the attach the list reloads and the new report appears.
    const item = await screen.findByTestId('case-form-investigations-item-1');
    expect(item).toHaveTextContent('cbc-report.pdf');
  });

  it('does not attach when the file picker is cancelled', async () => {
    pickReportFile.mockResolvedValue({ sourcePath: null });
    listAttachments.mockResolvedValue({ attachments: [] });
    renderForm();
    await findEditorRegion();
    await screen.findByTestId('case-form-investigations-empty');

    fireEvent.click(screen.getByTestId('case-form-investigations-upload'));

    await waitFor(() => expect(pickReportFile).toHaveBeenCalled());
    expect(attachReport).not.toHaveBeenCalled();
    // Still the empty state, no error.
    expect(
      screen.getByTestId('case-form-investigations-empty'),
    ).toBeInTheDocument();
  });

  it('opens an attachment through visit_open_attachment', async () => {
    listAttachments.mockResolvedValue({
      attachments: [att({ attachmentId: 'att-img', mime: 'image/png' })],
    });
    openAttachment.mockResolvedValue({
      mime: 'image/png',
      originalName: 'ultrasound.png',
      dataBase64: 'iVBORw0KGgo=',
    });
    renderForm();
    await findEditorRegion();
    await screen.findByTestId('case-form-investigations-item-1');

    fireEvent.click(screen.getByTestId('case-form-investigations-open-1'));

    await waitFor(() =>
      expect(openAttachment).toHaveBeenCalledWith({ attachmentId: 'att-img' }),
    );
  });

  it('removes an attachment after a confirm, then reloads the list', async () => {
    listAttachments
      .mockResolvedValueOnce({
        attachments: [att({ attachmentId: 'att-pdf' })],
      })
      .mockResolvedValue({ attachments: [] });
    renderForm();
    await findEditorRegion();
    await screen.findByTestId('case-form-investigations-item-1');

    // Remove asks for confirmation first (NFR-035, no accidental data loss).
    fireEvent.click(screen.getByTestId('case-form-investigations-remove-1'));
    const confirm = await screen.findByTestId(
      'case-form-investigations-remove-confirm',
    );
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(deleteAttachment).toHaveBeenCalledWith({
        attachmentId: 'att-pdf',
      }),
    );
    // The list reloads to the now-empty state.
    await screen.findByTestId('case-form-investigations-empty');
  });

  it('does not delete when the remove confirm is cancelled', async () => {
    listAttachments.mockResolvedValue({
      attachments: [att({ attachmentId: 'att-pdf' })],
    });
    renderForm();
    await findEditorRegion();
    await screen.findByTestId('case-form-investigations-item-1');

    fireEvent.click(screen.getByTestId('case-form-investigations-remove-1'));
    await screen.findByTestId('case-form-investigations-remove-confirm');
    fireEvent.click(
      screen.getByTestId('case-form-investigations-remove-cancel'),
    );

    expect(deleteAttachment).not.toHaveBeenCalled();
    // The attachment is still listed.
    expect(
      screen.getByTestId('case-form-investigations-item-1'),
    ).toBeInTheDocument();
  });

  it('shows an inline safe error (no path / stack) when attach fails with a typed error', async () => {
    pickReportFile.mockResolvedValue({ sourcePath: '/tmp/notes.txt' });
    listAttachments.mockResolvedValue({ attachments: [] });
    // The backend rejects an unsupported type with a UserFacingError.
    attachReport.mockRejectedValue({
      code: 'validation',
      message: 'That file type is not supported.',
      suggestedAction: 'Attach a PDF or image (PNG/JPEG/WebP).',
    });
    renderForm();
    await findEditorRegion();
    await screen.findByTestId('case-form-investigations-empty');

    fireEvent.click(screen.getByTestId('case-form-investigations-upload'));

    const err = await screen.findByTestId('case-form-investigations-error');
    expect(err).toHaveTextContent(/not supported/i);
    // The message is the typed, safe message — never a raw path / stack trace.
    expect(err).not.toHaveTextContent('/tmp/notes.txt');
  });

  it('supports multiple reports (ultrasound, CT, lab PDF) in the list', async () => {
    listAttachments.mockResolvedValue({
      attachments: [
        att({
          attachmentId: 'a1',
          mime: 'image/jpeg',
          originalName: 'usg.jpg',
        }),
        att({ attachmentId: 'a2', mime: 'image/png', originalName: 'ct.png' }),
        att({
          attachmentId: 'a3',
          mime: 'application/pdf',
          originalName: 'lab.pdf',
        }),
      ],
    });
    renderForm();
    await findEditorRegion();

    await screen.findByTestId('case-form-investigations-item-1');
    expect(
      screen.getByTestId('case-form-investigations-item-2'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('case-form-investigations-item-3'),
    ).toHaveTextContent('lab.pdf');
  });
});

// ---------------------------------------------------------------------------
// (11) Restored-document round-trip (kill-restore-equivalent, RE-HOMED from the
// retired journal round-trip): a populated v2 document opens, upcasts to the
// rich editor, and a prose edit autosaves a v3 `case-rich` payload that still
// carries the restored content — so a killed-mid-typing session loses nothing
// (CASE-005). This replaces the obsolete v2 lossless round-trip (which asserted
// the removed v2 journal shape); here we assert the v3 doctor-visible effect.
// ---------------------------------------------------------------------------

/** A populated v2 doc: one complaint, prose + a vitals table, a BP already set. */
function populatedJournalDoc(): unknown {
  return {
    schema: 'case-journal',
    version: 2,
    complaints: [
      {
        id: 'cc1',
        title: 'Headache',
        entries: [
          {
            entry_date: '2026-10-02',
            visit_id: 'v-1',
            blocks: [
              {
                kind: 'text',
                id: 'b1',
                text: 'Throbbing right temple, 3 yrs, gradual onset.',
              },
              {
                kind: 'table',
                id: 'b2',
                table_type: 'vitals',
                columns: ['BP (sys)', 'BP (dia)'],
                rows: [['120', '80']],
              },
            ],
          },
        ],
      },
    ],
    sections: {},
  };
}

describe('CaseForm — restored v2 document round-trips into v3 autosave (CASE-005)', () => {
  it('opens a populated visit, upcasts it into the editor, and a Save serialises a v3 case-rich payload that retains the restored prose and vitals', async () => {
    openOrCreate.mockResolvedValue(
      openResp({ dataJson: JSON.stringify(populatedJournalDoc()) }),
    );
    renderForm();
    const region = await findEditorRegion();

    // The restored prose + vitals are present in the editor on open (the
    // v2->v3 upcast worked and the editor mounted the restored document).
    await waitFor(() =>
      expect(region.textContent ?? '').toContain('Throbbing right temple'),
    );
    expect(region.querySelector('table')).not.toBeNull();

    // Force-flush (explicit Save). This serialises the LIVE editor document —
    // the same path a killed-mid-session autosave takes — without mutating the
    // restored content, so the payload must still carry everything that was
    // restored (nothing lost on reopen; CASE-005).
    fireEvent.click(screen.getByTestId('case-form-save'));
    await waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedJson();
    expect(saved['schema']).toBe('case-rich');
    expect(saved['version']).toBe(3);
    // v3 §7 text mirror still carries the RESTORED prose (nothing lost).
    expect(saved['text'] as string).toContain('Throbbing right temple');
    // the restored vitals table survives the restore -> serialise round-trip.
    const vitalsTables = savedNodesOfType(saved, 'table').filter(
      (t) =>
        (t['attrs'] as Record<string, unknown> | undefined)?.['hcTableType'] ===
        'vitals',
    );
    expect(vitalsTables.length).toBeGreaterThanOrEqual(1);
    expect(flatText(vitalsTables[0])).toContain('120');
    expect(flatText(vitalsTables[0])).toContain('80');
  });
});
