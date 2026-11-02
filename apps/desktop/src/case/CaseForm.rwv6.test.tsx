// RED component tests for the M3-RWv6 case-editor items on the REAL
// <CaseForm /> (real caseRich.ts / caseRichEditor.ts / TipTap):
//
//  (4) ONE-CLICK OPEN of a linked report. Each investigation link row gets an
//      open control `case-form-investigation-open-<n>` (n = 1-based link row,
//      next to the existing unlink control). One click calls
//      `visitOpenAttachment({ attachmentId })` for THAT row and shows the
//      in-app preview dialog (same data-URL preview as the Lab reports panel).
//  (5) FAMILY HISTORY: record Maternal only, then Paternal only, in the same
//      entry -> ONE table whose Paternal cells fill from the top.
//  (6) DELETE A TABLE ROW. Proposed testids (contract for hc-ui-dev):
//      `case-form-table-row-delete-<t>-<r>` (t = 1-based doc-order table,
//      r = 1-based DATA row; the header row has no control), each opening
//      `case-form-table-row-delete-dialog` with `-confirm` / `-cancel`.
//      Deleting the last data row removes the table and its section heading.
//  (7) COMPLAINT NUMBERING at click time: add an untitled #2, delete it by
//      hand in the editor, then Add new complaint -> the new one is #2.
//  (8) PHYSICAL GENERALS popup fields, exactly and in order: appetite,
//      thirst, thermal state, constitution, diet, cravings, aversions, urine,
//      stool, perspiration, sun aggravation (Yes/No), sleep, dreams, sleep
//      position. No Notes row.
//
// The only fake is the typed bindings dependency (`vi.mock('@/bindings')`).
// Real timers. Synthetic data only; no clinical values are logged. New
// en.json keys are not referenced via t().
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import type { Editor } from '@tiptap/core';

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

type Json = Record<string, unknown>;

// ---- fixtures ----------------------------------------------------------------

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

function richDoc(title: string, content: unknown[]): Json {
  return {
    schema: 'case-rich',
    version: 3,
    next_section_no: 1,
    sections: null,
    complaints: [
      { id: 'cc1', title, next_section_no: 1, doc: { type: 'doc', content } },
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

/** The live TipTap editor behind the rendered ProseMirror view. */
function liveEditor(region: HTMLElement): Editor {
  const dom = region.querySelector('.ProseMirror') as unknown as {
    editor?: Editor;
  };
  if (dom.editor === undefined) throw new Error('no live editor on the view');
  return dom.editor;
}

function lastSaved(): Json {
  const last = autosave.mock.calls.at(-1);
  if (last === undefined) throw new Error('caseVisitAutosave was never called');
  return JSON.parse((last[0] as { dataJson: string }).dataJson) as Json;
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

function bodyRows(table: Json): string[][] {
  const rows = (table['content'] as Json[] | undefined) ?? [];
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

function recordFamily(maternal: string, paternal: string): void {
  fireEvent.click(screen.getByTestId('case-form-record-family'));
  fireEvent.change(screen.getByTestId('case-form-family-maternal-input'), {
    target: { value: maternal },
  });
  fireEvent.change(screen.getByTestId('case-form-family-paternal-input'), {
    target: { value: paternal },
  });
  fireEvent.click(screen.getByTestId('case-form-record-family-confirm'));
}

// ===========================================================================
// (4) one-click open of a linked report
// ===========================================================================

describe('CaseForm RWv6 item 4: a linked report opens in one click from its row', () => {
  const LINKED = richDoc('Headache', [
    entryHeading('Headache'),
    para('Labs reviewed.'),
    { type: 'horizontalRule' },
    {
      type: 'table',
      attrs: { hcTableType: 'investigations' },
      content: [
        {
          type: 'tableRow',
          content: ['Investigation', 'Status'].map((h) => ({
            type: 'tableHeader',
            content: [para(h)],
          })),
        },
        {
          type: 'tableRow',
          attrs: { hcInvestigationLink: { attachmentId: 'att-9' } },
          content: ['CBC-24-10-2026', 'Submitted'].map((v) => ({
            type: 'tableCell',
            content: [para(v)],
          })),
        },
      ],
    },
  ]);

  it('one click on the row open control calls visit_open_attachment with that attachment id and shows the preview', async () => {
    openOrCreate.mockResolvedValue(openResp(JSON.stringify(LINKED)));
    openAttachment.mockResolvedValue({
      mime: 'image/png',
      originalName: 'CBC-24-10-2026',
      dataBase64: 'iVBORw0KGgo=',
    });
    renderForm();
    await waitForEditor();

    const open = await screen.findByTestId('case-form-investigation-open-1');
    expect(open).toHaveAccessibleName();
    fireEvent.click(open);

    await waitFor(() => expect(openAttachment).toHaveBeenCalledTimes(1));
    expect(openAttachment).toHaveBeenCalledWith({ attachmentId: 'att-9' });
    const dialog = await screen.findByRole('dialog', {
      name: 'CBC-24-10-2026',
    });
    const img = within(dialog).getByRole('img');
    expect(img.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
});

// ===========================================================================
// (5) family history fills the empty column
// ===========================================================================

describe('CaseForm RWv6 item 5: Paternal after Maternal fills the same table from the top', () => {
  it('Maternal only, then Paternal only -> ONE table, Paternal cells filled from the top', async () => {
    renderForm();
    await waitForEditor();
    recordFamily('Diabetes\nHypertension', '');
    recordFamily('', 'Asthma');

    await waitFor(() => {
      const tables = tablesOf(lastSavedContent(), 'family_history');
      expect(tables).toHaveLength(1);
      expect(bodyRows(tables[0]!)).toEqual([
        ['Diabetes', 'Asthma'],
        ['Hypertension', ''],
      ]);
    });
  });

  it('extra Paternal values beyond the empty cells add rows at the bottom', async () => {
    renderForm();
    await waitForEditor();
    recordFamily('Diabetes', '');
    recordFamily('', 'Asthma\nGout');

    await waitFor(() => {
      const tables = tablesOf(lastSavedContent(), 'family_history');
      expect(tables).toHaveLength(1);
      expect(bodyRows(tables[0]!)).toEqual([
        ['Diabetes', 'Asthma'],
        ['', 'Gout'],
      ]);
    });
  });
});

// ===========================================================================
// (6) delete a table row (with confirm)
// ===========================================================================

describe('CaseForm RWv6 item 6: per-row delete with confirm', () => {
  it('offers a labelled delete per DATA row and none for the header row', async () => {
    renderForm();
    await waitForEditor();
    recordVitals('120');
    recordVitals('130');

    const r1 = await screen.findByTestId('case-form-table-row-delete-1-1');
    const r2 = screen.getByTestId('case-form-table-row-delete-1-2');
    expect(r1).toHaveAccessibleName();
    expect(r2).toHaveAccessibleName();
    expect(
      screen.queryByTestId('case-form-table-row-delete-1-0'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('case-form-table-row-delete-1-3'),
    ).not.toBeInTheDocument();
  });

  it('cancel keeps the row; confirm deletes it and autosaves', async () => {
    renderForm();
    await waitForEditor();
    recordVitals('120');
    recordVitals('130');

    fireEvent.click(
      await screen.findByTestId('case-form-table-row-delete-1-1'),
    );
    const dialog = await screen.findByTestId(
      'case-form-table-row-delete-dialog',
    );
    expect(dialog).toHaveAttribute('role', 'dialog');
    fireEvent.click(screen.getByTestId('case-form-table-row-delete-cancel'));
    expect(
      screen.queryByTestId('case-form-table-row-delete-dialog'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('case-form-table-row-delete-1-2'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('case-form-table-row-delete-1-1'));
    fireEvent.click(
      await screen.findByTestId('case-form-table-row-delete-confirm'),
    );

    await waitFor(() => {
      const tables = tablesOf(lastSavedContent(), 'vitals');
      expect(tables).toHaveLength(1);
      const rows = bodyRows(tables[0]!);
      expect(rows).toHaveLength(1);
      expect(rows[0]![0]).toBe('130');
    });
    // The controls refresh right away (structure refreshed after setContent).
    expect(
      screen.queryByTestId('case-form-table-row-delete-1-2'),
    ).not.toBeInTheDocument();
  });

  it('deleting the last data row removes the table and its section heading', async () => {
    renderForm();
    await waitForEditor();
    recordVitals('120');

    fireEvent.click(
      await screen.findByTestId('case-form-table-row-delete-1-1'),
    );
    fireEvent.click(
      await screen.findByTestId('case-form-table-row-delete-confirm'),
    );

    await waitFor(() => {
      const content = lastSavedContent();
      expect(tablesOf(content, 'vitals')).toHaveLength(0);
      expect(
        content.filter(
          (n) =>
            n['type'] === 'heading' &&
            attrs(n)['hcKind'] === 'section' &&
            attrs(n)['hcSectionType'] === 'vitals',
        ),
      ).toHaveLength(0);
    });
    expect(
      screen.queryByTestId('case-form-table-row-delete-1-1'),
    ).not.toBeInTheDocument();
  });
});

// ===========================================================================
// (7) complaint numbering at click time
// ===========================================================================

describe('CaseForm RWv6 item 7: complaint numbering derives from the document', () => {
  const NAMED = {
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
          content: [entryHeading('Headache'), para('Throbbing.')],
        },
      },
    ],
  };

  async function addUntitledThenDeleteByHand(
    region: HTMLElement,
  ): Promise<void> {
    // Add an untitled complaint (#2).
    fireEvent.click(screen.getByTestId('case-form-add-complaint'));
    const ed = liveEditor(region);
    await waitFor(() => {
      let found = false;
      ed.state.doc.forEach((n) => {
        if (n.attrs['hcKind'] === 'complaint' && /^2\./.test(n.textContent))
          found = true;
      });
      expect(found, 'untitled complaint #2 was added').toBe(true);
    });
    // Delete its heading text by hand: select "2. Untitled complaint" and
    // press Delete. ProseMirror keeps an EMPTY complaint heading node.
    let from = -1;
    let size = 0;
    ed.state.doc.forEach((n, offset) => {
      if (n.attrs['hcKind'] === 'complaint' && /^2\./.test(n.textContent)) {
        from = offset + 1;
        size = n.content.size;
      }
    });
    act(() => {
      ed.commands.setTextSelection({ from, to: from + size });
      ed.commands.deleteSelection();
    });
  }

  function addNamed(name: string): void {
    fireEvent.change(screen.getByTestId('case-form-complaint-title'), {
      target: { value: name },
    });
    fireEvent.click(screen.getByTestId('case-form-add-complaint'));
  }

  it('add #2 (untitled), delete its heading text by hand, add again -> the new complaint is #2, not #3', async () => {
    openOrCreate.mockResolvedValue(openResp(JSON.stringify(NAMED)));
    renderForm();
    const region = await waitForEditor();
    await addUntitledThenDeleteByHand(region);
    addNamed('Cough');

    await waitFor(() => {
      const texts = Array.from(
        region.querySelectorAll('h1[data-hc-kind="complaint"]'),
      ).map((h) => (h.textContent ?? '').trim());
      expect(texts).toContain('2. Cough');
      expect(texts.filter((s) => /^3\./.test(s))).toEqual([]);
    });
  });

  it('the saved document has no ghost empty complaint, so reopening shows 1. Headache, 2. Cough', async () => {
    openOrCreate.mockResolvedValue(openResp(JSON.stringify(NAMED)));
    renderForm();
    const region = await waitForEditor();
    await addUntitledThenDeleteByHand(region);
    addNamed('Cough');

    await waitFor(() => {
      const titles = (
        (lastSaved()['complaints'] as Json[] | undefined) ?? []
      ).map((c) => c['title']);
      expect(titles).toEqual(['Headache', 'Cough']);
    });
  });
});

// ===========================================================================
// (8) physical generals popup fields
// ===========================================================================

const GENERALS_FIELDS = [
  'case-generals-appetite',
  'case-generals-thirst',
  'case-generals-thermal',
  'case-generals-constitution',
  'case-generals-diet',
  'case-generals-cravings',
  'case-generals-aversions',
  'case-generals-urine',
  'case-generals-stool',
  'case-generals-perspiration',
  'case-generals-sun-aggravation',
  'case-generals-sleep',
  'case-generals-dreams',
  'case-generals-sleep-position',
];

describe('CaseForm RWv6 item 8: physical generals popup fields', () => {
  async function openGenerals(): Promise<HTMLElement> {
    renderForm();
    await waitForEditor();
    fireEvent.click(screen.getByTestId('case-form-record-generals'));
    return screen.findByTestId('case-form-generals-popup');
  }

  it('has exactly the 14 fields in order, and no Notes row', async () => {
    const popup = await openGenerals();
    const controls = Array.from(
      popup.querySelectorAll<HTMLElement>(
        'input[data-testid^="case-generals-"], select[data-testid^="case-generals-"], textarea[data-testid^="case-generals-"], [role="radiogroup"][data-testid^="case-generals-"]',
      ),
    ).map((el) => el.getAttribute('data-testid'));
    expect(controls).toEqual(GENERALS_FIELDS);
    expect(within(popup).queryByTestId('case-generals-notes')).toBeNull();
    expect(within(popup).queryByText(/^\s*Notes\s*$/)).toBeNull();
  });

  it('every field has an accessible label', async () => {
    const popup = await openGenerals();
    for (const id of GENERALS_FIELDS) {
      const el = within(popup).queryByTestId(id);
      expect(el, id).not.toBeNull();
      expect(el, id).toHaveAccessibleName();
    }
  });

  it('sun aggravation is a Yes/No choice', async () => {
    const popup = await openGenerals();
    const sun = within(popup).getByTestId('case-generals-sun-aggravation');
    expect(sun.tagName).toBe('SELECT');
    const choices = Array.from((sun as HTMLSelectElement).options)
      .filter((o) => o.value !== '')
      .map((o) => (o.textContent ?? '').trim());
    expect(choices).toEqual(['Yes', 'No']);
  });

  it('recording writes the filled fields as rows (sun aggravation Yes, sleep position)', async () => {
    const popup = await openGenerals();
    fireEvent.change(within(popup).getByTestId('case-generals-constitution'), {
      target: { value: 'Lean' },
    });
    const sun = within(popup).getByTestId(
      'case-generals-sun-aggravation',
    ) as HTMLSelectElement;
    const yes = Array.from(sun.options).find(
      (o) => (o.textContent ?? '').trim() === 'Yes',
    );
    expect(yes, 'a Yes option').toBeDefined();
    fireEvent.change(sun, { target: { value: yes!.value } });
    fireEvent.change(
      within(popup).getByTestId('case-generals-sleep-position'),
      {
        target: { value: 'Left side' },
      },
    );
    fireEvent.click(screen.getByTestId('case-form-record-generals-confirm'));

    await waitFor(() => {
      const tables = tablesOf(lastSavedContent(), 'physical_generals');
      expect(tables).toHaveLength(1);
      const rows = bodyRows(tables[0]!);
      const values = rows.map((r) => r[1]);
      expect(values).toEqual(['Lean', 'Yes', 'Left side']);
      for (const r of rows) expect((r[0] ?? '').trim()).not.toBe('');
      expect(rows.find((r) => r[1] === 'Yes')?.[0]).toMatch(/sun/i);
    });
  });
});
