// The doctor-journal case document that lives inside `visit.data_json` (ADR
// 0018; shape in .worklog/HC-MVP1-M3/handoffs/M3-RW-data-json-schema.md). The
// backend treats `data_json` as opaque TEXT (ADR 0007); this module owns the
// in-memory model, the v2 (de)serialisation and the best-effort one-way upcast
// that lets an old R3 structured visit still open (ADR 0018 #8).
//
// Internal JSON keys are snake_case for continuity with the R3 document (the
// payload is UI-owned text, not a specta wire type). Every text/cell value is
// a plain string and FTS relies on the doctor's text being present as JSON
// string values, so case text is never moved out of `data_json` (schema §8).
//
// No patient data is logged here (R-PRIV-001); this module is pure data.

import { formatDate } from '@/shared/datetime';

/** Discriminator marking a v2 doctor-journal document. */
export const CASE_JOURNAL_SCHEMA = 'case-journal';
/** Current journal document version. */
export const CASE_JOURNAL_VERSION = 2;

/** The table kinds a block may carry (schema §4a–§4d). */
export type TableType = 'vitals' | 'modalities' | 'prescription' | 'generic';

/** A free-prose block the doctor edits in a textarea. */
export interface TextBlock {
  readonly kind: 'text';
  readonly id: string;
  readonly text: string;
}

/** An editable grid block; every cell (incl. header cells) is a string. */
export interface TableBlock {
  readonly kind: 'table';
  readonly id: string;
  readonly table_type: TableType;
  /** Present and true ONLY on prescription tables (ADR 0018 #4). */
  readonly rx_placeholder?: boolean;
  /** Ordered header cells (all editable). */
  readonly columns: readonly string[];
  /** Rows; each row is an array of cell strings aligned to `columns`. */
  readonly rows: ReadonlyArray<readonly string[]>;
}

/** A block is a discriminated union of text | table. */
export type Block = TextBlock | TableBlock;

/** One dated entry (running-log header + its ordered blocks) (schema §3). */
export interface Entry {
  /** RFC3339 calendar date the entry was opened (local date). */
  readonly entry_date: string;
  /** The visit that created this entry (display + audit trace). */
  readonly visit_id: string;
  readonly blocks: readonly Block[];
}

/** One big box per complaint: a dated running log (schema §2). */
export interface Complaint {
  /** Stable within the document; also the VIS-002 complaint key. */
  readonly id: string;
  /** One-line complaint name shown on the box + follow-up pre-load row. */
  readonly title: string;
  readonly entries: readonly Entry[];
}

/** Physical-generals structured side section (schema §5). */
export interface PhysicalGenerals {
  readonly [key: string]: string;
}

/** Family history: two independent tabs (schema §5). */
export interface FamilyHistory {
  readonly maternal: string;
  readonly paternal: string;
}

/** Investigations: two independent tabs; Submitted hosts PAT-009 (schema §5). */
export interface Investigations {
  readonly suggested: string;
  readonly submitted: string;
}

/** The structured side sections that remain schema-described (schema §5). */
export interface Sections {
  readonly physical_generals?: PhysicalGenerals;
  readonly family_history: FamilyHistory;
  readonly investigations: Investigations;
  readonly mental_generals?: Record<string, string>;
  readonly past_history?: Record<string, string>;
  readonly provisional_diagnosis?: Record<string, string>;
  readonly analysis?: Record<string, string>;
}

/** Empty family/investigations defaults so both tabs always have a home. */
function emptySections(): Sections {
  return {
    family_history: { maternal: '', paternal: '' },
    investigations: { suggested: '', submitted: '' },
  };
}

/** The structured side-section keys the journal UI edits. */
export type EditableSectionKey =
  | 'physical_generals'
  | 'family_history'
  | 'investigations'
  | 'provisional_diagnosis';

/** Read a side section's field value as a string (missing => ''). */
export function sectionFieldValue(
  sections: Sections,
  key: EditableSectionKey,
  field: string,
): string {
  const section = sections[key] as Record<string, string> | undefined;
  return section?.[field] ?? '';
}

/**
 * Immutably set one field of one structured side section, returning a new
 * {@link Sections}. Keeps the two independent-tab sections (family,
 * investigations) well-typed and preserves the rest.
 */
export function setSectionField(
  sections: Sections,
  key: EditableSectionKey,
  field: string,
  value: string,
): Sections {
  if (key === 'family_history') {
    return {
      ...sections,
      family_history: { ...sections.family_history, [field]: value },
    };
  }
  if (key === 'investigations') {
    return {
      ...sections,
      investigations: { ...sections.investigations, [field]: value },
    };
  }
  const prev = (sections[key] as Record<string, string> | undefined) ?? {};
  return { ...sections, [key]: { ...prev, [field]: value } };
}

/** The top-level v2 journal document (schema §1). */
export interface JournalDoc {
  readonly schema: typeof CASE_JOURNAL_SCHEMA;
  readonly version: number;
  readonly complaints: readonly Complaint[];
  readonly sections: Sections;
}

/** Context the upcast needs from the open visit (date + id). */
export interface VisitContext {
  readonly visitId: string;
  readonly visitAt: string;
}

/** The canonical seed columns for a `vitals` table (schema §4a). */
export const VITALS_COLUMNS: readonly string[] = [
  'BP (sys)',
  'BP (dia)',
  'Pulse',
  'Weight (kg)',
  'Height (cm)',
  'BMI',
  'Temp',
  'SpO2',
];

/** The seed columns for a `modalities` table (schema §4b). */
export const MODALITIES_COLUMNS: readonly string[] = [
  'Factor',
  'Aggravation (<)',
  'Amelioration (>)',
];

/** The seed columns for a `prescription` placeholder table (schema §4c). */
export const PRESCRIPTION_COLUMNS: readonly string[] = [
  'Medicine',
  'Potency',
  'Dosage',
  'Instructions',
];

/** A fresh, empty journal document: one empty complaint + one dated entry. */
export function emptyJournalDoc(ctx: VisitContext): JournalDoc {
  return {
    schema: CASE_JOURNAL_SCHEMA,
    version: CASE_JOURNAL_VERSION,
    complaints: [
      {
        id: 'cc1',
        title: '',
        entries: [newEntry(ctx)],
      },
    ],
    sections: emptySections(),
  };
}

/** A new dated entry (today's local date) with no blocks yet. */
export function newEntry(ctx: VisitContext): Entry {
  return {
    entry_date: localIsoDate(new Date()),
    visit_id: ctx.visitId,
    blocks: [],
  };
}

/**
 * Serialise the in-memory document to the exact JSON string stored in
 * `visit.data_json`. The document is written WHOLE on every autosave (schema
 * §8); this is the single source of that payload.
 */
export function serializeJournal(doc: JournalDoc): string {
  return JSON.stringify(doc);
}

/**
 * Parse the `visit.data_json` string on open into a typed {@link JournalDoc}.
 *
 * - A v2 `case-journal` document is restored exactly.
 * - A legacy R3 document (schema !== "case-journal") is upcast in memory
 *   (ADR 0018 #8); disk is untouched until the first autosave.
 * - A malformed/empty document falls back to one empty complaint, mirroring
 *   the R3 `restoreData` contract (schema §8).
 */
export function parseJournal(dataJson: string, ctx: VisitContext): JournalDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(dataJson);
  } catch {
    return emptyJournalDoc(ctx);
  }
  if (raw === null || typeof raw !== 'object') {
    return emptyJournalDoc(ctx);
  }
  const obj = raw as Record<string, unknown>;
  if (obj['schema'] === CASE_JOURNAL_SCHEMA) {
    return normalizeJournal(obj, ctx);
  }
  // Non-journal (version 1/absent, or a `chief_complaints` map) => legacy R3.
  return upcastLegacyCaseData(obj, ctx);
}

/** Coerce an arbitrary parsed object into a valid, defensively-shaped doc. */
function normalizeJournal(
  obj: Record<string, unknown>,
  ctx: VisitContext,
): JournalDoc {
  const complaintsRaw = Array.isArray(obj['complaints'])
    ? (obj['complaints'] as unknown[])
    : [];
  const complaints = complaintsRaw.map((c, i) => normalizeComplaint(c, i, ctx));
  const sections = normalizeSections(obj['sections']);
  if (complaints.length === 0) {
    return { ...emptyJournalDoc(ctx), sections };
  }
  return {
    schema: CASE_JOURNAL_SCHEMA,
    version: CASE_JOURNAL_VERSION,
    complaints,
    sections,
  };
}

/** Merge a restored `sections` object onto the empty defaults. */
function normalizeSections(raw: unknown): Sections {
  const base = emptySections();
  if (!isRecord(raw)) return base;
  const fam = isRecord(raw['family_history']) ? raw['family_history'] : {};
  const inv = isRecord(raw['investigations']) ? raw['investigations'] : {};
  const out: Sections = {
    ...base,
    family_history: {
      maternal: asString(fam['maternal']),
      paternal: asString(fam['paternal']),
    },
    investigations: {
      suggested: asString(inv['suggested']),
      submitted: asString(inv['submitted']),
    },
  };
  const pg = isRecord(raw['physical_generals'])
    ? toStringMap(raw['physical_generals'])
    : undefined;
  const mg = isRecord(raw['mental_generals'])
    ? toStringMap(raw['mental_generals'])
    : undefined;
  const ph = isRecord(raw['past_history'])
    ? toStringMap(raw['past_history'])
    : undefined;
  const dx = isRecord(raw['provisional_diagnosis'])
    ? toStringMap(raw['provisional_diagnosis'])
    : undefined;
  const an = isRecord(raw['analysis'])
    ? toStringMap(raw['analysis'])
    : undefined;
  return {
    ...out,
    ...(pg !== undefined ? { physical_generals: pg } : {}),
    ...(mg !== undefined ? { mental_generals: mg } : {}),
    ...(ph !== undefined ? { past_history: ph } : {}),
    ...(dx !== undefined ? { provisional_diagnosis: dx } : {}),
    ...(an !== undefined ? { analysis: an } : {}),
  };
}

/** Normalise one complaint, guaranteeing a stable id and at least one entry. */
function normalizeComplaint(
  raw: unknown,
  index: number,
  ctx: VisitContext,
): Complaint {
  const obj = isRecord(raw) ? raw : {};
  const id = typeof obj['id'] === 'string' ? obj['id'] : `cc${index + 1}`;
  const title = typeof obj['title'] === 'string' ? obj['title'] : '';
  const entriesRaw = Array.isArray(obj['entries'])
    ? (obj['entries'] as unknown[])
    : [];
  const entries = entriesRaw.map((e) => normalizeEntry(e, ctx));
  return {
    id,
    title,
    entries: entries.length === 0 ? [newEntry(ctx)] : entries,
  };
}

/** Normalise one entry and its blocks. */
function normalizeEntry(raw: unknown, ctx: VisitContext): Entry {
  const obj = isRecord(raw) ? raw : {};
  const entry_date =
    typeof obj['entry_date'] === 'string'
      ? obj['entry_date']
      : localIsoDate(new Date());
  const visit_id =
    typeof obj['visit_id'] === 'string' ? obj['visit_id'] : ctx.visitId;
  const blocksRaw = Array.isArray(obj['blocks'])
    ? (obj['blocks'] as unknown[])
    : [];
  const blocks = blocksRaw
    .map(normalizeBlock)
    .filter((b): b is Block => b !== null);
  return { entry_date, visit_id, blocks };
}

/** Normalise one block, dropping anything that is not a text/table block. */
function normalizeBlock(raw: unknown): Block | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw['id'] === 'string' ? raw['id'] : '';
  if (raw['kind'] === 'text') {
    return { kind: 'text', id, text: asString(raw['text']) };
  }
  if (raw['kind'] === 'table') {
    const columns = Array.isArray(raw['columns'])
      ? (raw['columns'] as unknown[]).map(asString)
      : [];
    const rows = Array.isArray(raw['rows'])
      ? (raw['rows'] as unknown[]).map((row) =>
          Array.isArray(row) ? (row as unknown[]).map(asString) : [],
        )
      : [];
    const table_type = isTableType(raw['table_type'])
      ? raw['table_type']
      : 'generic';
    const block: TableBlock = { kind: 'table', id, table_type, columns, rows };
    if (raw['rx_placeholder'] === true) {
      return { ...block, rx_placeholder: true };
    }
    return block;
  }
  return null;
}

/**
 * Best-effort, ONE-WAY, in-memory upcast of a legacy R3 `data_json` to a v2
 * journal document so an old visit still opens (ADR 0018 #8 / schema §7).
 * Pure function; nothing is written to disk until the doctor edits and
 * autosave rewrites the column in v2.
 */
export function upcastLegacyCaseData(
  raw: unknown,
  ctx: VisitContext,
): JournalDoc {
  const legacy = isRecord(raw) ? raw : {};
  const entryDate = localIsoDate(new Date(ctx.visitAt));

  const chiefComplaints = Array.isArray(legacy['chief_complaints'])
    ? (legacy['chief_complaints'] as unknown[])
    : [];

  const complaints: Complaint[] = chiefComplaints.map((cc, i) =>
    legacyComplaint(cc, i, entryDate, ctx),
  );

  // Seed a vitals table in the first complaint's entry from legacy vitals.
  const vitalsBlock = legacyVitalsBlock(legacy);
  if (vitalsBlock !== null && complaints.length > 0) {
    const first = complaints[0];
    if (first !== undefined) {
      const firstEntry = first.entries[0];
      if (firstEntry !== undefined) {
        complaints[0] = {
          ...first,
          entries: [
            { ...firstEntry, blocks: [...firstEntry.blocks, vitalsBlock] },
            ...first.entries.slice(1),
          ],
        };
      }
    }
  }

  // No complaints => one empty complaint with one empty dated entry (schema §7.5).
  if (complaints.length === 0) {
    complaints.push({
      id: 'cc1',
      title: '',
      entries: [{ entry_date: entryDate, visit_id: ctx.visitId, blocks: [] }],
    });
  }

  return {
    schema: CASE_JOURNAL_SCHEMA,
    version: CASE_JOURNAL_VERSION,
    complaints,
    sections: legacySections(legacy),
  };
}

/** Build one journal complaint from a legacy `chief_complaints[i]` entry. */
function legacyComplaint(
  raw: unknown,
  index: number,
  entryDate: string,
  ctx: VisitContext,
): Complaint {
  const cc = isRecord(raw) ? raw : {};
  const sensation = asString(cc['sensation']).trim();
  const location = asString(cc['location']).trim();
  const title = firstNonEmpty(sensation, location) || `Complaint ${index + 1}`;
  const text = legacyComplaintText(cc);
  return {
    id: `cc${index + 1}`,
    title,
    entries: [
      {
        entry_date: entryDate,
        visit_id: ctx.visitId,
        blocks: [{ kind: 'text', id: 'b1', text }],
      },
    ],
  };
}

/** Concatenate the legacy complaint fields as labelled lines (schema §7.2). */
function legacyComplaintText(cc: Record<string, unknown>): string {
  const lines: string[] = [];
  const push = (label: string, key: string): void => {
    const value = asString(cc[key]).trim();
    if (value !== '') lines.push(`${label}: ${value}`);
  };
  push('Location', 'location');
  push('Sensation', 'sensation');
  push('Aggravation', 'agg');
  push('Amelioration', 'amel');
  push('Concomitants', 'concomitants');
  push('Duration', 'duration');
  push('Onset', 'onset');
  return lines.join('\n');
}

/**
 * Seed a vitals table from a legacy `examination`/vitals section when present,
 * splitting a `"120/80"` BP string into two cells (schema §7.3). Returns null
 * when there is nothing to seed.
 */
function legacyVitalsBlock(legacy: Record<string, unknown>): TableBlock | null {
  const exam = isRecord(legacy['examination']) ? legacy['examination'] : null;
  if (exam === null) return null;
  const bp = asString(exam['bp']).trim();
  let sys = '';
  let dia = '';
  if (bp !== '') {
    const parts = bp.split('/');
    sys = (parts[0] ?? '').trim();
    dia = (parts[1] ?? '').trim();
  }
  const row = [
    sys,
    dia,
    asString(exam['pulse']).trim(),
    asString(exam['weight_kg']).trim(),
    asString(exam['height_cm']).trim(),
    asString(exam['bmi']).trim(),
    asString(exam['temp']).trim(),
    asString(exam['spo2']).trim(),
  ];
  if (row.every((cell) => cell === '')) return null;
  return {
    kind: 'table',
    id: 'bvit',
    table_type: 'vitals',
    columns: VITALS_COLUMNS,
    rows: [row],
  };
}

/** Fold the surviving legacy structured sections into v2 `sections`. */
function legacySections(legacy: Record<string, unknown>): Sections {
  const familyNarrative = narrativeOf(legacy['family_history']);
  const investNarrative = narrativeOf(legacy['investigations']);

  const extra: {
    physical_generals?: Record<string, string>;
    mental_generals?: Record<string, string>;
    past_history?: Record<string, string>;
    provisional_diagnosis?: Record<string, string>;
    analysis?: Record<string, string>;
  } = {};

  if (isRecord(legacy['physical_generals'])) {
    extra.physical_generals = toStringMap(legacy['physical_generals']);
  }
  for (const key of ['mental_generals', 'past_history'] as const) {
    const narrative = narrativeOf(legacy[key]);
    if (narrative !== '') extra[key] = { narrative };
  }
  const dx = isRecord(legacy['provisional_diagnosis'])
    ? asString(
        (legacy['provisional_diagnosis'] as Record<string, unknown>)['dx'],
      )
    : '';
  if (dx !== '') extra.provisional_diagnosis = { dx };
  const analysis = isRecord(legacy['analysis'])
    ? asString((legacy['analysis'] as Record<string, unknown>)['notes'])
    : '';
  if (analysis !== '') extra.analysis = { notes: analysis };

  // `personal_history` and any top-level `narrative` are intentionally dropped
  // (ADR 0018 #5); disk retains them until the next autosave overwrites.
  return {
    family_history: { maternal: familyNarrative, paternal: '' },
    investigations: { suggested: investNarrative, submitted: '' },
    ...extra,
  };
}

/** The `.narrative` string of a legacy section object, or ''. */
function narrativeOf(raw: unknown): string {
  return isRecord(raw) ? asString(raw['narrative']) : '';
}

/** Copy a record's string-valued entries into a plain string map. */
function toStringMap(raw: unknown): Record<string, string> {
  const obj = isRecord(raw) ? raw : {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/** The first of the given values that is non-empty after trimming, or ''. */
function firstNonEmpty(...values: string[]): string {
  for (const v of values) {
    if (v.trim() !== '') return v.trim();
  }
  return '';
}

/** A local-timezone ISO calendar date (`YYYY-MM-DD`) for a `Date`. */
function localIsoDate(date: Date): string {
  const d = Number.isNaN(date.getTime()) ? new Date() : date;
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format an entry's `entry_date` for display as DD-MM-YYYY (R-UI-006). */
export function formatEntryDate(entryDate: string): string {
  return formatDate(entryDate) ?? entryDate;
}

/** Coerce any JSON value to a display string (numbers kept as text). */
function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** Type guard: a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Type guard for a {@link TableType} discriminator. */
function isTableType(value: unknown): value is TableType {
  return (
    value === 'vitals' ||
    value === 'modalities' ||
    value === 'prescription' ||
    value === 'generic'
  );
}
