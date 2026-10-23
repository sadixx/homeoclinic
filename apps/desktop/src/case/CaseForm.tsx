// S08 Case record — doctor-journal model (docs/ui/S08-case-form.md revised;
// ADR 0018). The structured template-field form is REPLACED by a dated journal
// of editable text + table blocks: one big editable box per complaint, a new
// dated entry appended at every visit, button-inserted editable vitals /
// modalities / prescription tables, and a small set of structured side
// sections (physical generals, family Maternal/Paternal tabs, investigations
// Suggested/Submitted tabs with the PAT-009 uploader under Submitted).
//
// Calls ONLY the generated typed bindings (UI -> typed commands only; never
// SQL or raw filesystem paths). Every control / asserted value carries its
// revised-S08 data-testid (R-UI-003); visible text comes from en.json
// (R-UI-007); dates go through shared/datetime (R-UI-006).
//
// The whole journal document serialises into the opaque `visit.data_json`
// (ADR 0007); autosave (2 s + blur) and an explicit Save button both flush the
// whole document through `case_visit_autosave`, so a killed-mid-typing session
// loses nothing (CASE-005, the R3 kill-restore guarantee). A legacy R3
// `data_json` is upcast in memory on open (ADR 0018 #8); disk is untouched
// until the first autosave.
//
// Send-to-repertory (CASE-006) and the real Rx engine (R4) are out of scope:
// the prescription table is a labelled PLACEHOLDER (rx_placeholder:true) only.
// The Case summary button, the narrative field and the Personal history
// section are removed (ADR 0018 #5).

import { useCallback, useEffect, useRef, useState } from 'react';

import { Plus } from 'lucide-react';

import { commands } from '@/bindings';
import type { AttachmentSummary } from '@/bindings';
import {
  MODALITIES_COLUMNS,
  PRESCRIPTION_COLUMNS,
  VITALS_COLUMNS,
  formatEntryDate,
  newEntry,
  parseJournal,
  sectionFieldValue,
  serializeJournal,
  setSectionField,
  upcastLegacyCaseData,
  type Block,
  type Complaint,
  type EditableSectionKey,
  type Entry,
  type JournalDoc,
  type TableBlock,
  type TableType,
} from '@/case/caseJournal';
import { isUserFacingError, run } from '@/shared/command';
import { formatDate, formatDateTime } from '@/shared/datetime';
import { t } from '@/shared/strings';

// The upcast is a UI-owned pure function; re-exported here so callers (and the
// unit tests) import it alongside the component from this module.
export { upcastLegacyCaseData };

/** How the journal case form is opened. */
export interface CaseFormProps {
  /** Patient the case belongs to (route param). */
  readonly patientId: string;
  /** Visit the case belongs to (route param). */
  readonly visitId: string;
  /** Patient sex — reserved for the menstrual/obstetric conditional section. */
  readonly sex: 'male' | 'female';
  /** Patient age in whole years — reserved for the child-development section. */
  readonly ageYears: number;
  /**
   * How the visit opens: a brand-new `first` case, or a `follow_up` that opens
   * the SAME journal document and reads "Update ..." on the insert buttons and
   * appends a new dated entry (ADR 0018 #2/#3). Defaults to `first`.
   */
  readonly visitType?: 'first' | 'follow_up';
  /**
   * Return to the patient dashboard. When provided, a Back control is rendered
   * top-left (00-conventions §3); Back never discards data (the form
   * autosaves, CASE-005). When absent, no Back control is rendered.
   */
  readonly onBack?: () => void;
}

/** Autosave status shown beside the Save button (CASE-005). */
type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'error' };

const AUTOSAVE_DEBOUNCE_MS = 2000;

/** camelCase vitals keys the backend BMI recompute understands (schema §4a). */
const VITALS_WEIGHT = 'weightKg';
const VITALS_HEIGHT = 'heightCm';
const VITALS_BMI = 'bmi';

/**
 * Body-mass index from weight (kg) and height (cm) for the LIVE popup display,
 * truncated to one decimal place, or `null` when either input is missing or
 * non-positive (68 kg / 172 cm => 22.9, matching the S08 wireframe). The
 * authoritative BMI is recomputed by the backend on autosave (CASE-001).
 */
export function liveBmi(
  weightKg: number | undefined,
  heightCm: number | undefined,
): number | null {
  if (
    weightKg === undefined ||
    heightCm === undefined ||
    weightKg <= 0 ||
    heightCm <= 0
  ) {
    return null;
  }
  const heightM = heightCm / 100;
  return Math.trunc((weightKg / (heightM * heightM)) * 10) / 10;
}

/** A monotonically-increasing id generator for client-made blocks/complaints. */
function makeIdGen(prefix: string, start: number): () => string {
  let n = start;
  return () => `${prefix}${++n}`;
}

/**
 * The journal case sheet (S08, revised). Restores every complaint box from the
 * opened visit's `data_json`, autosaves the whole document, and inserts
 * editable text/table blocks under dated entries.
 */
export function CaseForm({
  patientId,
  visitId,
  visitType = 'first',
  onBack,
}: CaseFormProps): JSX.Element {
  const isFollowup = visitType === 'follow_up';

  const [doc, setDoc] = useState<JournalDoc | null>(null);
  const [activeComplaint, setActiveComplaint] = useState(0);
  const [nextFollowupOn, setNextFollowupOn] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [errored, setErrored] = useState(false);
  const [vitalsOpen, setVitalsOpen] = useState(false);
  // Becomes true the first time a save succeeds; gates the dues placeholder
  // area (Slice C6) so dues are "auto-shown on save". Billing is R5 — this is
  // a clearly-labelled, disabled placeholder with no money/math/network.
  const [savedOnce, setSavedOnce] = useState(false);
  // The side section open in the rail, if any (null = none expanded).
  const [openSection, setOpenSection] = useState<string | null>(null);
  // The testid of the content element to focus after the next render (a newly
  // inserted entry's text block), consumed once by a layout effect.
  const [focusTarget, setFocusTarget] = useState<string | null>(null);

  // Client id generators, seeded past any ids already in the restored doc so a
  // new block/complaint never collides with a restored one.
  const blockIdRef = useRef<() => string>(makeIdGen('b', 0));
  const complaintIdRef = useRef<() => string>(makeIdGen('cc', 0));

  // The autosave debounce timer; the latest doc is read from a ref so a blur
  // flush and the debounce both save the newest in-memory state.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef<JournalDoc | null>(doc);
  docRef.current = doc;
  // The structured camelCase vitals copy mirrored into `visit.vitals_json`
  // (schema §4a). Seeded from the opened visit and refreshed on each popup
  // Record; the journal table is the editable copy, this is the structured one.
  const vitalsRef = useRef<Record<string, number>>({});

  // ---- Load + restore ------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const open = await run(
          commands.caseVisitOpenOrCreate({ patientId, visitType }),
        );
        if (cancelled) return;
        const parsed = parseJournal(open.dataJson, {
          visitId: open.visitId,
          visitAt: open.visitAt,
        });
        blockIdRef.current = makeIdGen('b', maxIdNum(parsed, 'b'));
        complaintIdRef.current = makeIdGen('cc', maxComplaintNum(parsed));
        vitalsRef.current = restoreVitals(open.vitalsJson);
        setDoc(parsed);
        setNextFollowupOn(open.nextFollowupOn);
      } catch {
        if (!cancelled) setErrored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, visitId, visitType]);

  // ---- Autosave (CASE-005) -------------------------------------------------

  const flushSave = useCallback(async (): Promise<void> => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const current = docRef.current;
    if (current === null) return;
    setStatus({ kind: 'saving' });
    try {
      const res = await run(
        commands.caseVisitAutosave({
          visitId,
          dataJson: serializeJournal(current),
          vitalsJson: JSON.stringify(vitalsRef.current),
        }),
      );
      setStatus({ kind: 'saved', at: res.savedAt });
      setSavedOnce(true);
    } catch {
      setStatus({ kind: 'error' });
    }
  }, [visitId]);

  const scheduleSave = useCallback((): void => {
    setStatus({ kind: 'saving' });
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flushSave]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  // Focus the freshly-inserted text block once it is in the DOM.
  useEffect(() => {
    if (focusTarget === null) return;
    const el = document.querySelector<HTMLElement>(
      `[data-testid="${focusTarget}"]`,
    );
    el?.focus();
    setFocusTarget(null);
  }, [focusTarget, doc]);

  // ---- Document mutation ---------------------------------------------------
  /**
   * Replace the active complaint via an updater. `flushNow` distinguishes a
   * discrete action (a button insert — flush the document immediately so an
   * explicit action is never lost) from a keystroke edit (debounced, CASE-005
   * 2 s). The in-memory `docRef` is updated synchronously so a `flushNow` save
   * sees the just-applied change without waiting for the next render.
   */
  const updateActiveComplaint = useCallback(
    (fn: (c: Complaint) => Complaint, flushNow = false): void => {
      const prev = docRef.current;
      if (prev !== null) {
        const next: JournalDoc = {
          ...prev,
          complaints: prev.complaints.map((c, i) =>
            i === activeComplaint ? fn(c) : c,
          ),
        };
        docRef.current = next;
        setDoc(next);
      }
      if (flushNow) void flushSave();
      else scheduleSave();
    },
    [activeComplaint, scheduleSave, flushSave],
  );

  /** Append a block to the newest entry of the active complaint (flush now). */
  const appendBlockToActive = useCallback(
    (block: Block): void => {
      updateActiveComplaint((c) => withBlockInLastEntry(c, block), true);
    },
    [updateActiveComplaint],
  );

  const onAddEntry = useCallback((): void => {
    const newBlockId = blockIdRef.current();
    const ctx = { visitId, visitAt: new Date().toISOString() };
    const entry: Entry = {
      ...newEntry(ctx),
      blocks: [{ kind: 'text', id: newBlockId, text: '' }],
    };
    const cId = docRef.current?.complaints[activeComplaint]?.id ?? 'cc1';
    updateActiveComplaint(
      (c) => ({ ...c, entries: [...c.entries, entry] }),
      true,
    );
    // Focus the new entry's text block so the doctor can type immediately.
    setFocusTarget(`case-block-${cId}-${newBlockId}`);
  }, [updateActiveComplaint, visitId, activeComplaint]);

  const onAddTextBlock = useCallback((): void => {
    const id = blockIdRef.current();
    appendBlockToActive({ kind: 'text', id, text: '' });
  }, [appendBlockToActive]);

  const onInsertTable = useCallback(
    (
      tableType: TableType,
      columns: readonly string[],
      seedRow: readonly string[],
      rxPlaceholder: boolean,
    ): void => {
      const id = blockIdRef.current();
      const base: TableBlock = {
        kind: 'table',
        id,
        table_type: tableType,
        columns,
        rows: seedRow.length > 0 ? [seedRow] : [columns.map(() => '')],
      };
      appendBlockToActive(
        rxPlaceholder ? { ...base, rx_placeholder: true } : base,
      );
    },
    [appendBlockToActive],
  );

  const onInsertModalities = useCallback((): void => {
    onInsertTable('modalities', MODALITIES_COLUMNS, [], false);
  }, [onInsertTable]);

  const onInsertPrescription = useCallback((): void => {
    onInsertTable('prescription', PRESCRIPTION_COLUMNS, [], true);
  }, [onInsertTable]);

  const onRecordVitals = useCallback(
    (row: readonly string[], structured: Record<string, number>): void => {
      vitalsRef.current = structured;
      onInsertTable('vitals', VITALS_COLUMNS, row, false);
      setVitalsOpen(false);
    },
    [onInsertTable],
  );

  // ---- Block/cell edits ----------------------------------------------------

  const onTextBlockChange = useCallback(
    (entryIdx: number, blockId: string, text: string): void => {
      updateActiveComplaint((c) =>
        mapEntryBlock(c, entryIdx, blockId, (b) =>
          b.kind === 'text' ? { ...b, text } : b,
        ),
      );
    },
    [updateActiveComplaint],
  );

  const onCellChange = useCallback(
    (
      entryIdx: number,
      blockId: string,
      row: number,
      col: number,
      value: string,
    ): void => {
      updateActiveComplaint((c) =>
        mapEntryBlock(c, entryIdx, blockId, (b) =>
          b.kind === 'table' ? setCell(b, row, col, value) : b,
        ),
      );
    },
    [updateActiveComplaint],
  );

  const onHeaderChange = useCallback(
    (entryIdx: number, blockId: string, col: number, value: string): void => {
      updateActiveComplaint((c) =>
        mapEntryBlock(c, entryIdx, blockId, (b) =>
          b.kind === 'table' ? setHeader(b, col, value) : b,
        ),
      );
    },
    [updateActiveComplaint],
  );

  const onAddRow = useCallback(
    (entryIdx: number, blockId: string): void => {
      updateActiveComplaint((c) =>
        mapEntryBlock(c, entryIdx, blockId, (b) =>
          b.kind === 'table'
            ? { ...b, rows: [...b.rows, b.columns.map(() => '')] }
            : b,
        ),
      );
    },
    [updateActiveComplaint],
  );

  const onRemoveBlock = useCallback(
    (entryIdx: number, blockId: string): void => {
      updateActiveComplaint((c) => ({
        ...c,
        entries: c.entries.map((e, i) =>
          i === entryIdx
            ? { ...e, blocks: e.blocks.filter((b) => b.id !== blockId) }
            : e,
        ),
      }));
    },
    [updateActiveComplaint],
  );

  // ---- Complaint list ------------------------------------------------------

  const onAddComplaint = useCallback((): void => {
    setDoc((prev) => {
      if (prev === null) return prev;
      const id = complaintIdRef.current();
      const ctx = { visitId, visitAt: new Date().toISOString() };
      const complaint: Complaint = {
        id,
        title: '',
        entries: [newEntry(ctx)],
      };
      return { ...prev, complaints: [...prev.complaints, complaint] };
    });
    setActiveComplaint((i) => i + 1);
    scheduleSave();
  }, [visitId, scheduleSave]);

  const onTitleChange = useCallback(
    (title: string): void => {
      updateActiveComplaint((c) => ({ ...c, title }));
    },
    [updateActiveComplaint],
  );

  // ---- Side sections -------------------------------------------------------

  const onSectionField = useCallback(
    (sectionKey: EditableSectionKey, fieldKey: string, value: string): void => {
      setDoc((prev) => {
        if (prev === null) return prev;
        return {
          ...prev,
          sections: setSectionField(prev.sections, sectionKey, fieldKey, value),
        };
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  // ---- Render --------------------------------------------------------------

  if (errored && doc === null) {
    return (
      <section
        data-testid="case-form-error"
        role="alert"
        className="p-6 text-sm text-red-700"
      >
        {t('case.form.error.generic')}
      </section>
    );
  }

  if (doc === null) {
    return (
      <section
        data-testid="case-form-loading"
        aria-busy="true"
        className="p-6 text-sm text-slate-500"
      >
        <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
      </section>
    );
  }

  const complaint = doc.complaints[activeComplaint] ?? doc.complaints[0];
  const complaintId = complaint?.id ?? 'cc1';

  return (
    <section
      data-testid="case-form"
      className="flex h-full min-h-0 flex-col text-[0.875rem] text-slate-900"
    >
      <HeaderBar
        status={status}
        nextFollowupOn={nextFollowupOn}
        onForceSave={() => void flushSave()}
        {...(onBack !== undefined ? { onBack } : {})}
      />

      <div className="flex min-h-0 flex-1">
        {/* Left: complaint list + structured side-section rail. */}
        <nav
          aria-label={t('case.form.complaints.title')}
          className="flex w-60 flex-none flex-col gap-2 overflow-auto border-r border-slate-200 p-2"
        >
          <ComplaintRail
            complaints={doc.complaints}
            active={activeComplaint}
            onSelect={setActiveComplaint}
            onAdd={onAddComplaint}
          />
          <SideSectionRail
            doc={doc}
            visitId={visitId}
            openSection={openSection}
            onToggleSection={(key) =>
              setOpenSection((cur) => (cur === key ? null : key))
            }
            onSectionField={onSectionField}
            onBlurFlush={() => void flushSave()}
          />
        </nav>

        {/* Centre: the active complaint's dated journal box. Adaptive, full-
            width content region (Slice C4) — no narrow centered column, so a
            wide window / fullscreen fills the resolution (ADR 0018 §UX shell,
            S08 "Full-width content area, adaptive to the window"). */}
        <div
          data-testid="case-form-content"
          data-adaptive="true"
          className="min-w-0 flex-1 overflow-auto p-4"
        >
          {complaint !== undefined ? (
            <JournalBox
              complaint={complaint}
              complaintId={complaintId}
              isFollowup={isFollowup}
              onTitleChange={onTitleChange}
              onTitleBlur={() => void flushSave()}
              onAddEntry={onAddEntry}
              onAddText={onAddTextBlock}
              onRecordVitals={() => setVitalsOpen(true)}
              onModalities={onInsertModalities}
              onAddPrescription={onInsertPrescription}
              onTextChange={onTextBlockChange}
              onCellChange={onCellChange}
              onHeaderChange={onHeaderChange}
              onAddRow={onAddRow}
              onRemoveBlock={onRemoveBlock}
              onBlurFlush={() => void flushSave()}
            />
          ) : null}
        </div>
      </div>

      {savedOnce ? (
        <section
          data-testid="case-form-dues-placeholder"
          aria-label={t('case.form.dues.title')}
          className="flex flex-none items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600"
        >
          <span>
            <strong className="mr-1 text-slate-700">
              {t('case.form.dues.title')}
            </strong>
            {t('case.form.dues.placeholder')}
          </span>
          <button
            type="button"
            data-testid="case-form-dues-clear"
            disabled
            aria-disabled="true"
            title={t('case.form.dues.disabledHint')}
            className="cursor-not-allowed rounded border border-slate-300 bg-slate-100 px-3 py-1 text-slate-400"
          >
            {t('case.form.dues.clear')}
          </button>
        </section>
      ) : null}

      {vitalsOpen ? (
        <VitalsPopup
          onCancel={() => setVitalsOpen(false)}
          onRecord={onRecordVitals}
        />
      ) : null}
    </section>
  );
}

/** The biggest numeric suffix of a block id (`b<n>`) across the doc, or 0. */
function maxIdNum(doc: JournalDoc, prefix: string): number {
  let max = 0;
  for (const c of doc.complaints) {
    for (const e of c.entries) {
      for (const b of e.blocks) {
        const m = new RegExp(`^${prefix}(\\d+)$`).exec(b.id);
        if (m && m[1] !== undefined) max = Math.max(max, Number(m[1]));
      }
    }
  }
  return max;
}

/** The biggest numeric suffix of a complaint id (`cc<n>`), or 0. */
function maxComplaintNum(doc: JournalDoc): number {
  let max = 0;
  for (const c of doc.complaints) {
    const m = /^cc(\d+)$/.exec(c.id);
    if (m && m[1] !== undefined) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Append a block to a complaint's newest entry (creating one if none). */
function withBlockInLastEntry(c: Complaint, block: Block): Complaint {
  if (c.entries.length === 0) {
    return {
      ...c,
      entries: [{ entry_date: isoToday(), visit_id: '', blocks: [block] }],
    };
  }
  const lastIdx = c.entries.length - 1;
  return {
    ...c,
    entries: c.entries.map((e, i) =>
      i === lastIdx ? { ...e, blocks: [...e.blocks, block] } : e,
    ),
  };
}

/** Map one block (by id) inside a given entry index. */
function mapEntryBlock(
  c: Complaint,
  entryIdx: number,
  blockId: string,
  fn: (b: Block) => Block,
): Complaint {
  return {
    ...c,
    entries: c.entries.map((e, i) =>
      i === entryIdx
        ? { ...e, blocks: e.blocks.map((b) => (b.id === blockId ? fn(b) : b)) }
        : e,
    ),
  };
}

/** Set a body cell value, padding ragged rows to the column count. */
function setCell(
  b: TableBlock,
  row: number,
  col: number,
  value: string,
): TableBlock {
  const rows = b.rows.map((r, i) => {
    if (i !== row) return r;
    const next = b.columns.map((_, c) => r[c] ?? '');
    next[col] = value;
    return next;
  });
  return { ...b, rows };
}

/** Set a header (column) value. */
function setHeader(b: TableBlock, col: number, value: string): TableBlock {
  const columns = b.columns.map((h, i) => (i === col ? value : h));
  return { ...b, columns };
}

/** A local-timezone ISO calendar date for today. */
function isoToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Top header: patient/visit line placeholder, next F/U, Save + status. */
function HeaderBar({
  status,
  nextFollowupOn,
  onForceSave,
  onBack,
}: {
  readonly status: SaveStatus;
  readonly nextFollowupOn: string | null;
  readonly onForceSave: () => void;
  readonly onBack?: () => void;
}): JSX.Element {
  const nextText =
    nextFollowupOn !== null && formatDate(nextFollowupOn) !== null
      ? `${t('case.form.nextFollowup.prefix')} ${formatDate(nextFollowupOn)}`
      : t('case.form.nextFollowup.none');
  return (
    <header className="flex flex-none items-center justify-between gap-3 border-b border-slate-200 px-4 py-2">
      <div className="flex items-center gap-3">
        {onBack !== undefined ? (
          <button
            type="button"
            data-testid="case-form-back"
            aria-label={t('case.form.back')}
            onClick={onBack}
            className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('case.form.back')}
          </button>
        ) : null}
        <span
          data-testid="case-form-next-followup"
          className="text-sm text-slate-700"
        >
          {nextText}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <SaveIndicator status={status} />
        <button
          type="button"
          data-testid="case-form-save"
          aria-label={t('case.form.saveShortcut')}
          onClick={onForceSave}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-700"
        >
          {t('case.form.save')}
        </button>
      </div>
    </header>
  );
}

/** Status indicator beside Save (Saving…/Saved hh:mm) (CASE-005). */
function SaveIndicator({
  status,
}: {
  readonly status: SaveStatus;
}): JSX.Element {
  let text: string;
  if (status.kind === 'saving') {
    text = t('case.form.save.saving');
  } else if (status.kind === 'saved') {
    const when = formatDateTime(status.at);
    const hhmm = when !== null ? when.slice(-5) : '';
    text = `${t('case.form.save.savedPrefix')} ${hhmm}`.trim();
  } else if (status.kind === 'error') {
    text = t('case.form.save.error');
  } else {
    text = t('case.form.save.idle');
  }
  return (
    <span
      data-testid="case-form-save-status"
      role="status"
      aria-live="polite"
      className={[
        'text-xs',
        status.kind === 'error' ? 'text-red-700' : 'text-slate-600',
      ].join(' ')}
    >
      {text}
    </span>
  );
}

/** The complaint selector list + add control. */
function ComplaintRail({
  complaints,
  active,
  onSelect,
  onAdd,
}: {
  readonly complaints: readonly Complaint[];
  readonly active: number;
  readonly onSelect: (index: number) => void;
  readonly onAdd: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase text-slate-500">
          {t('case.form.complaints.title')}
        </h2>
        <button
          type="button"
          data-testid="case-form-add-complaint"
          aria-label={t('case.form.addComplaint')}
          onClick={onAdd}
          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {complaints.map((c, i) => {
        const label =
          c.title.trim() === ''
            ? `${t('case.form.complaintTitle')} ${i + 1}`
            : c.title;
        return (
          <button
            key={c.id}
            type="button"
            data-testid={`case-form-complaint-${i + 1}`}
            aria-pressed={i === active}
            onClick={() => onSelect(i)}
            className={[
              'rounded px-2 py-1 text-left hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600',
              i === active ? 'bg-blue-50 font-medium' : '',
            ].join(' ')}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** The active complaint's big editable dated-journal box. */
function JournalBox({
  complaint,
  complaintId,
  isFollowup,
  onTitleChange,
  onTitleBlur,
  onAddEntry,
  onAddText,
  onRecordVitals,
  onModalities,
  onAddPrescription,
  onTextChange,
  onCellChange,
  onHeaderChange,
  onAddRow,
  onRemoveBlock,
  onBlurFlush,
}: {
  readonly complaint: Complaint;
  readonly complaintId: string;
  readonly isFollowup: boolean;
  readonly onTitleChange: (title: string) => void;
  readonly onTitleBlur: () => void;
  readonly onAddEntry: () => void;
  readonly onAddText: () => void;
  readonly onRecordVitals: () => void;
  readonly onModalities: () => void;
  readonly onAddPrescription: () => void;
  readonly onTextChange: (
    entryIdx: number,
    blockId: string,
    text: string,
  ) => void;
  readonly onCellChange: (
    entryIdx: number,
    blockId: string,
    row: number,
    col: number,
    value: string,
  ) => void;
  readonly onHeaderChange: (
    entryIdx: number,
    blockId: string,
    col: number,
    value: string,
  ) => void;
  readonly onAddRow: (entryIdx: number, blockId: string) => void;
  readonly onRemoveBlock: (entryIdx: number, blockId: string) => void;
  readonly onBlurFlush: () => void;
}): JSX.Element {
  const hasPrescription = complaint.entries.some((e) =>
    e.blocks.some((b) => b.kind === 'table' && b.table_type === 'prescription'),
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <span className="sr-only">{t('case.form.complaint.titleLabel')}</span>
          <input
            data-testid="case-form-complaint-title"
            value={complaint.title}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={onTitleBlur}
            placeholder={t('case.form.complaint.titlePlaceholder')}
            aria-label={t('case.form.complaint.titleLabel')}
            className="input w-full text-base font-semibold"
          />
        </label>
        <button
          type="button"
          data-testid="case-form-add-entry"
          onClick={onAddEntry}
          className="flex-none rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          {t('case.form.addEntry')}
        </button>
      </div>

      <div
        data-testid="case-form-journal-box"
        role="group"
        aria-label={t('case.form.complaints.title')}
        className="flex flex-col gap-4 rounded border border-slate-200 p-3"
      >
        {complaint.entries.length === 0 ? (
          <p className="text-sm text-slate-500">{t('case.form.emptyHint')}</p>
        ) : (
          complaint.entries.map((entry, entryIdx) => (
            <EntryView
              key={`${entry.entry_date}-${entryIdx}`}
              entry={entry}
              entryIdx={entryIdx}
              complaintId={complaintId}
              onTextChange={onTextChange}
              onCellChange={onCellChange}
              onHeaderChange={onHeaderChange}
              onAddRow={onAddRow}
              onRemoveBlock={onRemoveBlock}
              onBlurFlush={onBlurFlush}
            />
          ))
        )}
      </div>

      {hasPrescription ? (
        <p
          data-testid="case-form-rx-placeholder-hint"
          role="note"
          className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-800"
        >
          {t('case.form.rxPlaceholderHint')}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
        <button
          type="button"
          data-testid="case-form-record-vitals"
          onClick={onRecordVitals}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          {isFollowup
            ? t('case.form.updateVitals')
            : t('case.form.recordVitals')}
        </button>
        <button
          type="button"
          data-testid="case-form-modalities"
          onClick={onModalities}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          {isFollowup
            ? t('case.form.updateModalities')
            : t('case.form.modalities')}
        </button>
        <button
          type="button"
          data-testid="case-form-add-prescription"
          onClick={onAddPrescription}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          {isFollowup
            ? t('case.form.updatePrescription')
            : t('case.form.addPrescription')}
        </button>
        <button
          type="button"
          data-testid="case-form-add-text"
          onClick={onAddText}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          {t('case.form.addText')}
        </button>
      </div>
    </div>
  );
}

/** One dated entry: its date header and ordered editable blocks. */
function EntryView({
  entry,
  entryIdx,
  complaintId,
  onTextChange,
  onCellChange,
  onHeaderChange,
  onAddRow,
  onRemoveBlock,
  onBlurFlush,
}: {
  readonly entry: Entry;
  readonly entryIdx: number;
  readonly complaintId: string;
  readonly onTextChange: (
    entryIdx: number,
    blockId: string,
    text: string,
  ) => void;
  readonly onCellChange: (
    entryIdx: number,
    blockId: string,
    row: number,
    col: number,
    value: string,
  ) => void;
  readonly onHeaderChange: (
    entryIdx: number,
    blockId: string,
    col: number,
    value: string,
  ) => void;
  readonly onAddRow: (entryIdx: number, blockId: string) => void;
  readonly onRemoveBlock: (entryIdx: number, blockId: string) => void;
  readonly onBlurFlush: () => void;
}): JSX.Element {
  const headerText = `${t('case.form.entry.label')} ${formatEntryDate(
    entry.entry_date,
  )}`;
  return (
    <div className="flex flex-col gap-2">
      <h3
        data-testid={`case-form-entry-${complaintId}-${entryIdx}`}
        className="text-xs font-semibold uppercase tracking-wide text-slate-500"
      >
        {headerText}
      </h3>
      {entry.blocks.map((block) =>
        block.kind === 'text' ? (
          <label key={block.id} className="flex flex-col gap-1">
            <span className="sr-only">{t('case.form.textBlock.label')}</span>
            <textarea
              data-testid={`case-block-${complaintId}-${block.id}`}
              value={block.text}
              rows={3}
              onChange={(e) => onTextChange(entryIdx, block.id, e.target.value)}
              onBlur={onBlurFlush}
              aria-label={t('case.form.textBlock.label')}
              className="input"
            />
          </label>
        ) : (
          <TableBlockView
            key={block.id}
            block={block}
            entryIdx={entryIdx}
            complaintId={complaintId}
            onCellChange={onCellChange}
            onHeaderChange={onHeaderChange}
            onAddRow={onAddRow}
            onRemoveBlock={onRemoveBlock}
            onBlurFlush={onBlurFlush}
          />
        ),
      )}
    </div>
  );
}

/** One editable table block: every header cell and body cell is an input. */
function TableBlockView({
  block,
  entryIdx,
  complaintId,
  onCellChange,
  onHeaderChange,
  onAddRow,
  onRemoveBlock,
  onBlurFlush,
}: {
  readonly block: TableBlock;
  readonly entryIdx: number;
  readonly complaintId: string;
  readonly onCellChange: (
    entryIdx: number,
    blockId: string,
    row: number,
    col: number,
    value: string,
  ) => void;
  readonly onHeaderChange: (
    entryIdx: number,
    blockId: string,
    col: number,
    value: string,
  ) => void;
  readonly onAddRow: (entryIdx: number, blockId: string) => void;
  readonly onRemoveBlock: (entryIdx: number, blockId: string) => void;
  readonly onBlurFlush: () => void;
}): JSX.Element {
  return (
    <div
      data-testid={`case-block-${complaintId}-${block.id}`}
      className="overflow-x-auto rounded border border-slate-200"
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {block.columns.map((col, c) => (
              <th key={c} className="border-b border-slate-200 p-1">
                <input
                  data-testid={`case-cell-${complaintId}-${block.id}-h-${c}`}
                  value={col}
                  onChange={(e) =>
                    onHeaderChange(entryIdx, block.id, c, e.target.value)
                  }
                  onBlur={onBlurFlush}
                  aria-label={t('case.form.table.cell')}
                  className="input w-full font-semibold"
                />
              </th>
            ))}
            <th className="w-8 border-b border-slate-200 p-1" />
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {block.columns.map((_, c) => (
                <td key={c} className="p-1">
                  <input
                    data-testid={`case-cell-${complaintId}-${block.id}-${r}-${c}`}
                    value={row[c] ?? ''}
                    onChange={(e) =>
                      onCellChange(entryIdx, block.id, r, c, e.target.value)
                    }
                    onBlur={onBlurFlush}
                    aria-label={t('case.form.table.cell')}
                    className="input w-full"
                  />
                </td>
              ))}
              <td className="p-1" />
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 border-t border-slate-100 p-1">
        <button
          type="button"
          data-testid={`case-table-add-row-${block.id}`}
          onClick={() => onAddRow(entryIdx, block.id)}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          {t('case.form.table.addRow')}
        </button>
        <button
          type="button"
          data-testid={`case-block-remove-${block.id}`}
          onClick={() => onRemoveBlock(entryIdx, block.id)}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          {t('case.form.table.removeBlock')}
        </button>
      </div>
    </div>
  );
}

/** The Record-vitals popup: BP sys + dia as TWO fields, live BMI (ADR 0018 #3). */
function VitalsPopup({
  onCancel,
  onRecord,
}: {
  readonly onCancel: () => void;
  readonly onRecord: (
    row: readonly string[],
    structured: Record<string, number>,
  ) => void;
}): JSX.Element {
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [pulse, setPulse] = useState('');
  const [weight, setWeight] = useState('');
  const [height, setHeight] = useState('');
  const [temp, setTemp] = useState('');
  const [spo2, setSpo2] = useState('');

  const bmi = liveBmi(numOrUndef(weight), numOrUndef(height));
  const bmiText = bmi === null ? '' : String(bmi);

  const record = useCallback((): void => {
    const structured: Record<string, number> = {};
    const put = (key: string, value: string): void => {
      const n = numOrUndef(value);
      if (n !== undefined) structured[key] = n;
    };
    put('bpSys', sys);
    put('bpDia', dia);
    put('pulse', pulse);
    put(VITALS_WEIGHT, weight);
    put(VITALS_HEIGHT, height);
    put('temp', temp);
    put('spo2', spo2);
    if (bmi !== null) structured[VITALS_BMI] = bmi;
    onRecord(
      [sys, dia, pulse, weight, height, bmiText, temp, spo2],
      structured,
    );
  }, [onRecord, sys, dia, pulse, weight, height, bmi, bmiText, temp, spo2]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('case.form.vitals.title')}
      data-testid="case-form-vitals-popup"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="w-[32rem] rounded border border-slate-300 bg-white p-4 shadow-lg">
        <h2 className="mb-3 text-sm font-semibold">
          {t('case.form.vitals.title')}
        </h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <NumberField
            testId="case-vitals-bp-sys"
            label={t('case.form.vitals.bpSys')}
            value={sys}
            onChange={setSys}
          />
          <NumberField
            testId="case-vitals-bp-dia"
            label={t('case.form.vitals.bpDia')}
            value={dia}
            onChange={setDia}
          />
          <NumberField
            testId="case-vitals-pulse"
            label={t('case.form.vitals.pulse')}
            value={pulse}
            onChange={setPulse}
          />
          <NumberField
            testId="case-vitals-weight"
            label={t('case.form.vitals.weight')}
            value={weight}
            onChange={setWeight}
          />
          <NumberField
            testId="case-vitals-height"
            label={t('case.form.vitals.height')}
            value={height}
            onChange={setHeight}
          />
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">
              {t('case.form.vitals.bmi')}
            </span>
            <output
              data-testid="case-vitals-bmi"
              aria-label={t('case.form.vitals.bmi')}
              className="input bg-slate-50"
            >
              {bmiText}
            </output>
          </div>
          <NumberField
            testId="case-vitals-temp"
            label={t('case.form.vitals.temp')}
            value={temp}
            onChange={setTemp}
          />
          <NumberField
            testId="case-vitals-spo2"
            label={t('case.form.vitals.spo2')}
            value={spo2}
            onChange={setSpo2}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-testid="case-form-record-vitals-cancel"
            onClick={onCancel}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('case.form.vitals.cancel')}
          </button>
          <button
            type="button"
            data-testid="case-form-record-vitals-confirm"
            onClick={record}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-700"
          >
            {t('case.form.vitals.record')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A labelled numeric input used inside the vitals popup. */
function NumberField({
  testId,
  label,
  value,
  onChange,
}: {
  readonly testId: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        data-testid={testId}
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="input"
      />
    </label>
  );
}

/** Parse a numeric string, or undefined when empty/invalid. */
function numOrUndef(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

/** Restore the structured camelCase vitals copy from the opened `vitals_json`. */
function restoreVitals(vitalsJson: string): Record<string, number> {
  try {
    const raw = JSON.parse(vitalsJson) as Record<string, unknown>;
    if (raw !== null && typeof raw === 'object') {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'number') out[k] = v;
      }
      return out;
    }
  } catch {
    /* a fresh or malformed visit starts with empty structured vitals */
  }
  return {};
}

/** The structured side-section rail (family, investigations, generals, dx). */
function SideSectionRail({
  doc,
  visitId,
  openSection,
  onToggleSection,
  onSectionField,
  onBlurFlush,
}: {
  readonly doc: JournalDoc;
  readonly visitId: string;
  readonly openSection: string | null;
  readonly onToggleSection: (key: string) => void;
  readonly onSectionField: (
    sectionKey: EditableSectionKey,
    fieldKey: string,
    value: string,
  ) => void;
  readonly onBlurFlush: () => void;
}): JSX.Element {
  const SECTIONS: ReadonlyArray<{ key: EditableSectionKey; title: string }> = [
    { key: 'physical_generals', title: t('case.form.generals.title') },
    { key: 'family_history', title: t('case.form.family.title') },
    { key: 'investigations', title: t('case.form.investigations.title') },
    {
      key: 'provisional_diagnosis',
      title: t('case.form.diagnosis.label'),
    },
  ];
  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-slate-200 pt-2">
      <h2 className="px-1 text-xs font-semibold uppercase text-slate-500">
        {t('case.form.sections.title')}
      </h2>
      {SECTIONS.map((s) => {
        const isOpen = openSection === s.key;
        return (
          <div key={s.key} className="flex flex-col">
            <button
              type="button"
              data-testid={`case-form-section-${s.key}`}
              aria-expanded={isOpen}
              onClick={() => onToggleSection(s.key)}
              className={[
                'rounded px-2 py-1 text-left hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600',
                isOpen ? 'bg-blue-50 font-medium' : '',
              ].join(' ')}
            >
              {s.title}
            </button>
            {isOpen ? (
              <div className="p-2">
                <SideSectionBody
                  sectionKey={s.key}
                  doc={doc}
                  visitId={visitId}
                  onSectionField={onSectionField}
                  onBlurFlush={onBlurFlush}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Render the body of one expanded side section. */
function SideSectionBody({
  sectionKey,
  doc,
  visitId,
  onSectionField,
  onBlurFlush,
}: {
  readonly sectionKey: EditableSectionKey;
  readonly doc: JournalDoc;
  readonly visitId: string;
  readonly onSectionField: (
    sectionKey: EditableSectionKey,
    fieldKey: string,
    value: string,
  ) => void;
  readonly onBlurFlush: () => void;
}): JSX.Element {
  if (sectionKey === 'family_history') {
    return (
      <FamilyHistoryTabs
        maternal={sectionFieldValue(doc.sections, 'family_history', 'maternal')}
        paternal={sectionFieldValue(doc.sections, 'family_history', 'paternal')}
        onChange={(field, value) =>
          onSectionField('family_history', field, value)
        }
        onBlurFlush={onBlurFlush}
      />
    );
  }
  if (sectionKey === 'investigations') {
    return (
      <InvestigationsTabs
        suggested={sectionFieldValue(
          doc.sections,
          'investigations',
          'suggested',
        )}
        visitId={visitId}
        onChange={(field, value) =>
          onSectionField('investigations', field, value)
        }
        onBlurFlush={onBlurFlush}
      />
    );
  }
  if (sectionKey === 'provisional_diagnosis') {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">
          {t('case.form.diagnosis.label')}
        </span>
        <textarea
          data-testid="case-form-diagnosis"
          rows={3}
          value={sectionFieldValue(doc.sections, 'provisional_diagnosis', 'dx')}
          onChange={(e) =>
            onSectionField('provisional_diagnosis', 'dx', e.target.value)
          }
          onBlur={onBlurFlush}
          aria-label={t('case.form.diagnosis.label')}
          className="input"
        />
      </label>
    );
  }
  // physical_generals and any other simple key -> a Notes field.
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">
        {t('case.form.generals.title')}
      </span>
      <textarea
        data-testid="case-form-generals-notes"
        rows={3}
        value={sectionFieldValue(doc.sections, 'physical_generals', 'notes')}
        onChange={(e) =>
          onSectionField('physical_generals', 'notes', e.target.value)
        }
        onBlur={onBlurFlush}
        aria-label={t('case.form.generals.title')}
        className="input"
      />
    </label>
  );
}

/** Family history: Maternal / Paternal tabs holding independent data. */
function FamilyHistoryTabs({
  maternal,
  paternal,
  onChange,
  onBlurFlush,
}: {
  readonly maternal: string;
  readonly paternal: string;
  readonly onChange: (field: 'maternal' | 'paternal', value: string) => void;
  readonly onBlurFlush: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<'maternal' | 'paternal'>('maternal');
  return (
    <div className="flex flex-col gap-2">
      <div
        role="tablist"
        aria-label={t('case.form.family.title')}
        className="flex gap-1"
      >
        <button
          type="button"
          role="tab"
          data-testid="case-form-family-maternal-tab"
          aria-selected={tab === 'maternal'}
          onClick={() => setTab('maternal')}
          className={tabClass(tab === 'maternal')}
        >
          {t('case.form.family.maternal')}
        </button>
        <button
          type="button"
          role="tab"
          data-testid="case-form-family-paternal-tab"
          aria-selected={tab === 'paternal'}
          onClick={() => setTab('paternal')}
          className={tabClass(tab === 'paternal')}
        >
          {t('case.form.family.paternal')}
        </button>
      </div>
      {tab === 'maternal' ? (
        <textarea
          data-testid="case-form-family-maternal"
          rows={4}
          value={maternal}
          onChange={(e) => onChange('maternal', e.target.value)}
          onBlur={onBlurFlush}
          aria-label={t('case.form.family.maternal')}
          className="input"
        />
      ) : (
        <textarea
          data-testid="case-form-family-paternal"
          rows={4}
          value={paternal}
          onChange={(e) => onChange('paternal', e.target.value)}
          onBlur={onBlurFlush}
          aria-label={t('case.form.family.paternal')}
          className="input"
        />
      )}
    </div>
  );
}

/** Investigations: Suggested text tab + Submitted (PAT-009 uploader) tab. */
function InvestigationsTabs({
  suggested,
  visitId,
  onChange,
  onBlurFlush,
}: {
  readonly suggested: string;
  readonly visitId: string;
  readonly onChange: (field: 'suggested', value: string) => void;
  readonly onBlurFlush: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<'suggested' | 'submitted'>('suggested');
  return (
    <div className="flex flex-col gap-2">
      <div
        role="tablist"
        aria-label={t('case.form.investigations.title')}
        className="flex gap-1"
      >
        <button
          type="button"
          role="tab"
          data-testid="case-form-invest-suggested-tab"
          aria-selected={tab === 'suggested'}
          onClick={() => setTab('suggested')}
          className={tabClass(tab === 'suggested')}
        >
          {t('case.form.invest.suggested')}
        </button>
        <button
          type="button"
          role="tab"
          data-testid="case-form-invest-submitted-tab"
          aria-selected={tab === 'submitted'}
          onClick={() => setTab('submitted')}
          className={tabClass(tab === 'submitted')}
        >
          {t('case.form.invest.submitted')}
        </button>
      </div>
      {tab === 'suggested' ? (
        <textarea
          data-testid="case-form-invest-suggested"
          rows={4}
          value={suggested}
          onChange={(e) => onChange('suggested', e.target.value)}
          onBlur={onBlurFlush}
          aria-label={t('case.form.invest.suggested')}
          className="input"
        />
      ) : (
        <InvestigationsPanel visitId={visitId} />
      )}
    </div>
  );
}

/** Shared tab button styling. */
function tabClass(active: boolean): string {
  return [
    'rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600',
    active ? 'bg-blue-600 text-white' : 'border border-slate-300',
  ].join(' ');
}

/**
 * Whether a mime is an image (drives the type badge + thumbnail preview).
 */
function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

/** Resolve a user-facing message for a thrown attachment error (R-UI-008). */
function attachmentErrorMessage(err: unknown): string {
  if (isUserFacingError(err)) return err.message;
  return t('case.form.investigations.error.generic');
}

/**
 * Investigations lab-report attachments (PAT-009), hosted under the Submitted
 * tab. Lets the doctor attach PDFs / images, list them, open one for in-app
 * preview and remove one behind a confirm. Calls ONLY the generated typed
 * bindings; the UI never constructs a filesystem path (the OS picker returns a
 * path via `visit_pick_report_file`). No patient data, path or stack trace is
 * surfaced (R-PRIV-001, R-UI-008).
 */
function InvestigationsPanel({
  visitId,
}: {
  readonly visitId: string;
}): JSX.Element {
  const [attachments, setAttachments] = useState<AttachmentSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    name: string;
    isImage: boolean;
  } | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const res = await run(commands.visitListAttachments({ visitId }));
    setAttachments(res.attachments);
    setLoaded(true);
  }, [visitId]);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const res = await run(commands.visitListAttachments({ visitId }));
        if (!cancelled) {
          setAttachments(res.attachments);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setLoaded(true);
          setError(t('case.form.investigations.error.generic'));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visitId]);

  const onUpload = useCallback(async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const picked = await run(commands.visitPickReportFile());
      if (picked.sourcePath === null) return;
      await run(
        commands.visitAttachReport({
          visitId,
          sourcePath: picked.sourcePath,
          caption: caption.trim() === '' ? null : caption.trim(),
        }),
      );
      setCaption('');
      await reload();
    } catch (e) {
      setError(attachmentErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [visitId, caption, reload]);

  const onOpen = useCallback(async (attachmentId: string): Promise<void> => {
    setError(null);
    try {
      const res = await run(commands.visitOpenAttachment({ attachmentId }));
      const url = `data:${res.mime};base64,${res.dataBase64}`;
      setPreview({
        url,
        name: res.originalName ?? '',
        isImage: isImageMime(res.mime),
      });
    } catch (e) {
      setError(attachmentErrorMessage(e));
    }
  }, []);

  const onConfirmRemove = useCallback(async (): Promise<void> => {
    if (confirmId === null) return;
    const id = confirmId;
    setConfirmId(null);
    setError(null);
    try {
      await run(commands.visitDeleteAttachment({ attachmentId: id }));
      await reload();
    } catch (e) {
      setError(attachmentErrorMessage(e));
    }
  }, [confirmId, reload]);

  return (
    <div className="mt-1 flex flex-col gap-3">
      <div>
        <h3 className="text-xs font-semibold uppercase text-slate-500">
          {t('case.form.investigations.title')}
        </h3>
        <p className="text-xs text-slate-500">
          {t('case.form.investigations.hint')}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            {t('case.form.investigations.caption')}
          </span>
          <input
            data-testid="case-form-investigations-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="input"
            aria-label={t('case.form.investigations.caption')}
          />
        </label>
        <button
          type="button"
          data-testid="case-form-investigations-upload"
          onClick={() => void onUpload()}
          disabled={busy}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
        >
          {busy
            ? t('case.form.investigations.uploading')
            : t('case.form.investigations.upload')}
        </button>
      </div>

      {error !== null ? (
        <p
          role="alert"
          data-testid="case-form-investigations-error"
          className="text-xs text-red-700"
        >
          {error}
        </p>
      ) : null}

      {loaded && attachments.length === 0 ? (
        <p
          data-testid="case-form-investigations-empty"
          className="text-sm text-slate-500"
        >
          {t('case.form.investigations.empty')}
        </p>
      ) : null}

      {attachments.length > 0 ? (
        <ul
          data-testid="case-form-investigations-list"
          className="flex flex-col gap-2"
        >
          {attachments.map((a, index) => {
            const n = index + 1;
            const image = isImageMime(a.mime);
            return (
              <li
                key={a.attachmentId}
                data-testid={`case-form-investigations-item-${n}`}
                className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    data-testid={`case-form-investigations-badge-${n}`}
                    className={[
                      'flex-none rounded px-1.5 py-0.5 text-[0.7rem] font-semibold uppercase',
                      image
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-rose-100 text-rose-800',
                    ].join(' ')}
                  >
                    {image
                      ? t('case.form.investigations.badge.image')
                      : t('case.form.investigations.badge.pdf')}
                  </span>
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{a.originalName ?? ''}</span>
                    {a.caption !== null && a.caption !== '' ? (
                      <span className="text-slate-500"> — {a.caption}</span>
                    ) : null}
                  </span>
                </div>
                <div className="flex flex-none items-center gap-2">
                  <button
                    type="button"
                    data-testid={`case-form-investigations-open-${n}`}
                    onClick={() => void onOpen(a.attachmentId)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {t('case.form.investigations.open')}
                  </button>
                  <button
                    type="button"
                    data-testid={`case-form-investigations-remove-${n}`}
                    onClick={() => setConfirmId(a.attachmentId)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {t('case.form.investigations.remove')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {confirmId !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('case.form.investigations.remove.title')}
          data-testid="case-form-investigations-remove-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setConfirmId(null);
          }}
        >
          <div className="w-[26rem] rounded border border-slate-300 bg-white p-4 shadow-lg">
            <h2 className="mb-1 text-sm font-semibold">
              {t('case.form.investigations.remove.title')}
            </h2>
            <p className="mb-3 text-xs text-slate-600">
              {t('case.form.investigations.remove.body')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="case-form-investigations-remove-cancel"
                onClick={() => setConfirmId(null)}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {t('case.form.investigations.remove.cancel')}
              </button>
              <button
                type="button"
                data-testid="case-form-investigations-remove-confirm"
                onClick={() => void onConfirmRemove()}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-red-700"
              >
                {t('case.form.investigations.remove.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {preview !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={preview.name}
          data-testid="case-form-investigations-preview"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPreview(null);
          }}
        >
          <div className="flex max-h-[85vh] w-[48rem] flex-col rounded border border-slate-300 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
              <h2 className="truncate text-sm font-semibold">{preview.name}</h2>
              <button
                type="button"
                data-testid="case-form-investigations-preview-close"
                onClick={() => setPreview(null)}
                className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {t('case.form.investigations.remove.cancel')}
              </button>
            </div>
            <div className="overflow-auto p-4">
              {preview.isImage ? (
                <img
                  data-testid="case-form-investigations-preview-image"
                  src={preview.url}
                  alt={preview.name}
                  className="mx-auto max-h-[70vh] max-w-full"
                />
              ) : (
                <a
                  data-testid="case-form-investigations-preview-download"
                  href={preview.url}
                  download={preview.name}
                  className="inline-block rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-700"
                >
                  {t('case.form.investigations.download')}
                </a>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
