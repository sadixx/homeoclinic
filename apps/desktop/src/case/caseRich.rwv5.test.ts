// RED unit tests for the M3-RWv5 PURE case-rich kernel (caseRich.ts):
//
//  (A) ONE TABLE PER TYPE PER ENTRY for ALL six table types, through the NEW
//      pure kernel `appendOrCreateTableInSpine(spine, caretPos, kind, seed)`.
//      This generalises the RWv4 modalities-only `appendOrCreateModalities`.
//      The CURRENT ENTRY is the dated entry that holds the caret, measured in
//      REAL ProseMirror positions (`editor.state.selection.head`), never the
//      old JSON-length scale. Its span runs from its `hcKind:"entry"` heading
//      up to the next entry/complaint heading or the end of the doc. The first
//      Record of a kind in that span creates `[hr, section heading, table]` at
//      the END of the span. Any later Record of the same kind in the SAME span
//      appends the seed's body rows to that table. A new follow-up entry starts
//      fresh.
//  (C) No numeric section prefixes: section headings show a bullet marker +
//      the label, never "<n>. ", and the FTS mirror keeps the label. A fresh
//      case shows no "Untitled complaint" section.
//
// Caret positions come from a REAL headless TipTap editor over the real
// `caseEditorExtensions()` (doc.descendants), so the test uses exactly the
// scale the CaseForm passes. The spine fed to the kernel is that editor's
// `getJSON()`, so positions and JSON agree.
//
// `appendOrCreateTableInSpine` does not exist yet. It is read off the module
// namespace and asserted to be a function, so the RED is an assertion
// failure, not a TypeScript/transpile error.
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';

import { t as tr } from '@/shared/strings';

import * as rich from './caseRich';
import {
  buildFamilySeed,
  buildPrescriptionSeed,
  buildSectionNodes,
  buildVitalsSeed,
  emptyRichDoc,
  extractCaseText,
  joinComplaintsToSpine,
  type ProseMirrorNode,
  type RichTableType,
  type TableSeed,
  type V3Doc,
} from './caseRich';
import { caseEditorExtensions, initialContent } from './caseRichEditor';

// ---------------------------------------------------------------------------
// The CUT handle (read off the namespace so a missing export is an assertion).
// ---------------------------------------------------------------------------

type AppendOrCreateInSpine = (
  spine: ProseMirrorNode,
  caretPos: number,
  kind: RichTableType,
  seed: TableSeed,
) => ProseMirrorNode;

function kernel(): AppendOrCreateInSpine {
  const fn = (rich as unknown as Record<string, unknown>)[
    'appendOrCreateTableInSpine'
  ];
  expect(
    typeof fn,
    'caseRich.appendOrCreateTableInSpine(spine, caretPos, kind, seed) must be exported (RWv5 §A)',
  ).toBe('function');
  return fn as AppendOrCreateInSpine;
}

// ---------------------------------------------------------------------------
// Headless editor for REAL ProseMirror positions.
// ---------------------------------------------------------------------------

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** Load a spine into a headless editor; return its normalised JSON. */
function load(spine: unknown): ProseMirrorNode {
  editor?.destroy();
  editor = new Editor({
    extensions: caseEditorExtensions(),
    content: spine as never,
  });
  return editor.getJSON() as unknown as ProseMirrorNode;
}

/**
 * The REAL ProseMirror position inside the paragraph that follows the
 * `entryNo`-th (0-based, doc order) entry heading of the loaded spine.
 */
function caretInEntry(entryNo: number): number {
  if (editor === null) throw new Error('load() first');
  let seen = -1;
  let found = -1;
  let wantParagraph = false;
  editor.state.doc.forEach((node, offset) => {
    if (found !== -1) return;
    if (node.type.name === 'heading' && node.attrs['hcKind'] === 'entry') {
      seen += 1;
      wantParagraph = seen === entryNo;
      return;
    }
    if (wantParagraph && node.type.name === 'paragraph') {
      found = offset + 1; // inside the paragraph
    }
  });
  if (found === -1) throw new Error(`no paragraph after entry #${entryNo}`);
  return found;
}

// ---------------------------------------------------------------------------
// Fixtures (synthetic clinical text only).
// ---------------------------------------------------------------------------

function complaintHeader(no: number, id: string, name: string): unknown {
  return {
    type: 'heading',
    attrs: {
      level: 1,
      hcKind: 'complaint',
      hcComplaintNo: no,
      hcComplaintId: id,
    },
    content: [{ type: 'text', text: `${no}. ${name}` }],
  };
}

function entryHeading(
  kind: 'first' | 'follow_up',
  name: string,
  date: string,
): unknown {
  return {
    type: 'heading',
    attrs: {
      level: 2,
      hcKind: 'entry',
      hcEntryKind: kind,
      hcComplaintName: name,
      hcDate: date,
      hcVisitId: 'v-1',
    },
    content: [{ type: 'text', text: `${name} — ${date}` }],
  };
}

function para(text: string): unknown {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

/** One complaint, a FIRST entry and a FOLLOW-UP entry, each with prose. */
function twoEntrySpine(): unknown {
  return {
    type: 'doc',
    content: [
      complaintHeader(1, 'cc1', 'Headache'),
      entryHeading('first', 'Headache', '2026-10-24'),
      para('Throbbing right temple, worse in the sun since three weeks.'),
      entryHeading('follow_up', 'Headache', '2026-11-01'),
      para('Better by half.'),
    ],
  };
}

/** Two complaints, each with one entry. */
function twoComplaintSpine(): unknown {
  return {
    type: 'doc',
    content: [
      complaintHeader(1, 'cc1', 'Headache'),
      entryHeading('first', 'Headache', '2026-10-24'),
      para('Throbbing right temple.'),
      complaintHeader(2, 'cc2', 'Acidity'),
      entryHeading('first', 'Acidity', '2026-10-24'),
      para('Sour eructations after meals.'),
    ],
  };
}

// The six table kinds and a seed builder for each (same shapes the CaseForm
// popups emit). `marker` is a unique cell value so a row can be traced.
const KINDS: ReadonlyArray<{
  kind: RichTableType;
  seed: (marker: string) => TableSeed;
}> = [
  {
    kind: 'vitals',
    seed: (m) =>
      buildVitalsSeed(
        {
          systolic: m,
          diastolic: '80',
          pulse: '',
          weightKg: '',
          heightCm: '',
          bmi: '',
          temp: '',
          spo2: '',
        },
        tr,
      ),
  },
  {
    kind: 'modalities',
    seed: (m) => ({
      hcTableType: 'modalities',
      columns: ['Factor', 'Aggravation', 'Amelioration'],
      rows: [[m, 'Worse', '']],
    }),
  },
  {
    kind: 'family_history',
    seed: (m) => buildFamilySeed({ maternal: m, paternal: `${m}-p` }, tr),
  },
  {
    kind: 'physical_generals',
    seed: (m) => ({
      hcTableType: 'physical_generals',
      columns: ['Field', 'Value'],
      rows: [['Appetite', m]],
    }),
  },
  {
    kind: 'investigations',
    seed: (m) => ({
      hcTableType: 'investigations',
      columns: ['Investigation', 'Status', 'Notes'],
      rows: [[m, 'Suggested', '']],
    }),
  },
  {
    kind: 'prescription',
    seed: (m) =>
      buildPrescriptionSeed(
        { medicine: m, potency: '30C', dosage: '', instructions: '' },
        tr,
      ),
  },
];

// ---------------------------------------------------------------------------
// Structural helpers over the top-level spine.
// ---------------------------------------------------------------------------

function top(spine: ProseMirrorNode): readonly ProseMirrorNode[] {
  return spine.content ?? [];
}

function isEntry(n: ProseMirrorNode): boolean {
  return n.type === 'heading' && n.attrs?.['hcKind'] === 'entry';
}

function isComplaint(n: ProseMirrorNode): boolean {
  return n.type === 'heading' && n.attrs?.['hcKind'] === 'complaint';
}

/** Top-level node index ranges [start, end) of every entry span, doc order. */
function entrySpans(spine: ProseMirrorNode): Array<[number, number]> {
  const nodes = top(spine);
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < nodes.length; i += 1) {
    if (!isEntry(nodes[i]!)) continue;
    let j = i + 1;
    while (j < nodes.length && !isEntry(nodes[j]!) && !isComplaint(nodes[j]!))
      j += 1;
    spans.push([i, j]);
  }
  return spans;
}

/** Tables of `kind` inside entry span `entryNo`. */
function tablesInEntry(
  spine: ProseMirrorNode,
  entryNo: number,
  kind: RichTableType,
): ProseMirrorNode[] {
  const span = entrySpans(spine)[entryNo];
  if (span === undefined) return [];
  return top(spine)
    .slice(span[0], span[1])
    .filter((n) => n.type === 'table' && n.attrs?.['hcTableType'] === kind);
}

/** Section headings of `kind` inside entry span `entryNo`. */
function sectionHeadingsInEntry(
  spine: ProseMirrorNode,
  entryNo: number,
  kind: RichTableType,
): ProseMirrorNode[] {
  const span = entrySpans(spine)[entryNo];
  if (span === undefined) return [];
  return top(spine)
    .slice(span[0], span[1])
    .filter(
      (n) =>
        n.type === 'heading' &&
        n.attrs?.['hcKind'] === 'section' &&
        n.attrs?.['hcSectionType'] === kind,
    );
}

function rowsOf(table: ProseMirrorNode): ProseMirrorNode[] {
  return (table.content ?? []).filter((r) => r.type === 'tableRow');
}

function cellTexts(row: ProseMirrorNode): string[] {
  return (row.content ?? []).map((c) => allText(c).trim());
}

function allText(node: ProseMirrorNode | undefined): string {
  if (node === undefined) return '';
  let out =
    node.type === 'text' && typeof node.text === 'string' ? node.text : '';
  for (const child of node.content ?? []) out += ` ${allText(child)}`;
  return out;
}

// ===========================================================================
// (A) one table per type per entry: create, append, distinct types, fresh
// follow-up, for EVERY table kind.
// ===========================================================================

describe.each(KINDS)(
  'RWv5 A — appendOrCreateTableInSpine, kind=$kind',
  ({ kind, seed }) => {
    it('the FIRST Record in an entry creates exactly one table (with one section heading) inside that entry', () => {
      const spine = load(twoEntrySpine());
      const next = kernel()(spine, caretInEntry(0), kind, seed('A1'));
      expect(tablesInEntry(next, 0, kind)).toHaveLength(1);
      expect(sectionHeadingsInEntry(next, 0, kind)).toHaveLength(1);
      expect(allText(tablesInEntry(next, 0, kind)[0])).toContain('A1');
      // nothing leaked into the follow-up entry
      expect(tablesInEntry(next, 1, kind)).toHaveLength(0);
    });

    it('a SECOND Record of the same kind in the same entry APPENDS rows (table count stays 1, rows grow, no 2nd heading)', () => {
      const spine = load(twoEntrySpine());
      const once = kernel()(spine, caretInEntry(0), kind, seed('A1'));
      const rowsBefore = rowsOf(tablesInEntry(once, 0, kind)[0]!).length;

      load(once); // re-measure positions on the grown doc
      const twice = kernel()(once, caretInEntry(0), kind, seed('A2'));

      const tables = tablesInEntry(twice, 0, kind);
      expect(tables, 'still ONE table of this kind in the entry').toHaveLength(
        1,
      );
      expect(sectionHeadingsInEntry(twice, 0, kind)).toHaveLength(1);
      const rowsAfter = rowsOf(tables[0]!).length;
      expect(rowsAfter).toBeGreaterThan(rowsBefore);
      const text = allText(tables[0]);
      expect(text).toContain('A1');
      expect(text).toContain('A2');
      // the header row is preserved (first row is header cells)
      expect(rowsOf(tables[0]!)[0]!.content?.[0]?.type).toBe('tableHeader');
    });

    it('a Record in a FOLLOW-UP entry creates a NEW table there; the prior entry table is untouched; a further Record appends there', () => {
      const spine = load(twoEntrySpine());
      const inFirst = kernel()(spine, caretInEntry(0), kind, seed('F1'));
      const firstTableBefore = tablesInEntry(inFirst, 0, kind)[0]!;

      load(inFirst);
      const inFollow = kernel()(inFirst, caretInEntry(1), kind, seed('U1'));
      expect(tablesInEntry(inFollow, 1, kind)).toHaveLength(1);
      expect(allText(tablesInEntry(inFollow, 1, kind)[0])).toContain('U1');
      expect(
        tablesInEntry(inFollow, 0, kind)[0],
        'the first entry table must be untouched',
      ).toEqual(firstTableBefore);

      load(inFollow);
      const again = kernel()(inFollow, caretInEntry(1), kind, seed('U2'));
      expect(tablesInEntry(again, 1, kind)).toHaveLength(1);
      expect(allText(tablesInEntry(again, 1, kind)[0])).toContain('U2');
      expect(allText(tablesInEntry(again, 0, kind)[0])).not.toContain('U2');
      expect(tablesInEntry(again, 0, kind)[0]).toEqual(firstTableBefore);
    });
  },
);

describe('RWv5 A — different kinds in the same entry each get their own table', () => {
  it('vitals then modalities then vitals: one vitals table (2 body rows) + one modalities table', () => {
    let spine = load(twoEntrySpine());
    spine = kernel()(spine, caretInEntry(0), 'vitals', KINDS[0]!.seed('V1'));
    load(spine);
    spine = kernel()(
      spine,
      caretInEntry(0),
      'modalities',
      KINDS[1]!.seed('M1'),
    );
    load(spine);
    spine = kernel()(spine, caretInEntry(0), 'vitals', KINDS[0]!.seed('V2'));

    const vitals = tablesInEntry(spine, 0, 'vitals');
    const modalities = tablesInEntry(spine, 0, 'modalities');
    expect(vitals).toHaveLength(1);
    expect(modalities).toHaveLength(1);
    expect(rowsOf(vitals[0]!)).toHaveLength(3); // header + V1 + V2
    expect(allText(modalities[0])).not.toContain('V2');
  });
});

describe('RWv5 A — the current entry is resolved on REAL ProseMirror positions', () => {
  it('caret in the FIRST entry (a follow-up exists) inserts the table inside the first entry, not at the doc tail', () => {
    const spine = load(twoEntrySpine());
    const next = kernel()(
      spine,
      caretInEntry(0),
      'vitals',
      KINDS[0]!.seed('P1'),
    );
    const nodes = top(next);
    const followIdx = nodes.findIndex(
      (n) => isEntry(n) && n.attrs?.['hcEntryKind'] === 'follow_up',
    );
    const tableIdx = nodes.findIndex(
      (n) => n.type === 'table' && n.attrs?.['hcTableType'] === 'vitals',
    );
    expect(followIdx).toBeGreaterThan(-1);
    expect(tableIdx).toBeGreaterThan(-1);
    expect(
      tableIdx,
      'the vitals table belongs to the first entry, before the follow-up heading',
    ).toBeLessThan(followIdx);
  });

  it('caret in complaint #1 (complaint #2 exists) records into complaint #1 entry, not the last complaint', () => {
    const spine = load(twoComplaintSpine());
    const next = kernel()(
      spine,
      caretInEntry(0),
      'modalities',
      KINDS[1]!.seed('C1'),
    );
    expect(tablesInEntry(next, 0, 'modalities')).toHaveLength(1);
    expect(tablesInEntry(next, 1, 'modalities')).toHaveLength(0);
  });

  it('caret in complaint #2 records into complaint #2 entry (a JSON-length scale would land in #1)', () => {
    const spine = load(twoComplaintSpine());
    const next = kernel()(
      spine,
      caretInEntry(1),
      'modalities',
      KINDS[1]!.seed('C2'),
    );
    expect(tablesInEntry(next, 1, 'modalities')).toHaveLength(1);
    expect(tablesInEntry(next, 0, 'modalities')).toHaveLength(0);
  });
});

describe('RWv5 A — prescription + family-history append specifics', () => {
  it('an appended prescription table keeps its hcRxPlaceholder marker and 4-cell rows', () => {
    let spine = load(twoEntrySpine());
    spine = kernel()(
      spine,
      caretInEntry(0),
      'prescription',
      KINDS[5]!.seed('Arnica'),
    );
    load(spine);
    spine = kernel()(
      spine,
      caretInEntry(0),
      'prescription',
      KINDS[5]!.seed('Bryonia'),
    );
    const rx = tablesInEntry(spine, 0, 'prescription');
    expect(rx).toHaveLength(1);
    expect(rx[0]!.attrs?.['hcRxPlaceholder']).toBe(true);
    const rows = rowsOf(rx[0]!);
    expect(rows).toHaveLength(3);
    expect(cellTexts(rows[2]!)).toEqual(['Bryonia', '30C', '', '']);
  });

  it('family history appends Maternal/Paternal rows into its 2-column table, each value in its column', () => {
    let spine = load(twoEntrySpine());
    spine = kernel()(
      spine,
      caretInEntry(0),
      'family_history',
      buildFamilySeed({ maternal: 'Diabetes', paternal: 'Asthma' }, tr),
    );
    load(spine);
    spine = kernel()(
      spine,
      caretInEntry(0),
      'family_history',
      buildFamilySeed({ maternal: 'Thyroid', paternal: 'Hypertension' }, tr),
    );
    const fam = tablesInEntry(spine, 0, 'family_history');
    expect(fam).toHaveLength(1);
    const rows = rowsOf(fam[0]!);
    expect(cellTexts(rows[0]!)).toEqual([
      tr('case.form.family.maternal'),
      tr('case.form.family.paternal'),
    ]);
    expect(rows.every((r) => (r.content ?? []).length === 2)).toBe(true);
    expect(cellTexts(rows[rows.length - 1]!)).toEqual([
      'Thyroid',
      'Hypertension',
    ]);
    expect(cellTexts(rows[1]!)).toEqual(['Diabetes', 'Asthma']);
  });
});

// ===========================================================================
// (C) no numeric section prefixes; bullet marker; FTS keeps the label.
// ===========================================================================

const NUMERIC_PREFIX = /^\s*\d+\.\s/;
const BULLET_PREFIX = /^\s*[•●▪◦‣]\s*/;

describe('RWv5 C — section headings use a bullet marker, never "<n>. "', () => {
  it.each(KINDS)(
    'the $kind section heading has no numeric prefix, starts with a bullet, and shows the label',
    ({ kind, seed }) => {
      const nodes = buildSectionNodes({ kind, sectionNo: 2, seed: seed('X') });
      const text = allText(nodes[1]).trim();
      expect(
        text,
        `section heading "${text}" must not carry "<n>. "`,
      ).not.toMatch(NUMERIC_PREFIX);
      expect(
        text,
        `section heading "${text}" must start with a bullet marker`,
      ).toMatch(BULLET_PREFIX);
      expect(text.replace(BULLET_PREFIX, '')).toBe(
        tr(`case.section.label.${kind}` as never),
      );
    },
  );

  it('vitals and modalities stamped with the same number never both render "2"', () => {
    const v = allText(
      buildSectionNodes({
        kind: 'vitals',
        sectionNo: 2,
        seed: KINDS[0]!.seed('x'),
      })[1],
    );
    const m = allText(
      buildSectionNodes({
        kind: 'modalities',
        sectionNo: 2,
        seed: KINDS[1]!.seed('x'),
      })[1],
    );
    expect(v).not.toMatch(/\b2\b/);
    expect(m).not.toMatch(/\b2\b/);
  });

  it('the FTS text mirror still carries the section label (and no "<n>. Label")', () => {
    const base = emptyRichDoc({
      visitId: 'v-1',
      visitAt: '2026-10-24T09:00:00Z',
    });
    const c = base.complaints[0]!;
    const doc: V3Doc = {
      ...base,
      complaints: [
        {
          ...c,
          doc: {
            type: 'doc',
            content: [
              ...(c.doc.content ?? []),
              ...buildSectionNodes({
                kind: 'vitals',
                sectionNo: 1,
                seed: KINDS[0]!.seed('120'),
              }),
            ],
          },
        },
      ],
    };
    const text = extractCaseText(doc);
    const label = tr('case.section.label.vitals');
    expect(text).toContain(label);
    expect(text).not.toContain(`1. ${label}`);
  });
});

// ===========================================================================
// (C) a fresh case shows NO "Untitled complaint" section.
// ===========================================================================

describe('RWv5 C — a fresh case has no "Untitled complaint" sample', () => {
  const ctx = { visitId: 'v-1', visitAt: '2026-10-24T09:00:00Z' };
  const untitled = /untitled complaint/i;

  it('the initial editor content of a fresh case contains no "Untitled complaint" text', () => {
    const spine = initialContent(
      emptyRichDoc(ctx),
    ) as unknown as ProseMirrorNode;
    expect(allText(spine)).not.toMatch(untitled);
  });

  it('the spine joined from a fresh case contains no "Untitled complaint" text', () => {
    const spine = joinComplaintsToSpine(emptyRichDoc(ctx).complaints);
    expect(allText(spine)).not.toMatch(untitled);
  });

  it('control: a fresh case still offers a dated entry to record into', () => {
    const spine = initialContent(
      emptyRichDoc(ctx),
    ) as unknown as ProseMirrorNode;
    expect(top(spine).some(isEntry)).toBe(true);
  });
});
