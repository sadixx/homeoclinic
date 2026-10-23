// M3-RWv2 rich-text (TipTap v2 / ProseMirror) case document — v3 `case-rich`.
//
// The ONE-WYSIWYG-editor-per-complaint model (ADR 0019). This module owns the
// pure, unit-testable v3 (de)serialisation, the in-memory upcast from the v2
// `case-journal` document (caseJournal.ts) and legacy R3 structured data, the
// plain-text projection that keeps `visit_fts` working, and the deterministic
// doc-transform builders the editor command chain wraps (table seeds, the
// hr+numbered-heading+table section nodes, the dated-entry nodes) plus the
// autosave scheduler kernel (CASE-005).
//
// Backend-opaque (ADR 0007): the backend never inspects this shape; it stores
// the serialised string in `visit.data_json TEXT` and the `visit_fts` trigger
// indexes `COALESCE(data_json,'')` verbatim, so v3 carries a top-level `text`
// mirror (§7). Internal JSON keys are snake_case for continuity with v2.
//
// Every text/cell value is a plain string; the UI never stores raw HTML and
// never logs patient data (R-PRIV-001). All upcasts are best-effort, one-way,
// in-memory; disk is untouched until the first autosave rewrites v3.

import { t, type StringKey } from '@/shared/strings';
import { formatDate } from '@/shared/datetime';

import {
  CASE_JOURNAL_SCHEMA,
  parseJournal,
  upcastLegacyCaseData,
  type JournalDoc,
  type Sections,
  type TableBlock,
  type VisitContext,
} from './caseJournal';

/** Discriminator marking a v3 `case-rich` document (handoff §1). */
export const CASE_RICH_SCHEMA = 'case-rich' as const;
/** Current rich-document version (handoff §1). */
export const CASE_RICH_VERSION = 3 as const;

/** The table / section kinds a node may carry (handoff §3). */
export type RichTableType =
  | 'vitals'
  | 'modalities'
  | 'family_history'
  | 'physical_generals'
  | 'investigations'
  | 'prescription'
  | 'generic';

/** A ProseMirror/TipTap JSON node (opaque to storage; handoff §3). */
export interface ProseMirrorNode {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
  readonly content?: readonly ProseMirrorNode[];
  readonly text?: string;
  readonly marks?: ReadonlyArray<{ readonly type: string }>;
}

/** One complaint = one editor document (handoff §2). */
export interface RichComplaint {
  readonly id: string;
  readonly title: string;
  readonly doc: ProseMirrorNode;
  readonly next_section_no: number;
}

/** The top-level v3 document stored (opaquely) in visit.data_json (handoff §1/§7). */
export interface V3Doc {
  readonly schema: typeof CASE_RICH_SCHEMA;
  readonly version: typeof CASE_RICH_VERSION;
  readonly complaints: readonly RichComplaint[];
  readonly next_section_no: number;
  readonly sections: unknown | null;
  /** Derived plain-text mirror for visit_fts (handoff §7); regen on serialise. */
  readonly text?: string;
}

/** Context the (de)serialiser/upcast needs from the open visit. */
export interface RichVisitContext {
  readonly visitId: string;
  readonly visitAt: string;
}

/** A table seed produced by a popup builder (columns + rows + kind/marker). */
export interface TableSeed {
  readonly hcTableType: RichTableType;
  readonly hcRxPlaceholder?: boolean;
  readonly columns: readonly string[];
  readonly rows: ReadonlyArray<readonly string[]>;
}

/** Vitals popup values (BP as two fields — ADR 0019 #7). */
export interface VitalsPopupValues {
  readonly systolic: string;
  readonly diastolic: string;
  readonly pulse: string;
  readonly weightKg: string;
  readonly heightCm: string;
  readonly bmi: string;
  readonly temp: string;
  readonly spo2: string;
}

/** Family-history popup values: the two tabs (handoff §5c). */
export interface FamilyPopupValues {
  readonly maternal: string;
  readonly paternal: string;
}

/** Prescription popup values (placeholder — handoff §5f). */
export interface PrescriptionPopupValues {
  readonly medicine: string;
  readonly potency: string;
  readonly dosage: string;
  readonly instructions: string;
}

/** Args for the section-node builder (hr + numbered heading + table). */
export interface SectionNodesArgs {
  readonly kind: RichTableType;
  readonly sectionNo: number;
  readonly seed: TableSeed;
}

/**
 * The kind of a dated entry under a complaint (M3-RWv3 §3a): the FIRST entry
 * when a complaint is created, or a per-complaint `follow_up` entry added later
 * in the same document (the in-editor "Add follow-up entry" button).
 */
export type EntryKind = 'first' | 'follow_up';

/**
 * Args for the dated-entry node builder. `complaintName`/`kind` are OPTIONAL
 * for back-compat with the pre-RWv3 callers (which emitted a bare dated entry);
 * when omitted, `kind` defaults to `'first'` and the header degrades to a
 * date-only line (M3-RWv3 §3c edge case).
 */
export interface DatedEntryArgs {
  readonly date: string;
  readonly visitId: string;
  /** The owning complaint's name, denormalised onto the entry heading (§3a). */
  readonly complaintName?: string;
  /** `'first'` (default) or `'follow_up'` (M3-RWv3 §3a). */
  readonly kind?: EntryKind;
}

/** Args for the numbered complaint-header node builder (M3-RWv3 §3a). */
export interface ComplaintHeaderArgs {
  readonly complaintNo: number;
  readonly complaintId: string;
  readonly name: string;
}

/** Args for the "Add new complaint" kernel builder (M3-RWv3 §5). */
export interface NewComplaintArgs {
  readonly complaintNo: number;
  readonly complaintId: string;
  readonly name: string;
  readonly date: string;
  readonly visitId: string;
}

/** The autosave scheduler contract (deterministic kernel of CASE-005). */
export interface AutosaveScheduler {
  schedule(payload: string): void;
  forceSave(): void;
}

// ---------------------------------------------------------------------------
// Canonical seed column KEYS (R-UI-007: visible text comes from en.json by
// key, never a hardcoded English literal). The pure builders resolve these to
// display strings through an injected {@link Translate} so they stay
// unit-testable with a fake `t` and carry no React/hook dependency.
// ---------------------------------------------------------------------------

/** A key -> display-string resolver (the typed {@link t}); injected, not a hook. */
export type Translate = (key: StringKey) => string;

/** Vitals table header keys (handoff §5a) — BP is TWO cells, never `120/80`. */
const VITALS_COLUMN_KEYS: readonly StringKey[] = [
  'case.form.vitals.col.bpSys',
  'case.form.vitals.col.bpDia',
  'case.form.vitals.col.pulse',
  'case.form.vitals.col.weight',
  'case.form.vitals.col.height',
  'case.form.vitals.col.bmi',
  'case.form.vitals.col.temp',
  'case.form.vitals.col.spo2',
];

/** Family-history two-column header keys (handoff §5c). */
const FAMILY_COLUMN_KEYS: readonly StringKey[] = [
  'case.form.family.maternal',
  'case.form.family.paternal',
];

/** Prescription placeholder header keys (handoff §5f). */
const PRESCRIPTION_COLUMN_KEYS: readonly StringKey[] = [
  'case.form.prescription.medicine',
  'case.form.prescription.potency',
  'case.form.prescription.dosage',
  'case.form.prescription.instructions',
];

/** Physical-generals key/value header keys (v2->v3 upcast; handoff §8a). */
const GENERALS_COLUMN_KEYS: readonly StringKey[] = [
  'case.form.generals.field',
  'case.form.generals.value',
];

/** Investigations header keys (v2->v3 upcast; handoff §8a). */
const INVESTIGATIONS_COLUMN_KEYS: readonly StringKey[] = [
  'case.form.investigations.name',
  'case.form.investigations.status',
  'case.form.investigations.notes',
];

/** Resolve a list of {@link StringKey}s to display strings via the injected `t`. */
function columns(t: Translate, keys: readonly StringKey[]): string[] {
  return keys.map((k) => t(k));
}

// ---------------------------------------------------------------------------
// Node construction helpers (plain JSON, exactly what TipTap `getJSON` emits).
// ---------------------------------------------------------------------------

/** A `text` leaf, or `undefined` when the string is empty (PM rejects ""). */
function textNode(value: string): ProseMirrorNode | undefined {
  return value === '' ? undefined : { type: 'text', text: value };
}

/** A `paragraph` wrapping the given string (empty paragraph when ''). */
function paragraph(value: string): ProseMirrorNode {
  const leaf = textNode(value);
  return leaf === undefined
    ? { type: 'paragraph' }
    : { type: 'paragraph', content: [leaf] };
}

/** One table cell (header or body) holding a single paragraph of text. */
function cell(
  kind: 'tableHeader' | 'tableCell',
  value: string,
): ProseMirrorNode {
  return { type: kind, content: [paragraph(value)] };
}

/** Build a `table` node from a {@link TableSeed} (header row + body rows). */
function tableNode(seed: TableSeed): ProseMirrorNode {
  const attrs: Record<string, unknown> = { hcTableType: seed.hcTableType };
  if (seed.hcRxPlaceholder === true) {
    attrs['hcRxPlaceholder'] = true;
  }
  const headerRow: ProseMirrorNode = {
    type: 'tableRow',
    content: seed.columns.map((c) => cell('tableHeader', c)),
  };
  const bodyRows: ProseMirrorNode[] = seed.rows.map((row) => ({
    type: 'tableRow',
    content: row.map((v) => cell('tableCell', v)),
  }));
  return { type: 'table', attrs, content: [headerRow, ...bodyRows] };
}

/** The display label for a section type (from en.json; handoff §4). */
function sectionLabel(kind: RichTableType): string {
  const key = `case.section.label.${kind}` as StringKey;
  return t(key);
}

/** Render the "N. Label" heading prefix text from the stamped number (§4). */
function sectionHeadingText(sectionNo: number, kind: RichTableType): string {
  return `${sectionNo}. ${sectionLabel(kind)}`;
}

// ---------------------------------------------------------------------------
// §12 pure functions.
// ---------------------------------------------------------------------------

/**
 * A fresh v3 document: one empty complaint whose doc holds one dated entry
 * (today's visit) and an empty paragraph for the caret (handoff §1/§8).
 */
export function emptyRichDoc(ctx: RichVisitContext): V3Doc {
  const complaint: RichComplaint = {
    id: 'cc1',
    title: '',
    next_section_no: 1,
    doc: {
      type: 'doc',
      content: [
        ...buildDatedEntryNodes({
          date: isoDate(ctx.visitAt),
          visitId: ctx.visitId,
        }),
      ],
    },
  };
  return {
    schema: CASE_RICH_SCHEMA,
    version: CASE_RICH_VERSION,
    complaints: [complaint],
    next_section_no: 1,
    sections: null,
  };
}

/**
 * Serialise the in-memory v3 document to the JSON string stored in
 * `visit.data_json`. The top-level `text` mirror is ALWAYS regenerated from
 * `doc` so it never goes stale (handoff §7/§11 invariant): any cached `text`
 * on the input is discarded and replaced.
 */
export function serializeRich(doc: V3Doc): string {
  const withFreshText: V3Doc = { ...doc, text: extractCaseText(doc) };
  return JSON.stringify(withFreshText);
}

/**
 * Parse a `visit.data_json` string on open into a v3 document, detecting and
 * upcasting older shapes (handoff §8 detection table):
 *
 * - `schema === "case-rich"` -> restore directly (normalised + text regen).
 * - `schema === "case-journal"` -> upcast v2 journal -> v3 (§8a).
 * - legacy R3 (`chief_complaints` / no schema) -> R3 -> v2 -> v3 (§8b).
 * - unparseable / null -> one empty complaint with one dated entry.
 *
 * Prototype-polluting own keys (`__proto__`/`constructor`/`prototype`) are
 * stripped at this parse boundary (defence in depth; see mergeAttributes
 * hardening note) before any object is trusted.
 */
export function parseCaseDoc(
  dataJson: string,
  ctx: RichVisitContext,
  t: Translate,
): V3Doc {
  let raw: unknown;
  try {
    raw = JSON.parse(dataJson, reviveSafe);
  } catch {
    return emptyRichDoc(ctx);
  }
  if (!isRecord(raw)) {
    return emptyRichDoc(ctx);
  }
  if (raw['schema'] === CASE_RICH_SCHEMA) {
    return normalizeV3(raw, ctx);
  }
  if (raw['schema'] === CASE_JOURNAL_SCHEMA) {
    return upcastJournalToRich(raw, ctx, t);
  }
  // Legacy R3 (version 1/absent, `chief_complaints`): R3 -> v2 -> v3 (§8b).
  const v2 = upcastLegacyCaseData(raw, visitCtx(ctx));
  return upcastJournalToRich(v2, ctx, t);
}

/**
 * Upcast a v2 `case-journal` document to v3 (handoff §8a). Accepts either an
 * already-typed {@link JournalDoc} or an unknown parsed object (normalised via
 * {@link parseJournal}); folds every dated entry and its blocks into the
 * complaint's ProseMirror doc, and folds the top-level `sections` object into
 * in-document tables appended to the FIRST complaint so family history /
 * physical generals / investigations survive (the B7 read-time fix).
 */
export function upcastJournalToRich(
  v2: unknown,
  ctx: RichVisitContext,
  t: Translate,
): V3Doc {
  const journal: JournalDoc = isTypedJournal(v2)
    ? v2
    : parseJournal(JSON.stringify(v2 ?? {}), visitCtx(ctx));

  const complaints: RichComplaint[] = journal.complaints.map((c) => {
    let nextNo = 1;
    const content: ProseMirrorNode[] = [];
    for (const entry of c.entries) {
      content.push(
        entryHeading(entry.entry_date, entry.visit_id, c.title, 'first'),
      );
      for (const block of entry.blocks) {
        if (block.kind === 'text') {
          for (const line of splitParagraphs(block.text)) {
            content.push(paragraph(line));
          }
        } else {
          const kind = tableKindOf(block);
          content.push(
            ...sectionNodesFor(kind, nextNo, seedFromBlock(block, kind)),
          );
          nextNo += 1;
        }
      }
    }
    return {
      id: c.id,
      title: c.title,
      next_section_no: nextNo,
      doc: { type: 'doc', content },
    };
  });

  // Fold the v2 top-level `sections` object into in-document tables appended to
  // the first complaint's content so no side-section data is lost (§8a step 3).
  const first = complaints[0];
  if (first !== undefined) {
    const { nodes, nextNo } = sectionTablesFromSections(
      journal.sections,
      first.next_section_no,
      t,
    );
    if (nodes.length > 0) {
      complaints[0] = {
        ...first,
        next_section_no: nextNo,
        doc: { type: 'doc', content: [...(first.doc.content ?? []), ...nodes] },
      };
    }
  }

  if (complaints.length === 0) {
    return emptyRichDoc(ctx);
  }

  const topNextNo = Math.max(...complaints.map((c) => c.next_section_no));
  return {
    schema: CASE_RICH_SCHEMA,
    version: CASE_RICH_VERSION,
    complaints,
    next_section_no: topNextNo,
    // Keep the original sections transitionally (§6) for back-compat read.
    sections: journal.sections ?? null,
  };
}

/**
 * The plain-text projection for `visit_fts` (handoff §7): the in-document-order
 * concatenation of every complaint `title`, every heading/paragraph/text run,
 * and every table cell (space-joined per row). Pure; derived from `doc` so the
 * serialiser never trusts a cached value.
 */
export function extractCaseText(doc: V3Doc): string {
  const parts: string[] = [];
  for (const complaint of doc.complaints) {
    if (complaint.title !== '') {
      parts.push(complaint.title);
    }
    collectNodeText(complaint.doc, parts);
  }
  return parts.filter((p) => p !== '').join('\n');
}

/** Walk a node tree, pushing a text fragment per structural node (§7). */
function collectNodeText(node: ProseMirrorNode, out: string[]): void {
  switch (node.type) {
    case 'text':
      if (typeof node.text === 'string' && node.text !== '')
        out.push(node.text);
      return;
    case 'tableRow': {
      // Space-join the row's cell text onto one line (handoff §7 example).
      const rowParts: string[] = [];
      for (const child of node.content ?? []) collectNodeText(child, rowParts);
      if (rowParts.length > 0) out.push(rowParts.join(' '));
      return;
    }
    case 'heading':
    case 'paragraph': {
      const lineParts: string[] = [];
      for (const child of node.content ?? []) collectNodeText(child, lineParts);
      if (lineParts.length > 0) out.push(lineParts.join(' '));
      return;
    }
    default:
      for (const child of node.content ?? []) collectNodeText(child, out);
  }
}

// ---------------------------------------------------------------------------
// Table seed builders (handoff §5).
// ---------------------------------------------------------------------------

/**
 * Build the vitals table seed, splitting BP into TWO cells (ADR 0019 #7) and
 * keeping a BMI column; never emits a combined `120/80` string (handoff §5a).
 */
export function buildVitalsSeed(
  values: VitalsPopupValues,
  t: Translate,
): TableSeed {
  return {
    hcTableType: 'vitals',
    columns: columns(t, VITALS_COLUMN_KEYS),
    rows: [
      [
        values.systolic,
        values.diastolic,
        values.pulse,
        values.weightKg,
        values.heightCm,
        values.bmi,
        values.temp,
        values.spo2,
      ],
    ],
  };
}

/**
 * Build the two-column Maternal|Paternal family-history seed (handoff §5c):
 * one body row per non-empty line, maternal lines drive the row count and the
 * ragged (shorter) column is padded with '' (assumption B).
 */
export function buildFamilySeed(
  values: FamilyPopupValues,
  t: Translate,
): TableSeed {
  const maternal = splitLines(values.maternal);
  const paternal = splitLines(values.paternal);
  const rowCount = Math.max(maternal.length, paternal.length);
  const rows: string[][] = [];
  for (let i = 0; i < rowCount; i += 1) {
    rows.push([maternal[i] ?? '', paternal[i] ?? '']);
  }
  return {
    hcTableType: 'family_history',
    columns: columns(t, FAMILY_COLUMN_KEYS),
    rows,
  };
}

/**
 * Build the prescription PLACEHOLDER seed (handoff §5f). `hcRxPlaceholder` is
 * MANDATORY true — the machine-readable "this is NOT a prescription record"
 * marker (R4/M7 boundary: no Rx row, no print).
 */
export function buildPrescriptionSeed(
  values: PrescriptionPopupValues,
  t: Translate,
): TableSeed {
  return {
    hcTableType: 'prescription',
    hcRxPlaceholder: true,
    columns: columns(t, PRESCRIPTION_COLUMN_KEYS),
    rows: [
      [values.medicine, values.potency, values.dosage, values.instructions],
    ],
  };
}

// ---------------------------------------------------------------------------
// Node builders (the pure kernel of insertSectionTable / appendDatedEntry).
// ---------------------------------------------------------------------------

/**
 * Build the ordered nodes a record-button insertion appends to the current
 * dated entry (handoff §3a): `[horizontalRule, section heading, table]`. The
 * heading carries `hcKind=section`, the stamped `hcSectionNo` and
 * `hcSectionType`, and renders the "N. Label" prefix (handoff §4).
 */
export function buildSectionNodes(
  args: SectionNodesArgs,
): readonly ProseMirrorNode[] {
  return sectionNodesFor(args.kind, args.sectionNo, args.seed);
}

/** Shared implementation of {@link buildSectionNodes} (reused by the upcast). */
function sectionNodesFor(
  kind: RichTableType,
  sectionNo: number,
  seed: TableSeed,
): ProseMirrorNode[] {
  const heading: ProseMirrorNode = {
    type: 'heading',
    attrs: {
      level: 3,
      hcKind: 'section',
      hcSectionNo: sectionNo,
      hcSectionType: kind,
    },
    content: [{ type: 'text', text: sectionHeadingText(sectionNo, kind) }],
  };
  return [{ type: 'horizontalRule' }, heading, tableNode(seed)];
}

/**
 * Compose the visible text of a dated entry heading (M3-RWv3 §3c). Pure and
 * localisable: the `-follow-up` suffix and the `name — date` separator both
 * come from en.json (R-UI-007), never a hardcoded English literal.
 *
 * - first  : `<name><sep><date>`               e.g. `Headache — 02-10-2026`
 * - follow : `<name><suffix><sep><date>`        e.g. `Headache-follow-up — 02-10-2026`
 *
 * When `name` is empty the base degrades to just the date (first) or the bare
 * `<suffix><sep><date>` (follow-up), so an unnamed complaint still reads
 * sensibly (§3c edge case).
 */
export function entryHeadingText(
  name: string,
  kind: EntryKind,
  date: string,
  translate: Translate,
): string {
  const sep = translate('case.form.entry.dateSeparator');
  const suffix =
    kind === 'follow_up' ? translate('case.form.entry.followupSuffix') : '';
  const base = `${name}${suffix}`;
  const display = displayDate(date);
  return base === '' ? display : `${base}${sep}${display}`;
}

/**
 * Build the nodes a dated entry appends (M3-RWv3 §3a/§5): a dated entry heading
 * (`hcKind=entry`, `hcDate`, `hcVisitId`, `hcEntryKind`, `hcComplaintName`)
 * followed by an empty paragraph for the caret. `kind` defaults to `'first'`
 * and `complaintName` to `''` so pre-RWv3 callers keep working unchanged.
 */
export function buildDatedEntryNodes(
  args: DatedEntryArgs,
): readonly ProseMirrorNode[] {
  const kind: EntryKind = args.kind ?? 'first';
  const name = args.complaintName ?? '';
  return [
    entryHeading(args.date, args.visitId, name, kind),
    { type: 'paragraph' },
  ];
}

/**
 * Build a numbered COMPLAINT-SECTION header node (M3-RWv3 §3a): an h1 heading
 * carrying `hcKind=complaint`, the 1-based `hcComplaintNo`, the `hcComplaintId`
 * (`cc<n>`) and the rendered text `"<no>. <name>"`. An empty name renders the
 * `case.form.complaint.untitled` placeholder so the numbered section is visible.
 */
export function buildComplaintHeaderNode(
  args: ComplaintHeaderArgs,
): ProseMirrorNode {
  const name = args.name === '' ? t('case.form.complaint.untitled') : args.name;
  return {
    type: 'heading',
    attrs: {
      level: 1,
      hcKind: 'complaint',
      hcComplaintNo: args.complaintNo,
      hcComplaintId: args.complaintId,
    },
    content: [{ type: 'text', text: `${args.complaintNo}. ${name}` }],
  };
}

/**
 * Build the nodes "Add new complaint" appends (M3-RWv3 §5): the numbered
 * complaint header, its FIRST dated entry (headed `<name> — <date>`) and the
 * caret paragraph the first entry already provides.
 */
export function buildNewComplaintNodes(
  args: NewComplaintArgs,
): readonly ProseMirrorNode[] {
  return [
    buildComplaintHeaderNode({
      complaintNo: args.complaintNo,
      complaintId: args.complaintId,
      name: args.name,
    }),
    ...buildDatedEntryNodes({
      date: args.date,
      visitId: args.visitId,
      complaintName: args.name,
      kind: 'first',
    }),
  ];
}

/**
 * A dated-entry heading node (M3-RWv3 §3). Carries the entry kind and the
 * denormalised complaint name so the header text can be derived without walking
 * back to the complaint header, and so the FTS mirror sees the name on every
 * entry.
 */
function entryHeading(
  date: string,
  visitId: string,
  complaintName: string,
  kind: EntryKind,
): ProseMirrorNode {
  return {
    type: 'heading',
    attrs: {
      level: 2,
      hcKind: 'entry',
      hcEntryKind: kind,
      hcComplaintName: complaintName,
      hcDate: date,
      hcVisitId: visitId,
    },
    content: [
      { type: 'text', text: entryHeadingText(complaintName, kind, date, t) },
    ],
  };
}

// ---------------------------------------------------------------------------
// Spine <-> complaints[] (representation a, M3-RWv3 §2/§3b).
// ---------------------------------------------------------------------------

/**
 * Join the canonical `complaints[]` into ONE "spine" ProseMirror doc: in
 * complaint order, each complaint's numbered header (derived from its array
 * position) followed by that complaint's own `doc.content` (M3-RWv3 §3b). The
 * inverse of {@link splitSpineToComplaints}.
 */
export function joinComplaintsToSpine(
  complaints: readonly RichComplaint[],
): ProseMirrorNode {
  const content: ProseMirrorNode[] = [];
  complaints.forEach((complaint, index) => {
    content.push(
      buildComplaintHeaderNode({
        complaintNo: index + 1,
        complaintId: complaint.id,
        name: complaint.title,
      }),
    );
    for (const node of complaint.doc.content ?? []) content.push(node);
  });
  return { type: 'doc', content };
}

/**
 * Split a spine doc back into `complaints[]` (M3-RWv3 §3b): each top-level
 * `hcKind:"complaint"` header starts a new complaint; everything until the next
 * complaint header (or end) is that complaint's `doc.content`. The complaint
 * header node itself is NOT copied into the per-complaint doc; `id`/`title`
 * come from its attrs. Nodes before the first complaint header (there should be
 * none in a well-formed spine) are attached to the first complaint.
 */
export function splitSpineToComplaints(
  spine: ProseMirrorNode,
): RichComplaint[] {
  const complaints: RichComplaint[] = [];
  const top = spine.content ?? [];
  let current: {
    id: string;
    title: string;
    content: ProseMirrorNode[];
  } | null = null;
  const flush = (): void => {
    if (current === null) return;
    complaints.push({
      id: current.id,
      title: current.title,
      next_section_no: nextSectionNoOf(current.content),
      doc: { type: 'doc', content: current.content },
    });
  };
  for (const node of top) {
    if (node.type === 'heading' && node.attrs?.['hcKind'] === 'complaint') {
      flush();
      const idAttr = node.attrs?.['hcComplaintId'];
      const id =
        typeof idAttr === 'string' ? idAttr : `cc${complaints.length + 1}`;
      current = { id, title: complaintTitleFromHeader(node), content: [] };
    } else {
      if (current === null) {
        current = { id: 'cc1', title: '', content: [] };
      }
      current.content.push(node);
    }
  }
  flush();
  return complaints;
}

/**
 * Resolve the caret's owning complaint id: the `hcComplaintId` of the nearest
 * complaint header at or before `caretPos`, measured in REAL ProseMirror
 * positions (M3-RWv3 §5). `caretPos` is `editor.state.selection.head`, so the
 * spine must be walked by actual node sizes — NOT a serialised-string length —
 * or the two scales disagree and every caret collapses onto complaint #1.
 *
 * ProseMirror position model: the first top-level child begins at position 0;
 * each top-level child spans {@link proseMirrorNodeSize} positions, so the next
 * child begins at the running sum. A complaint "owns" the caret when its start
 * position is `<= caretPos` and no later complaint header also qualifies. Falls
 * back to the first complaint when the caret precedes every header, else `cc1`.
 */
export function currentComplaintId(
  spine: ProseMirrorNode,
  caretPos: number,
): string {
  const top = spine.content ?? [];
  let pos = 0;
  let owning: string | null = null;
  for (const node of top) {
    if (node.type === 'heading' && node.attrs?.['hcKind'] === 'complaint') {
      const id = node.attrs?.['hcComplaintId'];
      if (typeof id === 'string') {
        if (pos <= caretPos) owning = id;
        else if (owning === null) owning = id;
      }
    }
    pos += proseMirrorNodeSize(node);
  }
  if (owning !== null) return owning;
  const firstHeader = top.find(
    (n) => n.type === 'heading' && n.attrs?.['hcKind'] === 'complaint',
  );
  const firstId = firstHeader?.attrs?.['hcComplaintId'];
  return typeof firstId === 'string' ? firstId : 'cc1';
}

/**
 * The ProseMirror `nodeSize` of a JSON node, matching `Node.nodeSize` on a live
 * document: a text leaf spans its string length; any other leaf (no `content`)
 * spans 1; a non-leaf (block) spans `2 + Σ child sizes` (one token for each
 * boundary). Used by {@link currentComplaintId} so caret resolution runs in the
 * same position scale as `editor.state.selection.head`.
 */
function proseMirrorNodeSize(node: ProseMirrorNode): number {
  if (node.type === 'text') return node.text?.length ?? 0;
  const children = node.content ?? [];
  if (children.length === 0) return 1;
  let inner = 0;
  for (const child of children) inner += proseMirrorNodeSize(child);
  return inner + 2;
}

/** Recover a complaint title from its header text (`"<no>. <name>"`). */
function complaintTitleFromHeader(header: ProseMirrorNode): string {
  const raw = (header.content ?? [])
    .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('');
  const stripped = raw.replace(/^\s*\d+\.\s*/, '');
  if (stripped === t('case.form.complaint.untitled')) return '';
  return stripped;
}

/** Derive a per-complaint `next_section_no` from its existing section headings. */
function nextSectionNoOf(content: readonly ProseMirrorNode[]): number {
  let max = 0;
  const walk = (n: ProseMirrorNode): void => {
    if (n.type === 'heading' && n.attrs?.['hcKind'] === 'section') {
      const no = n.attrs?.['hcSectionNo'];
      if (typeof no === 'number' && no > max) max = no;
    }
    for (const c of n.content ?? []) walk(c);
  };
  for (const n of content) walk(n);
  return max + 1;
}

// ---------------------------------------------------------------------------
// Autosave scheduler (deterministic CASE-005 kernel).
// ---------------------------------------------------------------------------

/**
 * Create the autosave scheduler: {@link AutosaveScheduler.schedule} debounces
 * `debounceMs` and coalesces rapid changes within the window to ONE save of
 * the latest payload; {@link AutosaveScheduler.forceSave} flushes the pending
 * payload immediately and cancels the timer so there is no double save
 * (handoff: explicit Save force-flush + 2 s debounce).
 */
export function createAutosaveScheduler(
  save: (payload: string) => void,
  debounceMs: number,
): AutosaveScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: string | undefined;

  const flush = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending !== undefined) {
      const payload = pending;
      pending = undefined;
      save(payload);
    }
  };

  return {
    schedule(payload: string): void {
      pending = payload;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    },
    forceSave(): void {
      flush();
    },
  };
}

// ---------------------------------------------------------------------------
// Upcast helpers.
// ---------------------------------------------------------------------------

/** Map a v2 table block's `table_type` to a v3 rich table/section kind. */
function tableKindOf(block: TableBlock): RichTableType {
  switch (block.table_type) {
    case 'vitals':
      return 'vitals';
    case 'modalities':
      return 'modalities';
    case 'prescription':
      return 'prescription';
    default:
      return 'generic';
  }
}

/** Build a {@link TableSeed} from a v2 table block (preserving cells). */
function seedFromBlock(block: TableBlock, kind: RichTableType): TableSeed {
  const seed: TableSeed = {
    hcTableType: kind,
    columns: [...block.columns],
    rows: block.rows.map((r) => [...r]),
  };
  if (block.rx_placeholder === true) {
    return { ...seed, hcRxPlaceholder: true };
  }
  return seed;
}

/**
 * Fold the v2 top-level `sections` object into in-document section tables
 * (handoff §8a step 3). Returns the nodes to append plus the advanced section
 * counter. Only non-empty sections produce a table; the two-column family
 * history and key/value generals/investigations use the §5 seed shapes.
 */
function sectionTablesFromSections(
  sections: Sections,
  startNo: number,
  t: Translate,
): { nodes: ProseMirrorNode[]; nextNo: number } {
  const nodes: ProseMirrorNode[] = [];
  let no = startNo;

  const fam = sections.family_history;
  if (fam !== undefined && (fam.maternal !== '' || fam.paternal !== '')) {
    nodes.push(
      ...sectionNodesFor(
        'family_history',
        no,
        buildFamilySeed({ maternal: fam.maternal, paternal: fam.paternal }, t),
      ),
    );
    no += 1;
  }

  const pg = sections.physical_generals;
  if (pg !== undefined) {
    const rows = Object.entries(pg)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => [k, v]);
    if (rows.length > 0) {
      nodes.push(
        ...sectionNodesFor('physical_generals', no, {
          hcTableType: 'physical_generals',
          columns: columns(t, GENERALS_COLUMN_KEYS),
          rows,
        }),
      );
      no += 1;
    }
  }

  const inv = sections.investigations;
  if (inv !== undefined && (inv.suggested !== '' || inv.submitted !== '')) {
    const rows: string[][] = [];
    if (inv.suggested !== '') rows.push([inv.suggested, 'Suggested', '']);
    if (inv.submitted !== '') rows.push([inv.submitted, 'Submitted', '']);
    nodes.push(
      ...sectionNodesFor('investigations', no, {
        hcTableType: 'investigations',
        columns: columns(t, INVESTIGATIONS_COLUMN_KEYS),
        rows,
      }),
    );
    no += 1;
  }

  return { nodes, nextNo: no };
}

/** Normalise an already-v3 parsed object into a well-typed {@link V3Doc}. */
function normalizeV3(
  obj: Record<string, unknown>,
  ctx: RichVisitContext,
): V3Doc {
  const complaintsRaw = Array.isArray(obj['complaints'])
    ? obj['complaints']
    : [];
  // A v3 payload our own serialiser produced always carries the top-level `text`
  // mirror (serializeRich). Its absence marks a RAW / hand-authored legacy v3
  // doc that predates RWv3 and whose entry headings must be back-filled to
  // `hcEntryKind:'first'` + `hcComplaintName` (M3-RWv3 §6). A doc that already
  // has `text` round-trips verbatim (the attrs are authoritative as written).
  const normalizeEntries = obj['text'] === undefined;
  const complaints: RichComplaint[] = complaintsRaw
    .map((c, i) => normalizeComplaint(c, i, normalizeEntries))
    .filter((c): c is RichComplaint => c !== null);
  if (complaints.length === 0) {
    return emptyRichDoc(ctx);
  }
  const topNextNo =
    typeof obj['next_section_no'] === 'number'
      ? obj['next_section_no']
      : Math.max(...complaints.map((c) => c.next_section_no));
  return {
    schema: CASE_RICH_SCHEMA,
    version: CASE_RICH_VERSION,
    complaints,
    next_section_no: topNextNo,
    sections: obj['sections'] ?? null,
  };
}

/** Normalise one v3 complaint, guaranteeing a doc and a counter. */
function normalizeComplaint(
  raw: unknown,
  index: number,
  normalizeEntries: boolean,
): RichComplaint | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw['id'] === 'string' ? raw['id'] : `cc${index + 1}`;
  const title = typeof raw['title'] === 'string' ? raw['title'] : '';
  const next_section_no =
    typeof raw['next_section_no'] === 'number' ? raw['next_section_no'] : 1;
  const doc = isRecord(raw['doc'])
    ? (raw['doc'] as unknown as ProseMirrorNode)
    : { type: 'doc', content: [] };
  const normalisedDoc = normalizeEntries
    ? normalizeEntryHeadings(doc, title)
    : doc;
  return { id, title, doc: normalisedDoc, next_section_no };
}

/**
 * Back-fill legacy v3 entry headings that predate RWv3 (M3-RWv3 §6): an `entry`
 * heading with NO `hcEntryKind` is stamped `'first'`, and a missing
 * `hcComplaintName` is filled from the owning complaint `title`. Non-entry
 * nodes pass through untouched; the walk is immutable (returns a new tree).
 */
function normalizeEntryHeadings(
  node: ProseMirrorNode,
  complaintTitle: string,
): ProseMirrorNode {
  const children = node.content?.map((c) =>
    normalizeEntryHeadings(c, complaintTitle),
  );
  let next: ProseMirrorNode =
    children === undefined ? node : { ...node, content: children };
  if (next.type === 'heading' && next.attrs?.['hcKind'] === 'entry') {
    const attrs = next.attrs ?? {};
    const kind =
      attrs['hcEntryKind'] === 'follow_up' ? 'follow_up' : ('first' as const);
    const name =
      typeof attrs['hcComplaintName'] === 'string' &&
      attrs['hcComplaintName'] !== ''
        ? (attrs['hcComplaintName'] as string)
        : complaintTitle;
    next = {
      ...next,
      attrs: { ...attrs, hcEntryKind: kind, hcComplaintName: name },
    };
  }
  return next;
}

// ---------------------------------------------------------------------------
// Small pure utilities.
// ---------------------------------------------------------------------------

/** Adapt a {@link RichVisitContext} to the v2 {@link VisitContext} shape. */
function visitCtx(ctx: RichVisitContext): VisitContext {
  return { visitId: ctx.visitId, visitAt: ctx.visitAt };
}

/** Type guard: an already-typed v2 journal document. */
function isTypedJournal(v: unknown): v is JournalDoc {
  return (
    isRecord(v) &&
    v['schema'] === CASE_JOURNAL_SCHEMA &&
    Array.isArray(v['complaints'])
  );
}

/** Type guard: a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * JSON.parse reviver that drops prototype-polluting own keys at the parse
 * boundary (defence in depth; mergeAttributes `__proto__` hardening). Returns
 * the value unchanged for everything else.
 */
function reviveSafe(key: string, value: unknown): unknown {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    return undefined;
  }
  return value;
}

/** Split a multi-line string into non-empty, trimmed lines. */
function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

/** Split prose into paragraphs on newlines (empty input -> one empty para). */
function splitParagraphs(value: string): string[] {
  if (value === '') return [''];
  const lines = value.split('\n');
  return lines.length === 0 ? [''] : lines;
}

/** The `YYYY-MM-DD` calendar date of an RFC3339 instant (or as-is if short). */
function isoDate(instant: string): string {
  if (instant.length >= 10) return instant.slice(0, 10);
  return instant;
}

/**
 * Display an entry date as `DD-MM-YYYY` (R-UI-006) through the shared
 * {@link formatDate} helper (rwv2-gl-4: one date formatter, no re-implemented
 * DD-MM-YYYY). A date-only `YYYY-MM-DD` is anchored to LOCAL midnight before
 * formatting so a calendar date never shifts a day in a behind-UTC timezone;
 * a full RFC3339 instant is passed through unchanged. Falls back to the raw
 * input when the value is not a date `formatDate` can parse.
 */
function displayDate(date: string): string {
  const anchored = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00` : date;
  return formatDate(anchored) ?? date;
}
