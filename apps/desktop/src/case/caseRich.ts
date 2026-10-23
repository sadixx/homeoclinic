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

/** Args for the dated-entry ("Add entry") node builder. */
export interface DatedEntryArgs {
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
      content.push(entryHeading(entry.entry_date, entry.visit_id));
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
 * Build the nodes "Add entry" appends (handoff §3a): a dated entry heading
 * (`hcKind=entry`, `hcDate`, `hcVisitId`) followed by an empty paragraph for
 * the caret.
 */
export function buildDatedEntryNodes(
  args: DatedEntryArgs,
): readonly ProseMirrorNode[] {
  return [entryHeading(args.date, args.visitId), { type: 'paragraph' }];
}

/** A dated-entry heading node (handoff §3). */
function entryHeading(date: string, visitId: string): ProseMirrorNode {
  return {
    type: 'heading',
    attrs: { level: 2, hcKind: 'entry', hcDate: date, hcVisitId: visitId },
    content: [{ type: 'text', text: displayDate(date) }],
  };
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
  const complaints: RichComplaint[] = complaintsRaw
    .map((c, i) => normalizeComplaint(c, i))
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
function normalizeComplaint(raw: unknown, index: number): RichComplaint | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw['id'] === 'string' ? raw['id'] : `cc${index + 1}`;
  const title = typeof raw['title'] === 'string' ? raw['title'] : '';
  const next_section_no =
    typeof raw['next_section_no'] === 'number' ? raw['next_section_no'] : 1;
  const doc = isRecord(raw['doc'])
    ? (raw['doc'] as unknown as ProseMirrorNode)
    : { type: 'doc', content: [] };
  return { id, title, doc, next_section_no };
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
