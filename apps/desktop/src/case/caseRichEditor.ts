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
  buildSectionNodes,
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
 * Called at autosave time so the payload always reflects the latest in-editor
 * state (including in-place table-cell edits), never a stale React snapshot.
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
 * Assemble the whole v3 document from the (single, for R3) complaint editor and
 * its metadata. `text` is regenerated by {@link extractCaseText} inside
 * {@link serializeRich}, so no caller has to maintain the FTS mirror.
 */
export function v3DocFromEditor(
  editor: Editor,
  id: string,
  title: string,
  nextSectionNo: number,
  sections: unknown | null,
): V3Doc {
  const complaint = complaintFromEditor(editor, id, title, nextSectionNo);
  return {
    schema: CASE_RICH_SCHEMA,
    version: CASE_RICH_VERSION,
    complaints: [complaint],
    next_section_no: nextSectionNo,
    sections,
  };
}

/**
 * The initial editor content for a complaint: its ProseMirror `doc`, as parsed
 * from the v3 payload. TipTap accepts a plain JSON doc as `content`; the v3
 * `ProseMirrorNode` type is `readonly`, so it is deep-cloned into a plain
 * mutable object graph (the content TipTap mutates internally) via JSON.
 */
export function initialContent(complaint: RichComplaint): Content {
  return JSON.parse(JSON.stringify(complaint.doc)) as Content;
}

/**
 * Append the record-section nodes (full-width rule + numbered heading + seeded
 * table) at the END of the document (serialization-v3 §3a). Does NOT call
 * `.focus()`/`scrollIntoView`: the scroll path touches `getClientRects`, which
 * is absent in jsdom, so we insert positionally and leave focus management to
 * the caller. Returns nothing; the editor updates in place.
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
 * Append a dated-entry heading (+ empty paragraph) at the END of the document
 * ("Add entry"; serialization-v3 §3a). No `.focus()` in the chain (see
 * {@link insertSectionNodes}).
 */
export function insertDatedEntry(
  editor: Editor,
  date: string,
  visitId: string,
): void {
  const nodes = buildDatedEntryNodes({
    date,
    visitId,
  }) as unknown as ProseMirrorNode[];
  const end = editor.state.doc.content.size;
  editor
    .chain()
    .insertContentAt(end, nodes as never)
    .run();
}
