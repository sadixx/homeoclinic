// RED unit tests for the M3-RWv5 EDITOR GLUE `appendOrCreateTable(editor,
// kind, seed)` (caseRichEditor.ts). It generalises the RWv4 modalities-only
// `appendOrCreateModalities` to ALL six table kinds: one table per type per
// entry.
//
// Contract under test:
//   - The CURRENT ENTRY is the dated entry holding the live caret
//     (`editor.state.selection.head`), resolved on REAL ProseMirror positions.
//     It is no longer "the last entry in the doc".
//   - The first call for a kind in that entry creates [hr, section heading,
//     table] at the end of the entry. Later calls for the same kind in the
//     same entry append the seed rows to that table.
//   - A new follow-up entry starts fresh.
//
// CUT: the real caseEditorExtensions() + insertDatedEntry() over a headless
// @tiptap/core Editor (works under jsdom). `appendOrCreateTable` is read off
// the module namespace and asserted to be a function, so a missing export is
// an assertion failure, not a transpile error.
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';

import { t as tr } from '@/shared/strings';

import * as glue from './caseRichEditor';
import { caseEditorExtensions, insertDatedEntry } from './caseRichEditor';
import {
  buildFamilySeed,
  buildPrescriptionSeed,
  buildVitalsSeed,
  type ProseMirrorNode,
  type RichTableType,
  type TableSeed,
} from './caseRich';

type AppendOrCreateTable = (
  editor: Editor,
  kind: RichTableType,
  seed: TableSeed,
) => void;

function appendOrCreateTable(): AppendOrCreateTable {
  const fn = (glue as unknown as Record<string, unknown>)[
    'appendOrCreateTable'
  ];
  expect(
    typeof fn,
    'caseRichEditor.appendOrCreateTable(editor, kind, seed) must be exported (RWv5 §A)',
  ).toBe('function');
  return fn as AppendOrCreateTable;
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

/** Put the caret inside the paragraph after the `entryNo`-th entry heading. */
function caretInEntry(ed: Editor, entryNo: number): void {
  let seen = -1;
  let found = -1;
  let want = false;
  ed.state.doc.forEach((node, offset) => {
    if (found !== -1) return;
    if (node.type.name === 'heading' && node.attrs['hcKind'] === 'entry') {
      seen += 1;
      want = seen === entryNo;
      return;
    }
    if (want && node.type.name === 'paragraph') found = offset + 1;
  });
  if (found === -1) throw new Error(`no paragraph after entry #${entryNo}`);
  ed.commands.setTextSelection(found);
}

function spine(ed: Editor): ProseMirrorNode {
  return ed.getJSON() as unknown as ProseMirrorNode;
}

function oneEntryDoc(): unknown {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: {
          level: 1,
          hcKind: 'complaint',
          hcComplaintNo: 1,
          hcComplaintId: 'cc1',
        },
        content: [{ type: 'text', text: '1. Headache' }],
      },
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
  };
}

const KINDS: ReadonlyArray<{
  kind: RichTableType;
  seed: (m: string) => TableSeed;
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

function isEntry(n: ProseMirrorNode): boolean {
  return n.type === 'heading' && n.attrs?.['hcKind'] === 'entry';
}

/** Tables of `kind` in the `entryNo`-th entry span (top-level, doc order). */
function tablesInEntry(
  doc: ProseMirrorNode,
  entryNo: number,
  kind: RichTableType,
): ProseMirrorNode[] {
  const nodes = doc.content ?? [];
  let seen = -1;
  const out: ProseMirrorNode[] = [];
  for (const n of nodes) {
    if (isEntry(n)) {
      seen += 1;
      continue;
    }
    if (n.type === 'heading' && n.attrs?.['hcKind'] === 'complaint') {
      if (seen >= entryNo) break;
      continue;
    }
    if (
      seen === entryNo &&
      n.type === 'table' &&
      n.attrs?.['hcTableType'] === kind
    )
      out.push(n);
  }
  return out;
}

function allText(node: ProseMirrorNode | undefined): string {
  if (node === undefined) return '';
  let out =
    node.type === 'text' && typeof node.text === 'string' ? node.text : '';
  for (const c of node.content ?? []) out += ` ${allText(c)}`;
  return out;
}

function rowCount(t: ProseMirrorNode): number {
  return (t.content ?? []).filter((r) => r.type === 'tableRow').length;
}

describe.each(KINDS)(
  'RWv5 A — appendOrCreateTable glue, kind=$kind',
  ({ kind, seed }) => {
    it('first call creates one table; a second call in the SAME entry appends (count stays 1, rows grow)', () => {
      const ed = makeEditor(oneEntryDoc());
      const fn = appendOrCreateTable();
      caretInEntry(ed, 0);
      fn(ed, kind, seed('G1'));
      const afterOne = tablesInEntry(spine(ed), 0, kind);
      expect(afterOne).toHaveLength(1);
      const rowsOne = rowCount(afterOne[0]!);

      caretInEntry(ed, 0);
      fn(ed, kind, seed('G2'));
      const afterTwo = tablesInEntry(spine(ed), 0, kind);
      expect(afterTwo, 'one table of this kind per entry').toHaveLength(1);
      expect(rowCount(afterTwo[0]!)).toBeGreaterThan(rowsOne);
      expect(allText(afterTwo[0])).toContain('G1');
      expect(allText(afterTwo[0])).toContain('G2');
    });

    it('after a follow-up entry is added, a call with the caret there creates a NEW table in the follow-up and later calls append there', () => {
      const ed = makeEditor(oneEntryDoc());
      const fn = appendOrCreateTable();
      caretInEntry(ed, 0);
      fn(ed, kind, seed('E1'));
      const firstBefore = tablesInEntry(spine(ed), 0, kind)[0];

      insertDatedEntry(ed, '2026-11-01', 'v-1', 'Headache', 'follow_up');
      caretInEntry(ed, 1);
      fn(ed, kind, seed('E2'));
      caretInEntry(ed, 1);
      fn(ed, kind, seed('E3'));

      const doc = spine(ed);
      const follow = tablesInEntry(doc, 1, kind);
      expect(follow, 'the follow-up entry gets its OWN table').toHaveLength(1);
      expect(allText(follow[0])).toContain('E2');
      expect(allText(follow[0])).toContain('E3');
      const first = tablesInEntry(doc, 0, kind);
      expect(first).toHaveLength(1);
      expect(first[0], 'the first entry table is untouched').toEqual(
        firstBefore,
      );
    });

    it('with the caret back in the FIRST entry, a call appends to the first entry table, not the follow-up', () => {
      const ed = makeEditor(oneEntryDoc());
      const fn = appendOrCreateTable();
      insertDatedEntry(ed, '2026-11-01', 'v-1', 'Headache', 'follow_up');
      caretInEntry(ed, 1);
      fn(ed, kind, seed('L1'));
      caretInEntry(ed, 0);
      fn(ed, kind, seed('L0'));

      const doc = spine(ed);
      expect(tablesInEntry(doc, 0, kind)).toHaveLength(1);
      expect(allText(tablesInEntry(doc, 0, kind)[0])).toContain('L0');
      expect(tablesInEntry(doc, 1, kind)).toHaveLength(1);
      expect(allText(tablesInEntry(doc, 1, kind)[0])).not.toContain('L0');
    });
  },
);
