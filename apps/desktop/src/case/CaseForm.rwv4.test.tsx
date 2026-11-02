// RED component tests for the M3-RWv4 refinement batch inside <CaseForm /> (ADR
// 0019 "Increment M3-RWv4"; .worklog/HC-MVP1-M3/handoffs/M3-RWv4-design.md;
// docs/ui/S08). Leader decision: "Lab reports & Scans" is a PANEL on the S07
// dashboard, NOT a new screen/route — so the editor-side Submitted flow here
// links/uploads via typed commands and the PANEL is tested separately in
// PatientDashboard.rwv4.test.tsx.
//
// CUT: the REAL `apps/desktop/src/case/CaseForm.tsx`, wired through the REAL
// caseRich.ts / caseRichEditor.ts. Every assertion targets the NEW RWv4 surface
// the current CUT does not yet render, so the tests COMPILE (vitest transpiles)
// and FAIL on assertions — the red comes from the real CUT being incomplete,
// never a stand-in.
//
// New en.json keys (e.g. the upload warning) are NOT referenced through `t()`
// here: `t`'s `StringKey` union would reject an absent key at TYPE-CHECK and turn
// the RED into a transpile ERROR. These tests assert via testids + rendered-text
// regex so a still-missing key fails the assertion, not the build.
//
// FAKES: ONLY the generated typed bindings `@/bindings` (a dependency,
// R-TEST-002) via `vi.hoisted`. TipTap + caseRich.ts are the REAL CUT. Timers
// follow the existing CaseForm.editor.test.tsx pattern (fireEvent + fake timers).
//
// NO production code is written by this file (hc-unit-tester, leaf role).

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

const AUTOSAVE_DEBOUNCE_MS = 2000;

/** A v3 case-rich doc: one complaint, one first entry + prose. */
function oneComplaintRichDoc(): unknown {
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
            {
              type: 'heading',
              attrs: {
                level: 2,
                hcKind: 'entry',
                hcEntryKind: 'first',
                hcComplaintName: 'Headache',
                hcDate: '2026-10-24',
                hcVisitId: 'v-1',
              },
              content: [{ type: 'text', text: 'Headache — 24-10-2026' }],
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Throbbing right temple.' }],
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
    dataJson: JSON.stringify(oneComplaintRichDoc()),
    vitalsJson: '{}',
    visitAt: '2026-10-24T09:00:00Z',
    nextFollowupOn: '2026-11-24',
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
  autosave.mockResolvedValue({ savedAt: '2026-10-24T09:00:30Z' });
  listAttachments.mockReset();
  listAttachments.mockResolvedValue({ attachments: [] });
  patientListAttachments.mockReset();
  patientListAttachments.mockResolvedValue({ attachments: [] });
  pickReportFile.mockReset();
  pickReportFile.mockResolvedValue({ sourcePath: '/tmp/cbc.pdf' });
  attachReport.mockReset();
  attachReport.mockResolvedValue({
    attachmentId: 'att-1',
    mime: 'application/pdf',
    sha256: 'abc',
    originalName: 'CBC-Test Patient 001-24-10-2026',
    byteSize: 10,
  });
  deleteAttachment.mockReset();
  deleteAttachment.mockResolvedValue({ ok: true });
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

function attrs(node: Record<string, unknown>): Record<string, unknown> {
  return (node['attrs'] as Record<string, unknown>) ?? {};
}

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

async function waitForEditor(): Promise<HTMLElement> {
  return screen.findByTestId('case-form-editor-cc1', undefined, {
    timeout: 1500,
  });
}

/**
 * Move the caret OFF the complaint heading and into entry body prose, so the
 * DEFECT-1 list guard allows the toggle. Sets the DOM selection into the last
 * paragraph text node inside the ProseMirror surface and dispatches
 * `selectionchange` (ProseMirror syncs its selection + fires onSelectionUpdate).
 */
async function placeCaretInProse(region: HTMLElement): Promise<void> {
  const pm =
    region.querySelector<HTMLElement>('.ProseMirror') ??
    region.querySelector<HTMLElement>('[contenteditable="true"]');
  if (pm === null) throw new Error('no ProseMirror contenteditable');
  const paras = pm.querySelectorAll('p');
  const para = paras[paras.length - 1];
  if (para === undefined) throw new Error('no paragraph to place the caret in');
  pm.focus();
  const target = para.firstChild ?? para;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  fireEvent.focus(pm);
}

async function getFormFake(): Promise<void> {
  await vi.waitFor(() =>
    expect(screen.getByTestId('case-form')).toBeInTheDocument(),
  );
}

// ===========================================================================
// A1 — complaint heading is a BOLD + UNDERLINED standout, name shown ONCE
// ===========================================================================

describe('CaseForm RWv4 A1 — complaint heading is a bold + underlined standout, name once', () => {
  it('renders the complaint heading via data-hc-kind="complaint" with a bold+underline hook, name once', async () => {
    const region = await (async () => {
      renderForm();
      return waitForEditor();
    })();

    await waitFor(() => {
      expect(region.querySelector('[data-hc-kind="complaint"]')).not.toBeNull();
    });
    const heading = region.querySelector(
      '[data-hc-kind="complaint"]',
    ) as HTMLElement;

    // bold + underlined: either an inline style or a class carries the standout
    const style = heading.getAttribute('style') ?? '';
    const cls = heading.className ?? '';
    const bold =
      /font-weight\s*:\s*(bold|[6-9]00)/i.test(style) ||
      /\bfont-(?:bold|semibold|black)\b|\bfont-weight-(?:bold|[6-9]00)\b/.test(
        cls,
      );
    const underlined =
      /text-decoration[^;]*underline/i.test(style) || /\bunderline\b/.test(cls);
    expect(bold, 'complaint heading must be bold').toBe(true);
    expect(underlined, 'complaint heading must be underlined').toBe(true);

    // the complaint name appears exactly ONCE in the heading (not duplicated)
    const headingText = heading.textContent ?? '';
    const occurrences = headingText.split('Headache').length - 1;
    expect(occurrences, 'complaint name shown once in its heading').toBe(1);
  });
});

// ===========================================================================
// A2 — "Add new entry" is GONE; the other two remain
// ===========================================================================

describe('CaseForm RWv4 A2 — "Add new entry" removed; follow-up + add-complaint remain', () => {
  it('does NOT render case-form-add-entry but DOES render add-followup-entry and add-complaint', async () => {
    renderForm();
    await waitForEditor();

    expect(screen.queryByTestId('case-form-add-entry')).toBeNull();
    expect(
      screen.queryByText(/add new entry/i),
      'the "Add new entry" affordance must be removed',
    ).toBeNull();

    expect(
      screen.getByTestId('case-form-add-followup-entry'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('case-form-add-complaint')).toBeInTheDocument();
  });
});

// ===========================================================================
// A3 — Word-style bullet / ordered list toolbar toggles produce list nodes
// ===========================================================================

describe('CaseForm RWv4 A3 — list formatting toolbar toggles bullet / ordered lists', () => {
  it('renders a format toolbar with bullet + ordered toggles', async () => {
    renderForm();
    await waitForEditor();
    expect(screen.getByTestId('case-form-format-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('case-form-format-bullet')).toBeInTheDocument();
    expect(screen.getByTestId('case-form-format-ordered')).toBeInTheDocument();
  });

  it('clicking the bullet toggle autosaves a doc containing a bulletList node', async () => {
    const region = await (async () => {
      renderForm();
      return waitForEditor();
    })();
    // DEFECT 1: the toggle only runs off the complaint heading — put the caret
    // in entry prose first (where lists are meant to work).
    await placeCaretInProse(region);

    fireEvent.click(screen.getByTestId('case-form-format-bullet'));
    await waitFor(() => expect(autosave).toHaveBeenCalled(), { timeout: 3000 });

    const saved = lastSavedJson();
    expect(savedNodesOfType(saved, 'bulletList').length).toBeGreaterThanOrEqual(
      1,
    );
  });

  // DEFECT 1 (M3-RWv4 build-12): the complaint-heading guard must only disable
  // the list buttons on a complaint heading — with the caret in entry prose the
  // buttons stay ENABLED so lists keep working in entry text. (The guard's
  // heading-side behaviour is proven in caseRichEditor.rwv4.test.ts over the
  // real editor selection.)
  it('the bullet + ordered buttons are enabled when the caret is in entry prose (lists still work there)', async () => {
    const region = await (async () => {
      renderForm();
      return waitForEditor();
    })();
    await placeCaretInProse(region);
    const bullet = screen.getByTestId(
      'case-form-format-bullet',
    ) as HTMLButtonElement;
    const ordered = screen.getByTestId(
      'case-form-format-ordered',
    ) as HTMLButtonElement;
    await waitFor(() => expect(bullet.disabled).toBe(false), { timeout: 3000 });
    expect(ordered.disabled).toBe(false);
    expect(bullet.getAttribute('aria-disabled')).toBe('false');
    expect(ordered.getAttribute('aria-disabled')).toBe('false');
  });
});

// ===========================================================================
// A7 — editor region is bounded + internally scrollable (not unbounded flex-1)
// ===========================================================================

describe('CaseForm RWv4 A7 — editor is bounded with internal overflow scroll', () => {
  it('the editor region has an overflow-y scroll class and the record toolbar + panel remain siblings in the DOM', async () => {
    const region = await (async () => {
      renderForm();
      return waitForEditor();
    })();

    const cls = region.className;
    // bounded internal scroll — NOT the old unbounded growth
    expect(
      /overflow-y-auto|overflow-auto|overflow-y-scroll/.test(cls),
      'editor region must declare its own vertical scroll',
    ).toBe(true);
    expect(
      /min-h-0/.test(cls),
      'editor region must allow shrinking within the flex column (min-h-0) so it bounds instead of growing',
    ).toBe(true);

    // the record toolbar + investigations panel still render (not overwritten)
    expect(screen.getByTestId('case-form-record-vitals')).toBeInTheDocument();
    expect(
      screen.getByTestId('case-form-investigations-upload'),
    ).toBeInTheDocument();
  });
});

// ===========================================================================
// B4 — a SECOND Record modalities APPENDS to the same modalities table
// ===========================================================================

describe('CaseForm RWv4 B4 — modalities is one appendable table per entry', () => {
  it('a second Record modalities appends a row to the SAME modalities table (count stays 1)', async () => {
    vi.useFakeTimers();
    renderForm();
    await getFormFake();

    const recordModalities = (factor: string): void => {
      fireEvent.click(screen.getByTestId('case-form-modalities'));
      fireEvent.change(screen.getByTestId('case-modalities-factor'), {
        target: { value: factor },
      });
      fireEvent.click(screen.getByTestId('case-form-modalities-confirm'));
    };

    recordModalities('Cold');
    recordModalities('Motion');

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedJson();
    const modalities = savedNodesOfType(saved, 'table').filter(
      (t) => attrs(t)['hcTableType'] === 'modalities',
    );
    // ONE modalities table for the entry...
    expect(modalities).toHaveLength(1);
    // ...carrying BOTH factor values
    const txt = flatText(modalities[0]!);
    expect(txt).toContain('Cold');
    expect(txt).toContain('Motion');
  });

  it('Record vitals still inserts its OWN table (vitals unchanged by the modalities append rule)', async () => {
    vi.useFakeTimers();
    renderForm();
    await getFormFake();

    fireEvent.click(screen.getByTestId('case-form-record-vitals'));
    fireEvent.change(screen.getByTestId('case-vitals-bp-sys'), {
      target: { value: '120' },
    });
    fireEvent.click(screen.getByTestId('case-form-record-vitals-confirm'));

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedJson();
    const vitals = savedNodesOfType(saved, 'table').filter(
      (t) => attrs(t)['hcTableType'] === 'vitals',
    );
    expect(vitals.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// C6 — remove control + confirm on complaints and entries
// ===========================================================================

describe('CaseForm RWv4 C6 — remove (x) control with confirm on complaints and entries', () => {
  it('exposes a remove control per complaint and per entry', async () => {
    renderForm();
    await waitForEditor();
    expect(
      screen.getByTestId('case-form-complaint-remove-cc1'),
    ).toBeInTheDocument();
    // at least one entry remove control (the first entry)
    expect(screen.getByTestId('case-form-entry-remove-1')).toBeInTheDocument();
  });

  it('clicking the complaint remove shows a confirm dialog; cancel keeps the complaint', async () => {
    renderForm();
    await waitForEditor();

    fireEvent.click(screen.getByTestId('case-form-complaint-remove-cc1'));
    expect(screen.getByTestId('case-form-remove-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('case-form-remove-cancel'));
    await waitFor(() =>
      expect(screen.queryByTestId('case-form-remove-dialog')).toBeNull(),
    );
    // complaint still present
    expect(
      screen.getByTestId('case-form-complaint-remove-cc1'),
    ).toBeInTheDocument();
  });

  it('confirming an entry remove drops that entry from the autosaved doc', async () => {
    vi.useFakeTimers();
    // open with a complaint that has TWO entries so a remove never drops to zero
    const doc = oneComplaintRichDoc() as Record<string, unknown>;
    const complaints = doc['complaints'] as Record<string, unknown>[];
    const inner = (complaints[0]!['doc'] as Record<string, unknown>)[
      'content'
    ] as unknown[];
    inner.push(
      {
        type: 'heading',
        attrs: {
          level: 2,
          hcKind: 'entry',
          hcEntryKind: 'follow_up',
          hcComplaintName: 'Headache',
          hcDate: '2026-11-01',
          hcVisitId: 'v-1',
        },
        content: [{ type: 'text', text: 'Headache-follow-up — 01-11-2026' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Second-visit note.' }],
      },
    );
    openOrCreate.mockResolvedValue(openResp({ dataJson: JSON.stringify(doc) }));

    renderForm();
    await getFormFake();

    // remove the SECOND entry
    fireEvent.click(screen.getByTestId('case-form-entry-remove-2'));
    expect(screen.getByTestId('case-form-remove-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('case-form-remove-confirm'));

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedJson();
    const text = saved['text'] as string;
    expect(text).toContain('Throbbing right temple'); // first entry survives
    expect(text).not.toContain('Second-visit note.'); // removed entry gone
  });
});

// ===========================================================================
// D5 — investigations status DROPDOWN + Submitted popup + display label + unlink/delete
// ===========================================================================

describe('CaseForm RWv4 D5 — investigations Suggested/Submitted dropdown', () => {
  it('the status control is a dropdown with Suggested + Submitted options', async () => {
    renderForm();
    await waitForEditor();

    fireEvent.click(screen.getByTestId('case-form-record-investigations'));
    const select = screen.getByTestId('case-investigations-status-select');
    expect(select.tagName).toBe('SELECT');
    expect(
      screen.getByTestId('case-investigations-status-opt-suggested'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('case-investigations-status-opt-submitted'),
    ).toBeInTheDocument();
  });

  it('selecting Submitted opens the submit popup with upload-new + pick-existing and a warning note', async () => {
    renderForm();
    await waitForEditor();

    fireEvent.click(screen.getByTestId('case-form-record-investigations'));
    fireEvent.change(screen.getByTestId('case-investigations-status-select'), {
      target: { value: 'submitted' },
    });

    expect(
      screen.getByTestId('case-form-investigation-submit-popup'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('case-form-investigation-submit-upload'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('case-form-investigation-submit-pick-list'),
    ).toBeInTheDocument();
    // warning note: "upload the correct file against the name"
    const warn = screen.getByTestId('case-form-investigation-upload-warning');
    expect(warn.textContent ?? '').toMatch(
      /correct file.*name|against the name/i,
    );
  });

  it('uploading via Submitted sends a displayLabel of <investigation>-<patient>-<date> (sanitised, no raw PII separators)', async () => {
    renderForm();
    await waitForEditor();

    fireEvent.click(screen.getByTestId('case-form-record-investigations'));
    fireEvent.change(screen.getByTestId('case-investigations-name'), {
      target: { value: 'CBC' },
    });
    fireEvent.change(screen.getByTestId('case-investigations-status-select'), {
      target: { value: 'submitted' },
    });
    fireEvent.click(
      screen.getByTestId('case-form-investigation-submit-upload'),
    );

    await waitFor(() => expect(attachReport).toHaveBeenCalled());
    const req = attachReport.mock.calls.at(-1)![0] as {
      displayLabel?: string | null;
      visitId: string;
    };
    expect(
      req.displayLabel,
      'Submitted upload must pass a composed displayLabel',
    ).toBeTruthy();
    const label = req.displayLabel!;
    // composed from the investigation name + a date; a display label only,
    // never a path (R-PRIV-007) — no path separators.
    expect(label).toContain('CBC');
    expect(label).not.toContain('/');
    expect(label).not.toContain('\\');
    expect(label).toMatch(/\d{2}-\d{2}-\d{4}/); // DD-MM-YYYY date component
  });

  // DEFECT 2 (M3-RWv4 build-12): a Submitted upload-new renders but never
  // produced a link row in `case-form-investigation-links` (30s E2E timeout).
  // A resolved attach result MUST append an investigation link row carrying the
  // attachment id + display label, visible in the links panel with an unlink
  // control, AND the link row must be persisted via autosave.
  it('a Submitted upload appends an investigation link row (id + label) to case-form-investigation-links and autosaves it', async () => {
    renderForm();
    await waitForEditor();

    fireEvent.click(screen.getByTestId('case-form-record-investigations'));
    fireEvent.change(screen.getByTestId('case-investigations-name'), {
      target: { value: 'CBC' },
    });
    fireEvent.change(screen.getByTestId('case-investigations-status-select'), {
      target: { value: 'submitted' },
    });
    fireEvent.click(
      screen.getByTestId('case-form-investigation-submit-upload'),
    );

    // the attach command resolved with attachmentId 'att-1' (beforeEach mock)
    await waitFor(() => expect(attachReport).toHaveBeenCalled());

    // a link row now renders in the panel, carrying the display label...
    const links = await screen.findByTestId(
      'case-form-investigation-links',
      undefined,
      { timeout: 1500 },
    );
    const label = attachReport.mock.calls.at(-1)![0] as {
      displayLabel: string;
    };
    expect(links.textContent ?? '').toContain('CBC');
    // ...and an unlink control for that row (proves the row is present + keyed)
    expect(
      screen.getByTestId('case-form-investigation-unlink-1'),
    ).toBeInTheDocument();

    // ...and the saved doc carries a tableRow with hcInvestigationLink.attachmentId
    await waitFor(() => expect(autosave).toHaveBeenCalled());
    const saved = lastSavedJson();
    const linkRows = savedNodesOfType(saved, 'tableRow').filter(
      (r) => attrs(r)['hcInvestigationLink'] != null,
    );
    expect(linkRows.length).toBeGreaterThanOrEqual(1);
    const link = attrs(linkRows[0]!)['hcInvestigationLink'] as {
      attachmentId?: string;
    };
    expect(link.attachmentId).toBe('att-1');
    // the row cells carry the composed display label (no raw PII separators)
    expect(flatText(linkRows[0]!)).toContain('CBC');
    expect(label.displayLabel).toBeTruthy();
  });
});

describe('CaseForm RWv4 D5 — UNLINK vs DELETE are separate and both confirm', () => {
  it('UNLINK removes the investigation link row WITHOUT calling visitDeleteAttachment', async () => {
    vi.useFakeTimers();
    // open with an investigations table carrying a link row
    const doc = oneComplaintRichDoc() as Record<string, unknown>;
    const complaints = doc['complaints'] as Record<string, unknown>[];
    const inner = (complaints[0]!['doc'] as Record<string, unknown>)[
      'content'
    ] as unknown[];
    inner.push({
      type: 'table',
      attrs: { hcTableType: 'investigations' },
      content: [
        {
          type: 'tableRow',
          attrs: { hcInvestigationLink: { attachmentId: 'att-1' } },
          content: [
            {
              type: 'tableCell',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'CBC-Test Patient 001-24-10-2026' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    openOrCreate.mockResolvedValue(openResp({ dataJson: JSON.stringify(doc) }));

    renderForm();
    await getFormFake();

    fireEvent.click(screen.getByTestId('case-form-investigation-unlink-1'));
    expect(
      screen.getByTestId('case-form-investigation-unlink-dialog'),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId('case-form-investigation-unlink-confirm'),
    );

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    // the link row is gone from the serialized doc...
    const saved = lastSavedJson();
    const linkRows = savedNodesOfType(saved, 'tableRow').filter(
      (r) => attrs(r)['hcInvestigationLink'] != null,
    );
    expect(linkRows).toHaveLength(0);
    // ...and NO file was deleted (unlink is a data_json edit only)
    expect(deleteAttachment).not.toHaveBeenCalled();
  });
});
