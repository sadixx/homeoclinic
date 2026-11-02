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
  buildBodyRows,
  buildDatedEntryNodes,
  buildNewComplaintNodes,
  buildSectionNodes,
  currentComplaintId,
  bulletSectionHeadings,
  isGhostComplaintHeading,
  joinComplaintsToSpine,
  nameLeadingComplaint,
  nextComplaintNumber,
  planTableRecord,
  tableSectionSpanOf,
  splitSpineToComplaints,
  type EntryKind,
  type ProseMirrorNode,
  type RichComplaint,
  type RichTableType,
  type SectionNodesArgs,
  type TableSeed,
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
            renderHTML: (attrs) => {
              const kind = attrs['hcKind'];
              if (kind === null || kind === undefined) return {};
              const out: Record<string, string> = {
                'data-hc-kind': kind as string,
              };
              // M3-RWv4 §1: the complaint heading is a BOLD + UNDERLINED
              // standout. The styling is primarily the scoped index.css rule on
              // h1[data-hc-kind="complaint"]; these utility classes carry the
              // same intent on the element itself so the standout survives even
              // where the stylesheet is not applied (e.g. jsdom/RTL assertions)
              // — still style-only, no new node/attr, no serialization change.
              if (kind === 'complaint') {
                out['class'] = 'font-bold underline';
              }
              return out;
            },
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
        // M3-RWv4 §5.3: the investigation LINK attr lives on the table ROW so a
        // row can REFERENCE a shared patient attachment without duplicating it.
        // The value is a JSON object `{ attachmentId }` (or null) serialised to
        // a single `data-hc-investigation-link` data-attr, the same hardened
        // pattern as the other `hc*` attrs; `reviveSafe` in parseCaseDoc guards
        // the parse boundary against prototype pollution. Additive to v3:
        // absence ⇒ null ⇒ not a link row (backward tolerant, no upcast).
        types: ['tableRow'],
        attributes: {
          hcInvestigationLink: {
            default: null,
            parseHTML: (el) => {
              const raw = el.getAttribute('data-hc-investigation-link');
              if (raw === null) return null;
              try {
                const parsed = JSON.parse(raw) as unknown;
                return isRecord(parsed) &&
                  typeof parsed['attachmentId'] === 'string'
                  ? { attachmentId: parsed['attachmentId'] }
                  : null;
              } catch {
                return null;
              }
            },
            renderHTML: (attrs) => {
              const link = attrs['hcInvestigationLink'];
              return isRecord(link) && typeof link['attachmentId'] === 'string'
                ? {
                    'data-hc-investigation-link': JSON.stringify({
                      attachmentId: link['attachmentId'],
                    }),
                  }
                : {};
            },
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
  // M3-RWv5 C: legacy "<n>. Label" section headings reopen as "<bullet> Label".
  const spine = bulletSectionHeadings(joinComplaintsToSpine(doc.complaints));
  return JSON.parse(JSON.stringify(spine)) as Content;
}

/**
 * The 1-based complaint number the NEXT "Add new complaint" allocates
 * (M3-RWv6 item 7): the highest complaint number visible in the live editor
 * doc + 1, read at click time ({@link nextComplaintNumber}). An unnamed,
 * header-less first complaint (M3-RWv5 C) still occupies number 1, and a
 * complaint heading emptied by hand frees its number.
 */
function nextComplaintNo(editor: Editor): number {
  return nextComplaintNumber(editorSpine(editor));
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
 * Is the current selection anchored on a top-level complaint heading
 * (`heading[hcKind='complaint']`)? Walks every ancestor depth of the selection
 * `$from` for a heading node carrying `hcKind === 'complaint'`.
 *
 * M3-RWv4 build-12 DEFECT 1 (DATA LOSS): the Word-style list toggles wrap the
 * node under the caret into a list item. If the caret sits on the complaint
 * heading, TipTap wraps the HEADING into a `listItem`, so
 * {@link splitSpineToComplaints} (which delimits complaint sections by a
 * top-level `heading[hcKind='complaint']`) can no longer see it and the WHOLE
 * complaint section is lost (and is not restored after relaunch). The list
 * toolbar MUST therefore refuse to run over a complaint heading — the toggles
 * stay fully available inside entry body text.
 */
export function selectionIsOnComplaintHeading(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === 'heading' && node.attrs['hcKind'] === 'complaint') {
      return true;
    }
  }
  return false;
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
  // M3-RWv5 C: a fresh case's first complaint has no header until it is
  // named. Naming it ("Add new complaint" with a name) turns that leading
  // unnamed section into "1. <name>" instead of appending a second complaint.
  if (args.name !== '') {
    const named = nameLeadingComplaint(editorSpine(editor), args.name);
    if (named !== null) {
      setEditorSpine(editor, named);
      return;
    }
  }
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
      n.attrs?.['hcComplaintId'] === id &&
      !isGhostComplaintHeading(n),
  );
  if (header === undefined) return '';
  const raw = (header.content ?? [])
    .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('');
  return raw.replace(/^\s*\d+\.\s*/, '');
}

/** Type guard: a non-null, non-array object (parse-boundary + attr helpers). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * M3-RWv5 A — ONE TABLE PER TYPE PER ENTRY, for every record kind (vitals,
 * modalities, family history, physical generals, investigations,
 * prescription). The CURRENT entry is the dated entry holding the live caret
 * (`editor.state.selection.head`, REAL ProseMirror positions — never a
 * serialised-JSON length). The first Record of `kind` in that entry creates
 * `[hr, bullet heading, table]` at the end of the entry; every later Record of
 * the same kind in the same entry appends the seed's body rows to that table.
 * A new follow-up entry has no table yet, so it starts fresh.
 *
 * The plan comes from the pure {@link planTableRecord} (the same kernel as
 * `appendOrCreateTableInSpine`) and is applied as ONE ProseMirror transaction
 * (`tr.insert`), so the selection is MAPPED through the change and the caret
 * stays in the same entry for the next Record (a whole-doc `setContent` would
 * reset it). No `.focus()`/scrollIntoView (jsdom lacks the geometry APIs).
 */
export function appendOrCreateTable(
  editor: Editor,
  kind: RichTableType,
  seed: TableSeed,
): void {
  const spine = editorSpine(editor);
  const plan = planTableRecord(spine, editor.state.selection.head, kind, seed);
  const doc = editor.state.doc;
  // Top-level start offset of every child, plus the doc end.
  const offsets: number[] = [];
  doc.forEach((_node, offset) => {
    offsets.push(offset);
  });
  offsets.push(doc.content.size);
  const schema = editor.schema;
  editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (plan.mode === 'create') {
        const at = offsets[plan.index] ?? doc.content.size;
        const nodes = plan.nodes.map((n) =>
          schema.nodeFromJSON(JSON.parse(JSON.stringify(n))),
        );
        if (dispatch) tr.insert(at, nodes);
        return true;
      }
      if (plan.mode === 'replace') {
        // M3-RWv6 item 5: the merged table replaces the old one in place.
        const from = offsets[plan.index] ?? 0;
        const to = from + doc.child(plan.index).nodeSize;
        const node = schema.nodeFromJSON(JSON.parse(JSON.stringify(plan.node)));
        if (dispatch) tr.replaceWith(from, to, node);
        return true;
      }
      const table = doc.child(plan.index);
      // Inside the table, just after its last row.
      const at = (offsets[plan.index] ?? 0) + table.nodeSize - 1;
      const rows = buildBodyRows(plan.rows).map((r) =>
        schema.nodeFromJSON(JSON.parse(JSON.stringify(r))),
      );
      if (dispatch) tr.insert(at, rows);
      return true;
    })
    .run();
}

/**
 * M3-RWv4 §4 modalities entry point, kept for its callers/tests: modalities is
 * now simply one of the kinds handled by {@link appendOrCreateTable}.
 */
export function appendOrCreateModalities(
  editor: Editor,
  seed: TableSeed,
): void {
  appendOrCreateTable(editor, 'modalities', seed);
}

/** One complaint's structure for the React remove-control overlay (M3-RWv4 §6). */
export interface ComplaintStructure {
  /** The complaint id (`cc<n>`), used in the remove-control testid. */
  readonly complaintId: string;
  /** The display name (from the header text), for the control's aria-label. */
  readonly name: string;
  /** How many `hcKind:"entry"` entries this complaint has. */
  readonly entryCount: number;
}

/**
 * Derive the complaint/entry structure of the live editor doc (M3-RWv4 §6) so
 * the React layer can render a focusable remove (x) control per complaint and
 * per entry WITHOUT making them editable doc nodes. Entry indices are
 * doc-order, global across complaints (matching the `case-form-entry-remove-<n>`
 * testid, n = 1-based entry position in the whole document).
 */
export function caseStructure(editor: Editor): {
  complaints: ComplaintStructure[];
  /** Flat, doc-order list of `{ complaintId, entryIndex }` per entry. */
  entries: { complaintId: string; entryIndex: number }[];
} {
  const content = (editor.getJSON() as JsonDoc).content ?? [];
  const complaints: ComplaintStructure[] = [];
  const entries: { complaintId: string; entryIndex: number }[] = [];
  let currentId = 'cc1';
  for (const n of content) {
    // M3-RWv6 item 7: a heading emptied by hand is not a complaint.
    if (isGhostComplaintHeading(n)) continue;
    if (n.type === 'heading' && n.attrs?.['hcKind'] === 'complaint') {
      const id = n.attrs?.['hcComplaintId'];
      currentId = typeof id === 'string' ? id : `cc${complaints.length + 1}`;
      const name = (n.content ?? [])
        .map((c) =>
          c.type === 'text' && typeof c.text === 'string' ? c.text : '',
        )
        .join('')
        .replace(/^\s*\d+\.\s*/, '');
      complaints.push({ complaintId: currentId, name, entryCount: 0 });
    } else if (n.type === 'heading' && n.attrs?.['hcKind'] === 'entry') {
      if (complaints.length === 0) {
        // M3-RWv5 C: entries of the unnamed, header-less first complaint.
        complaints.push({ complaintId: currentId, name: '', entryCount: 0 });
      }
      const last = complaints[complaints.length - 1];
      const entryIndex = last ? last.entryCount : 0;
      entries.push({ complaintId: currentId, entryIndex });
      if (last) {
        complaints[complaints.length - 1] = {
          ...last,
          entryCount: last.entryCount + 1,
        };
      }
    }
  }
  return { complaints, entries };
}

/** Re-set the editor's whole document from a spine doc, deep-cloned (glue). */
export function setEditorSpine(editor: Editor, spine: ProseMirrorNode): void {
  const next = JSON.parse(JSON.stringify(spine)) as Content;
  editor.chain().setContent(next).run();
}

/** The live editor doc as a spine `ProseMirrorNode` (for pure transforms). */
export function editorSpine(editor: Editor): ProseMirrorNode {
  return { type: 'doc', content: (editor.getJSON() as JsonDoc).content ?? [] };
}

/**
 * Remove the investigation LINK row carrying `attrs.hcInvestigationLink.
 * attachmentId === attachmentId` from the live editor doc (M3-RWv4 §5.6 UNLINK)
 * — a `data_json` edit ONLY; the underlying attachment is NOT touched. Returns
 * the new spine so the caller re-sets content + autosaves.
 */
export function unlinkInvestigationRow(
  editor: Editor,
  attachmentId: string,
): ProseMirrorNode {
  const stripRows = (node: ProseMirrorNode): ProseMirrorNode => {
    const children = node.content;
    if (children === undefined) return node;
    const kept = children
      .filter((c) => {
        const link = c.attrs?.['hcInvestigationLink'] as
          | { attachmentId?: string }
          | null
          | undefined;
        return !(
          c.type === 'tableRow' &&
          link != null &&
          link.attachmentId === attachmentId
        );
      })
      .map(stripRows);
    return { ...node, content: kept };
  };
  return stripRows(editorSpine(editor));
}

/**
 * Append an investigation LINK row (display-label cells + `hcInvestigationLink`)
 * to the LAST investigations table in the current (tail) entry, creating the
 * table if none exists (M3-RWv4 §5.3). Returns the new spine for the caller to
 * re-set + autosave. `linkRow` is built by `caseRich.buildInvestigationLinkRow`.
 */
export function appendInvestigationLink(
  editor: Editor,
  linkRow: ProseMirrorNode,
  createTable: () => ProseMirrorNode[],
): ProseMirrorNode {
  const content = [...((editor.getJSON() as JsonDoc).content ?? [])];
  // Find the last investigations table after the last entry heading.
  let lastEntryIndex = -1;
  for (let i = 0; i < content.length; i += 1) {
    const n = content[i]!;
    if (n.type === 'heading' && n.attrs?.['hcKind'] === 'entry') {
      lastEntryIndex = i;
    }
  }
  let tableIndex = -1;
  for (let i = lastEntryIndex + 1; i < content.length; i += 1) {
    const n = content[i]!;
    if (n.type === 'table' && n.attrs?.['hcTableType'] === 'investigations') {
      tableIndex = i;
    }
  }
  if (tableIndex === -1) {
    // No investigations table yet → create one that already carries the link.
    const created = createTable();
    return { type: 'doc', content: [...content, ...created] };
  }
  const table = content[tableIndex]!;
  const grown: ProseMirrorNode = {
    ...table,
    content: [...(table.content ?? []), linkRow],
  };
  const next = content.map((n, i) => (i === tableIndex ? grown : n));
  return { type: 'doc', content: next };
}

/** One inserted table of the live doc, for the row-delete controls. */
export interface TableStructure {
  /** The table's `hcTableType` (or null for a table without one). */
  readonly kind: string | null;
  /** How many DATA rows (header excluded) the table has. */
  readonly dataRows: number;
}

/**
 * The top-level tables of the live doc in document order (M3-RWv6 item 6), so
 * the React layer can render a delete control per data row without making it
 * an editable doc node.
 */
export function tableStructure(editor: Editor): TableStructure[] {
  const out: TableStructure[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name !== 'table') return;
    const kind = node.attrs['hcTableType'];
    out.push({
      kind: typeof kind === 'string' ? kind : null,
      dataRows: Math.max(0, node.childCount - 1),
    });
  });
  return out;
}

/**
 * The REAL ProseMirror position of data row `rowIndex` (1-based, header = 0)
 * of the `tableNo`-th (1-based, doc order) top-level table, or null.
 */
export function tableRowPos(
  editor: Editor,
  tableNo: number,
  rowIndex: number,
): number | null {
  let seen = 0;
  let found: number | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (found !== null || node.type.name !== 'table') return;
    seen += 1;
    if (seen !== tableNo || rowIndex < 0 || rowIndex >= node.childCount) return;
    let pos = offset + 1;
    for (let i = 0; i < rowIndex; i += 1) pos += node.child(i).nodeSize;
    found = pos;
  });
  return found;
}

/**
 * Delete the table row at REAL ProseMirror position `rowPos` (M3-RWv6 item 6)
 * as ONE transaction (one undo step; the selection is mapped). The header row
 * (first row) is refused: returns false and the doc is unchanged, as for a
 * position that is not a row of a top-level table. Deleting the last data row
 * removes the table with its section heading and rule (the same span as the
 * pure `caseRich.removeTableRow`). Returns true when a row was deleted.
 */
export function removeTableRowAt(editor: Editor, rowPos: number): boolean {
  const doc = editor.state.doc;
  if (rowPos < 0 || rowPos > doc.content.size) return false;
  const $pos = doc.resolve(rowPos);
  // A top-level table's row sits at depth 1 (its parent is the table).
  if ($pos.depth !== 1) return false;
  const table = $pos.parent;
  if (table.type.name !== 'table') return false;
  const row = $pos.nodeAfter;
  if (row === null || row.type.name !== 'tableRow') return false;
  const rowIndex = $pos.index();
  if (rowIndex === 0) return false;
  let from = rowPos;
  let to = rowPos + row.nodeSize;
  if (table.childCount <= 2) {
    const tableIndex = $pos.index(0);
    const [start, end] = tableSectionSpanOf(editorSpine(editor), tableIndex);
    const offsets: number[] = [];
    doc.forEach((_n, offset) => {
      offsets.push(offset);
    });
    offsets.push(doc.content.size);
    from = offsets[start] ?? from;
    to = offsets[end] ?? to;
  }
  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) tr.delete(from, to);
      return true;
    })
    .run();
}
