// RED editor-glue tests for the M3-RWv6 case-editor items, over a REAL
// headless TipTap editor (caseEditorExtensions(), jsdom) and REAL
// ProseMirror positions:
//
//  (5) `appendOrCreateTable(editor, 'family_history', seed)` fills the empty
//      column of the entry's family table from the top (no offset rows).
//  (6) Proposed export `removeTableRowAt(editor, rowPos): boolean`. `rowPos`
//      is the real ProseMirror position of the `tableRow` node (as yielded by
//      `doc.descendants`). Header row: returns false, doc unchanged. The last
//      data row: the table, its section heading and its rule go too.
//  (7) `insertComplaint(editor, { name, ... })` numbers the new complaint as
//      the highest complaint number visible in the document plus 1, computed
//      at call time. Deleting an untitled complaint by hand frees its number.
//
// New exports are read off the module namespace and asserted to be functions,
// so a missing export is an assertion failure, not a transpile error.
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';

import { t } from '@/shared/strings';

import * as glue from './caseRichEditor';
import {
  appendOrCreateTable,
  caseEditorExtensions,
  insertComplaint,
} from './caseRichEditor';
import { buildFamilySeed } from './caseRich';

type RemoveTableRowAt = (editor: Editor, rowPos: number) => boolean;

function removeTableRowAt(): RemoveTableRowAt {
  const f = (glue as unknown as Record<string, unknown>)['removeTableRowAt'];
  expect(
    typeof f,
    'caseRichEditor.removeTableRowAt(editor, rowPos) must be exported (RWv6 item 6)',
  ).toBe('function');
  return f as RemoveTableRowAt;
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function makeEditor(content: unknown): Editor {
  editor = new Editor({
    extensions: caseEditorExtensions(),
    content: content as never,
  });
  return editor;
}

// ---- JSON builders ---------------------------------------------------------

const txt = (s: string) => (s === '' ? [] : [{ type: 'text', text: s }]);
const para = (s: string) =>
  s === '' ? { type: 'paragraph' } : { type: 'paragraph', content: txt(s) };
const cellRow = (kind: string, cells: readonly string[]) => ({
  type: 'tableRow',
  content: cells.map((v) => ({ type: kind, content: [para(v)] })),
});
const entry = (name: string) => ({
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
});
const complaint = (no: number, label: string) => ({
  type: 'heading',
  attrs: {
    level: 1,
    hcKind: 'complaint',
    hcComplaintNo: no,
    hcComplaintId: `cc${no}`,
  },
  content: txt(label),
});
const section = (kind: string) => ({
  type: 'heading',
  attrs: { level: 3, hcKind: 'section', hcSectionNo: 1, hcSectionType: kind },
  content: txt('\u2022 Section'),
});
const tableOf = (
  kind: string,
  header: readonly string[],
  rows: ReadonlyArray<readonly string[]>,
) => ({
  type: 'table',
  attrs: { hcTableType: kind },
  content: [
    cellRow('tableHeader', header),
    ...rows.map((r) => cellRow('tableCell', r)),
  ],
});

// ---- live-doc readers ------------------------------------------------------

function rowPositions(ed: Editor): number[] {
  const out: number[] = [];
  ed.state.doc.descendants((node: PmNode, pos: number) => {
    if (node.type.name === 'tableRow') out.push(pos);
    return true;
  });
  return out;
}

function tableRowsText(ed: Editor, kind: string): string[][][] {
  const out: string[][][] = [];
  ed.state.doc.forEach((node) => {
    if (node.type.name !== 'table' || node.attrs['hcTableType'] !== kind)
      return;
    const rows: string[][] = [];
    node.forEach((r, _o, i) => {
      if (i === 0) return; // header
      const cells: string[] = [];
      r.forEach((c) => cells.push(c.textContent));
      rows.push(cells);
    });
    out.push(rows);
  });
  return out;
}

function topLevelKinds(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.forEach((n) => {
    out.push(
      n.type.name === 'heading'
        ? `heading:${String(n.attrs['hcKind'])}`
        : n.type.name,
    );
  });
  return out;
}

function complaintHeadings(ed: Editor): { no: unknown; text: string }[] {
  const out: { no: unknown; text: string }[] = [];
  ed.state.doc.forEach((n) => {
    if (n.type.name === 'heading' && n.attrs['hcKind'] === 'complaint') {
      out.push({ no: n.attrs['hcComplaintNo'], text: n.textContent });
    }
  });
  return out;
}

/** Caret inside the first top-level paragraph (real PM position). */
function caretInFirstParagraph(ed: Editor): void {
  let at = -1;
  ed.state.doc.forEach((n, offset) => {
    if (at === -1 && n.type.name === 'paragraph') at = offset + 1;
  });
  ed.commands.setTextSelection(at);
}

// ===========================================================================
// (5) family history glue
// ===========================================================================

describe('RWv6 item 5 glue: appendOrCreateTable fills the empty family column', () => {
  const header = [
    t('case.form.family.maternal'),
    t('case.form.family.paternal'),
  ];

  it('Paternal-only after Maternal-only fills the Paternal cells from the top', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        entry('Headache'),
        para('Notes.'),
        { type: 'horizontalRule' },
        section('family_history'),
        tableOf('family_history', header, [
          ['Diabetes', ''],
          ['Hypertension', ''],
        ]),
      ],
    });
    caretInFirstParagraph(ed);
    appendOrCreateTable(
      ed,
      'family_history',
      buildFamilySeed({ maternal: '', paternal: 'Asthma\nGout\nCancer' }, t),
    );
    expect(tableRowsText(ed, 'family_history')).toEqual([
      [
        ['Diabetes', 'Asthma'],
        ['Hypertension', 'Gout'],
        ['', 'Cancer'],
      ],
    ]);
  });
});

// ===========================================================================
// (6) removeTableRowAt
// ===========================================================================

function vitalsDoc(rows: ReadonlyArray<readonly string[]>): unknown {
  return {
    type: 'doc',
    content: [
      entry('Headache'),
      para('Notes.'),
      { type: 'horizontalRule' },
      section('vitals'),
      tableOf('vitals', ['BP', 'Pulse'], rows),
      para('After the table.'),
    ],
  };
}

describe('RWv6 item 6 glue: removeTableRowAt (real PM positions)', () => {
  it('removes the data row at that position', () => {
    const remove = removeTableRowAt();
    const ed = makeEditor(
      vitalsDoc([
        ['120', '72'],
        ['130', '80'],
      ]),
    );
    const [, firstData] = rowPositions(ed);
    expect(remove(ed, firstData!)).toBe(true);
    expect(tableRowsText(ed, 'vitals')).toEqual([[['130', '80']]]);
  });

  it('refuses the header row: returns false and leaves the doc unchanged', () => {
    const remove = removeTableRowAt();
    const ed = makeEditor(vitalsDoc([['120', '72']]));
    const before = JSON.stringify(ed.getJSON());
    const [headerPos] = rowPositions(ed);
    expect(remove(ed, headerPos!)).toBe(false);
    expect(JSON.stringify(ed.getJSON())).toBe(before);
  });

  it('deleting the last data row removes the table, its heading and its rule', () => {
    const remove = removeTableRowAt();
    const ed = makeEditor(vitalsDoc([['120', '72']]));
    const [, onlyData] = rowPositions(ed);
    expect(remove(ed, onlyData!)).toBe(true);
    expect(topLevelKinds(ed)).toEqual([
      'heading:entry',
      'paragraph',
      'paragraph',
    ]);
    expect(ed.state.doc.textContent).toContain('After the table.');
  });

  it('is undoable as one step (one transaction)', () => {
    const remove = removeTableRowAt();
    const ed = makeEditor(
      vitalsDoc([
        ['120', '72'],
        ['130', '80'],
      ]),
    );
    const before = JSON.stringify(ed.getJSON());
    const [, firstData] = rowPositions(ed);
    remove(ed, firstData!);
    ed.commands.undo();
    expect(JSON.stringify(ed.getJSON())).toBe(before);
  });
});

// ===========================================================================
// (7) insertComplaint numbering at click time
// ===========================================================================

describe('RWv6 item 7 glue: insertComplaint numbers from the document', () => {
  const ADD = { date: '2026-10-24', visitId: 'v-1' };

  it('after the untitled #2 heading is deleted by hand, the next complaint is #2 (not #3)', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        complaint(1, '1. Headache'),
        entry('Headache'),
        para('Throbbing.'),
      ],
    });
    // Add an untitled complaint (#2), then delete its heading text by hand:
    // select "2. Untitled complaint" and press Delete. ProseMirror keeps the
    // EMPTY heading node (old attrs, hcComplaintNo 2) with no visible number.
    insertComplaint(ed, { name: '', ...ADD });
    let headingTextStart = -1;
    let headingTextSize = 0;
    ed.state.doc.forEach((n, offset) => {
      if (n.type.name === 'heading' && n.attrs['hcComplaintNo'] === 2) {
        headingTextStart = offset + 1;
        headingTextSize = n.content.size;
      }
    });
    expect(headingTextStart, 'untitled complaint #2 was added').toBeGreaterThan(
      0,
    );
    ed.commands.setTextSelection({
      from: headingTextStart,
      to: headingTextStart + headingTextSize,
    });
    ed.commands.deleteSelection();
    expect(
      complaintHeadings(ed).map((h) => h.text),
      'the #2 heading text is gone',
    ).toEqual(['1. Headache', '']);

    insertComplaint(ed, { name: 'Cough', ...ADD });
    const cough = complaintHeadings(ed).find((h) => h.text.includes('Cough'));
    expect(cough, 'the Cough complaint heading').toBeDefined();
    expect(cough!.text).toBe('2. Cough');
    expect(cough!.no).toBe(2);
    expect(
      complaintHeadings(ed).filter((h) => /^\s*3\./.test(h.text)),
    ).toHaveLength(0);
  });

  it('numbers from the highest complaint number present (1 and 3 -> 4)', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        complaint(1, '1. Headache'),
        entry('Headache'),
        para(''),
        complaint(3, '3. Cough'),
        entry('Cough'),
        para(''),
      ],
    });
    insertComplaint(ed, { name: 'Vertigo', ...ADD });
    const v = complaintHeadings(ed).find((h) => h.text.includes('Vertigo'));
    expect(v?.text).toBe('4. Vertigo');
    expect(v?.no).toBe(4);
  });
});
