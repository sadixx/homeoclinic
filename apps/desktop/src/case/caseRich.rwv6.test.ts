// RED pure-kernel tests for the M3-RWv6 case-editor items, over plain
// ProseMirror JSON (the same kernel the live editor glue applies):
//
//  (5) FAMILY HISTORY FILLS THE EMPTY COLUMN FROM THE TOP. Recording Paternal
//      into an entry whose family table holds only Maternal values (or vice
//      versa) writes the new values into that column's EMPTY cells from the
//      top. Rows are added only for values beyond the empty cells. CUT: the
//      existing export `appendOrCreateTableInSpine` (kind 'family_history').
//  (6) DELETE A TABLE ROW. Proposed export `removeTableRow(spine, tableIndex,
//      rowIndex)`: `tableIndex` is the top-level index of the table node,
//      `rowIndex` its row index (0 = header). The header row is never deleted
//      (spine returned unchanged). Deleting the LAST data row removes the
//      table AND its section heading and rule ("heading marker").
//  (7) COMPLAINT NUMBERING. Proposed export `nextComplaintNumber(spine)`: the
//      highest complaint number visible in the document's complaint headings
//      plus 1, computed at click time (not a count, not a counter). A
//      complaint heading whose text was deleted by hand carries no number.
//
// New exports are read off the module namespace and asserted to be
// functions, so a missing export is an assertion failure, not a type error.
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect } from 'vitest';

import { t } from '@/shared/strings';

import * as rich from './caseRich';
import {
  appendOrCreateTableInSpine,
  buildFamilySeed,
  buildVitalsSeed,
  proseMirrorNodeSize,
  type ProseMirrorNode,
} from './caseRich';

function exported<T>(name: string): T {
  const f = (rich as unknown as Record<string, unknown>)[name];
  expect(typeof f, `caseRich.${name}() must be exported (RWv6)`).toBe(
    'function',
  );
  return f as T;
}

type RemoveTableRow = (
  spine: ProseMirrorNode,
  tableIndex: number,
  rowIndex: number,
) => ProseMirrorNode;
type NextComplaintNumber = (spine: ProseMirrorNode) => number;

// ---- builders ---------------------------------------------------------------

function text(s: string): ProseMirrorNode[] {
  return s === '' ? [] : [{ type: 'text', text: s }];
}

function para(s: string): ProseMirrorNode {
  const c = text(s);
  return c.length === 0
    ? { type: 'paragraph' }
    : { type: 'paragraph', content: c };
}

function row(kind: 'tableHeader' | 'tableCell', cells: readonly string[]) {
  return {
    type: 'tableRow',
    content: cells.map((v) => ({ type: kind, content: [para(v)] })),
  } as ProseMirrorNode;
}

function table(
  kind: string,
  header: readonly string[],
  rows: ReadonlyArray<readonly string[]>,
): ProseMirrorNode {
  return {
    type: 'table',
    attrs: { hcTableType: kind },
    content: [
      row('tableHeader', header),
      ...rows.map((r) => row('tableCell', r)),
    ],
  };
}

function sectionHeading(kind: string): ProseMirrorNode {
  return {
    type: 'heading',
    attrs: { level: 3, hcKind: 'section', hcSectionNo: 1, hcSectionType: kind },
    content: text('\u2022 Section'),
  };
}

function entryHeading(): ProseMirrorNode {
  return {
    type: 'heading',
    attrs: {
      level: 2,
      hcKind: 'entry',
      hcEntryKind: 'first',
      hcComplaintName: 'Headache',
      hcDate: '2026-10-24',
      hcVisitId: 'v-1',
    },
    content: text('Headache \u2014 24-10-2026'),
  };
}

function complaintHeading(no: number, label: string): ProseMirrorNode {
  return {
    type: 'heading',
    attrs: {
      level: 1,
      hcKind: 'complaint',
      hcComplaintNo: no,
      hcComplaintId: `cc${no}`,
    },
    content: text(label),
  };
}

const FAMILY_HEADER = [
  t('case.form.family.maternal'),
  t('case.form.family.paternal'),
];

/** [entry, paragraph, hr, heading, family table] — caret in the paragraph. */
function familySpine(rows: ReadonlyArray<readonly string[]>): ProseMirrorNode {
  return {
    type: 'doc',
    content: [
      entryHeading(),
      para('Notes.'),
      { type: 'horizontalRule' },
      sectionHeading('family_history'),
      table('family_history', FAMILY_HEADER, rows),
    ],
  };
}

/** A real ProseMirror position inside the paragraph after the entry heading. */
function caretInParagraph(spine: ProseMirrorNode): number {
  return proseMirrorNodeSize(spine.content![0]!) + 1;
}

function cellText(n: ProseMirrorNode): string {
  if (n.type === 'text') return n.text ?? '';
  return (n.content ?? []).map(cellText).join('');
}

/** Body rows (header excluded) of every table of `kind`, as strings. */
function familyTables(spine: ProseMirrorNode): string[][][] {
  return (spine.content ?? [])
    .filter(
      (n) =>
        n.type === 'table' && n.attrs?.['hcTableType'] === 'family_history',
    )
    .map((tb) =>
      (tb.content ?? []).slice(1).map((r) => (r.content ?? []).map(cellText)),
    );
}

function recordFamily(
  spine: ProseMirrorNode,
  maternal: string,
  paternal: string,
): ProseMirrorNode {
  return appendOrCreateTableInSpine(
    spine,
    caretInParagraph(spine),
    'family_history',
    buildFamilySeed({ maternal, paternal }, t),
  );
}

// ===========================================================================
// (5) family history fills the empty column from the top
// ===========================================================================

describe('RWv6 item 5: family history fills the empty column from the top', () => {
  it('Maternal recorded, then Paternal only: the Paternal cells fill from the top (no offset rows)', () => {
    const before = familySpine([
      ['Diabetes', ''],
      ['Hypertension', ''],
    ]);
    const after = recordFamily(before, '', 'Asthma');
    expect(familyTables(after)).toEqual([
      [
        ['Diabetes', 'Asthma'],
        ['Hypertension', ''],
      ],
    ]);
  });

  it('Paternal recorded, then Maternal only: the Maternal cells fill from the top', () => {
    const before = familySpine([
      ['', 'Asthma'],
      ['', 'Gout'],
    ]);
    const after = recordFamily(before, 'Diabetes\nThyroid', '');
    expect(familyTables(after)).toEqual([
      [
        ['Diabetes', 'Asthma'],
        ['Thyroid', 'Gout'],
      ],
    ]);
  });

  it('adds rows only for the values beyond the empty cells', () => {
    const before = familySpine([
      ['Diabetes', ''],
      ['Hypertension', ''],
    ]);
    const after = recordFamily(before, '', 'Asthma\nGout\nCancer');
    expect(familyTables(after)).toEqual([
      [
        ['Diabetes', 'Asthma'],
        ['Hypertension', 'Gout'],
        ['', 'Cancer'],
      ],
    ]);
  });

  it('fills the first EMPTY cell of a partly filled column', () => {
    const before = familySpine([
      ['Diabetes', 'Asthma'],
      ['Hypertension', ''],
    ]);
    const after = recordFamily(before, '', 'Gout');
    expect(familyTables(after)).toEqual([
      [
        ['Diabetes', 'Asthma'],
        ['Hypertension', 'Gout'],
      ],
    ]);
  });

  it('a new Maternal value with no empty Maternal cell appends a row (no overwrite)', () => {
    const before = familySpine([['Diabetes', 'Asthma']]);
    const after = recordFamily(before, 'Thyroid', '');
    expect(familyTables(after)).toEqual([
      [
        ['Diabetes', 'Asthma'],
        ['Thyroid', ''],
      ],
    ]);
  });

  it('GUARD: other kinds keep plain row append (vitals twice = two rows)', () => {
    const spine: ProseMirrorNode = {
      type: 'doc',
      content: [entryHeading(), para('Notes.')],
    };
    const vitals = (sys: string) =>
      buildVitalsSeed(
        {
          systolic: sys,
          diastolic: '80',
          pulse: '',
          weightKg: '',
          heightCm: '',
          bmi: '',
          temp: '',
          spo2: '',
        },
        t,
      );
    const once = appendOrCreateTableInSpine(
      spine,
      caretInParagraph(spine),
      'vitals',
      vitals('120'),
    );
    const twice = appendOrCreateTableInSpine(
      once,
      caretInParagraph(once),
      'vitals',
      vitals('130'),
    );
    const tables = (twice.content ?? []).filter((n) => n.type === 'table');
    expect(tables).toHaveLength(1);
    expect((tables[0]!.content ?? []).length).toBe(3);
  });
});

// ===========================================================================
// (6) delete a table row
// ===========================================================================

/** [entry, para, hr, heading, vitals table(2 rows), para] */
function vitalsSpine(rows: ReadonlyArray<readonly string[]>): ProseMirrorNode {
  return {
    type: 'doc',
    content: [
      entryHeading(),
      para('Notes.'),
      { type: 'horizontalRule' },
      sectionHeading('vitals'),
      table('vitals', ['BP', 'Pulse'], rows),
      para('After the table.'),
    ],
  };
}
const TABLE_INDEX = 4;

function bodyRows(spine: ProseMirrorNode): string[][] {
  const tb = (spine.content ?? []).find((n) => n.type === 'table');
  if (tb === undefined) return [];
  return (tb.content ?? [])
    .slice(1)
    .map((r) => (r.content ?? []).map(cellText));
}

describe('RWv6 item 6: removeTableRow', () => {
  it('removes the chosen data row and keeps the others in order', () => {
    const remove = exported<RemoveTableRow>('removeTableRow');
    const before = vitalsSpine([
      ['120', '72'],
      ['130', '80'],
      ['140', '88'],
    ]);
    const after = remove(before, TABLE_INDEX, 2);
    expect(bodyRows(after)).toEqual([
      ['120', '72'],
      ['140', '88'],
    ]);
  });

  it('never deletes the header row (spine unchanged)', () => {
    const remove = exported<RemoveTableRow>('removeTableRow');
    const before = vitalsSpine([['120', '72']]);
    const after = remove(before, TABLE_INDEX, 0);
    expect(after).toEqual(before);
  });

  it('deleting the last data row removes the table, its section heading and its rule', () => {
    const remove = exported<RemoveTableRow>('removeTableRow');
    const before = vitalsSpine([['120', '72']]);
    const after = remove(before, TABLE_INDEX, 1);
    const types = (after.content ?? []).map((n) =>
      n.type === 'heading' ? `heading:${String(n.attrs?.['hcKind'])}` : n.type,
    );
    expect(types).toEqual(['heading:entry', 'paragraph', 'paragraph']);
    expect(cellText(after)).toContain('After the table.');
  });

  it('does not mutate the input spine', () => {
    const remove = exported<RemoveTableRow>('removeTableRow');
    const before = vitalsSpine([
      ['120', '72'],
      ['130', '80'],
    ]);
    const snapshot = JSON.stringify(before);
    remove(before, TABLE_INDEX, 1);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

// ===========================================================================
// (7) complaint numbering = highest visible complaint number + 1
// ===========================================================================

describe('RWv6 item 7: nextComplaintNumber', () => {
  it('two numbered complaints -> 3', () => {
    const next = exported<NextComplaintNumber>('nextComplaintNumber');
    const spine: ProseMirrorNode = {
      type: 'doc',
      content: [
        complaintHeading(1, '1. Headache'),
        entryHeading(),
        para(''),
        complaintHeading(2, `2. ${t('case.form.complaint.untitled')}`),
        para(''),
      ],
    };
    expect(next(spine)).toBe(3);
  });

  it('a complaint whose heading text was deleted by hand no longer counts (-> 2, not 3)', () => {
    const next = exported<NextComplaintNumber>('nextComplaintNumber');
    const spine: ProseMirrorNode = {
      type: 'doc',
      content: [
        complaintHeading(1, '1. Headache'),
        entryHeading(),
        para('Throbbing.'),
        // The doctor selected "2. Untitled complaint ..." and pressed Delete:
        // ProseMirror keeps an EMPTY heading node with the old attrs.
        complaintHeading(2, ''),
      ],
    };
    expect(next(spine)).toBe(2);
  });

  it('uses the HIGHEST number in the document, not the count (1 and 3 -> 4)', () => {
    const next = exported<NextComplaintNumber>('nextComplaintNumber');
    const spine: ProseMirrorNode = {
      type: 'doc',
      content: [
        complaintHeading(1, '1. Headache'),
        para(''),
        complaintHeading(3, '3. Cough'),
        para(''),
      ],
    };
    expect(next(spine)).toBe(4);
  });

  it('a removed complaint section (heading node gone) frees its number (-> 2)', () => {
    const next = exported<NextComplaintNumber>('nextComplaintNumber');
    const spine: ProseMirrorNode = {
      type: 'doc',
      content: [complaintHeading(1, '1. Headache'), entryHeading(), para('')],
    };
    expect(next(spine)).toBe(2);
  });
});
