// S08 Case record — ONE rich WYSIWYG editor per complaint (ADR 0019, M3-RWv2).
// The case body is a single TipTap/ProseMirror document: free prose, dated-entry
// headings, numbered section headings, full-width horizontal-rule separators and
// inserted editable Office-style tables, all in one notepad in authored order.
// The structured side-section rail is gone; its data is now recorded through
// RECORD BUTTONS that insert editable tables into the current dated entry
// (Record vitals / modalities / family history / physical generals /
// investigations / prescription). Family history inserts a two-column
// Maternal|Paternal table; the prescription table is a labelled R4 PLACEHOLDER.
//
// Calls ONLY the generated typed bindings (UI -> typed commands only; never SQL
// or raw filesystem paths). Every control / asserted value carries its S08
// data-testid (R-UI-003); visible text comes from en.json (R-UI-007); dates go
// through shared/datetime (R-UI-006).
//
// The whole v3 `case-rich` document serialises into the opaque `visit.data_json`
// (ADR 0007) through caseRich.serializeRich — which regenerates the top-level
// plain-text mirror for visit_fts on every save (v3 §7). Autosave (2 s + blur)
// and an explicit Save button both flush the whole document through
// `case_visit_autosave`, so a killed-mid-typing session loses nothing
// (CASE-005). A legacy R3 / v2-journal `data_json` is upcast in memory on open
// by caseRich.parseCaseDoc (v3 §8); disk is untouched until the first autosave.
//
// The real Rx engine (R4) is out of scope: Add prescription inserts a labelled
// PLACEHOLDER table (hcRxPlaceholder:true) only. The Case summary button, the
// narrative field and the Personal history section stay removed (ADR 0018 #5).

import { useCallback, useEffect, useRef, useState } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/react';

import { commands } from '@/bindings';
import type { AttachmentSummary } from '@/bindings';
import {
  buildFamilySeed,
  buildPrescriptionSeed,
  buildVitalsSeed,
  parseCaseDoc,
  serializeRich,
  type RichTableType,
  type TableSeed,
  type V3Doc,
} from '@/case/caseRich';
import {
  caseEditorExtensions,
  currentComplaintName,
  initialContent,
  insertComplaint,
  insertDatedEntry,
  insertSectionNodes,
  v3DocFromEditor,
} from '@/case/caseRichEditor';
import { isUserFacingError, run } from '@/shared/command';
import { formatDate, formatDateTime, todayIsoDate } from '@/shared/datetime';
import { t } from '@/shared/strings';

// The legacy v2->* upcast now lives in caseRich (parseCaseDoc). It is re-exported
// here for continuity with callers/tests that imported it alongside the
// component before the RWv2 editor rework.
export { upcastLegacyCaseData } from '@/case/caseJournal';

/** How the case form is opened. */
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
   * the SAME document and reads "Update ..." on the record buttons. Defaults to
   * `first`.
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
 * non-positive (68 kg / 172 cm => 22.9). The authoritative BMI is recomputed by
 * the backend on autosave (CASE-001).
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

/** Which record popup is open (null = none). */
type OpenPopup =
  | null
  | 'vitals'
  | 'modalities'
  | 'family'
  | 'generals'
  | 'investigations'
  | 'prescription';

/**
 * The journal case sheet (S08, revised): one TipTap editor per complaint,
 * record-button popups that insert editable tables, autosave through the v3
 * `case-rich` serialiser.
 */
export function CaseForm({
  patientId,
  visitId,
  visitType = 'first',
  onBack,
}: CaseFormProps): JSX.Element {
  const isFollowup = visitType === 'follow_up';

  const [doc, setDoc] = useState<V3Doc | null>(null);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [errored, setErrored] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [nextFollowupOn, setNextFollowupOn] = useState<string | null>(null);
  const [popup, setPopup] = useState<OpenPopup>(null);
  // True once an Rx placeholder table has been inserted; shows the R4 hint.
  const [rxInserted, setRxInserted] = useState(false);

  // The per-complaint section counter (R3: one complaint, "cc1"). Held in a ref
  // so an insert reads the latest value synchronously between renders.
  const nextSectionNoRef = useRef(1);
  // The transitional `sections` object carried forward verbatim (v3 §6).
  const sectionsRef = useRef<unknown | null>(null);
  // Complaint identity for the active editor (R3 renders the first complaint).
  const complaintIdRef = useRef('cc1');
  const complaintTitleRef = useRef('');
  // The live complaint-name <input>, so "Add new complaint" can clear it after
  // consuming the name into a new section header (uncontrolled input + ref).
  const complaintTitleInputRef = useRef<HTMLInputElement | null>(null);

  // Autosave debounce timer + a ref to the live editor so blur/force-flush read
  // the newest in-editor state (incl. in-place cell edits), never a stale snap.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  // Structured camelCase vitals mirrored into `visit.vitals_json` (schema §4a).
  const vitalsRef = useRef<Record<string, number>>({});

  // ---- Autosave (CASE-005) -------------------------------------------------

  const buildPayload = useCallback((): string | null => {
    const editor = editorRef.current;
    if (editor === null) return null;
    const v3 = v3DocFromEditor(
      editor,
      complaintIdRef.current,
      complaintTitleRef.current,
      nextSectionNoRef.current,
      sectionsRef.current,
    );
    return serializeRich(v3);
  }, []);

  const flushSave = useCallback(async (): Promise<void> => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const payload = buildPayload();
    if (payload === null) return;
    setStatus({ kind: 'saving' });
    try {
      const res = await run(
        commands.caseVisitAutosave({
          visitId,
          dataJson: payload,
          vitalsJson: JSON.stringify(vitalsRef.current),
        }),
      );
      setStatus({ kind: 'saved', at: res.savedAt });
      setSavedOnce(true);
    } catch {
      setStatus({ kind: 'error' });
    }
  }, [visitId, buildPayload]);

  const scheduleSave = useCallback((): void => {
    setStatus({ kind: 'saving' });
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flushSave]);

  // ---- Editor --------------------------------------------------------------

  const editor = useEditor(
    {
      extensions: caseEditorExtensions(),
      content: doc !== null ? initialContent(doc) : '',
      editable: true,
      editorProps: {
        // The editor region has its own scroll container; we never need
        // ProseMirror's selection-scroll (which measures DOM geometry) — opting
        // out keeps the editor stable under constrained DOM environments.
        handleScrollToSelection: () => true,
        attributes: {
          'aria-label': t('case.form.editor.label'),
          'aria-multiline': 'true',
          role: 'textbox',
          class: 'ProseMirror hc-case-editor focus:outline-none',
        },
      },
      onUpdate: () => {
        scheduleSave();
      },
      onBlur: () => {
        void flushSave();
      },
    },
    [doc !== null],
  );
  editorRef.current = editor;

  // ---- Load + restore ------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const open = await run(
          commands.caseVisitOpenOrCreate({ patientId, visitType }),
        );
        if (cancelled) return;
        const parsed = parseCaseDoc(
          open.dataJson,
          {
            visitId: open.visitId,
            visitAt: open.visitAt,
          },
          t,
        );
        const first = parsed.complaints[0]!;
        complaintIdRef.current = first.id;
        complaintTitleRef.current = first.title;
        nextSectionNoRef.current = first.next_section_no;
        sectionsRef.current = parsed.sections ?? null;
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

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  // ---- Inserts -------------------------------------------------------------

  /** Insert a seeded record section (rule + numbered heading + table). */
  const insertSection = useCallback(
    (kind: RichTableType, seed: TableSeed): void => {
      const ed = editorRef.current;
      if (ed === null) return;
      const sectionNo = nextSectionNoRef.current;
      nextSectionNoRef.current = sectionNo + 1;
      insertSectionNodes(ed, { kind, sectionNo, seed });
      void flushSave();
    },
    [flushSave],
  );

  const onAddEntry = useCallback((): void => {
    const ed = editorRef.current;
    if (ed === null) return;
    insertDatedEntry(
      ed,
      todayIsoDate(),
      visitId,
      currentComplaintName(ed),
      'first',
    );
    void flushSave();
  }, [visitId, flushSave]);

  const onAddFollowupEntry = useCallback((): void => {
    const ed = editorRef.current;
    if (ed === null) return;
    insertDatedEntry(
      ed,
      todayIsoDate(),
      visitId,
      currentComplaintName(ed),
      'follow_up',
    );
    void flushSave();
  }, [visitId, flushSave]);

  const onAddComplaint = useCallback((): void => {
    const ed = editorRef.current;
    if (ed === null) return;
    const name = complaintTitleRef.current.trim();
    insertComplaint(ed, { name, date: todayIsoDate(), visitId });
    // The complaint name has been consumed into its own section header; clear
    // the shared input so the next complaint starts blank (M3-RWv3 §5).
    complaintTitleRef.current = '';
    if (complaintTitleInputRef.current !== null) {
      complaintTitleInputRef.current.value = '';
    }
    void flushSave();
  }, [visitId, flushSave]);

  const onRecordVitals = useCallback(
    (seed: TableSeed, structured: Record<string, number>): void => {
      vitalsRef.current = structured;
      insertSection('vitals', seed);
      setPopup(null);
    },
    [insertSection],
  );

  const onRecordFamily = useCallback(
    (seed: TableSeed): void => {
      insertSection('family_history', seed);
      setPopup(null);
    },
    [insertSection],
  );

  const onRecordPrescription = useCallback(
    (seed: TableSeed): void => {
      insertSection('prescription', seed);
      setPopup(null);
    },
    [insertSection],
  );

  const onRecordGenericSeed = useCallback(
    (kind: RichTableType, seed: TableSeed): void => {
      insertSection(kind, seed);
      setPopup(null);
    },
    [insertSection],
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

  const complaintId = complaintIdRef.current;

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
        {/* Centre: the active complaint's ONE rich editor + record toolbar. */}
        <div
          data-testid="case-form-content"
          data-adaptive="true"
          className="flex min-w-0 flex-1 flex-col overflow-auto p-4"
        >
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <span className="sr-only">
                {t('case.form.complaint.titleLabel')}
              </span>
              <input
                ref={complaintTitleInputRef}
                data-testid="case-form-complaint-title"
                defaultValue={complaintTitleRef.current}
                onChange={(e) => {
                  complaintTitleRef.current = e.target.value;
                }}
                placeholder={t('case.form.complaint.titlePlaceholder')}
                aria-label={t('case.form.complaint.titleLabel')}
                className="input w-full text-base font-semibold"
              />
            </label>
            {/* The three complaint/entry actions (M3-RWv3 §5), replacing the
                single legacy "Add entry". Each is a labelled, keyboard-focusable
                button with its own data-testid. */}
            <div className="flex flex-none flex-wrap gap-2">
              <button
                type="button"
                data-testid="case-form-add-entry"
                onClick={onAddEntry}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {t('case.form.addNewEntry')}
              </button>
              <button
                type="button"
                data-testid="case-form-add-followup-entry"
                onClick={onAddFollowupEntry}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {t('case.form.addFollowupEntry')}
              </button>
              <button
                type="button"
                data-testid="case-form-add-complaint"
                onClick={onAddComplaint}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {t('case.form.addNewComplaint')}
              </button>
            </div>
          </div>

          {/* The single WYSIWYG notepad. Zoom is driven app-level: the shared
              app-bar zoom controls + Ctrl+= / Ctrl+- / Ctrl+0 scale the
              DOCUMENT ROOT font-size (useZoom -> AppShell, C8), which scales
              every rem-based unit — chrome AND this editor — uniformly. The
              editor no longer carries its own fontSize scale (that editor-only
              override scaled just this box, competing with the app-level zoom).
              Full-width adaptive (no capped column). */}
          <div
            data-testid={`case-form-editor-${complaintId}`}
            className="min-h-[16rem] w-full flex-1 rounded border border-slate-200 p-3"
          >
            <EditorContent editor={editor} />
          </div>

          {rxInserted ? (
            <p
              data-testid="case-form-rx-placeholder-hint"
              role="note"
              className="mt-2 rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-800"
            >
              {t('case.form.rxPlaceholderHint')}
            </p>
          ) : null}

          {/* Record toolbar (replaces the structured side-section rail). */}
          <div
            role="toolbar"
            aria-label={t('case.form.toolbar.label')}
            className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3"
          >
            <RecordButton
              testId="case-form-record-vitals"
              label={
                isFollowup
                  ? t('case.form.updateVitals')
                  : t('case.form.recordVitals')
              }
              onClick={() => setPopup('vitals')}
            />
            <RecordButton
              testId="case-form-modalities"
              label={
                isFollowup
                  ? t('case.form.updateModalities')
                  : t('case.form.modalities')
              }
              onClick={() => setPopup('modalities')}
            />
            <RecordButton
              testId="case-form-record-family"
              label={
                isFollowup
                  ? t('case.form.updateFamily')
                  : t('case.form.recordFamily')
              }
              onClick={() => setPopup('family')}
            />
            <RecordButton
              testId="case-form-record-generals"
              label={
                isFollowup
                  ? t('case.form.updateGenerals')
                  : t('case.form.recordGenerals')
              }
              onClick={() => setPopup('generals')}
            />
            <RecordButton
              testId="case-form-record-investigations"
              label={
                isFollowup
                  ? t('case.form.updateInvestigations')
                  : t('case.form.recordInvestigations')
              }
              onClick={() => setPopup('investigations')}
            />
            <RecordButton
              testId="case-form-add-prescription"
              label={
                isFollowup
                  ? t('case.form.updatePrescription')
                  : t('case.form.addPrescription')
              }
              onClick={() => setPopup('prescription')}
            />
          </div>

          {/* PAT-009 lab-report uploader — a SIDE control, not editor content. */}
          <div className="mt-4 border-t border-slate-200 pt-3">
            <InvestigationsPanel visitId={visitId} />
          </div>
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

      {popup === 'vitals' ? (
        <VitalsPopup
          onCancel={() => setPopup(null)}
          onRecord={(seed, structured) => {
            onRecordVitals(seed, structured);
          }}
        />
      ) : null}

      {popup === 'family' ? (
        <FamilyPopup
          onCancel={() => setPopup(null)}
          onRecord={(seed) => {
            onRecordFamily(seed);
          }}
        />
      ) : null}

      {popup === 'modalities' ? (
        <ModalitiesPopup
          onCancel={() => setPopup(null)}
          onRecord={(seed) => {
            onRecordGenericSeed('modalities', seed);
          }}
        />
      ) : null}

      {popup === 'generals' ? (
        <GeneralsPopup
          onCancel={() => setPopup(null)}
          onRecord={(seed) => {
            onRecordGenericSeed('physical_generals', seed);
          }}
        />
      ) : null}

      {popup === 'investigations' ? (
        <InvestigationsRecordPopup
          onCancel={() => setPopup(null)}
          onRecord={(seed) => {
            onRecordGenericSeed('investigations', seed);
          }}
        />
      ) : null}

      {popup === 'prescription' ? (
        <PrescriptionPopup
          onCancel={() => setPopup(null)}
          onRecord={(seed) => {
            setRxInserted(true);
            onRecordPrescription(seed);
          }}
        />
      ) : null}
    </section>
  );
}

/** A record-toolbar button (opens a popup). */
function RecordButton({
  testId,
  label,
  onClick,
}: {
  readonly testId: string;
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
    >
      {label}
    </button>
  );
}

/** Top header: next F/U display, Save + status. */
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

// ---------------------------------------------------------------------------
// Popups (accessible dialogs: role=dialog, aria-modal, Escape closes, focus
// is trapped to the dialog's controls which are the first focusable element).
// ---------------------------------------------------------------------------

/** A shared modal shell: role=dialog, labelled, Escape cancels, focus-trapped. */
function Dialog({
  testId,
  title,
  onCancel,
  children,
  footer,
  width = '32rem',
}: {
  readonly testId: string;
  readonly title: string;
  readonly onCancel: () => void;
  readonly children: React.ReactNode;
  readonly footer: React.ReactNode;
  readonly width?: string;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  // Focus the first focusable control on open (keyboard-first, SUX).
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(
      'input, textarea, button, [tabindex]',
    );
    el?.focus();
  }, []);

  // Trap Tab/Shift+Tab inside the dialog (accessibility: focus management).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = ref.current?.querySelectorAll<HTMLElement>(
        'input, textarea, button, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables === undefined || focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onCancel],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onKeyDown={onKeyDown}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        style={{ width }}
        className="rounded border border-slate-300 bg-white p-4 shadow-lg"
      >
        <h2 className="mb-3 text-sm font-semibold">{title}</h2>
        {children}
        <div className="mt-4 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

/** Cancel / Record footer buttons shared by the popups. */
function DialogFooter({
  cancelTestId,
  confirmTestId,
  onCancel,
  onConfirm,
}: {
  readonly cancelTestId: string;
  readonly confirmTestId: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): JSX.Element {
  return (
    <>
      <button
        type="button"
        data-testid={cancelTestId}
        onClick={onCancel}
        className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
      >
        {t('case.form.popup.cancel')}
      </button>
      <button
        type="button"
        data-testid={confirmTestId}
        onClick={onConfirm}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-700"
      >
        {t('case.form.popup.record')}
      </button>
    </>
  );
}

/** A labelled text input used inside popups. */
function TextField({
  testId,
  label,
  value,
  onChange,
  numeric = false,
}: {
  readonly testId: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly numeric?: boolean;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        data-testid={testId}
        {...(numeric ? { type: 'number', inputMode: 'numeric' as const } : {})}
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

/** Record vitals: BP sys + dia as TWO fields, live BMI (ADR 0019 #7). */
function VitalsPopup({
  onCancel,
  onRecord,
}: {
  readonly onCancel: () => void;
  readonly onRecord: (
    seed: TableSeed,
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
    const seed = buildVitalsSeed(
      {
        systolic: sys,
        diastolic: dia,
        pulse,
        weightKg: weight,
        heightCm: height,
        bmi: bmiText,
        temp,
        spo2,
      },
      t,
    );
    onRecord(seed, structured);
  }, [onRecord, sys, dia, pulse, weight, height, bmi, bmiText, temp, spo2]);

  return (
    <Dialog
      testId="case-form-vitals-popup"
      title={t('case.form.vitals.title')}
      onCancel={onCancel}
      footer={
        <DialogFooter
          cancelTestId="case-form-record-vitals-cancel"
          confirmTestId="case-form-record-vitals-confirm"
          onCancel={onCancel}
          onConfirm={record}
        />
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <TextField
          testId="case-vitals-bp-sys"
          label={t('case.form.vitals.bpSys')}
          value={sys}
          onChange={setSys}
          numeric
        />
        <TextField
          testId="case-vitals-bp-dia"
          label={t('case.form.vitals.bpDia')}
          value={dia}
          onChange={setDia}
          numeric
        />
        <TextField
          testId="case-vitals-pulse"
          label={t('case.form.vitals.pulse')}
          value={pulse}
          onChange={setPulse}
          numeric
        />
        <TextField
          testId="case-vitals-weight"
          label={t('case.form.vitals.weight')}
          value={weight}
          onChange={setWeight}
          numeric
        />
        <TextField
          testId="case-vitals-height"
          label={t('case.form.vitals.height')}
          value={height}
          onChange={setHeight}
          numeric
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
        <TextField
          testId="case-vitals-temp"
          label={t('case.form.vitals.temp')}
          value={temp}
          onChange={setTemp}
          numeric
        />
        <TextField
          testId="case-vitals-spo2"
          label={t('case.form.vitals.spo2')}
          value={spo2}
          onChange={setSpo2}
          numeric
        />
      </div>
    </Dialog>
  );
}

/** Record family history: Maternal / Paternal tabs -> two-column table. */
function FamilyPopup({
  onCancel,
  onRecord,
}: {
  readonly onCancel: () => void;
  readonly onRecord: (seed: TableSeed) => void;
}): JSX.Element {
  const [tab, setTab] = useState<'maternal' | 'paternal'>('maternal');
  const [maternal, setMaternal] = useState('');
  const [paternal, setPaternal] = useState('');

  const record = useCallback((): void => {
    onRecord(buildFamilySeed({ maternal, paternal }, t));
  }, [onRecord, maternal, paternal]);

  return (
    <Dialog
      testId="case-form-family-popup"
      title={t('case.form.family.popupTitle')}
      onCancel={onCancel}
      footer={
        <DialogFooter
          cancelTestId="case-form-record-family-cancel"
          confirmTestId="case-form-record-family-confirm"
          onCancel={onCancel}
          onConfirm={record}
        />
      }
    >
      <div
        role="tablist"
        aria-label={t('case.form.family.title')}
        className="mb-2 flex gap-1"
      >
        <button
          type="button"
          role="tab"
          data-testid="case-family-maternal"
          aria-selected={tab === 'maternal'}
          onClick={() => setTab('maternal')}
          className={tabClass(tab === 'maternal')}
        >
          {t('case.form.family.maternal')}
        </button>
        <button
          type="button"
          role="tab"
          data-testid="case-family-paternal"
          aria-selected={tab === 'paternal'}
          onClick={() => setTab('paternal')}
          className={tabClass(tab === 'paternal')}
        >
          {t('case.form.family.paternal')}
        </button>
      </div>
      <p className="mb-1 text-xs text-slate-500">
        {t('case.form.family.inputHint')}
      </p>
      {/* Both inputs stay mounted so switching tabs never loses the other side's
          text; the inactive one is visually hidden but kept in the DOM/payload. */}
      <label className={tab === 'maternal' ? 'flex flex-col gap-1' : 'hidden'}>
        <span className="sr-only">{t('case.form.family.maternalInput')}</span>
        <textarea
          data-testid="case-form-family-maternal-input"
          rows={4}
          value={maternal}
          onChange={(e) => setMaternal(e.target.value)}
          aria-label={t('case.form.family.maternalInput')}
          className="input"
        />
      </label>
      <label className={tab === 'paternal' ? 'flex flex-col gap-1' : 'hidden'}>
        <span className="sr-only">{t('case.form.family.paternalInput')}</span>
        <textarea
          data-testid="case-form-family-paternal-input"
          rows={4}
          value={paternal}
          onChange={(e) => setPaternal(e.target.value)}
          aria-label={t('case.form.family.paternalInput')}
          className="input"
        />
      </label>
    </Dialog>
  );
}

/** Record modalities: factor / aggravation / amelioration. */
function ModalitiesPopup({
  onCancel,
  onRecord,
}: {
  readonly onCancel: () => void;
  readonly onRecord: (seed: TableSeed) => void;
}): JSX.Element {
  const [factor, setFactor] = useState('');
  const [agg, setAgg] = useState('');
  const [amel, setAmel] = useState('');

  const record = useCallback((): void => {
    onRecord({
      hcTableType: 'modalities',
      columns: [
        t('case.form.modalities.factor'),
        t('case.form.modalities.agg'),
        t('case.form.modalities.amel'),
      ],
      rows: [[factor, agg, amel]],
    });
  }, [onRecord, factor, agg, amel]);

  return (
    <Dialog
      testId="case-form-modalities-popup"
      title={t('case.form.modalities.popupTitle')}
      onCancel={onCancel}
      footer={
        <DialogFooter
          cancelTestId="case-form-modalities-cancel"
          confirmTestId="case-form-modalities-confirm"
          onCancel={onCancel}
          onConfirm={record}
        />
      }
    >
      <div className="flex flex-col gap-2">
        <TextField
          testId="case-modalities-factor"
          label={t('case.form.modalities.factor')}
          value={factor}
          onChange={setFactor}
        />
        <TextField
          testId="case-modalities-agg"
          label={t('case.form.modalities.agg')}
          value={agg}
          onChange={setAgg}
        />
        <TextField
          testId="case-modalities-amel"
          label={t('case.form.modalities.amel')}
          value={amel}
          onChange={setAmel}
        />
      </div>
    </Dialog>
  );
}

/** Record physical generals: key/value rows. */
function GeneralsPopup({
  onCancel,
  onRecord,
}: {
  readonly onCancel: () => void;
  readonly onRecord: (seed: TableSeed) => void;
}): JSX.Element {
  const [appetite, setAppetite] = useState('');
  const [thirst, setThirst] = useState('');
  const [thermal, setThermal] = useState('');
  const [notes, setNotes] = useState('');

  const record = useCallback((): void => {
    const rows: string[][] = [];
    const push = (label: string, value: string): void => {
      if (value.trim() !== '') rows.push([label, value]);
    };
    push(t('case.form.generals.appetite'), appetite);
    push(t('case.form.generals.thirst'), thirst);
    push(t('case.form.generals.thermal'), thermal);
    push(t('case.form.generals.notes'), notes);
    if (rows.length === 0) rows.push(['', '']);
    onRecord({
      hcTableType: 'physical_generals',
      columns: [t('case.form.generals.field'), t('case.form.generals.value')],
      rows,
    });
  }, [onRecord, appetite, thirst, thermal, notes]);

  return (
    <Dialog
      testId="case-form-generals-popup"
      title={t('case.form.generals.popupTitle')}
      onCancel={onCancel}
      footer={
        <DialogFooter
          cancelTestId="case-form-record-generals-cancel"
          confirmTestId="case-form-record-generals-confirm"
          onCancel={onCancel}
          onConfirm={record}
        />
      }
    >
      <div className="flex flex-col gap-2">
        <TextField
          testId="case-generals-appetite"
          label={t('case.form.generals.appetite')}
          value={appetite}
          onChange={setAppetite}
        />
        <TextField
          testId="case-generals-thirst"
          label={t('case.form.generals.thirst')}
          value={thirst}
          onChange={setThirst}
        />
        <TextField
          testId="case-generals-thermal"
          label={t('case.form.generals.thermal')}
          value={thermal}
          onChange={setThermal}
        />
        <TextField
          testId="case-generals-notes"
          label={t('case.form.generals.notes')}
          value={notes}
          onChange={setNotes}
        />
      </div>
    </Dialog>
  );
}

/** Record investigations (in-document notes; the uploader is separate). */
function InvestigationsRecordPopup({
  onCancel,
  onRecord,
}: {
  readonly onCancel: () => void;
  readonly onRecord: (seed: TableSeed) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [statusValue, setStatusValue] = useState('');
  const [notes, setNotes] = useState('');

  const record = useCallback((): void => {
    onRecord({
      hcTableType: 'investigations',
      columns: [
        t('case.form.investigations.name'),
        t('case.form.investigations.status'),
        t('case.form.investigations.notes'),
      ],
      rows: [[name, statusValue, notes]],
    });
  }, [onRecord, name, statusValue, notes]);

  return (
    <Dialog
      testId="case-form-investigations-popup"
      title={t('case.form.investigations.popupTitle')}
      onCancel={onCancel}
      footer={
        <DialogFooter
          cancelTestId="case-form-record-investigations-cancel"
          confirmTestId="case-form-record-investigations-confirm"
          onCancel={onCancel}
          onConfirm={record}
        />
      }
    >
      <div className="flex flex-col gap-2">
        <TextField
          testId="case-investigations-name"
          label={t('case.form.investigations.name')}
          value={name}
          onChange={setName}
        />
        <TextField
          testId="case-investigations-status"
          label={t('case.form.investigations.status')}
          value={statusValue}
          onChange={setStatusValue}
        />
        <TextField
          testId="case-investigations-notes"
          label={t('case.form.investigations.notes')}
          value={notes}
          onChange={setNotes}
        />
      </div>
    </Dialog>
  );
}

/** Add prescription: inserts a labelled R4 PLACEHOLDER table (ADR 0019 #11). */
function PrescriptionPopup({
  onCancel,
  onRecord,
}: {
  readonly onCancel: () => void;
  readonly onRecord: (seed: TableSeed) => void;
}): JSX.Element {
  const [medicine, setMedicine] = useState('');
  const [potency, setPotency] = useState('');
  const [dosage, setDosage] = useState('');
  const [instructions, setInstructions] = useState('');

  const record = useCallback((): void => {
    onRecord(
      buildPrescriptionSeed({ medicine, potency, dosage, instructions }, t),
    );
  }, [onRecord, medicine, potency, dosage, instructions]);

  return (
    <Dialog
      testId="case-form-prescription-popup"
      title={t('case.form.prescription.popupTitle')}
      onCancel={onCancel}
      footer={
        <DialogFooter
          cancelTestId="case-form-add-prescription-cancel"
          confirmTestId="case-form-add-prescription-confirm"
          onCancel={onCancel}
          onConfirm={record}
        />
      }
    >
      <p className="mb-2 rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
        {t('case.form.rxPlaceholderHint')}
      </p>
      <div className="flex flex-col gap-2">
        <TextField
          testId="case-rx-medicine"
          label={t('case.form.prescription.medicine')}
          value={medicine}
          onChange={setMedicine}
        />
        <TextField
          testId="case-rx-potency"
          label={t('case.form.prescription.potency')}
          value={potency}
          onChange={setPotency}
        />
        <TextField
          testId="case-rx-dosage"
          label={t('case.form.prescription.dosage')}
          value={dosage}
          onChange={setDosage}
        />
        <TextField
          testId="case-rx-instructions"
          label={t('case.form.prescription.instructions')}
          value={instructions}
          onChange={setInstructions}
        />
      </div>
    </Dialog>
  );
}

/** Shared tab button styling. */
function tabClass(active: boolean): string {
  return [
    'rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600',
    active ? 'bg-blue-600 text-white' : 'border border-slate-300',
  ].join(' ');
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

/** Whether a mime is an image (drives the type badge + thumbnail preview). */
function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

/** Resolve a user-facing message for a thrown attachment error (R-UI-008). */
function attachmentErrorMessage(err: unknown): string {
  if (isUserFacingError(err)) return err.message;
  return t('case.form.investigations.error.generic');
}

/**
 * Investigations lab-report attachments (PAT-009), a SIDE control (ADR 0019
 * #11). Lets the doctor attach PDFs / images, list them, open one for in-app
 * preview and remove one behind a confirm. Calls ONLY the generated typed
 * bindings; the UI never constructs a filesystem path. No patient data, path or
 * stack trace is surfaced (R-PRIV-001, R-UI-008).
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
