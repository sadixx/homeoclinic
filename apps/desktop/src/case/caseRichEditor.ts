// M3-RWv2 — the TipTap/ProseMirror editor glue for the ONE-WYSIWYG-editor-per-
// complaint case form (ADR 0019). This module owns ONLY the editor wiring:
//
//  - the extension set (StarterKit + the four table extensions + horizontalRule
//    + heading, all shipped inside StarterKit) and the tiny `hcAttrs` extension
//    that adds the v3 custom node attributes (`hcKind`, `hcSectionNo`,
//    `hcSectionType`, `hcDate`, `hcVisitId` on `heading`; `hcTableType`,
//    `hcRxPlaceholder` on `table`) so they round-trip through `editor.getJSON()`
//    (serialization-v3 §3), and
//  - the pure bridges between the editor's live ProseMirror document and the v3
//    `case-rich` payload in `caseRich.ts`: read the editor doc into a `V3Doc`
//    for autosave, and append the caseRich builder nodes (record sections, dated
//    entries) at the end of the document.
//
// No network, no eval, no `dangerouslySetInnerHTML`. The editor runs under the
// existing strict CSP (`script-src 'self'`) with no relaxation (ADR 0019 §3).
// Clinical values are inserted as plain text nodes, never HTML.

import { Extension } from '@tiptap/core';
import type { Content } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';

import {
  CASE_RICH_SCHEMA,
  CASE_RICH_VERSION,
  buildDatedEntryNodes,
  buildNewComplaintNodes,
  buildSectionNodes,
  currentComplaintId,
  joinComplaintsToSpine,
  splitSpineToComplaints,
  type EntryKind,
  type ProseMirrorNode,
  type RichComplaint,
  type SectionNodesArgs,
  type V3Doc,
} from './caseRich';

/**
 * The v3 custom attributes, added to the existing `heading` and `table` nodes
 * as GLOBAL attributes (serialization-v3 §3). Using `addGlobalAttributes` lets
 * us keep StarterKit's bundled Heading/HorizontalRule and the standard Table
 * extensions untouched while making the `hc*` attrs part of their schema so
 * they survive `getJSON()` / `parseHTML` round-trips. Every attribute is a
 * plain JSON scalar, so the document stays pure JSON.
 */
const HcAttributes = Extension.create({
  name: 'hcAttributes',
  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          hcKind: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-hc-kind'),
            renderHTML: (attrs) =>
              attrs['hcKind'] !== null && attrs['hcKind'] !== undefined
                ? { 'data-hc-kind': attrs['hcKind'] as string }
                : {},
          },
          hcSectionNo: {
            default: null,
            parseHTML: (el) => {
              const v = el.getAttribute('data-hc-section-no');
              return v === null ? null : Number(v);
            },
            renderHTML: (attrs) =>
              attrs['hcSectionNo'] !== null &&
              attrs['hcSectionNo'] !== undefined
                ? { 'data-hc-section-no': String(attrs['hcSectionNo']) }
                : {},
          },
          hcSectionType: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-hc-section-type'),
            renderHTML: (attrs) =>
              attrs['hcSectionType'] !== null &&
              attrs['hcSectionType'] !== undefined
                ? { 'data-hc-section-type': attrs['hcSectionType'] as string }
                : {},
          },
          hcDate: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-hc-date'),
            renderHTML: (attrs) =>
              attrs['hcDate'] !== null && attrs['hcDate'] !== undefined
                ? { 'data-hc-date': attrs['hcDate'] as string }
                : {},
          },
          hcVisitId: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-hc-visit-id'),
            renderHTML: (attrs) =>
              attrs['hcVisitId'] !== null && attrs['hcVisitId'] !== undefined
                ? { 'data-hc-visit-id': attrs['hcVisitId'] as string }
                : {},
          },
          hcEntryKind: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-hc-entry-kind'),
            renderHTML: (attrs) =>
              attrs['hcEntryKind'] !== null &&
              attrs['hcEntryKind'] !== undefined
                ? { 'data-hc-entry-kind': attrs['hcEntryKind'] as string }
                : {},
          },
          hcComplaintName: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-hc-complaint-name'),
            renderHTML: (attrs) =>
              attrs['hcComplaintName'] !== null &&
              attrs['hcComplaintName'] !== undefined
                ? {
                    'data-hc-complaint-name': attrs[
                      'hcComplaintName'
                    ] as string,
                  }
                : {},
          },
          hcComplaintNo: {
            default: null,
            parseHTML: (el) => {
              const v = el.getAttribute('data-hc-complaint-no');
              return v === null ? null : Number(v);
            },
            renderHTML: (attrs) =>
              attrs['hcComplaintNo'] !== null &&
              attrs['hcComplaintNo'] !== undefined
                ? { 'data-hc-complaint-no': String(attrs['hcComplaintNo']) }
                : {},
          },
          hcComplaintId: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-hc-complaint-id'),
            renderHTML: (attrs) =>
              attrs['hcComplaintId'] !== null &&
              attrs['hcComplaintId'] !== undefined
                ? { 'data-hc-complaint-id': attrs['hcComplaintId'] as string }
                : {},
          },
        },
      },
      {
        types: ['table'],
        attributes: {
          hcTableType: {
            default: null,
            parseHTML: (el) => el.getAttribute('data-hc-table-type'),
            renderHTML: (attrs) =>
              attrs['hcTableType'] !== null &&
              attrs['hcTableType'] !== undefined
                ? { 'data-hc-table-type': attrs['hcTableType'] as string }
                : {},
          },
          hcRxPlaceholder: {
            default: null,
            parseHTML: (el) =>
              el.getAttribute('data-hc-rx-placeholder') === 'true'
                ? true
                : null,
            renderHTML: (attrs) =>
              attrs['hcRxPlaceholder'] === true
                ? { 'data-hc-rx-placeholder': 'true' }
                : {},
          },
        },
      },
    ];
  },
});

/**
 * The extension set every case editor uses. `dropcursor`/`gapcursor` are
 * disabled: they add nothing for a single-column clinical note and their
 * coordinate maths touches DOM APIs jsdom lacks; table column-resizing is off
 * (`resizable: false`) for the same reason and because the grid is fixed-shape.
 * StarterKit supplies doc/paragraph/text/history/heading/horizontalRule.
 */
export function caseEditorExtensions(): ReturnType<
  typeof StarterKit.configure
>[] {
  return [
    StarterKit.configure({ dropcursor: false, gapcursor: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    HcAttributes,
  ] as unknown as ReturnType<typeof StarterKit.configure>[];
}

/** A plain-JSON ProseMirror doc (what `editor.getJSON()` returns). */
type JsonDoc = { type: 'doc'; content?: ProseMirrorNode[] };

/**
 * Read one editor's live ProseMirror JSON into a v3 {@link RichComplaint}.
 * Retained for the single-complaint callers/tests that bridge one editor doc.
 */
export function complaintFromEditor(
  editor: Editor,
  id: string,
  title: string,
  nextSectionNo: number,
): RichComplaint {
  const doc = editor.getJSON() as JsonDoc;
  return {
    id,
    title,
    next_section_no: nextSectionNo,
    doc: { type: 'doc', content: doc.content ?? [] },
  };
}

/**
 * Assemble the whole v3 document from the SINGLE spine editor (M3-RWv3 §2,
 * representation a). The editor holds ONE chronological document whose top-level
 * `hcKind:"complaint"` headers delimit the complaint sections; on autosave the
 * spine is split back into the canonical `complaints[]` (each complaint's `doc`
 * is its own section content, header excluded — M3-RWv3 §3b) so the backend
 * text mirrors stay keyed by complaint. `sections` is carried forward verbatim;
 * `text` is regenerated by {@link serializeRich}. When the spine somehow holds
 * no complaint header (degenerate/empty), one fallback complaint is emitted so
 * the payload always has at least one complaint.
 */
export function v3DocFromEditor(
  editor: Editor,
  fallbackId: string,
  fallbackTitle: string,
  nextSectionNo: number,
  sections: unknown | null,
): V3Doc {
  const doc = editor.getJSON() as JsonDoc;
  const spine: ProseMirrorNode = { type: 'doc', content: doc.content ?? [] };
  let complaints = splitSpineToComplaints(spine);
  if (complaints.length === 0) {
    complaints = [
      {
        id: fallbackId,
        title: fallbackTitle,
        next_section_no: nextSectionNo,
        doc: spine,
      },
    ];
  }
  const topNextNo = Math.max(
    nextSectionNo,
    ...complaints.map((c) => c.next_section_no),
  );
  return {
    schema: CASE_RICH_SCHEMA,
    version: CASE_RICH_VERSION,
    complaints,
    next_section_no: topNextNo,
    sections,
  };
}

/**
 * The initial editor content for the WHOLE record (M3-RWv3 §2): the spine doc
 * joining every complaint section (numbered header + its entries), in order.
 * TipTap accepts a plain JSON doc as `content`; the readonly node graph is
 * deep-cloned into the mutable object graph TipTap owns.
 */
export function initialContent(doc: V3Doc): Content {
  const spine = joinComplaintsToSpine(doc.complaints);
  return JSON.parse(JSON.stringify(spine)) as Content;
}

/**
 * The 1-based complaint number the NEXT "Add new complaint" allocates: the
 * count of existing top-level complaint headers + 1 (M3-RWv3 §4, position-based
 * numbering). Read from the live editor doc so it reflects in-session adds.
 */
function nextComplaintNo(editor: Editor): number {
  const content = (editor.getJSON() as JsonDoc).content ?? [];
  return (
    content.filter(
      (n) => n.type === 'heading' && n.attrs?.['hcKind'] === 'complaint',
    ).length + 1
  );
}

/**
 * Resolve the complaint id owning the caret (M3-RWv3 §5). Maps the live
 * ProseMirror selection head to the pure {@link currentComplaintId} resolver
 * over the serialised spine.
 */
function resolveCurrentComplaintId(editor: Editor): string {
  const spine: ProseMirrorNode = {
    type: 'doc',
    content: (editor.getJSON() as JsonDoc).content ?? [],
  };
  return currentComplaintId(spine, editor.state.selection.head);
}

/**
 * Append the record-section nodes (full-width rule + numbered heading + seeded
 * table) at the END of the document (M3-RWv3 §5: into the current entry — the
 * last entry of the current complaint, which in a chronological append is the
 * document tail). No `.focus()`/`scrollIntoView`: the scroll path touches
 * `getClientRects`, absent in jsdom.
 */
export function insertSectionNodes(
  editor: Editor,
  args: SectionNodesArgs,
): void {
  const nodes = buildSectionNodes(args) as unknown as ProseMirrorNode[];
  const end = editor.state.doc.content.size;
  editor
    .chain()
    .insertContentAt(end, nodes as never)
    .run();
}

/**
 * Append a dated entry (heading + empty paragraph) under the CURRENT complaint
 * (M3-RWv3 §5). `kind` is `'first'` (Add new entry) or `'follow_up'` (Add
 * follow-up entry); `complaintName` is denormalised onto the heading so the
 * header text composes and the FTS mirror sees the name on every entry. The
 * entry is appended at the end of the document (chronological append); the
 * current complaint is resolved from the caret.
 */
export function insertDatedEntry(
  editor: Editor,
  date: string,
  visitId: string,
  complaintName: string,
  kind: EntryKind,
): void {
  const nodes = buildDatedEntryNodes({
    date,
    visitId,
    complaintName,
    kind,
  }) as unknown as ProseMirrorNode[];
  const end = editor.state.doc.content.size;
  editor
    .chain()
    .insertContentAt(end, nodes as never)
    .run();
}

/**
 * Append a brand-new numbered complaint SECTION at the END of the document
 * (M3-RWv3 §5, "Add new complaint"): the complaint header, its first dated
 * entry and a caret paragraph. The complaint number is the next position
 * (§4); the id is the next `cc<n>`.
 */
export function insertComplaint(
  editor: Editor,
  args: { name: string; date: string; visitId: string },
): void {
  const no = nextComplaintNo(editor);
  const nodes = buildNewComplaintNodes({
    complaintNo: no,
    complaintId: `cc${no}`,
    name: args.name,
    date: args.date,
    visitId: args.visitId,
  }) as unknown as ProseMirrorNode[];
  const end = editor.state.doc.content.size;
  editor
    .chain()
    .insertContentAt(end, nodes as never)
    .run();
}

/** Resolve the display name of the complaint owning the caret (for new entries). */
export function currentComplaintName(editor: Editor): string {
  const id = resolveCurrentComplaintId(editor);
  const content = (editor.getJSON() as JsonDoc).content ?? [];
  const header = content.find(
    (n) =>
      n.type === 'heading' &&
      n.attrs?.['hcKind'] === 'complaint' &&
      n.attrs?.['hcComplaintId'] === id,
  );
  if (header === undefined) return '';
  const raw = (header.content ?? [])
    .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('');
  return raw.replace(/^\s*\d+\.\s*/, '');
}
