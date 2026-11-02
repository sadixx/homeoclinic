// Regression tests for reviewer defect rwv5-cr-1: `proseMirrorNodeSize` sized
// every node WITHOUT children as 1, so EMPTY containers (paragraph, heading,
// table cell, ...) — which `editor.getJSON()` emits with no `content` key —
// were sized 1 instead of ProseMirror's 2 (open + close token). Every caret
// after such a node was then off by one per empty node, and a Record (or the
// complaint resolver) could land in the WRONG entry/complaint.
//
// Every caret here is taken from the REAL ProseMirror doc built by the same
// TipTap schema (`caseEditorExtensions()`) in jsdom — never hand-computed — so
// the tests prove the helper runs on the same scale as
// `editor.state.selection.head`.

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';

import { t as tr } from '@/shared/strings';

import {
  appendOrCreateTable,
  caseEditorExtensions,
  editorSpine,
} from './caseRichEditor';
import {
  appendOrCreateTableInSpine,
  buildDatedEntryNodes,
  buildVitalsSeed,
  currentComplaintId,
  currentEntrySpan,
  proseMirrorNodeSize,
  type ProseMirrorNode,
} from './caseRich';

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

function vitalsSeed(systolic: string) {
  return buildVitalsSeed(
    {
      systolic,
      diastolic: '80',
      pulse: '',
      weightKg: '',
      heightCm: '',
      bmi: '',
      temp: '',
      spo2: '',
    },
    tr,
  );
}

function complaintHeader(no: number, name: string): ProseMirrorNode {
  return {
    type: 'heading',
    attrs: {
      level: 1,
      hcKind: 'complaint',
      hcComplaintNo: no,
      hcComplaintId: `cc${no}`,
    },
    content: [{ type: 'text', text: `${no}. ${name}` }],
  };
}

function entryHeading(
  kind: 'first' | 'follow_up',
  date: string,
  visitId: string,
): ProseMirrorNode {
  return {
    type: 'heading',
    attrs: {
      level: 2,
      hcKind: 'entry',
      hcEntryKind: kind,
      hcComplaintName: 'Headache',
      hcDate: date,
      hcVisitId: visitId,
    },
    content: [{ type: 'text', text: `Headache — ${date}` }],
  };
}

function para(text: string): ProseMirrorNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

const EMPTY_PARA: ProseMirrorNode = { type: 'paragraph' };

/**
 * Real top-level start offsets of the live doc, and the caret position at the
 * END of the text of the paragraph at top-level `index` (a valid caret inside
 * that paragraph: start + 1 open token + text length).
 */
function caretAtEndOfTopLevelPara(ed: Editor, index: number): number {
  const doc = ed.state.doc;
  let at = -1;
  doc.forEach((node: PmNode, offset: number, i: number) => {
    if (i === index) {
      expect(node.type.name).toBe('paragraph');
      at = offset + 1 + node.content.size;
    }
  });
  expect(at, `top-level child #${index} exists`).toBeGreaterThan(0);
  // The real doc agrees the caret is inside that paragraph.
  const $pos = doc.resolve(at);
  expect($pos.parent.type.name).toBe('paragraph');
  expect($pos.index(0)).toBe(index);
  return at;
}

function vitalsTableIndices(doc: ProseMirrorNode): number[] {
  const out: number[] = [];
  (doc.content ?? []).forEach((n, i) => {
    if (n.type === 'table' && n.attrs?.['hcTableType'] === 'vitals')
      out.push(i);
  });
  return out;
}

describe('rwv5-cr-1 — proseMirrorNodeSize matches the REAL ProseMirror doc', () => {
  const DOCS: ReadonlyArray<{ name: string; doc: unknown }> = [
    {
      name: 'empty paragraphs (doc of only empty paragraphs)',
      doc: { type: 'doc', content: [EMPTY_PARA, EMPTY_PARA, EMPTY_PARA] },
    },
    {
      name: 'empty heading + empty paragraph + text',
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 2 } },
          EMPTY_PARA,
          para('Throbbing right temple.'),
        ],
      },
    },
    {
      name: 'leaf nodes: horizontalRule + hardBreak',
      doc: {
        type: 'doc',
        content: [
          para('before'),
          { type: 'horizontalRule' },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'line 1' },
              { type: 'hardBreak' },
              { type: 'hardBreak' },
              { type: 'text', text: 'line 2' },
            ],
          },
          { type: 'horizontalRule' },
        ],
      },
    },
    {
      name: 'table with EMPTY header and body cells',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  { type: 'tableHeader', content: [para('BP')] },
                  { type: 'tableHeader', content: [EMPTY_PARA] },
                ],
              },
              {
                type: 'tableRow',
                content: [
                  { type: 'tableCell', content: [EMPTY_PARA] },
                  { type: 'tableCell', content: [para('80')] },
                ],
              },
            ],
          },
          EMPTY_PARA,
        ],
      },
    },
    {
      name: 'lists with an empty list item',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [
              { type: 'listItem', content: [EMPTY_PARA] },
              { type: 'listItem', content: [para('item')] },
            ],
          },
          {
            type: 'orderedList',
            content: [{ type: 'listItem', content: [EMPTY_PARA] }],
          },
          { type: 'blockquote', content: [EMPTY_PARA] },
          { type: 'codeBlock' },
        ],
      },
    },
    {
      name: 'case spine: complaint + dated entries (each with its empty caret paragraph)',
      doc: {
        type: 'doc',
        content: [
          complaintHeader(1, 'Headache'),
          ...buildDatedEntryNodes({
            date: '2026-10-24',
            visitId: 'v-1',
            complaintName: 'Headache',
            kind: 'first',
          }),
          ...buildDatedEntryNodes({
            date: '2026-11-01',
            visitId: 'v-2',
            complaintName: 'Headache',
            kind: 'follow_up',
          }),
        ],
      },
    },
  ];

  it.each(DOCS)('$name: total and every top-level child', ({ doc }) => {
    const ed = makeEditor(doc);
    const json = editorSpine(ed);
    const pm = ed.state.doc;

    expect(proseMirrorNodeSize(json)).toBe(pm.nodeSize);

    const top = json.content ?? [];
    expect(top).toHaveLength(pm.childCount);
    pm.forEach((child: PmNode, _offset: number, i: number) => {
      expect(proseMirrorNodeSize(top[i]!), `top-level child #${i}`).toBe(
        child.nodeSize,
      );
    });
  });

  it('an EMPTY container is size 2, a leaf is size 1 (live schema)', () => {
    const ed = makeEditor({
      type: 'doc',
      content: [
        EMPTY_PARA,
        { type: 'heading', attrs: { level: 1 } },
        { type: 'horizontalRule' },
      ],
    });
    const pm = ed.state.doc;
    const top = editorSpine(ed).content ?? [];
    expect(pm.child(0).nodeSize).toBe(2);
    expect(proseMirrorNodeSize(top[0]!)).toBe(2);
    expect(pm.child(1).nodeSize).toBe(2);
    expect(proseMirrorNodeSize(top[1]!)).toBe(2);
    expect(pm.child(2).nodeSize).toBe(1);
    expect(proseMirrorNodeSize(top[2]!)).toBe(1);
  });
});

describe('rwv5-cr-1 — a Record lands in the caret entry after an EMPTY paragraph', () => {
  /**
   * cc1: first entry (text + an EMPTY paragraph), then the FOLLOW-UP entry the
   * caret sits in, then a later follow-up entry. Under the old sizing the empty
   * paragraph shifted every later position by -1, so the caret at the end of
   * the follow-up paragraph resolved to the NEXT entry heading.
   */
  function followUpDoc(): unknown {
    return {
      type: 'doc',
      content: [
        complaintHeader(1, 'Headache'),
        entryHeading('first', '2026-10-24', 'v-1'), // 1
        para('Throbbing right temple.'), // 2
        EMPTY_PARA, // 3
        entryHeading('follow_up', '2026-11-01', 'v-2'), // 4  <- caret entry
        para('Better.'), // 5  <- caret here
        entryHeading('follow_up', '2026-11-08', 'v-3'), // 6
        para('Same.'), // 7
      ],
    };
  }
  const FOLLOW_UP_HEADING = 4;
  const FOLLOW_UP_PARA = 5;
  const NEXT_ENTRY_HEADING = 6;

  it('currentEntrySpan resolves the FOLLOW-UP entry from a real caret', () => {
    const ed = makeEditor(followUpDoc());
    const caret = caretAtEndOfTopLevelPara(ed, FOLLOW_UP_PARA);
    const [start, end] = currentEntrySpan(editorSpine(ed), caret);
    expect(start).toBe(FOLLOW_UP_HEADING);
    expect(end).toBe(NEXT_ENTRY_HEADING);
  });

  it('pure kernel: Record vitals is created inside the follow-up entry', () => {
    const ed = makeEditor(followUpDoc());
    const caret = caretAtEndOfTopLevelPara(ed, FOLLOW_UP_PARA);
    const out = appendOrCreateTableInSpine(
      editorSpine(ed),
      caret,
      'vitals',
      vitalsSeed('120'),
    );
    const [idx] = vitalsTableIndices(out);
    expect(idx, 'one vitals table').toBeDefined();
    // [hr, section heading, table] inserted at the end of the follow-up span,
    // i.e. right before the later entry heading (which shifts by 3).
    expect(idx).toBe(NEXT_ENTRY_HEADING + 2);
    const after = out.content?.[NEXT_ENTRY_HEADING + 3];
    expect(after?.attrs?.['hcVisitId']).toBe('v-3');
    expect(out.content?.[FOLLOW_UP_HEADING]?.attrs?.['hcVisitId']).toBe('v-2');
  });

  it('live editor glue: Record vitals lands in the follow-up entry, not the next one', () => {
    const ed = makeEditor(followUpDoc());
    ed.commands.setTextSelection(caretAtEndOfTopLevelPara(ed, FOLLOW_UP_PARA));
    appendOrCreateTable(ed, 'vitals', vitalsSeed('120'));

    const out = editorSpine(ed);
    const top = out.content ?? [];
    const tables = vitalsTableIndices(out);
    expect(tables).toHaveLength(1);
    const tableIdx = tables[0]!;
    // Owning entry heading = the nearest entry heading before the table.
    let owner = -1;
    for (let i = tableIdx; i >= 0; i -= 1) {
      if (top[i]?.type === 'heading' && top[i]?.attrs?.['hcKind'] === 'entry') {
        owner = i;
        break;
      }
    }
    expect(top[owner]?.attrs?.['hcVisitId']).toBe('v-2');

    // A second Record from the same (mapped) caret APPENDS to that table.
    appendOrCreateTable(ed, 'vitals', vitalsSeed('130'));
    expect(vitalsTableIndices(editorSpine(ed))).toEqual([tableIdx]);
  });
});

describe('rwv5-cr-1 — complaint resolver after an EMPTY paragraph', () => {
  /** cc1 ends with an empty paragraph then a text paragraph; cc2 follows. */
  function twoComplaintDoc(): unknown {
    return {
      type: 'doc',
      content: [
        complaintHeader(1, 'Headache'), // 0
        entryHeading('first', '2026-10-24', 'v-1'), // 1
        EMPTY_PARA, // 2
        para('Throbbing.'), // 3  <- caret at end of text
        complaintHeader(2, 'Cough'), // 4
        entryHeading('first', '2026-10-24', 'v-1'), // 5
        para('Dry.'), // 6
      ],
    };
  }

  it('a caret at the end of the last cc1 paragraph resolves to cc1', () => {
    const ed = makeEditor(twoComplaintDoc());
    const caret = caretAtEndOfTopLevelPara(ed, 3);
    expect(currentComplaintId(editorSpine(ed), caret)).toBe('cc1');
  });

  it('a caret inside cc2 resolves to cc2', () => {
    const ed = makeEditor(twoComplaintDoc());
    const caret = caretAtEndOfTopLevelPara(ed, 6);
    expect(currentComplaintId(editorSpine(ed), caret)).toBe('cc2');
  });

  it('at every real top-level start, the resolver agrees with the doc', () => {
    const ed = makeEditor(twoComplaintDoc());
    const json = editorSpine(ed);
    ed.state.doc.forEach((_n: PmNode, offset: number, i: number) => {
      const caret = offset + 1; // inside child i
      expect(currentComplaintId(json, caret), `child #${i}`).toBe(
        i < 4 ? 'cc1' : 'cc2',
      );
    });
  });
});
