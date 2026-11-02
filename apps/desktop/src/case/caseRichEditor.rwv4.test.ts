// RED unit tests for the M3-RWv4 EDITOR GLUE (caseRichEditor.ts) — the pure
// bridges between the live ProseMirror document and the v3 `case-rich` payload
// (ADR 0019 "Increment M3-RWv4"; .worklog/HC-MVP1-M3/handoffs/M3-RWv4-design.md).
//
// CUT: `apps/desktop/src/case/caseRichEditor.ts`, which RWv4 extends with:
//   - the list nodes (bulletList/orderedList/listItem) already shipped inside
//     StarterKit must stay IN the editor schema and round-trip through getJSON
//     (A3, §3) — asserted over a headless editor built from the REAL
//     `caseEditorExtensions()`.
//   - `appendOrCreateModalities(editor, seed)` (NEW, B4, §4): first call creates
//     ONE modalities table; a second call in the same entry APPENDS rows to that
//     SAME table (table count stays 1; rows grow).
//   - the `hcInvestigationLink` global attribute registered on `tableRow`
//     (D5, §5.3) so a link row round-trips through getJSON.
//
// `appendOrCreateModalities` does not exist yet, so it resolves to `undefined`
// and the call throws — the RED comes from the real CUT being incomplete. The
// extension set + list schema is the REAL CUT; nothing is faked (R-TEST-002).
//
// TIPTAP IN JSDOM: a headless `@tiptap/core` Editor over caseEditorExtensions()
// with command chains + getJSON works under jsdom (per CaseForm.editor.test.tsx:
// "@tiptap/react renders, and its command chains + getJSON work under jsdom").
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';

import {
  caseEditorExtensions,
  appendOrCreateModalities,
  selectionIsOnComplaintHeading,
} from './caseRichEditor';
import {
  splitSpineToComplaints,
  type ProseMirrorNode,
  type TableSeed,
} from './caseRich';

let editor: Editor | null = null;

function makeEditor(content?: unknown): Editor {
  editor = new Editor({
    extensions: caseEditorExtensions(),
    content: (content as never) ?? '<p></p>',
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function nodesOfType(root: ProseMirrorNode, type: string): ProseMirrorNode[] {
  const found: ProseMirrorNode[] = [];
  const walk = (n: ProseMirrorNode): void => {
    if (n.type === type) found.push(n);
    for (const c of n.content ?? []) walk(c);
  };
  walk(root);
  return found;
}

function allText(node: ProseMirrorNode | undefined): string {
  if (node === undefined) return '';
  let out =
    node.type === 'text' && typeof node.text === 'string' ? node.text : '';
  for (const child of node.content ?? []) out += ` ${allText(child)}`;
  return out;
}

function modalitiesSeed(row: string[]): TableSeed {
  return {
    hcTableType: 'modalities',
    columns: ['Factor', 'Aggravation', 'Amelioration'],
    rows: [row],
  };
}

// ===========================================================================
// A3 — the list nodes are in the editor schema and round-trip through getJSON
// ===========================================================================

describe('RWv4 A3 — the case editor schema includes the Word-style list nodes', () => {
  it('toggleBulletList produces a bulletList node that survives getJSON', () => {
    const ed = makeEditor('<p>Aching joints</p>');
    const ok = ed.chain().focus().selectAll().toggleBulletList().run();
    expect(
      ok,
      'toggleBulletList must be a registered command (BulletList in schema)',
    ).toBe(true);
    const doc = ed.getJSON() as unknown as ProseMirrorNode;
    expect(nodesOfType(doc, 'bulletList').length).toBeGreaterThanOrEqual(1);
    expect(nodesOfType(doc, 'listItem').length).toBeGreaterThanOrEqual(1);
    expect(allText(doc)).toContain('Aching joints');
  });

  it('toggleOrderedList produces an orderedList node that survives getJSON', () => {
    const ed = makeEditor('<p>Morning dose</p>');
    const ok = ed.chain().focus().selectAll().toggleOrderedList().run();
    expect(
      ok,
      'toggleOrderedList must be a registered command (OrderedList in schema)',
    ).toBe(true);
    const doc = ed.getJSON() as unknown as ProseMirrorNode;
    expect(nodesOfType(doc, 'orderedList').length).toBeGreaterThanOrEqual(1);
    expect(allText(doc)).toContain('Morning dose');
  });
});

// ===========================================================================
// B4 — appendOrCreateModalities: first creates, second appends to the SAME table
// ===========================================================================

describe('RWv4 B4 — appendOrCreateModalities creates once then appends rows', () => {
  it('the FIRST call creates exactly one modalities table', () => {
    const ed = makeEditor('<p></p>');
    appendOrCreateModalities(
      ed,
      modalitiesSeed(['Cold', 'Worse', 'Better in warmth']),
    );
    const doc = ed.getJSON() as unknown as ProseMirrorNode;
    const tables = nodesOfType(doc, 'table').filter(
      (t) => t.attrs?.['hcTableType'] === 'modalities',
    );
    expect(tables).toHaveLength(1);
    expect(allText(tables[0]!)).toContain('Cold');
  });

  it('a SECOND call APPENDS rows to the same table (count stays 1, rows grow)', () => {
    const ed = makeEditor('<p></p>');
    appendOrCreateModalities(
      ed,
      modalitiesSeed(['Cold', 'Worse', 'Better in warmth']),
    );
    appendOrCreateModalities(ed, modalitiesSeed(['Motion', 'Worse', '']));

    const doc = ed.getJSON() as unknown as ProseMirrorNode;
    const tables = nodesOfType(doc, 'table').filter(
      (t) => t.attrs?.['hcTableType'] === 'modalities',
    );
    // STILL exactly one modalities table...
    expect(tables).toHaveLength(1);
    // ...with BOTH rows' content (header + two body rows => >= 3 tableRows)
    const rows = nodesOfType(tables[0]!, 'tableRow');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(allText(tables[0]!)).toContain('Cold');
    expect(allText(tables[0]!)).toContain('Motion');
  });
});

// ===========================================================================
// D5 — the hcInvestigationLink attr is registered on tableRow (round-trips)
// ===========================================================================

describe('RWv4 D5 — hcInvestigationLink is a tableRow attribute that round-trips', () => {
  it('a tableRow authored with attrs.hcInvestigationLink keeps it through getJSON', () => {
    // Author a table whose body row carries the link attr; if HcAttributes does
    // not register hcInvestigationLink on tableRow, the schema strips it and
    // getJSON drops the attr -> this FAILS (the RWv4 attr is missing).
    const content = {
      type: 'doc',
      content: [
        {
          type: 'table',
          attrs: { hcTableType: 'investigations' },
          content: [
            {
              type: 'tableRow',
              attrs: {
                hcInvestigationLink: {
                  attachmentId: '0192bb00-0000-7000-8000-000000000009',
                },
              },
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        {
                          type: 'text',
                          text: 'CBC-Test Patient 001-24-10-2026',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const ed = makeEditor(content);
    const doc = ed.getJSON() as unknown as ProseMirrorNode;
    const linked = nodesOfType(doc, 'tableRow').find(
      (r) => r.attrs?.['hcInvestigationLink'] != null,
    );
    expect(
      linked,
      'hcInvestigationLink must be a registered tableRow attribute so it survives getJSON',
    ).toBeDefined();
    const link = linked!.attrs?.['hcInvestigationLink'] as {
      attachmentId?: string;
    };
    expect(link.attachmentId).toBe('0192bb00-0000-7000-8000-000000000009');
  });
});

// ===========================================================================
// DEFECT 1 (M3-RWv4 build-12, DATA LOSS) — the list toggle must never wrap a
// complaint heading into a list item (which would make splitSpineToComplaints
// lose the whole complaint section).
// ===========================================================================

/** A spine doc: ONE complaint heading (h1 hcKind=complaint) + an entry + prose. */
function complaintSpine(): unknown {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1, hcKind: 'complaint', hcComplaintId: 'cc1' },
        content: [{ type: 'text', text: '1. Headache' }],
      },
      {
        type: 'heading',
        attrs: { level: 2, hcKind: 'entry', hcComplaintName: 'Headache' },
        content: [{ type: 'text', text: 'Headache — 24-10-2026' }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Throbbing right temple.' }],
      },
    ],
  };
}

/** The 1-based document position of the first char of the Nth matching node. */
function posInside(ed: Editor, predicate: (n: unknown) => boolean): number {
  let found = -1;
  ed.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (predicate(node as unknown)) {
      found = pos + 1; // inside the node's content
      return false;
    }
    return true;
  });
  if (found === -1) throw new Error('target node not found');
  return found;
}

describe('RWv4 DEFECT 1 — selectionIsOnComplaintHeading guards the list toggles', () => {
  it('returns TRUE when the caret is inside the complaint heading', () => {
    const ed = makeEditor(complaintSpine());
    const pos = posInside(
      ed,
      (n) =>
        (n as { type: { name: string }; attrs?: Record<string, unknown> }).type
          .name === 'heading' &&
        (n as { attrs?: Record<string, unknown> }).attrs?.['hcKind'] ===
          'complaint',
    );
    ed.commands.setTextSelection(pos);
    expect(selectionIsOnComplaintHeading(ed)).toBe(true);
  });

  it('returns FALSE when the caret is inside entry body text', () => {
    const ed = makeEditor(complaintSpine());
    const pos = posInside(
      ed,
      (n) => (n as { type: { name: string } }).type.name === 'paragraph',
    );
    ed.commands.setTextSelection(pos);
    expect(selectionIsOnComplaintHeading(ed)).toBe(false);
  });

  it('honouring the guard: NOT toggling keeps the complaint heading so splitSpineToComplaints still finds it', () => {
    const ed = makeEditor(complaintSpine());
    // Caret on the complaint heading -> guard says do NOT toggle. Simulate the
    // guarded handler (no-op) and assert the spine still splits into 1 complaint.
    const pos = posInside(
      ed,
      (n) =>
        (n as { type: { name: string }; attrs?: Record<string, unknown> }).type
          .name === 'heading' &&
        (n as { attrs?: Record<string, unknown> }).attrs?.['hcKind'] ===
          'complaint',
    );
    ed.commands.setTextSelection(pos);
    expect(selectionIsOnComplaintHeading(ed)).toBe(true); // handler would no-op

    const spine = ed.getJSON() as unknown as ProseMirrorNode;
    const complaints = splitSpineToComplaints(spine);
    expect(complaints).toHaveLength(1);
    expect(complaints[0]!.title).toContain('Headache');
  });

  it('control: toggling a list INSIDE entry text DOES produce a list (guard allows it)', () => {
    const ed = makeEditor(complaintSpine());
    const pos = posInside(
      ed,
      (n) => (n as { type: { name: string } }).type.name === 'paragraph',
    );
    ed.commands.setTextSelection(pos);
    expect(selectionIsOnComplaintHeading(ed)).toBe(false); // handler would run
    ed.chain().focus().toggleBulletList().run();

    const doc = ed.getJSON() as unknown as ProseMirrorNode;
    expect(nodesOfType(doc, 'bulletList').length).toBeGreaterThanOrEqual(1);
    // the complaint heading is untouched -> still splits into 1 complaint
    expect(splitSpineToComplaints(doc)).toHaveLength(1);
  });
});
