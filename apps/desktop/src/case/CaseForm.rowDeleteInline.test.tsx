// RED component tests for HC-MVP1-M3ux: INLINE row delete in case tables, on
// the REAL <CaseForm /> (real caseRich.ts / caseRichEditor.ts / TipTap).
//
// Today (M3-RWv6 item 6) the row-delete controls render as a separate strip
// OUTSIDE the editor: per table a `role=group` ("Delete a row of the table:
// <label>") plus buttons "✕ Row 1", "✕ Row 2", ... The doctor cannot match
// them to rows (Physical generals shows 14 in a line). Wanted:
//
//  - the strip is gone (no `case-form-table-row-controls`, no group, no
//    "Row N" buttons anywhere);
//  - every DATA row of every inserted table carries its own small minus
//    control INSIDE that row's <tr> in the editor DOM (a ProseMirror widget
//    decoration or a NodeView); the header row has none;
//  - the control keeps the existing testid contract
//    `case-form-table-row-delete-<t>-<r>` (t = 1-based doc-order table, r =
//    1-based data row) so the existing RWv6 unit + E2E specs stay valid;
//  - accessible name = "Delete row" + row number + table label (e.g.
//    "Delete row 2 of Vitals"); visible text is just a minus glyph;
//  - it opens the SAME confirm dialog (`case-form-table-row-delete-dialog`
//    with `-confirm` / `-cancel`), deletes exactly that row at its real
//    ProseMirror position, deleting the last data row removes the table;
//  - it is a focusable, non-editable (`contenteditable=false`) button that
//    Enter/Space activate WITHOUT ProseMirror editing the document;
//  - it never becomes document content: nothing of it reaches data_json, the
//    top-level `text` (visit_fts) mirror or the live doc;
//  - a row added via Record gets its minus right away (no reload).
//
// Visual size (>= 14px text, adequate target) and contrast (>= 3:1) cannot be
// measured in jsdom (no Tailwind CSS); they are covered by review + E2E.
//
// The only fake is the typed bindings dependency (`vi.mock('@/bindings')`).
// Real timers. Synthetic data only. NO production code is written here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

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
import { tableRowPos } from './caseRichEditor';

type Json = Record<string, unknown>;

// ---- fixtures (synthetic) ----------------------------------------------------

const txt = (s: string) => (s === '' ? [] : [{ type: 'text', text: s }]);
const para = (s: string) =>
  s === '' ? { type: 'paragraph' } : { type: 'paragraph', content: txt(s) };

function entryHeading(name: string): Json {
  return {
    type: 'heading',
    attrs: {
      level: 2,
      hcKind: 'entry',
      hcEntryKind: 'first',
      hcComplaintName: name,
      hcDate: '2026-10-24',
      hcVisitId: 'v-1',
    },
    content: txt(`${name} \u2014 24-10-2026`),
  };
}

function section(kind: string, label: string, no: number): Json[] {
  return [
    { type: 'horizontalRule' },
    {
      type: 'heading',
      attrs: {
        level: 3,
        hcKind: 'section',
        hcSectionNo: no,
        hcSectionType: kind,
      },
      content: txt(`\u2022 ${label}`),
    },
  ];
}

function table(kind: string, header: string[], rows: string[][]): Json {
  return {
    type: 'table',
    attrs: { hcTableType: kind },
    content: [
      {
        type: 'tableRow',
        content: header.map((h) => ({
          type: 'tableHeader',
          content: [para(h)],
        })),
      },
      ...rows.map((r) => ({
        type: 'tableRow',
        content: r.map((v) => ({ type: 'tableCell', content: [para(v)] })),
      })),
    ],
  };
}

function richDoc(title: string, content: unknown[]): Json {
  return {
    schema: 'case-rich',
    version: 3,
    next_section_no: 4,
    sections: null,
    complaints: [
      { id: 'cc1', title, next_section_no: 4, doc: { type: 'doc', content } },
    ],
  };
}

function openResp(dataJson: string): Json {
  return {
    visitId: 'v-1',
    templateId: 'journal_default',
    dataJson,
    vitalsJson: '{}',
    visitAt: '2026-10-24T09:00:00Z',
    nextFollowupOn: null,
  };
}

const BASE_DOC = richDoc('Headache', [
  entryHeading('Headache'),
  para('Throbbing right temple.'),
]);

const GENERALS_ROWS: string[][] = Array.from({ length: 14 }, (_v, i) => [
  `Field ${i + 1}`,
  `Value ${i + 1}`,
]);

/** Vitals (3 data rows), Physical generals (14), Investigations (1). */
const MULTI_DOC = richDoc('Headache', [
  entryHeading('Headache'),
  para('Throbbing right temple.'),
  ...section('vitals', 'Vitals', 1),
  table(
    'vitals',
    ['BP sys', 'BP dia'],
    [
      ['120', '80'],
      ['130', '85'],
      ['140', '90'],
    ],
  ),
  ...section('physical_generals', 'Physical generals', 2),
  table('physical_generals', ['Field', 'Value'], GENERALS_ROWS),
  ...section('investigations', 'Investigations', 3),
  table('investigations', ['Investigation', 'Status'], [['CBC', 'Pending']]),
]);

const MULTI_TABLES: { label: string; dataRows: number }[] = [
  { label: 'Vitals', dataRows: 3 },
  { label: 'Physical generals', dataRows: 14 },
  { label: 'Investigations', dataRows: 1 },
];

const CONTROL_ID = /^case-form-table-row-delete-\d+-\d+$/;

beforeEach(() => {
  openOrCreate.mockReset();
  openOrCreate.mockResolvedValue(openResp(JSON.stringify(BASE_DOC)));
  autosave.mockReset();
  autosave.mockResolvedValue({ savedAt: '2026-10-24T09:00:30Z' });
  listAttachments.mockReset();
  listAttachments.mockResolvedValue({ attachments: [] });
  patientListAttachments.mockReset();
  patientListAttachments.mockResolvedValue({ attachments: [] });
  pickReportFile.mockReset();
  pickReportFile.mockResolvedValue({ sourcePath: null });
  openAttachment.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderForm(): void {
  render(<CaseForm patientId="p-123" visitId="v-1" sex="male" ageYears={34} />);
}

async function waitForEditor(): Promise<HTMLElement> {
  const region = await screen.findByTestId('case-form-editor-cc1', undefined, {
    timeout: 1500,
  });
  await waitFor(() =>
    expect(region.querySelector('.ProseMirror')).not.toBeNull(),
  );
  return region;
}

function pmRoot(region: HTMLElement): HTMLElement {
  const pm = region.querySelector<HTMLElement>('.ProseMirror');
  if (pm === null) throw new Error('no ProseMirror view');
  return pm;
}

function liveEditor(region: HTMLElement): Editor {
  const dom = pmRoot(region) as unknown as { editor?: Editor };
  if (dom.editor === undefined) throw new Error('no live editor on the view');
  return dom.editor;
}

/** The <tr> rows of the t-th (1-based) rendered table in the editor. */
function renderedRows(region: HTMLElement, tableNo: number): HTMLElement[] {
  const tables = pmRoot(region).querySelectorAll('table');
  const tb = tables[tableNo - 1];
  if (tb === undefined) throw new Error(`no rendered table #${tableNo}`);
  return Array.from(tb.querySelectorAll<HTMLElement>('tr'));
}

/** All row-delete controls anywhere in the document. */
function allControls(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-testid^="case-form-table-row-delete-"]',
    ),
  ).filter((el) => CONTROL_ID.test(el.getAttribute('data-testid') ?? ''));
}

function control(tableNo: number, rowNo: number): HTMLElement {
  return screen.getByTestId(`case-form-table-row-delete-${tableNo}-${rowNo}`);
}

/**
 * Assert the (t, r) control sits INSIDE the editor, inside the r-th data <tr>
 * of the t-th table, and is a labelled minus button for that row + table.
 */
function expectInlineControl(
  region: HTMLElement,
  tableNo: number,
  rowNo: number,
  label: string,
): void {
  const btn = control(tableNo, rowNo);
  const where = `table ${tableNo} row ${rowNo}`;
  expect(pmRoot(region).contains(btn), `${where}: inside the editor`).toBe(
    true,
  );
  const rows = renderedRows(region, tableNo);
  expect(rows[rowNo]?.contains(btn), `${where}: inside its own <tr>`).toBe(
    true,
  );
  expect(btn.tagName, `${where}: a <button>`).toBe('BUTTON');
  // Visible text is a lone minus glyph, never "✕ Row N".
  expect((btn.textContent ?? '').trim(), `${where}: minus glyph`).toMatch(
    /^[\u2212\u2013-]$/,
  );
  const name = btn.getAttribute('aria-label') ?? '';
  expect(name, `${where}: name says Delete row`).toMatch(/delete row/i);
  expect(name, `${where}: name carries the row number`).toMatch(
    new RegExp(`\\b${rowNo}\\b`),
  );
  expect(name, `${where}: name carries the table label`).toContain(label);
}

function lastSavedJson(): string {
  const last = autosave.mock.calls.at(-1);
  if (last === undefined) throw new Error('caseVisitAutosave was never called');
  return (last[0] as { dataJson: string }).dataJson;
}

function lastSaved(): Json {
  return JSON.parse(lastSavedJson()) as Json;
}

function lastSavedContent(): Json[] {
  const out: Json[] = [];
  for (const c of (lastSaved()['complaints'] as Json[] | undefined) ?? []) {
    const doc = c['doc'] as Json | undefined;
    for (const n of (doc?.['content'] as Json[] | undefined) ?? []) out.push(n);
  }
  return out;
}

const attrs = (n: Json): Json => (n['attrs'] as Json | undefined) ?? {};

function flat(node: unknown): string {
  if (node === null || typeof node !== 'object') return '';
  const n = node as Json;
  let s =
    n['type'] === 'text' && typeof n['text'] === 'string'
      ? (n['text'] as string)
      : '';
  const c = n['content'];
  if (Array.isArray(c)) for (const x of c) s += flat(x);
  return s;
}

function tablesOf(content: Json[], kind: string): Json[] {
  return content.filter(
    (n) => n['type'] === 'table' && attrs(n)['hcTableType'] === kind,
  );
}

function bodyRows(tb: Json): string[][] {
  const rows = (tb['content'] as Json[] | undefined) ?? [];
  return rows
    .slice(1)
    .map((r) =>
      ((r['content'] as Json[] | undefined) ?? []).map((c) => flat(c)),
    );
}

function recordVitals(sys: string): void {
  fireEvent.click(screen.getByTestId('case-form-record-vitals'));
  fireEvent.change(screen.getByTestId('case-vitals-bp-sys'), {
    target: { value: sys },
  });
  fireEvent.click(screen.getByTestId('case-form-record-vitals-confirm'));
}

async function renderMulti(): Promise<HTMLElement> {
  openOrCreate.mockResolvedValue(openResp(JSON.stringify(MULTI_DOC)));
  renderForm();
  const region = await waitForEditor();
  await waitFor(() =>
    expect(pmRoot(region).querySelectorAll('table')).toHaveLength(3),
  );
  return region;
}

// ===========================================================================
// (1) the old strip is gone
// ===========================================================================

describe('M3ux inline row delete (1): the separate "✕ Row N" strip is gone', () => {
  it('renders no row-control strip, no per-table group and no "Row N" buttons', async () => {
    await renderMulti();

    expect(
      screen.queryByTestId('case-form-table-row-controls'),
      'the strip container',
    ).toBeNull();
    expect(
      screen.queryAllByRole('group', { name: /delete a row of the table/i }),
      'per-table groups',
    ).toHaveLength(0);
    expect(
      screen.queryAllByRole('button', { name: /^\s*\u2715?\s*Row\s+\d+\s*$/ }),
      '"Row N" buttons',
    ).toHaveLength(0);
    const rowTextButtons = screen
      .queryAllByRole('button')
      .filter((b) => /\bRow\s+\d+\b/.test(b.textContent ?? ''));
    expect(rowTextButtons, 'buttons whose visible text is "Row N"').toEqual([]);
  });

  it('every row-delete control lives inside the editor, none outside it', async () => {
    const region = await renderMulti();
    const controls = allControls();
    expect(controls.length, 'there are row-delete controls').toBeGreaterThan(0);
    const outside = controls
      .filter((c) => !pmRoot(region).contains(c))
      .map((c) => c.getAttribute('data-testid'));
    expect(outside, 'controls rendered outside the editor').toEqual([]);
  });
});

// ===========================================================================
// (2) one inline minus per DATA row, none on the header row
// ===========================================================================

describe('M3ux inline row delete (2): a labelled minus inside each data row', () => {
  it('each data row of every table has exactly one minus in its own <tr>, labelled with row number + table', async () => {
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 1, 1, 'Vitals'));

    MULTI_TABLES.forEach((tb, i) => {
      const tableNo = i + 1;
      for (let r = 1; r <= tb.dataRows; r += 1) {
        expectInlineControl(region, tableNo, r, tb.label);
        const inRow = Array.from(
          renderedRows(region, tableNo)[r]!.querySelectorAll(
            '[data-testid^="case-form-table-row-delete-"]',
          ),
        );
        expect(inRow, `table ${tableNo} row ${r}: exactly one`).toHaveLength(1);
      }
    });
    expect(allControls()).toHaveLength(3 + 14 + 1);
  });

  it('the header row of every table has no minus', async () => {
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 1, 1, 'Vitals'));
    for (let tableNo = 1; tableNo <= 3; tableNo += 1) {
      const header = renderedRows(region, tableNo)[0]!;
      expect(header.querySelector('th'), 'row 0 is the header').not.toBeNull();
      expect(
        header.querySelectorAll('[data-testid^="case-form-table-row-delete-"]'),
        `table ${tableNo} header`,
      ).toHaveLength(0);
      expect(
        screen.queryByTestId(`case-form-table-row-delete-${tableNo}-0`),
      ).toBeNull();
    }
  });
});

// ===========================================================================
// (3) same confirm dialog, same deletion rules
// ===========================================================================

describe('M3ux inline row delete (3): confirm / cancel / last-row rule', () => {
  it('cancel keeps the row; confirm deletes exactly that row and the minus controls renumber', async () => {
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 1, 2, 'Vitals'));
    const ed = liveEditor(region);

    fireEvent.click(control(1, 2));
    const dialog = await screen.findByTestId(
      'case-form-table-row-delete-dialog',
    );
    expect(dialog).toHaveAttribute('role', 'dialog');
    fireEvent.click(screen.getByTestId('case-form-table-row-delete-cancel'));
    expect(
      screen.queryByTestId('case-form-table-row-delete-dialog'),
    ).toBeNull();
    expect(renderedRows(region, 1)).toHaveLength(4); // header + 3
    expect(ed.state.doc.textContent).toContain('130');

    fireEvent.click(control(1, 2));
    fireEvent.click(
      await screen.findByTestId('case-form-table-row-delete-confirm'),
    );

    await waitFor(() => {
      const vit = tablesOf(lastSavedContent(), 'vitals');
      expect(vit).toHaveLength(1);
      expect(bodyRows(vit[0]!)).toEqual([
        ['120', '80'],
        ['140', '90'],
      ]);
    });
    // Other tables untouched.
    expect(
      bodyRows(tablesOf(lastSavedContent(), 'physical_generals')[0]!),
    ).toHaveLength(14);
    // The inline controls follow the new rows (structure refreshed).
    await waitFor(() => {
      expect(screen.queryByTestId('case-form-table-row-delete-1-3')).toBeNull();
      expectInlineControl(region, 1, 2, 'Vitals');
    });
    expect(
      renderedRows(region, 1)[2]!.textContent ?? '',
      'row 2 is now the 140 row',
    ).toContain('140');
  });

  it('deleting the only data row via its minus removes the table and its section heading', async () => {
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 3, 1, 'Investigations'));

    fireEvent.click(control(3, 1));
    fireEvent.click(
      await screen.findByTestId('case-form-table-row-delete-confirm'),
    );

    await waitFor(() => {
      const content = lastSavedContent();
      expect(tablesOf(content, 'investigations')).toHaveLength(0);
      expect(
        content.filter(
          (n) =>
            n['type'] === 'heading' &&
            attrs(n)['hcKind'] === 'section' &&
            attrs(n)['hcSectionType'] === 'investigations',
        ),
      ).toHaveLength(0);
      expect(tablesOf(content, 'vitals')).toHaveLength(1);
    });
    await waitFor(() =>
      expect(pmRoot(region).querySelectorAll('table')).toHaveLength(2),
    );
    expect(screen.queryByTestId('case-form-table-row-delete-3-1')).toBeNull();
  });
});

// ===========================================================================
// (4) keyboard + never document content
// ===========================================================================

describe('M3ux inline row delete (4): keyboard operable, never saved', () => {
  it('the minus is a focusable, non-editable button', async () => {
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 1, 2, 'Vitals'));
    const btn = control(1, 2) as HTMLButtonElement;

    expect(btn.disabled).toBe(false);
    expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
    expect(btn.closest('[aria-hidden="true"]')).toBeNull();
    expect(
      btn.closest('[contenteditable="false"]'),
      'widget is outside the editable content',
    ).not.toBeNull();
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });

  it('Enter and Space open the confirm dialog without ProseMirror editing the doc', async () => {
    const user = userEvent.setup();
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 1, 2, 'Vitals'));
    const ed = liveEditor(region);
    const before = JSON.stringify(ed.getJSON());

    control(1, 2).focus();
    await user.keyboard('{Enter}');
    await screen.findByTestId('case-form-table-row-delete-dialog');
    expect(JSON.stringify(ed.getJSON()), 'Enter left the doc unchanged').toBe(
      before,
    );
    fireEvent.click(screen.getByTestId('case-form-table-row-delete-cancel'));
    await waitFor(() =>
      expect(
        screen.queryByTestId('case-form-table-row-delete-dialog'),
      ).toBeNull(),
    );

    control(1, 2).focus();
    await user.keyboard(' ');
    await screen.findByTestId('case-form-table-row-delete-dialog');
    expect(JSON.stringify(ed.getJSON()), 'Space left the doc unchanged').toBe(
      before,
    );
  });

  it('nothing of the minus control reaches data_json, the fts text mirror or the live doc', async () => {
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 1, 1, 'Vitals'));
    // Trigger a real autosave with the controls rendered.
    recordVitals('150');
    await waitFor(() => expect(autosave).toHaveBeenCalled());
    await waitFor(() =>
      expect(tablesOf(lastSavedContent(), 'vitals').length).toBeGreaterThan(0),
    );

    const raw = lastSavedJson();
    for (const leak of [
      '\u2212',
      'Delete row',
      'case-form-table-row-delete',
      'button',
    ]) {
      expect(raw.includes(leak), `data_json contains ${leak}`).toBe(false);
    }
    const mirror = lastSaved()['text'];
    expect(typeof mirror).toBe('string');
    expect(mirror as string).not.toMatch(/\u2212|Delete row/);

    // Saved rows hold only cells; cell count matches the header.
    for (const tb of lastSavedContent().filter((n) => n['type'] === 'table')) {
      const rows = (tb['content'] as Json[] | undefined) ?? [];
      const width = ((rows[0]?.['content'] as Json[] | undefined) ?? []).length;
      for (const r of rows) {
        expect(r['type']).toBe('tableRow');
        const cells = (r['content'] as Json[] | undefined) ?? [];
        expect(cells).toHaveLength(width);
        for (const c of cells)
          expect(['tableCell', 'tableHeader']).toContain(c['type']);
      }
    }
    expect(liveEditor(region).state.doc.textContent).not.toMatch(
      /\u2212|Delete row/,
    );
  });
});

// ===========================================================================
// (5) a row added via Record gets its minus without reload
// ===========================================================================

describe('M3ux inline row delete (5): new rows get a minus immediately', () => {
  it('Record vitals twice -> a minus in data row 1, then also in data row 2', async () => {
    renderForm();
    const region = await waitForEditor();

    recordVitals('120');
    await waitFor(() => expectInlineControl(region, 1, 1, 'Vitals'));

    recordVitals('130');
    await waitFor(() => expectInlineControl(region, 1, 2, 'Vitals'));
    expect(renderedRows(region, 1)[2]!.textContent ?? '').toContain('130');
    expect(allControls()).toHaveLength(2);
  });
});

// ===========================================================================
// (6) rowdelete-1: Ctrl+Shift+Backspace deletes the caret's DATA row
// ===========================================================================

/** The real key chord, pressed with user-event (keydown/keyup sequence). */
const SHORTCUT = '{Control>}{Shift>}{Backspace}{/Shift}{/Control}';

/** Vitals (2 data rows), then a single-row Investigations table, then text. */
const TRAILING_DOC = richDoc('Headache', [
  entryHeading('Headache'),
  para('Throbbing right temple.'),
  ...section('vitals', 'Vitals', 1),
  table(
    'vitals',
    ['BP sys', 'BP dia'],
    [
      ['120', '80'],
      ['130', '85'],
    ],
  ),
  ...section('investigations', 'Investigations', 2),
  table('investigations', ['Investigation', 'Status'], [['CBC', 'Pending']]),
  para('After the table.'),
]);

/** Focus the editor and put the caret in the first cell of (table, row). */
function caretInRow(region: HTMLElement, tableNo: number, rowNo: number): void {
  const ed = liveEditor(region);
  const pos = tableRowPos(ed, tableNo, rowNo);
  if (pos === null) throw new Error(`no row ${tableNo}/${rowNo}`);
  placeCaret(region, pos + 1);
}

/** Focus the editor and put the caret at the text position nearest `pos`. */
function placeCaret(region: HTMLElement, pos: number): void {
  const ed = liveEditor(region);
  pmRoot(region).focus();
  ed.view.dispatch(
    ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(pos), 1)),
  );
  expect(document.activeElement, 'editor focused before the key').toBe(
    pmRoot(region),
  );
}

/** Position just inside the paragraph whose text is exactly `text`. */
function paragraphPos(region: HTMLElement, text: string): number {
  let found: number | null = null;
  liveEditor(region).state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === 'paragraph' && node.textContent === text) {
      found = pos + 1;
      return false;
    }
    return true;
  });
  if (found === null) throw new Error(`no paragraph "${text}"`);
  return found;
}

/**
 * Where the caret is: the text of the top-level table row holding it, or
 * `outside:<text of its textblock>` when it is not in a table.
 */
function caretPlace(region: HTMLElement): string {
  const $h = liveEditor(region).state.selection.$head;
  if ($h.depth >= 2 && $h.node(1).type.name === 'table') {
    return $h.node(2).textContent;
  }
  return `outside:${$h.parent.textContent}`;
}

const docJson = (region: HTMLElement): string =>
  JSON.stringify(liveEditor(region).getJSON());

const dialogOrNull = (): HTMLElement | null =>
  screen.queryByTestId('case-form-table-row-delete-dialog');

describe('M3ux inline row delete (6): Ctrl+Shift+Backspace on the caret row', () => {
  it('in a data row the shortcut opens the confirm for that row and confirm deletes exactly that row', async () => {
    const user = userEvent.setup();
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 1, 2, 'Vitals'));
    caretInRow(region, 1, 2);
    const before = docJson(region);

    await user.keyboard(SHORTCUT);

    const dialog = await screen.findByTestId(
      'case-form-table-row-delete-dialog',
    );
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(docJson(region), 'the key itself edits nothing').toBe(before);

    await user.click(screen.getByTestId('case-form-table-row-delete-confirm'));

    await waitFor(() =>
      expect(bodyRows(tablesOf(lastSavedContent(), 'vitals')[0]!)).toEqual([
        ['120', '80'],
        ['140', '90'],
      ]),
    );
    expect(
      bodyRows(tablesOf(lastSavedContent(), 'physical_generals')[0]!),
      'other tables untouched',
    ).toHaveLength(14);
    expect(renderedRows(region, 1)).toHaveLength(3); // header + 2
  });

  it('on the header row the shortcut opens no confirm and leaves the doc unchanged', async () => {
    const user = userEvent.setup();
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 1, 1, 'Vitals'));
    caretInRow(region, 1, 0);
    expect(caretPlace(region)).toBe('BP sysBP dia');
    const before = docJson(region);

    await user.keyboard(SHORTCUT);

    expect(dialogOrNull(), 'no confirm on the header').toBeNull();
    expect(docJson(region), 'header row kept').toBe(before);
    expect(renderedRows(region, 1)).toHaveLength(4);
  });

  it('outside any table the shortcut opens no confirm and no table row is removed', async () => {
    // Outside a table the chord is not the row-delete's: it falls through to
    // the editor's ordinary Ctrl+Backspace text handling (not asserted here).
    const user = userEvent.setup();
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 1, 1, 'Vitals'));
    const text = 'Throbbing right temple.';
    placeCaret(region, paragraphPos(region, text) + text.length);
    expect(caretPlace(region)).toBe(`outside:${text}`);

    await user.keyboard(SHORTCUT);

    expect(dialogOrNull(), 'no confirm outside a table').toBeNull();
    expect(pmRoot(region).querySelectorAll('table')).toHaveLength(3);
    expect(
      [1, 2, 3].map((n) => renderedRows(region, n).length),
      'every table keeps all its rows',
    ).toEqual([4, 15, 2]);
    expect(allControls()).toHaveLength(3 + 14 + 1);
  });
});

// ===========================================================================
// (7) rowdelete-7: focus comes back to the editor; shortcut is advertised
// ===========================================================================

describe('M3ux inline row delete (7): focus returns to the editor', () => {
  it('after confirm the caret is in the editor on the next row (it moved up into the deleted place)', async () => {
    const user = userEvent.setup();
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 1, 2, 'Vitals'));
    caretInRow(region, 1, 2);
    await user.keyboard(SHORTCUT);
    await screen.findByTestId('case-form-table-row-delete-dialog');
    expect(
      region.contains(document.activeElement),
      'focus moved into the dialog',
    ).toBe(false);

    await user.click(screen.getByTestId('case-form-table-row-delete-confirm'));

    await waitFor(() => expect(renderedRows(region, 1)).toHaveLength(3));
    expect(dialogOrNull()).toBeNull();
    expect(document.activeElement, 'editor focused').toBe(pmRoot(region));
    expect(caretPlace(region), 'caret on the former row 3').toBe('14090');
  });

  it('after confirm on the last data row the caret is in the editor on the previous row', async () => {
    const user = userEvent.setup();
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 1, 3, 'Vitals'));

    // Mouse path: the minus moves focus off the editor; confirm brings it back.
    await user.click(control(1, 3));
    await user.click(
      await screen.findByTestId('case-form-table-row-delete-confirm'),
    );

    await waitFor(() => expect(renderedRows(region, 1)).toHaveLength(3));
    expect(document.activeElement, 'editor focused').toBe(pmRoot(region));
    expect(caretPlace(region), 'caret on row 2').toBe('13085');
  });

  it('after confirm removes the whole table the caret is in the editor in the text after it', async () => {
    const user = userEvent.setup();
    openOrCreate.mockResolvedValue(openResp(JSON.stringify(TRAILING_DOC)));
    renderForm();
    const region = await waitForEditor();
    await waitFor(() => expectInlineControl(region, 2, 1, 'Investigations'));
    caretInRow(region, 2, 1);

    await user.keyboard(SHORTCUT);
    await user.click(
      await screen.findByTestId('case-form-table-row-delete-confirm'),
    );

    await waitFor(() =>
      expect(pmRoot(region).querySelectorAll('table')).toHaveLength(1),
    );
    expect(document.activeElement, 'editor focused').toBe(pmRoot(region));
    expect(caretPlace(region)).toBe('outside:After the table.');
  });

  it('after Cancel and after Escape focus returns to the editor in the same row, doc unchanged', async () => {
    const user = userEvent.setup();
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 2, 5, 'Physical generals'));
    const before = docJson(region);

    // Keyboard path + Escape.
    caretInRow(region, 2, 5);
    await user.keyboard(SHORTCUT);
    await screen.findByTestId('case-form-table-row-delete-dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialogOrNull()).toBeNull());
    expect(document.activeElement, 'Escape: editor focused').toBe(
      pmRoot(region),
    );
    expect(caretPlace(region), 'Escape: same row').toBe('Field 5Value 5');

    // Mouse path + Cancel (focus was on the minus, not the editor).
    await user.click(control(1, 3));
    await user.click(
      await screen.findByTestId('case-form-table-row-delete-cancel'),
    );
    expect(dialogOrNull()).toBeNull();
    expect(document.activeElement, 'Cancel: editor focused').toBe(
      pmRoot(region),
    );
    expect(caretPlace(region), 'Cancel: the row it was opened for').toBe(
      '14090',
    );
    expect(docJson(region), 'nothing deleted').toBe(before);
  });

  it('every minus advertises the shortcut via aria-keyshortcuts and its tooltip', async () => {
    const region = await renderMulti();
    await waitFor(() => expectInlineControl(region, 1, 1, 'Vitals'));
    const controls = allControls();
    expect(controls).toHaveLength(3 + 14 + 1);
    for (const btn of controls) {
      const id = btn.getAttribute('data-testid');
      expect(btn.getAttribute('aria-keyshortcuts'), `${id}`).toBe(
        'Control+Shift+Backspace',
      );
      expect(btn.title, `${id} tooltip names the row`).toContain(
        btn.getAttribute('aria-label') ?? '<no label>',
      );
      expect(btn.title, `${id} tooltip names the shortcut`).toContain(
        'Ctrl+Shift+Backspace',
      );
    }
    expect(control(1, 2).title).toBe(
      'Delete row 2 of Vitals (Ctrl+Shift+Backspace in the row)',
    );
  });
});
