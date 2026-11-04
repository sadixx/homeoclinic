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
  buildInvestigationLinkRow,
  buildPrescriptionSeed,
  buildVitalsSeed,
  parseCaseDoc,
  removeComplaint,
  removeEntry,
  sanitizeDisplayLabel,
  sectionLabelFor,
  serializeRich,
  type ProseMirrorNode,
  type RichTableType,
  type TableSeed,
  type V3Doc,
} from '@/case/caseRich';
import {
  appendInvestigationLink,
  appendOrCreateTable,
  caseEditorExtensions,
  caseStructure,
  currentComplaintName,
  editorSpine,
  initialContent,
  insertComplaint,
  insertDatedEntry,
  focusTableRow,
  parkCaretForRowDelete,
  removeTableRowAt,
  selectionIsOnComplaintHeading,
  setEditorSpine,
  tableRowPos,
  unlinkInvestigationRow,
  v3DocFromEditor,
  type ComplaintStructure,
  type RowDeleteOptions,
} from '@/case/caseRichEditor';
import { isUserFacingError, run } from '@/shared/command';
import { formatDate, formatDateTime, todayIsoDate } from '@/shared/datetime';
import { t } from '@/shared/strings';
import type { StringKey } from '@/shared/strings';
import { NextFollowupControl } from '@/case/NextFollowupControl';

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

  // C6 (M3-RWv4 §6): the live complaint/entry structure, derived from the
  // editor doc, so a focusable remove (x) control renders per complaint + per
  // entry WITHOUT being an editable doc node. Refreshed on load + editor update.
  const [structure, setStructure] = useState<{
    complaints: ComplaintStructure[];
    entries: { complaintId: string; entryIndex: number }[];
  }>({ complaints: [], entries: [] });
  // The pending remove confirmation (complaint or entry), or null.
  const [removeTarget, setRemoveTarget] = useState<
    | null
    | { kind: 'complaint'; complaintId: string }
    | { kind: 'entry'; complaintId: string; entryIndex: number }
  >(null);
  // D5: the pending UNLINK confirmation (an attachment id), or null.
  const [unlinkTarget, setUnlinkTarget] = useState<string | null>(null);
  // D5: the investigation link rows in the live doc (attachmentId + label), so
  // a focusable UNLINK control renders per link row.
  const [linkRows, setLinkRows] = useState<
    { attachmentId: string; label: string }[]
  >([]);
  // M3-RWv6 item 4: the report opened in one click from its link row.
  const [linkPreview, setLinkPreview] = useState<AttachmentPreview | null>(
    null,
  );
  const [linkOpenError, setLinkOpenError] = useState<string | null>(null);
  // M3-RWv6 item 6 / M3ux: the pending row-delete confirmation, set by the
  // inline minus control on a table's data row.
  const [rowDeleteTarget, setRowDeleteTarget] = useState<{
    readonly tableNo: number;
    readonly rowIndex: number;
  } | null>(null);
  // DEFECT 1 (M3-RWv4 build-12): is the caret on a complaint heading? When true
  // the bullet/ordered toolbar buttons are disabled (and the toggles no-op) so a
  // complaint heading can NEVER be wrapped into a list item and lost.
  const [listGuarded, setListGuarded] = useState(false);

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

  // Ctrl+S / Cmd+S = the Save button (CASE-005, HC-MVP1-M3vis): an immediate
  // force-save of the newest in-editor content, from anywhere while the case
  // form is mounted (prose, a table cell, the header, or nothing focused). A
  // window CAPTURE listener runs before ProseMirror's keymaps and any element
  // handler, so the webview's own "save page" default is always suppressed.
  // It matches only Mod+S without Alt (Caps Lock gives key "S"), so the table
  // keymaps (Tab, Ctrl+Shift+Backspace row delete) are untouched. Removed on
  // unmount so a closed visit is never saved into.
  //
  // Layouts: `key` is "s"/"S" on Latin layouts. On a non-Latin layout (e.g.
  // Hindi InScript, Marathi) `key` is the layout's own character, so the
  // physical key (`code === 'KeyS'`) is matched instead, but only when `key`
  // is not a Latin letter, so Ctrl+O on Dvorak (physical KeyS) is not Save.
  // An auto-repeat (key held down) is swallowed but does not save again, so
  // holding the chord never bursts autosave writes (one audit row each).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return;
      const key = e.key.toLowerCase();
      const isSave = key === 's' || (e.code === 'KeyS' && !/^[a-z]$/.test(key));
      if (!isSave) return;
      e.preventDefault();
      if (e.repeat) return;
      void flushSave();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [flushSave]);

  const scheduleSave = useCallback((): void => {
    setStatus({ kind: 'saving' });
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flushSave]);

  // C6: recompute the complaint/entry structure from the live editor doc so the
  // remove-control overlay stays in sync after any edit (add/remove/typing).
  const refreshStructure = useCallback((): void => {
    const ed = editorRef.current;
    if (ed === null) return;
    setStructure(caseStructure(ed));
    setLinkRows(collectLinkRows(editorSpine(ed)));
    setListGuarded(selectionIsOnComplaintHeading(ed));
  }, []);

  // ---- Editor --------------------------------------------------------------

  const editor = useEditor(
    {
      extensions: caseEditorExtensions(rowDeleteOptions(setRowDeleteTarget)),
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
      onCreate: () => {
        refreshStructure();
      },
      onUpdate: () => {
        scheduleSave();
        refreshStructure();
      },
      // DEFECT 1 (M3-RWv4 build-12): a plain caret move (no doc change) does not
      // fire onUpdate, so track the complaint-heading guard here too — the list
      // toolbar must disable the instant the caret lands on a complaint heading.
      onSelectionUpdate: ({ editor: ed }) => {
        setListGuarded(selectionIsOnComplaintHeading(ed));
      },
      onBlur: () => {
        void flushSave();
      },
    },
    [doc !== null],
  );
  // M3-RWv6 flake fix: useEditor swaps the pre-load (empty) instance for the
  // loaded one in a passive effect AFTER the commit that first sees `doc`. If
  // the scheduler yields in between, that commit would show a live form backed
  // by the EMPTY editor, so a click/blur there would save an empty case over
  // the real one. Remember the pre-load instance and treat it as not ready.
  const preloadEditorRef = useRef<Editor | null>(null);
  if (doc === null) preloadEditorRef.current = editor;
  const editorStale =
    doc !== null && editor !== null && editor === preloadEditorRef.current;
  editorRef.current = editorStale ? null : editor;

  // Populate the remove-control structure once the editor mounts (onCreate may
  // fire before editorRef is assigned on the first render).
  useEffect(() => {
    if (editor !== null) {
      setStructure(caseStructure(editor));
      setLinkRows(collectLinkRows(editorSpine(editor)));
    }
  }, [editor]);

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

  /**
   * Record a seeded table into the caret's entry (M3-RWv5 A): ONE table per
   * type per entry — the first Record of a kind in the entry creates the
   * section (rule + bullet heading + table), later Records append rows to it.
   */
  const insertSection = useCallback(
    (kind: RichTableType, seed: TableSeed): void => {
      const ed = editorRef.current;
      if (ed === null) return;
      appendOrCreateTable(ed, kind, seed);
      void flushSave();
    },
    [flushSave],
  );

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
    // M3-RWv5 C: a fresh case's first complaint appears only once it is named,
    // so an unnamed "Add new complaint" there just points at the name field.
    if (
      name === '' &&
      !caseStructure(ed).complaints.some((c) => c.name !== '')
    ) {
      complaintTitleInputRef.current?.focus();
      return;
    }
    insertComplaint(ed, { name, date: todayIsoDate(), visitId });
    // b15-r1-f1 (M3-RWv5 build-15): naming the leading complaint re-sets the doc
    // via setEditorSpine (TipTap setContent, emitUpdate=false), so onUpdate never
    // fires. Refresh the derived structure explicitly, so the empty prompt hides
    // and the remove (x) overlay appears without waiting for another edit. The
    // append path does emit onUpdate. Refreshing again there is idempotent.
    refreshStructure();
    // The complaint name has been consumed into its own section header; clear
    // the shared input so the next complaint starts blank (M3-RWv3 §5).
    complaintTitleRef.current = '';
    if (complaintTitleInputRef.current !== null) {
      complaintTitleInputRef.current.value = '';
    }
    void flushSave();
  }, [visitId, flushSave, refreshStructure]);

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

  // Modalities follows the same one-table-per-entry rule as every other kind
  // (M3-RWv4 §4, generalised by M3-RWv5 A).
  const onRecordModalities = useCallback(
    (seed: TableSeed): void => {
      insertSection('modalities', seed);
      setPopup(null);
    },
    [insertSection],
  );

  // A3 (M3-RWv4 §3): Word-style list toggles over the current selection.
  // DEFECT 1 (M3-RWv4 build-12, DATA LOSS): the toggle wraps the node under the
  // caret into a list item. If the caret is on the complaint heading, TipTap
  // would wrap the HEADING into a listItem and splitSpineToComplaints then loses
  // the whole complaint section. The toggles therefore NO-OP when the selection
  // is on a complaint heading (the toolbar buttons are also disabled); lists
  // still work inside entry body text.
  const onToggleBullet = useCallback((): void => {
    const ed = editorRef.current;
    if (ed === null) return;
    if (selectionIsOnComplaintHeading(ed)) return;
    ed.chain().focus().toggleBulletList().run();
    void flushSave();
  }, [flushSave]);

  const onToggleOrdered = useCallback((): void => {
    const ed = editorRef.current;
    if (ed === null) return;
    if (selectionIsOnComplaintHeading(ed)) return;
    ed.chain().focus().toggleOrderedList().run();
    void flushSave();
  }, [flushSave]);

  // C6 (M3-RWv4 §6): confirmed removal of a complaint section or an entry. The
  // removal is a PURE spine transform (removeComplaint/removeEntry) applied to
  // the live editor doc, then the whole document is re-set and autosaved. The
  // editor never drops below one complaint (the pure helper's fallback).
  const onConfirmRemove = useCallback((): void => {
    const ed = editorRef.current;
    const target = removeTarget;
    if (ed === null || target === null) return;
    const spine = editorSpine(ed);
    const next =
      target.kind === 'complaint'
        ? removeComplaint(spine, target.complaintId)
        : removeEntry(spine, target.complaintId, target.entryIndex);
    setEditorSpine(ed, next);
    setRemoveTarget(null);
    // setContent does not emit onUpdate: refresh the derived structure here.
    refreshStructure();
    void flushSave();
  }, [removeTarget, flushSave, refreshStructure]);

  // D5 (M3-RWv4 §5.6): confirmed UNLINK — drop the investigation link row
  // (data_json edit) WITHOUT deleting the attachment file.
  const onConfirmUnlink = useCallback((): void => {
    const ed = editorRef.current;
    const attachmentId = unlinkTarget;
    if (ed === null || attachmentId === null) return;
    const next = unlinkInvestigationRow(ed, attachmentId);
    setEditorSpine(ed, next);
    setUnlinkTarget(null);
    // setContent does not emit onUpdate: refresh the derived structure here.
    refreshStructure();
    void flushSave();
  }, [unlinkTarget, flushSave, refreshStructure]);

  // M3-RWv6 item 6: confirmed delete of one data row of an inserted table, as
  // ONE editor transaction at the row's REAL ProseMirror position. Deleting the
  // last data row removes the table with its section heading and rule.
  const onConfirmRowDelete = useCallback((): void => {
    const ed = editorRef.current;
    const target = rowDeleteTarget;
    if (ed === null || target === null) return;
    setRowDeleteTarget(null);
    const pos = tableRowPos(ed, target.tableNo, target.rowIndex);
    if (pos === null) {
      focusTableRow(ed, target.tableNo, target.rowIndex);
      return;
    }
    // rowdelete-2: park the caret where the keyboard user lands afterwards
    // (the next row moves up into this place, else the previous row, else the
    // text after a removed table); the delete maps it. Then focus the editor
    // so focus never falls to <body> when the dialog closes.
    parkCaretForRowDelete(ed, target.tableNo, target.rowIndex);
    const deleted = removeTableRowAt(ed, pos);
    ed.view.focus();
    if (!deleted) return;
    refreshStructure();
    void flushSave();
  }, [rowDeleteTarget, flushSave, refreshStructure]);

  // rowdelete-2: cancel returns keyboard focus to the editor in the row the
  // confirm was opened for, so a keyboard user is never left on <body>.
  const onCancelRowDelete = useCallback((): void => {
    const ed = editorRef.current;
    const target = rowDeleteTarget;
    setRowDeleteTarget(null);
    if (ed === null || target === null) return;
    focusTableRow(ed, target.tableNo, target.rowIndex);
  }, [rowDeleteTarget]);

  // M3-RWv6 item 4: one click on a link row opens that report in the same
  // in-app preview as the Lab reports panel (typed command only, no path).
  const onOpenLinkedReport = useCallback(
    async (attachmentId: string): Promise<void> => {
      setLinkOpenError(null);
      try {
        const res = await run(commands.visitOpenAttachment({ attachmentId }));
        setLinkPreview({
          url: `data:${res.mime};base64,${res.dataBase64}`,
          name: res.originalName ?? '',
          isImage: isImageMime(res.mime),
        });
      } catch (e) {
        setLinkOpenError(attachmentErrorMessage(e));
      }
    },
    [],
  );

  // D5 (M3-RWv4 §5.2a/§5.5): a Submitted UPLOAD — pick a file, attach it with a
  // composed display-ONLY label `<investigation>-<date>` (patient name is set
  // backend-side so the UI does not shuttle PII; the label is sanitised and
  // NEVER logged — R-PRIV-001/007), then write a link row into the
  // investigations table (data_json edit) and autosave.
  const onSubmitUpload = useCallback(
    async (investigationName: string): Promise<void> => {
      const ed = editorRef.current;
      if (ed === null) return;
      try {
        const picked = await run(commands.visitPickReportFile());
        if (picked.sourcePath === null) return;
        const displayLabel = sanitizeDisplayLabel(
          investigationName,
          '',
          formatDate(todayIsoDate()) ?? todayIsoDate(),
        );
        const attached = await run(
          commands.visitAttachReport({
            visitId,
            sourcePath: picked.sourcePath,
            caption: null,
            displayLabel,
          }),
        );
        linkAttachmentRow(ed, attached.attachmentId, displayLabel);
        // DEFECT 2 (M3-RWv4 build-12): linkAttachmentRow re-sets the document via
        // setEditorSpine (setContent), which does NOT emit onUpdate — so without
        // this explicit refresh the new link row is in the doc but the
        // `case-form-investigation-links` panel (driven by `linkRows` state)
        // never renders and the E2E 30s-waits for it time out. Refresh the
        // derived structure + link rows now (same pattern as unlink/remove).
        refreshStructure();
        setPopup(null);
        void flushSave();
      } catch {
        setPopup(null);
      }
    },
    [visitId, flushSave, refreshStructure],
  );

  // D5 (M3-RWv4 §5.2b): link an ALREADY-uploaded patient attachment.
  const onSubmitPick = useCallback(
    (attachmentId: string, label: string): void => {
      const ed = editorRef.current;
      if (ed === null) return;
      linkAttachmentRow(ed, attachmentId, label);
      // DEFECT 2 (see onSubmitUpload): refresh the derived link-row state so the
      // newly-linked row renders without waiting for an unrelated editor update.
      refreshStructure();
      setPopup(null);
      void flushSave();
    },
    [flushSave, refreshStructure],
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

  // Keep the loading state until the editor holding the loaded case exists.
  if (doc === null || editorStale) {
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
        visitId={visitId}
        nextFollowupOn={nextFollowupOn}
        onNextFollowupSaved={setNextFollowupOn}
        onForceSave={() => void flushSave()}
        {...(onBack !== undefined ? { onBack } : {})}
      />

      <div className="flex min-h-0 flex-1">
        {/* Centre: the active complaint's ONE rich editor + record toolbar. */}
        <div
          data-testid="case-form-content"
          data-adaptive="true"
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4"
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
            {/* The two complaint/entry actions (M3-RWv4 §2): "Add follow-up
                entry" and "Add new complaint". The legacy "Add new entry" was
                removed (RWv4 A2) — every complaint's initial entry is created by
                "Add new complaint"; later visits are follow-up entries. */}
            <div className="flex flex-none flex-wrap gap-2">
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

          {/* M3-RWv5 C: a fresh case shows no "Untitled complaint" sample;
              this prompt asks for the name, and the first complaint header
              appears once it is named via Add new complaint. */}
          {structure.complaints.every((c) => c.name === '') ? (
            <p
              data-testid="case-form-complaint-empty-prompt"
              role="note"
              className="mb-2 rounded bg-slate-50 px-3 py-1.5 text-sm text-slate-700"
            >
              {t('case.form.complaint.emptyPrompt')}
            </p>
          ) : null}

          {/* A3 (M3-RWv4 §3): Word-style list formatting toolbar, fixed above
              the bounded editor. Bullet + ordered toggles reflect the active
              list via aria-pressed. Keyboard-focusable + labelled. */}
          <FormatToolbar
            onBullet={onToggleBullet}
            onOrdered={onToggleOrdered}
            bulletActive={editor?.isActive('bulletList') ?? false}
            orderedActive={editor?.isActive('orderedList') ?? false}
            guarded={listGuarded}
          />

          {/* C6 (M3-RWv4 §6): a focusable remove (x) control per complaint and
              per entry, rendered as a React overlay keyed to the live editor
              structure (NOT an editable doc node). Each opens a confirm dialog. */}
          <RemoveControls
            structure={structure}
            onRemoveComplaint={(complaintId) =>
              setRemoveTarget({ kind: 'complaint', complaintId })
            }
            onRemoveEntry={(complaintId, entryIndex) =>
              setRemoveTarget({ kind: 'entry', complaintId, entryIndex })
            }
          />

          {/* D5 (M3-RWv4 §5.6): an UNLINK control per linked report row — a
              data_json edit only (the file stays), separate from Delete file. */}
          {linkRows.length > 0 ? (
            <ul
              data-testid="case-form-investigation-links"
              className="mb-2 flex flex-col gap-1"
            >
              {linkRows.map((lr, index) => {
                const n = index + 1;
                return (
                  <li
                    key={`${lr.attachmentId}-${n}`}
                    className="flex items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1 text-sm"
                  >
                    <span className="min-w-0 truncate">{lr.label}</span>
                    <span className="flex flex-none items-center gap-2">
                      <button
                        type="button"
                        data-testid={`case-form-investigation-open-${n}`}
                        aria-label={`${t('case.form.investigations.open')}: ${lr.label}`}
                        onClick={() => void onOpenLinkedReport(lr.attachmentId)}
                        className="rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        {t('case.form.investigations.open')}
                      </button>
                      <button
                        type="button"
                        data-testid={`case-form-investigation-unlink-${n}`}
                        onClick={() => setUnlinkTarget(lr.attachmentId)}
                        className="rounded border border-slate-300 px-2 py-0.5 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        {t('case.form.investigations.unlink')}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {linkOpenError !== null ? (
            <p
              role="alert"
              data-testid="case-form-investigation-open-error"
              className="mb-2 text-sm text-red-700"
            >
              {linkOpenError}
            </p>
          ) : null}

          {/* The single WYSIWYG notepad. A7 (M3-RWv4 §7): the editor is a
              BOUNDED, internally-scrolling region — `flex-1 min-h-0
              overflow-y-auto` inside the `flex h-full min-h-0 flex-col` content
              column — so a long document scrolls WITHIN this box instead of
              growing the column and overwriting the record toolbar / panel
              below. Zoom is app-level (document-root font-size). */}
          <div
            data-testid={`case-form-editor-${complaintId}`}
            className="w-full flex-1 min-h-0 overflow-y-auto rounded border border-slate-200 p-3"
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
            onRecordModalities(seed);
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
          patientId={patientId}
          onCancel={() => setPopup(null)}
          onRecord={(seed) => {
            onRecordGenericSeed('investigations', seed);
          }}
          onSubmitUpload={(name) => {
            void onSubmitUpload(name);
          }}
          onSubmitPick={(attachmentId, label) => {
            onSubmitPick(attachmentId, label);
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

      {/* C6 (M3-RWv4 §6): the shared remove confirm dialog (complaint or entry).
          Escape cancels; the confirm drops the nodes + renumbers. */}
      {removeTarget !== null ? (
        <ConfirmDialog
          testId="case-form-remove-dialog"
          title={
            removeTarget.kind === 'complaint'
              ? t('case.form.remove.complaint.title')
              : t('case.form.remove.entry.title')
          }
          body={
            removeTarget.kind === 'complaint'
              ? t('case.form.remove.complaint.body')
              : t('case.form.remove.entry.body')
          }
          confirmLabel={t('case.form.remove.confirm')}
          cancelLabel={t('case.form.remove.cancel')}
          cancelTestId="case-form-remove-cancel"
          confirmTestId="case-form-remove-confirm"
          onCancel={() => setRemoveTarget(null)}
          onConfirm={onConfirmRemove}
        />
      ) : null}

      {/* M3-RWv6 item 6: the row-delete confirm. Escape cancels. */}
      {rowDeleteTarget !== null ? (
        <ConfirmDialog
          testId="case-form-table-row-delete-dialog"
          title={t('case.form.tableRow.delete.title')}
          body={t('case.form.tableRow.delete.body')}
          confirmLabel={t('case.form.tableRow.delete.confirm')}
          cancelLabel={t('case.form.tableRow.delete.cancel')}
          cancelTestId="case-form-table-row-delete-cancel"
          confirmTestId="case-form-table-row-delete-confirm"
          onCancel={onCancelRowDelete}
          onConfirm={onConfirmRowDelete}
        />
      ) : null}

      {/* M3-RWv6 item 4: preview of a report opened from its link row. */}
      {linkPreview !== null ? (
        <AttachmentPreviewDialog
          testId="case-form-investigation-preview"
          preview={linkPreview}
          onClose={() => setLinkPreview(null)}
        />
      ) : null}

      {/* D5 (M3-RWv4 §5.6): the UNLINK confirm dialog — removes the link row
          only; the attachment file is NOT deleted. */}
      {unlinkTarget !== null ? (
        <ConfirmDialog
          testId="case-form-investigation-unlink-dialog"
          title={t('case.form.investigations.unlink.title')}
          body={t('case.form.investigations.unlink.body')}
          confirmLabel={t('case.form.investigations.unlink.confirm')}
          cancelLabel={t('case.form.investigations.unlink.cancel')}
          cancelTestId="case-form-investigation-unlink-cancel"
          confirmTestId="case-form-investigation-unlink-confirm"
          onCancel={() => setUnlinkTarget(null)}
          onConfirm={onConfirmUnlink}
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

/**
 * A3 (M3-RWv4 §3): the Word-style list formatting toolbar. Bullet + ordered
 * toggles reflect the active list (aria-pressed). `role="toolbar"`, labelled,
 * keyboard-focusable. Presentation/editing only — no network, no CSP impact.
 *
 * DEFECT 1 (M3-RWv4 build-12, DATA LOSS): when `guarded` (the caret is on a
 * complaint heading) both buttons are DISABLED (`disabled` + `aria-disabled`)
 * so a complaint heading can never be wrapped into a list item and lost. The
 * buttons re-enable the moment the caret moves into entry body text.
 */
function FormatToolbar({
  onBullet,
  onOrdered,
  bulletActive,
  orderedActive,
  guarded,
}: {
  readonly onBullet: () => void;
  readonly onOrdered: () => void;
  readonly bulletActive: boolean;
  readonly orderedActive: boolean;
  readonly guarded: boolean;
}): JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label={t('case.form.format.toolbar')}
      data-testid="case-form-format-toolbar"
      className="mb-2 flex flex-none gap-1 border-b border-slate-200 pb-2"
    >
      <button
        type="button"
        data-testid="case-form-format-bullet"
        aria-pressed={bulletActive}
        aria-disabled={guarded}
        disabled={guarded}
        aria-label={t('case.form.format.bullet')}
        title={
          guarded
            ? t('case.form.format.listGuardTitle')
            : t('case.form.format.bullet')
        }
        onClick={guarded ? undefined : onBullet}
        className={[
          'rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600',
          guarded
            ? 'cursor-not-allowed border-slate-200 text-slate-400'
            : bulletActive
              ? 'border-blue-600 bg-blue-50 text-blue-700'
              : 'border-slate-300 hover:bg-slate-100',
        ].join(' ')}
      >
        {t('case.form.format.bullet')}
      </button>
      <button
        type="button"
        data-testid="case-form-format-ordered"
        aria-pressed={orderedActive}
        aria-disabled={guarded}
        disabled={guarded}
        aria-label={t('case.form.format.ordered')}
        title={
          guarded
            ? t('case.form.format.listGuardTitle')
            : t('case.form.format.ordered')
        }
        onClick={guarded ? undefined : onOrdered}
        className={[
          'rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600',
          guarded
            ? 'cursor-not-allowed border-slate-200 text-slate-400'
            : orderedActive
              ? 'border-blue-600 bg-blue-50 text-blue-700'
              : 'border-slate-300 hover:bg-slate-100',
        ].join(' ')}
      >
        {t('case.form.format.ordered')}
      </button>
    </div>
  );
}

/**
 * C6 (M3-RWv4 §6): the remove (x) controls overlay — a focusable control per
 * complaint and per entry, derived from the live editor structure. Each opens
 * the shared confirm dialog; the actual removal is a pure spine transform. The
 * controls are a React overlay (NOT editable doc nodes) so they can never be
 * typed into or serialised.
 */
function RemoveControls({
  structure,
  onRemoveComplaint,
  onRemoveEntry,
}: {
  readonly structure: {
    complaints: ComplaintStructure[];
    entries: { complaintId: string; entryIndex: number }[];
  };
  readonly onRemoveComplaint: (complaintId: string) => void;
  readonly onRemoveEntry: (complaintId: string, entryIndex: number) => void;
}): JSX.Element {
  return (
    <div
      data-testid="case-form-remove-controls"
      className="mb-2 flex flex-none flex-wrap gap-2 text-xs"
    >
      {structure.complaints.map((c) => (
        <button
          key={c.complaintId}
          type="button"
          data-testid={`case-form-complaint-remove-${c.complaintId}`}
          aria-label={`${t('case.form.complaint.remove')}: ${c.name}`}
          title={t('case.form.complaint.remove')}
          onClick={() => onRemoveComplaint(c.complaintId)}
          className="rounded border border-slate-300 px-2 py-0.5 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          {t('case.form.remove.icon')}{' '}
          {c.name === '' ? t('case.form.complaint.remove') : c.name}
        </button>
      ))}
      {structure.entries.map((e, index) => {
        const n = index + 1;
        return (
          <button
            key={`${e.complaintId}-${e.entryIndex}-${n}`}
            type="button"
            data-testid={`case-form-entry-remove-${n}`}
            aria-label={t('case.form.entry.remove')}
            title={t('case.form.entry.remove')}
            onClick={() => onRemoveEntry(e.complaintId, e.entryIndex)}
            className="rounded border border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('case.form.remove.icon')} {n}
          </button>
        );
      })}
    </div>
  );
}

/**
 * M3ux: the inline row-delete control wiring. Each DATA row of every inserted
 * table carries a minus button (a ProseMirror widget, never doc content) named
 * "Delete row <r> of <table>"; activating it opens the row-delete confirm.
 */
function rowDeleteOptions(
  onTarget: (target: { tableNo: number; rowIndex: number }) => void,
): RowDeleteOptions {
  return {
    glyph: t('case.form.tableRow.minus'),
    label: (rowNo, kind) => rowDeleteLabel(rowNo, kind),
    title: (rowNo, kind) =>
      t('case.form.tableRow.deleteTitle')
        .replace('{label}', rowDeleteLabel(rowNo, kind))
        .replace('{shortcut}', t('case.form.tableRow.deleteShortcut')),
    onDelete: (tableNo, rowNo) => onTarget({ tableNo, rowIndex: rowNo }),
  };
}

/** "Delete row <r> of <table>" for data row `rowNo` of a `kind` table. */
function rowDeleteLabel(rowNo: number, kind: string | null): string {
  return t('case.form.tableRow.deleteLabel')
    .replace('{row}', String(rowNo))
    .replace('{table}', sectionLabelFor(kind));
}

/**
 * A shared accessible confirm dialog (role=dialog, aria-modal, Escape cancels,
 * focus-trapped via the shared {@link Dialog} shell). Used by C6 removal and D5
 * unlink.
 */
function ConfirmDialog({
  testId,
  title,
  body,
  confirmLabel,
  cancelLabel,
  cancelTestId,
  confirmTestId,
  onCancel,
  onConfirm,
}: {
  readonly testId: string;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly cancelTestId: string;
  readonly confirmTestId: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): JSX.Element {
  return (
    <Dialog
      testId={testId}
      title={title}
      onCancel={onCancel}
      width="26rem"
      footer={
        <>
          <button
            type="button"
            data-testid={cancelTestId}
            onClick={onCancel}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid={confirmTestId}
            onClick={onConfirm}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-red-700"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-xs text-slate-600">{body}</p>
    </Dialog>
  );
}

/**
 * Collect the investigation LINK rows from the live doc (M3-RWv4 §5.6): each
 * `tableRow` carrying `attrs.hcInvestigationLink.attachmentId`, paired with the
 * first cell's text as a display label for the UNLINK control.
 */
function collectLinkRows(
  root: ProseMirrorNode,
): { attachmentId: string; label: string }[] {
  const out: { attachmentId: string; label: string }[] = [];
  const walk = (n: ProseMirrorNode): void => {
    const link = n.attrs?.['hcInvestigationLink'] as
      | { attachmentId?: string }
      | null
      | undefined;
    if (
      n.type === 'tableRow' &&
      link != null &&
      typeof link.attachmentId === 'string'
    ) {
      const label = cellText(n);
      out.push({ attachmentId: link.attachmentId, label });
    }
    for (const c of n.content ?? []) walk(c);
  };
  walk(root);
  return out;
}

/** The concatenated text of a node (first-cell display label for a link row). */
function cellText(node: ProseMirrorNode): string {
  let s =
    node.type === 'text' && typeof node.text === 'string' ? node.text : '';
  for (const c of node.content ?? []) s += cellText(c);
  return s;
}

/** Top header: next F/U display + scheduler (VIS-004), Save + status. */
function HeaderBar({
  status,
  visitId,
  nextFollowupOn,
  onNextFollowupSaved,
  onForceSave,
  onBack,
}: {
  readonly status: SaveStatus;
  readonly visitId: string;
  readonly nextFollowupOn: string | null;
  readonly onNextFollowupSaved: (next: string | null) => void;
  readonly onForceSave: () => void;
  readonly onBack?: () => void;
}): JSX.Element {
  const nextText =
    nextFollowupOn !== null && formatDate(nextFollowupOn) !== null
      ? `${t('case.form.nextFollowup.prefix')} ${formatDate(nextFollowupOn)}`
      : t('case.form.nextFollowup.none');
  return (
    // Wraps (the scheduler drops under the F/U text) rather than scrolling
    // sideways when the window is narrower than 1366x768 needs.
    <header className="flex flex-none flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-200 px-4 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
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
          className="whitespace-nowrap text-sm text-slate-700"
        >
          {nextText}
        </span>
        <NextFollowupControl
          key={visitId}
          visitId={visitId}
          value={nextFollowupOn}
          onSaved={onNextFollowupSaved}
        />
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

/**
 * D5 (M3-RWv4 §5.3): append an investigation LINK row referencing `attachmentId`
 * (cells = the display label + "Submitted" status) to the current entry's
 * investigations table, creating that table if the entry has none yet, then
 * re-set the editor document. A `data_json` edit only — the attachment is
 * untouched.
 */
function linkAttachmentRow(
  editor: Editor,
  attachmentId: string,
  label: string,
): void {
  const submitted = t('case.form.investigations.status.submitted');
  const linkRow = buildInvestigationLinkRow({
    attachmentId,
    cells: [label, submitted],
  });
  const createTable = (): ProseMirrorNode[] => {
    const header: ProseMirrorNode = {
      type: 'tableRow',
      content: [
        t('case.form.investigations.name'),
        t('case.form.investigations.status'),
      ].map((h) => ({
        type: 'tableHeader',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: h }] }],
      })),
    };
    const table: ProseMirrorNode = {
      type: 'table',
      attrs: { hcTableType: 'investigations' },
      content: [header, linkRow],
    };
    return [{ type: 'horizontalRule' }, table];
  };
  const next = appendInvestigationLink(editor, linkRow, createTable);
  setEditorSpine(editor, next);
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

/**
 * Physical generals popup fields (M3-RWv6 item 8), exactly and in this order.
 * `yesNo` fields are a Yes/No select; every other field is free text.
 */
const GENERALS_FIELDS: ReadonlyArray<{
  readonly id: string;
  readonly label: StringKey;
  readonly yesNo?: true;
}> = [
  { id: 'appetite', label: 'case.form.generals.appetite' },
  { id: 'thirst', label: 'case.form.generals.thirst' },
  { id: 'thermal', label: 'case.form.generals.thermal' },
  { id: 'constitution', label: 'case.form.generals.constitution' },
  { id: 'diet', label: 'case.form.generals.diet' },
  { id: 'cravings', label: 'case.form.generals.cravings' },
  { id: 'aversions', label: 'case.form.generals.aversions' },
  { id: 'urine', label: 'case.form.generals.urine' },
  { id: 'stool', label: 'case.form.generals.stool' },
  { id: 'perspiration', label: 'case.form.generals.perspiration' },
  {
    id: 'sun-aggravation',
    label: 'case.form.generals.sunAggravation',
    yesNo: true,
  },
  { id: 'sleep', label: 'case.form.generals.sleep' },
  { id: 'dreams', label: 'case.form.generals.dreams' },
  { id: 'sleep-position', label: 'case.form.generals.sleepPosition' },
];

/** Record physical generals: one Field|Value row per filled field. */
function GeneralsPopup({
  onCancel,
  onRecord,
}: {
  readonly onCancel: () => void;
  readonly onRecord: (seed: TableSeed) => void;
}): JSX.Element {
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});

  const setValue = useCallback((id: string, value: string): void => {
    setValues((prev) => ({ ...prev, [id]: value }));
  }, []);

  const record = useCallback((): void => {
    const rows: string[][] = [];
    for (const f of GENERALS_FIELDS) {
      const value = values[f.id] ?? '';
      if (value.trim() !== '') rows.push([t(f.label), value]);
    }
    if (rows.length === 0) rows.push(['', '']);
    onRecord({
      hcTableType: 'physical_generals',
      columns: [t('case.form.generals.field'), t('case.form.generals.value')],
      rows,
    });
  }, [onRecord, values]);

  return (
    <Dialog
      testId="case-form-generals-popup"
      title={t('case.form.generals.popupTitle')}
      onCancel={onCancel}
      width="40rem"
      footer={
        <DialogFooter
          cancelTestId="case-form-record-generals-cancel"
          confirmTestId="case-form-record-generals-confirm"
          onCancel={onCancel}
          onConfirm={record}
        />
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {GENERALS_FIELDS.map((f) =>
          f.yesNo === true ? (
            <YesNoField
              key={f.id}
              testId={`case-generals-${f.id}`}
              label={t(f.label)}
              value={values[f.id] ?? ''}
              onChange={(v) => setValue(f.id, v)}
            />
          ) : (
            <TextField
              key={f.id}
              testId={`case-generals-${f.id}`}
              label={t(f.label)}
              value={values[f.id] ?? ''}
              onChange={(v) => setValue(f.id, v)}
            />
          ),
        )}
      </div>
    </Dialog>
  );
}

/**
 * A labelled Yes/No select used inside popups (M3-RWv6 item 8). The stored
 * value is the visible Yes / No text; '' means not recorded.
 */
function YesNoField({
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
  const yes = t('case.form.generals.yes');
  const no = t('case.form.generals.no');
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="input"
      >
        <option value="">{t('case.form.generals.notRecorded')}</option>
        <option value={yes}>{yes}</option>
        <option value={no}>{no}</option>
      </select>
    </label>
  );
}

/** Record investigations (in-document notes; the uploader is separate). */
function InvestigationsRecordPopup({
  patientId,
  onCancel,
  onRecord,
  onSubmitUpload,
  onSubmitPick,
}: {
  readonly patientId: string;
  readonly onCancel: () => void;
  readonly onRecord: (seed: TableSeed) => void;
  readonly onSubmitUpload: (investigationName: string) => void;
  readonly onSubmitPick: (attachmentId: string, label: string) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  // D5: status is a typed DROPDOWN with exactly two options.
  const [statusValue, setStatusValue] = useState<'suggested' | 'submitted'>(
    'suggested',
  );
  const [notes, setNotes] = useState('');
  // The Submitted popup is open while status === 'submitted'.
  const [submitOpen, setSubmitOpen] = useState(false);

  const record = useCallback((): void => {
    onRecord({
      hcTableType: 'investigations',
      columns: [
        t('case.form.investigations.name'),
        t('case.form.investigations.status'),
        t('case.form.investigations.notes'),
      ],
      rows: [[name, t('case.form.investigations.status.suggested'), notes]],
    });
  }, [onRecord, name, notes]);

  const onStatusChange = useCallback((value: string): void => {
    if (value === 'submitted') {
      setStatusValue('submitted');
      setSubmitOpen(true);
    } else {
      setStatusValue('suggested');
      setSubmitOpen(false);
    }
  }, []);

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
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            {t('case.form.investigations.status')}
          </span>
          <select
            data-testid="case-investigations-status-select"
            value={statusValue}
            onChange={(e) => onStatusChange(e.target.value)}
            aria-label={t('case.form.investigations.status')}
            className="input"
          >
            <option
              data-testid="case-investigations-status-opt-suggested"
              value="suggested"
            >
              {t('case.form.investigations.status.suggested')}
            </option>
            <option
              data-testid="case-investigations-status-opt-submitted"
              value="submitted"
            >
              {t('case.form.investigations.status.submitted')}
            </option>
          </select>
        </label>
        <TextField
          testId="case-investigations-notes"
          label={t('case.form.investigations.notes')}
          value={notes}
          onChange={setNotes}
        />
      </div>

      {submitOpen ? (
        <SubmitReportPopup
          patientId={patientId}
          onCancel={() => {
            setSubmitOpen(false);
            setStatusValue('suggested');
          }}
          onUpload={() => onSubmitUpload(name)}
          onPick={(attachmentId, label) => onSubmitPick(attachmentId, label)}
        />
      ) : null}
    </Dialog>
  );
}

/**
 * D5 (M3-RWv4 §5.2): the Submitted popup — UPLOAD a new report OR PICK an
 * already-uploaded one from the shared patient attachment store
 * (`patient_list_attachments`). A warning note reminds the doctor to upload the
 * correct file against the name. Accessible (shared Dialog shell).
 */
function SubmitReportPopup({
  patientId,
  onCancel,
  onUpload,
  onPick,
}: {
  readonly patientId: string;
  readonly onCancel: () => void;
  readonly onUpload: () => void;
  readonly onPick: (attachmentId: string, label: string) => void;
}): JSX.Element {
  const [existing, setExisting] = useState<AttachmentSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const res = await run(commands.patientListAttachments({ patientId }));
        if (!cancelled) setExisting(res.attachments);
      } catch {
        /* pick-existing is best-effort; upload-new still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const selectedLabel = (): string => {
    const a = existing.find((x) => x.attachmentId === selected);
    return a?.originalName ?? a?.caption ?? '';
  };

  return (
    <Dialog
      testId="case-form-investigation-submit-popup"
      title={t('case.form.investigations.submit.title')}
      onCancel={onCancel}
      footer={
        <button
          type="button"
          data-testid="case-form-investigation-submit-cancel"
          onClick={onCancel}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          {t('case.form.investigations.submit.cancel')}
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        <button
          type="button"
          data-testid="case-form-investigation-submit-upload"
          onClick={onUpload}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-700"
        >
          {t('case.form.investigations.submit.upload')}
        </button>
        <p
          role="note"
          data-testid="case-form-investigation-upload-warning"
          className="rounded bg-amber-50 px-3 py-1.5 text-xs text-amber-800"
        >
          {t('case.form.investigations.uploadWarning')}
        </p>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">
            {t('case.form.investigations.submit.pickLabel')}
          </span>
          <ul
            data-testid="case-form-investigation-submit-pick-list"
            className="flex flex-col gap-1"
          >
            {existing.length === 0 ? (
              <li className="text-xs text-slate-500">
                {t('case.form.investigations.submit.pickEmpty')}
              </li>
            ) : (
              existing.map((a, index) => {
                const n = index + 1;
                const label = a.originalName ?? a.caption ?? a.attachmentId;
                return (
                  <li key={a.attachmentId}>
                    <button
                      type="button"
                      data-testid={`case-form-investigation-submit-pick-item-${n}`}
                      aria-pressed={selected === a.attachmentId}
                      onClick={() => setSelected(a.attachmentId)}
                      className={[
                        'w-full rounded border px-2 py-1 text-left text-xs focus:outline-none focus:ring-2 focus:ring-blue-600',
                        selected === a.attachmentId
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-slate-300 hover:bg-slate-100',
                      ].join(' ')}
                    >
                      {label}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <button
            type="button"
            data-testid="case-form-investigation-submit-pick-confirm"
            disabled={selected === null}
            onClick={() => {
              if (selected !== null) onPick(selected, selectedLabel());
            }}
            className="mt-1 rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
          >
            {t('case.form.investigations.submit.pickConfirm')}
          </button>
        </div>
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
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);

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
          displayLabel: null,
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
        <AttachmentPreviewDialog
          testId="case-form-investigations-preview"
          preview={preview}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}

/** An opened attachment ready for the in-app preview (data URL, no path). */
interface AttachmentPreview {
  readonly url: string;
  readonly name: string;
  readonly isImage: boolean;
}

/**
 * The in-app attachment preview (image inline, PDF behind "Save to open"),
 * shared by the Lab reports panel and the one-click Open on an investigation
 * link row (M3-RWv6 item 4). role=dialog named by the file; Escape closes.
 */
function AttachmentPreviewDialog({
  testId,
  preview,
  onClose,
}: {
  readonly testId: string;
  readonly preview: AttachmentPreview;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={preview.name}
      data-testid={testId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-[48rem] flex-col rounded border border-slate-300 bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <h2 className="truncate text-sm font-semibold">{preview.name}</h2>
          <button
            type="button"
            data-testid={`${testId}-close`}
            onClick={() => onClose()}
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('case.form.investigations.remove.cancel')}
          </button>
        </div>
        <div className="overflow-auto p-4">
          {preview.isImage ? (
            <img
              data-testid={`${testId}-image`}
              src={preview.url}
              alt={preview.name}
              className="mx-auto max-h-[70vh] max-w-full"
            />
          ) : (
            <a
              data-testid={`${testId}-download`}
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
  );
}
