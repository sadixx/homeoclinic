// S08 First (detailed) case form + schema-driven form engine (docs/ui/
// S08-case-form.md; HC-MVP1-058..064). CASE-001..006, CASE-009, VIS-001.
//
// Calls ONLY the generated typed bindings (UI -> typed commands only; never
// SQL or raw filesystem paths). Every control / asserted value carries its
// spec data-testid (R-UI-003); all visible text comes from en.json
// (R-UI-007); dates/times go through shared/datetime (R-UI-006).
//
// The engine renders a template's `schema_json` (sections -> fields) rather
// than a hard-coded layout (CASE-004): section order, collapsible/hideable
// flags, `showIf` conditionals (female / child age < 14) and `allowFreeText`
// pick lists all come from the schema. The default template is fetched with
// `case_template_get_default`; the open visit's answers/vitals come from
// `case_visit_open_or_create` and are RESTORED on open so a killed-mid-typing
// session loses nothing (CASE-005, acceptance flow 3).
//
// Autosave (CASE-005): 2 s after the last change AND on blur, through
// `case_visit_autosave`; the status bar shows Saving.../Saved hh:mm. There is
// no Save button on this clinical form.
//
// Send-to-repertory (CASE-006) is FEATURE-FLAGGED OFF until R7: the control is
// not rendered (no dead end, ADR-0002) and the R7 `rubric_search_prefill` stub
// is never called this slice.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Minus } from 'lucide-react';

import { commands } from '@/bindings';
import { run } from '@/shared/command';
import { formatDateTime } from '@/shared/datetime';
import { t, type StringKey } from '@/shared/strings';

/** Supported field kinds in a template schema. */
type FieldType =
  | 'text'
  | 'long-text'
  | 'single-choice'
  | 'multi-choice'
  | 'number'
  | 'date'
  | 'scale0-10';

/** One field within a section (as described by the template schema). */
interface SchemaField {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly options?: readonly string[];
  readonly allowFreeText?: boolean;
  readonly computed?: string;
}

/** Conditional-visibility predicate on a section. */
interface ShowIf {
  readonly sex?: string;
  readonly ageYearsLt?: number;
}

/** One section of the case template. */
interface SchemaSection {
  readonly key: string;
  readonly title: string;
  readonly collapsible?: boolean;
  readonly hideable?: boolean;
  readonly repeatable?: boolean;
  readonly showIf?: ShowIf;
  readonly fields: readonly SchemaField[];
}

/** The parsed template schema. */
interface TemplateSchema {
  readonly version: number;
  readonly sections: readonly SchemaSection[];
}

/** How the form is opened. */
export interface CaseFormProps {
  /** Patient the case belongs to (route param). */
  readonly patientId: string;
  /** Visit the case belongs to (route param). */
  readonly visitId: string;
  /** Patient sex — drives the menstrual/obstetric conditional section. */
  readonly sex: 'male' | 'female';
  /** Patient age in whole years — drives the child-development section. */
  readonly ageYears: number;
  /**
   * Return to the logical parent (the patient dashboard). When provided, a
   * first-class Back control is rendered top-left (00-conventions §3). Back
   * never discards data — the clinical form already autosaves (CASE-005). When
   * absent, no Back control is rendered (no dead end, ADR-0002).
   */
  readonly onBack?: () => void;
}

/** Answers for one repeatable chief-complaint block. */
type ComplaintBlock = Record<string, string>;

/** The full set of case-form answers kept in memory. */
interface CaseData {
  /** Repeatable chief-complaint blocks (section `chief_complaints`). */
  chief_complaints: ComplaintBlock[];
  /** Non-repeatable sections keyed by section key -> field key -> value. */
  [sectionKey: string]: ComplaintBlock | ComplaintBlock[];
}

/** Vitals, camelCase to match the M3-A `recompute_bmi` contract. */
interface Vitals {
  [key: string]: number | undefined;
}

/** Autosave status shown in the status bar (CASE-005). */
type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'error' };

const AUTOSAVE_DEBOUNCE_MS = 2000;

/** camelCase vitals keys the backend BMI recompute understands. */
const VITALS_WEIGHT = 'weightKg';
const VITALS_HEIGHT = 'heightCm';
const VITALS_BMI = 'bmi';

/** Map a schema field key in the examination section to its vitals key. */
function vitalsKeyFor(fieldKey: string): string {
  if (fieldKey === 'weight_kg') return VITALS_WEIGHT;
  if (fieldKey === 'height_cm') return VITALS_HEIGHT;
  if (fieldKey === 'bmi') return VITALS_BMI;
  return fieldKey;
}

/**
 * Body-mass index from weight (kg) and height (cm) for the LIVE display,
 * shown to one decimal place, or `null` when either input is missing or
 * non-positive. `BMI = weight_kg / (height_m)^2` with `height_m = height_cm /
 * 100`; the fractional part is truncated to one decimal (68 kg / 172 cm =>
 * 22.9, matching the S08 wireframe). This is the client-side preview only; the
 * authoritative BMI is recomputed and persisted by the backend on autosave
 * (CASE-001/062).
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

/** Parse a template schema JSON string into a typed schema (empty on error). */
function parseSchema(schemaJson: string): TemplateSchema {
  try {
    const raw = JSON.parse(schemaJson) as TemplateSchema;
    if (raw && Array.isArray(raw.sections)) return raw;
  } catch {
    /* a malformed schema renders as an empty form rather than crashing */
  }
  return { version: 0, sections: [] };
}

/** Whether a section's `showIf` predicate holds for this patient. */
function sectionVisibleForPatient(
  section: SchemaSection,
  sex: string,
  ageYears: number,
): boolean {
  const cond = section.showIf;
  if (cond === undefined) return true;
  if (cond.sex !== undefined && cond.sex !== sex) return false;
  if (cond.ageYearsLt !== undefined && !(ageYears < cond.ageYearsLt)) {
    return false;
  }
  return true;
}

/** Read a non-repeatable section's answers from loaded data. */
function sectionAnswers(data: CaseData, key: string): ComplaintBlock {
  const value = data[key];
  if (value !== undefined && !Array.isArray(value)) return value;
  return {};
}

/**
 * The structured first-consultation case sheet (S08). Renders the default
 * template's sections from its JSON schema, autosaves every field, shows live
 * BMI and opens a read-only case summary.
 */
export function CaseForm({
  patientId,
  visitId,
  sex,
  ageYears,
  onBack,
}: CaseFormProps): JSX.Element {
  const [schema, setSchema] = useState<TemplateSchema | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templates, setTemplates] = useState<
    ReadonlyArray<{ id: string; name: string }>
  >([]);
  const [data, setData] = useState<CaseData>({ chief_complaints: [{}] });
  const [vitals, setVitals] = useState<Vitals>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  // Sections the doctor hid by TOGGLING the rail item (UX2), as opposed to the
  // Hide-sections dialog. Both persist the same hidden state, but a rail-
  // toggled section STAYS in the rail (muted, discoverable to click back on),
  // while a dialog-hidden section is removed from the rail entirely. Tracking
  // the source keeps both behaviours correct.
  const [railToggledHidden, setRailToggledHidden] = useState<
    Record<string, boolean>
  >({});
  const [complaintErrors, setComplaintErrors] = useState<
    Record<number, boolean>
  >({});
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [hideDialogOpen, setHideDialogOpen] = useState(false);
  const [summaryHtml, setSummaryHtml] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);

  // The autosave debounce timer; the latest data/vitals are read from refs so a
  // blur flush and the debounce always save the newest in-memory state.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef<CaseData>(data);
  const vitalsRef = useRef<Vitals>(vitals);
  dataRef.current = data;
  vitalsRef.current = vitals;

  // Load the template + open-or-create the visit, then RESTORE answers/vitals
  // from the returned JSON so a killed-mid-typing session loses nothing
  // (CASE-005). The two reads are independent; a template read failure still
  // lets the restore run with an empty layout.
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const open = await run(
          commands.caseVisitOpenOrCreate({ patientId, visitType: 'first' }),
        );
        if (cancelled) return;
        const restoredData = restoreData(open.dataJson);
        const restoredVitals = restoreVitals(open.vitalsJson);
        setData(restoredData);
        setVitals(restoredVitals);
      } catch {
        if (!cancelled) setErrored(true);
      }

      try {
        const def = await run(commands.caseTemplateGetDefault());
        if (cancelled) return;
        setTemplateName(def.name);
        const parsed = parseSchema(def.schemaJson);
        setSchema(parsed);
        // Chief complaints open by default; every other section starts
        // collapsed (the doctor expands what they need).
        const initialExpanded: Record<string, boolean> = {};
        for (const s of parsed.sections) {
          initialExpanded[s.key] = s.key === 'chief_complaints';
        }
        setExpanded(initialExpanded);
      } catch {
        if (!cancelled) setErrored(true);
      }

      try {
        const list = await run(commands.caseTemplateList());
        if (!cancelled) {
          setTemplates(list.templates.map((x) => ({ id: x.id, name: x.name })));
        }
      } catch {
        /* the picker is best-effort; the default template still renders */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, visitId]);

  // ---- Autosave (CASE-005) -------------------------------------------------

  /** Serialise the current answers/vitals and persist them now. */
  const flushSave = useCallback(async (): Promise<void> => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setStatus({ kind: 'saving' });
    try {
      const res = await run(
        commands.caseVisitAutosave({
          visitId,
          dataJson: JSON.stringify(dataRef.current),
          vitalsJson: JSON.stringify(vitalsRef.current),
        }),
      );
      setStatus({ kind: 'saved', at: res.savedAt });
    } catch {
      setStatus({ kind: 'error' });
    }
  }, [visitId]);

  /** Restart the 2 s debounce after a change and show the saving state. */
  const scheduleSave = useCallback((): void => {
    setStatus({ kind: 'saving' });
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [flushSave]);

  // Clear a pending timer on unmount so no save fires after teardown.
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  // ---- Field mutation ------------------------------------------------------

  const setComplaintField = useCallback(
    (index: number, fieldKey: string, value: string): void => {
      setData((prev) => {
        const blocks = prev.chief_complaints.slice();
        blocks[index] = { ...blocks[index], [fieldKey]: value };
        return { ...prev, chief_complaints: blocks };
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const setSectionField = useCallback(
    (sectionKey: string, fieldKey: string, value: string): void => {
      setData((prev) => {
        const current = !Array.isArray(prev[sectionKey])
          ? ((prev[sectionKey] as ComplaintBlock | undefined) ?? {})
          : {};
        return { ...prev, [sectionKey]: { ...current, [fieldKey]: value } };
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const setVital = useCallback(
    (fieldKey: string, value: string): void => {
      const num = value.trim() === '' ? undefined : Number(value);
      setVitals((prev) => {
        const next: Vitals = { ...prev };
        if (num === undefined || Number.isNaN(num)) {
          delete next[vitalsKeyFor(fieldKey)];
        } else {
          next[vitalsKeyFor(fieldKey)] = num;
        }
        const bmi = liveBmi(next[VITALS_WEIGHT], next[VITALS_HEIGHT]);
        if (bmi === null) delete next[VITALS_BMI];
        else next[VITALS_BMI] = bmi;
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const addComplaint = useCallback((): void => {
    setData((prev) => ({
      ...prev,
      chief_complaints: [...prev.chief_complaints, {}],
    }));
  }, []);

  const removeComplaint = useCallback(
    (index: number): void => {
      setData((prev) => {
        if (prev.chief_complaints.length <= 1) return prev;
        const blocks = prev.chief_complaints.slice();
        blocks.splice(index, 1);
        return { ...prev, chief_complaints: blocks };
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const validateComplaint = useCallback((index: number): void => {
    const block = dataRef.current.chief_complaints[index];
    const text = (block?.sensation ?? '').trim();
    setComplaintErrors((prev) => ({ ...prev, [index]: text === '' }));
  }, []);

  // ---- Sections ------------------------------------------------------------

  const toggleExpanded = useCallback((key: string, open: boolean): void => {
    setExpanded((prev) => ({ ...prev, [key]: open }));
  }, []);

  const toggleHidden = useCallback(
    async (key: string): Promise<void> => {
      const nextHidden = !(hidden[key] ?? false);
      setHidden((prev) => ({ ...prev, [key]: nextHidden }));
      try {
        // Per-doctor template visibility persists as their template (CASE-002).
        await run(
          commands.caseTemplateSetVisibility({
            sectionKey: key,
            hidden: nextHidden,
          }),
        );
      } catch {
        /* a persistence failure keeps the local choice; it is retried on reopen */
      }
    },
    [hidden],
  );

  // Rail click TOGGLES the section (UX2), reusing the same toggleHidden +
  // case_template_set_visibility persistence as the Hide-sections dialog
  // (one-txn-one-audit) and coexisting with it:
  //   - a HIDDEN section is re-shown (persisted hidden:false) and expanded so
  //     its fields appear;
  //   - a shown but COLLAPSED section is expanded (open its panel) — a doctor
  //     navigating the rail opens a section before choosing to hide it;
  //   - a shown and EXPANDED section is hidden (persisted hidden:true), which
  //     is the "click again hides it" toggle-off the user asked for.
  const toggleRailSection = useCallback(
    (key: string): void => {
      const isHidden = hidden[key] ?? false;
      if (isHidden) {
        // Re-show: clear the rail-toggled marker, expand, and persist shown.
        setRailToggledHidden((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        toggleExpanded(key, true);
        void toggleHidden(key);
        return;
      }
      if (expanded[key] ?? false) {
        // Toggle OFF from the rail: mark the source so it stays in the rail
        // (muted) rather than disappearing like a dialog-hidden section.
        setRailToggledHidden((prev) => ({ ...prev, [key]: true }));
        void toggleHidden(key);
        return;
      }
      toggleExpanded(key, true);
    },
    [hidden, expanded, toggleExpanded, toggleHidden],
  );

  // ---- Case summary (CASE-009) ---------------------------------------------

  const openSummary = useCallback(async (): Promise<void> => {
    try {
      const res = await run(commands.caseSummaryRender({ visitId }));
      setSummaryHtml(res.html);
    } catch {
      setErrored(true);
    }
  }, [visitId]);

  // The sections shown in the left rail: schema order, minus only the
  // patient-conditional ones (CASE-001). Per-doctor HIDDEN sections stay in the
  // rail so the doctor can click them back on — a hidden rail item carries a
  // hidden-state indicator (UX2). The centre pane renders only non-hidden
  // sections (CASE-002).
  const railSections = useMemo(() => {
    if (schema === null) return [];
    return schema.sections.filter((s) => {
      if (!sectionVisibleForPatient(s, sex, ageYears)) return false;
      const isHidden = hidden[s.key] ?? false;
      // A section hidden via the Hide-sections DIALOG leaves the rail; a rail-
      // TOGGLED section stays (muted) so it is discoverable to click back on.
      if (isHidden && !(railToggledHidden[s.key] ?? false)) return false;
      return true;
    });
  }, [schema, sex, ageYears, hidden, railToggledHidden]);

  // The sections to render in the centre pane: schema order, minus patient-
  // conditional and per-doctor hidden ones (CASE-002/001).
  const visibleSections = useMemo(() => {
    if (schema === null) return [];
    return schema.sections.filter(
      (s) =>
        sectionVisibleForPatient(s, sex, ageYears) && !(hidden[s.key] ?? false),
    );
  }, [schema, sex, ageYears, hidden]);

  if (errored && schema === null) {
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

  if (schema === null) {
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

  return (
    <section
      data-testid="case-form"
      aria-label={templateName}
      className="flex h-full min-h-0 flex-col text-[0.875rem] text-slate-900"
    >
      <HeaderBar
        templateName={templateName}
        templates={templates}
        status={status}
        onForceSave={() => void flushSave()}
        {...(onBack !== undefined ? { onBack } : {})}
      />

      <div className="flex min-h-0 flex-1">
        {/* Left: section rail (CASE-002) */}
        <nav
          aria-label={t('case.form.sections.title')}
          className="flex w-56 flex-none flex-col gap-1 overflow-auto border-r border-slate-200 p-2"
        >
          <h2 className="px-1 text-xs font-semibold uppercase text-slate-500">
            {t('case.form.sections.title')}
          </h2>
          {railSections.map((s) => {
            const isHidden = hidden[s.key] ?? false;
            const isExpanded = !isHidden && (expanded[s.key] ?? false);
            return (
              <button
                key={s.key}
                type="button"
                data-testid={`case-form-section-${s.key}`}
                // A rail click TOGGLES the section on/off (UX2). The state is
                // surfaced for accessibility and test discovery: aria-pressed
                // is true while shown, aria-expanded reflects the open panel,
                // and data-hidden marks a hidden section so it stays clickable
                // to restore.
                aria-pressed={!isHidden}
                aria-expanded={isExpanded}
                data-hidden={isHidden ? 'true' : undefined}
                title={
                  isHidden ? t('case.form.sections.hiddenHint') : undefined
                }
                onClick={() => toggleRailSection(s.key)}
                className={[
                  'rounded px-2 py-1 text-left hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600',
                  isHidden
                    ? 'italic text-slate-400'
                    : isExpanded
                      ? 'bg-blue-50 font-medium'
                      : '',
                ].join(' ')}
              >
                {s.title}
              </button>
            );
          })}
          <button
            type="button"
            data-testid="case-form-hide-sections"
            onClick={() => setHideDialogOpen(true)}
            className="mt-2 rounded border border-slate-300 px-2 py-1 text-left hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('case.form.hideSections')}
          </button>
        </nav>

        {/* Centre: active section fields */}
        <div className="min-w-0 flex-1 overflow-auto p-4">
          {visibleSections.map((section) =>
            expanded[section.key] ? (
              <SectionPanel
                key={section.key}
                section={section}
                data={data}
                vitals={vitals}
                complaintErrors={complaintErrors}
                onCollapse={() => toggleExpanded(section.key, false)}
                onComplaintField={setComplaintField}
                onComplaintBlur={(index) => {
                  validateComplaint(index);
                  void flushSave();
                }}
                onSectionField={setSectionField}
                onSectionBlur={() => void flushSave()}
                onVital={setVital}
                onAddComplaint={addComplaint}
                onRemoveComplaint={removeComplaint}
              />
            ) : null,
          )}

          <div className="mt-4 border-t border-slate-200 pt-3">
            <button
              type="button"
              data-testid="case-form-case-summary"
              onClick={() => void openSummary()}
              className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {t('case.form.caseSummary')}
            </button>
          </div>
        </div>
      </div>

      {hideDialogOpen ? (
        <HideSectionsDialog
          sections={schema.sections.filter((s) => s.hideable !== false)}
          hidden={hidden}
          onToggle={(key) => void toggleHidden(key)}
          onClose={() => setHideDialogOpen(false)}
        />
      ) : null}

      {summaryHtml !== null ? (
        <SummaryView html={summaryHtml} onClose={() => setSummaryHtml(null)} />
      ) : null}
    </section>
  );
}

/** Restore the in-memory answers from the open-or-create `data_json`. */
function restoreData(dataJson: string): CaseData {
  const base: CaseData = { chief_complaints: [{}] };
  try {
    const raw = JSON.parse(dataJson) as Record<string, unknown>;
    if (raw && typeof raw === 'object') {
      const out: CaseData = { ...base, ...(raw as object) } as CaseData;
      if (
        !Array.isArray(out.chief_complaints) ||
        out.chief_complaints.length === 0
      ) {
        out.chief_complaints = [{}];
      }
      return out;
    }
  } catch {
    /* a fresh or malformed visit starts with one empty complaint block */
  }
  return base;
}

/** Restore vitals from the open-or-create `vitals_json`. */
function restoreVitals(vitalsJson: string): Vitals {
  try {
    const raw = JSON.parse(vitalsJson) as Record<string, unknown>;
    if (raw && typeof raw === 'object') {
      const out: Vitals = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'number') out[k] = v;
      }
      return out;
    }
  } catch {
    /* empty vitals on a fresh or malformed visit */
  }
  return {};
}

/** Top header: patient/visit line, template picker and autosave status. */
function HeaderBar({
  templateName,
  templates,
  status,
  onForceSave,
  onBack,
}: {
  readonly templateName: string;
  readonly templates: ReadonlyArray<{ id: string; name: string }>;
  readonly status: SaveStatus;
  readonly onForceSave: () => void;
  readonly onBack?: () => void;
}): JSX.Element {
  return (
    <header className="flex flex-none items-center justify-between gap-3 border-b border-slate-200 px-4 py-2">
      <div className="flex items-center gap-3">
        {/* Back to the patient dashboard (00-conventions §3). Rendered only
            when a destination is wired, so there is no dead-end control
            (ADR-0002). Back never discards data — the form autosaves. */}
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
        <span className="font-semibold">{templateName}</span>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          {t('case.form.template')}
          <select
            data-testid="case-form-template"
            value={templateName}
            onChange={() => {
              /* template switching beyond the default is R9 (CASE-004) */
            }}
            className="rounded border border-slate-300 px-1 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {templates.length === 0 ? (
              <option value={templateName}>{templateName}</option>
            ) : (
              templates.map((tpl) => (
                <option key={tpl.id} value={tpl.name}>
                  {tpl.name}
                </option>
              ))
            )}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <SaveIndicator status={status} />
        <button
          type="button"
          data-testid="case-form-force-save"
          onClick={onForceSave}
          className="sr-only"
        >
          {t('case.form.save.saving')}
        </button>
      </div>
    </header>
  );
}

/** Status-bar autosave indicator (Saving.../Saved hh:mm) (CASE-005). */
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

/** One expanded section's fields in the centre pane. */
function SectionPanel({
  section,
  data,
  vitals,
  complaintErrors,
  onCollapse,
  onComplaintField,
  onComplaintBlur,
  onSectionField,
  onSectionBlur,
  onVital,
  onAddComplaint,
  onRemoveComplaint,
}: {
  readonly section: SchemaSection;
  readonly data: CaseData;
  readonly vitals: Vitals;
  readonly complaintErrors: Record<number, boolean>;
  readonly onCollapse: () => void;
  readonly onComplaintField: (
    index: number,
    fieldKey: string,
    value: string,
  ) => void;
  readonly onComplaintBlur: (index: number) => void;
  readonly onSectionField: (
    sectionKey: string,
    fieldKey: string,
    value: string,
  ) => void;
  readonly onSectionBlur: () => void;
  readonly onVital: (fieldKey: string, value: string) => void;
  readonly onAddComplaint: () => void;
  readonly onRemoveComplaint: (index: number) => void;
}): JSX.Element {
  return (
    <div className="mb-4 rounded border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
        <h2 className="font-semibold">{section.title}</h2>
        <div className="flex items-center gap-2">
          {section.repeatable ? (
            <button
              type="button"
              data-testid="case-form-add-complaint"
              onClick={onAddComplaint}
              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {t('case.form.addComplaint')}
            </button>
          ) : null}
          <button
            type="button"
            data-testid={`case-form-collapse-${section.key}`}
            aria-label={t('case.form.collapse')}
            onClick={onCollapse}
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="p-3">
        {section.repeatable ? (
          <ComplaintRepeater
            blocks={data.chief_complaints}
            errors={complaintErrors}
            onField={onComplaintField}
            onBlur={onComplaintBlur}
            onRemove={onRemoveComplaint}
          />
        ) : section.key === 'examination' ? (
          <VitalsFields section={section} vitals={vitals} onVital={onVital} />
        ) : (
          <GenericFields
            section={section}
            answers={sectionAnswers(data, section.key)}
            onField={onSectionField}
            onBlur={onSectionBlur}
          />
        )}
      </div>
    </div>
  );
}

/** Repeatable chief-complaint blocks (CASE-001). */
function ComplaintRepeater({
  blocks,
  errors,
  onField,
  onBlur,
  onRemove,
}: {
  readonly blocks: ComplaintBlock[];
  readonly errors: Record<number, boolean>;
  readonly onField: (index: number, fieldKey: string, value: string) => void;
  readonly onBlur: (index: number) => void;
  readonly onRemove: (index: number) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, index) => {
        const n = index + 1;
        const blockTitle = `${t('case.form.complaintTitle')} ${n}`;
        return (
          <fieldset key={index} className="rounded border border-slate-200 p-3">
            <legend className="flex items-center gap-2 px-1 text-xs font-semibold text-slate-600">
              {blockTitle}
              {blocks.length > 1 ? (
                <button
                  type="button"
                  data-testid={`case-form-remove-complaint-${n}`}
                  onClick={() => onRemove(index)}
                  className="rounded border border-slate-300 px-1.5 py-0.5 text-[0.7rem] text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {t('case.form.removeComplaint')}
                </button>
              ) : null}
            </legend>

            {/* Primary required field: the chief-complaint description, which
                in the chronic_detailed template is the `sensation` field
                (S08 folds "Complaint text"/"Sensation" onto this one line;
                CASE-001). The label wraps the input so its testid scopes the
                value for restore assertions (`case-form-complaint-<n>`), and
                the textarea itself carries the spec `case-form-sensation-<n>`
                id so the distinct S08 sensation target resolves (R-UI-003). */}
            <label
              data-testid={`case-form-complaint-${n}`}
              className="flex flex-col gap-1"
            >
              <span className="text-xs font-medium text-slate-600">
                {t('case.form.complaint.label')}
                {t('setup.requiredMark')}
              </span>
              <textarea
                data-testid={`case-form-sensation-${n}`}
                value={block.sensation ?? ''}
                rows={2}
                onChange={(e) => onField(index, 'sensation', e.target.value)}
                onBlur={() => onBlur(index)}
                className="input"
                aria-label={t('case.form.complaint.label')}
              />
            </label>
            {errors[index] ? (
              <span
                role="alert"
                data-testid={`case-form-complaint-${n}-error`}
                className="mt-1 block text-xs text-red-700"
              >
                {t('case.form.complaint.required')}
              </span>
            ) : null}

            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
              {COMPLAINT_FIELD_KEYS.map((key) => {
                const label = t(COMPLAINT_FIELD_LABEL_KEYS[key]);
                const testIdKey = COMPLAINT_FIELD_TESTID_SUFFIX[key] ?? key;
                return (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-slate-600">
                      {label}
                    </span>
                    <input
                      data-testid={`case-form-${testIdKey}-${n}`}
                      value={block[key] ?? ''}
                      onChange={(e) => onField(index, key, e.target.value)}
                      onBlur={() => onBlur(index)}
                      className="input"
                      aria-label={label}
                    />
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * The non-primary chief-complaint field keys (CASE-001), in render order, and
 * their en.json label keys. Labels come from the strings file (R-UI-007); the
 * map value type is `StringKey` so each key is checked at compile time.
 */
const COMPLAINT_FIELD_KEYS = [
  'location',
  'agg',
  'amel',
  'concomitants',
  'duration',
  'onset',
] as const;

const COMPLAINT_FIELD_LABEL_KEYS: Readonly<
  Record<(typeof COMPLAINT_FIELD_KEYS)[number], StringKey>
> = {
  location: 'case.form.complaint.location',
  agg: 'case.form.complaint.agg',
  amel: 'case.form.complaint.amel',
  concomitants: 'case.form.complaint.concomitants',
  duration: 'case.form.complaint.duration',
  onset: 'case.form.complaint.onset',
};

/**
 * The S08 testid suffix for each complaint field. The autosave DATA key stays
 * as the schema key (e.g. `concomitants`) so the persisted JSON contract is
 * unchanged, but the spec names the control `case-form-concomitant-<n>`
 * (singular). Keys not listed here fall back to their own field key, so only
 * the divergent ids need an entry (R-UI-003).
 */
const COMPLAINT_FIELD_TESTID_SUFFIX: Readonly<
  Partial<Record<(typeof COMPLAINT_FIELD_KEYS)[number], string>>
> = {
  concomitants: 'concomitant',
};

/** Examination/vitals fields with live BMI (CASE-001/062). */
function VitalsFields({
  section,
  vitals,
  onVital,
}: {
  readonly section: SchemaSection;
  readonly vitals: Vitals;
  readonly onVital: (fieldKey: string, value: string) => void;
}): JSX.Element {
  const bmi = liveBmi(vitals[VITALS_WEIGHT], vitals[VITALS_HEIGHT]);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
      {section.fields.map((field) => {
        if (field.key === 'bmi') {
          // BMI is computed, not editable (CASE-001). Rendered as read-only
          // text (carrying a `readonly` attribute) rather than an input so the
          // doctor cannot override it.
          return (
            <div key={field.key} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">
                {t('case.form.bmi.label')}
              </span>
              <output
                data-testid="case-form-bmi"
                ref={(el) => el?.setAttribute('readonly', '')}
                aria-label={t('case.form.bmi.label')}
                aria-readonly="true"
                className="input bg-slate-50"
              >
                {bmi === null ? '' : String(bmi)}
              </output>
            </div>
          );
        }
        const vKey = vitalsKeyFor(field.key);
        const current = vitals[vKey];
        return (
          <label key={field.key} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">
              {field.label}
            </span>
            <input
              data-testid={`case-form-vital-${field.key}`}
              type={field.type === 'number' ? 'number' : 'text'}
              inputMode="numeric"
              value={current === undefined ? '' : String(current)}
              onChange={(e) => onVital(field.key, e.target.value)}
              className="input"
              aria-label={field.label}
            />
          </label>
        );
      })}
    </div>
  );
}

/** A section's fields rendered generically from the schema (CASE-004/003). */
function GenericFields({
  section,
  answers,
  onField,
  onBlur,
}: {
  readonly section: SchemaSection;
  readonly answers: ComplaintBlock;
  readonly onField: (
    sectionKey: string,
    fieldKey: string,
    value: string,
  ) => void;
  readonly onBlur: () => void;
}): JSX.Element {
  // Physical-generals pick lists use the `generals` testid prefix. The
  // single-field diagnosis/analysis sections carry their own spec testids
  // (`case-form-diagnosis`, `case-form-analysis`, R-UI-003) rather than the
  // generic `case-form-field-<key>`. Every other section uses `field`.
  const SECTION_FIELD_TESTID: Readonly<Record<string, string>> = {
    provisional_diagnosis: 'case-form-diagnosis',
    analysis: 'case-form-analysis',
  };
  const prefix = section.key === 'physical_generals' ? 'generals' : 'field';
  const sectionTestId = SECTION_FIELD_TESTID[section.key];
  return (
    <div className="grid grid-cols-1 gap-y-2 md:grid-cols-2 md:gap-x-4">
      {section.fields.map((field) => {
        const testId = sectionTestId ?? `case-form-${prefix}-${field.key}`;
        const value = answers[field.key] ?? '';
        const common = {
          'data-testid': testId,
          value,
          onBlur,
          className: 'input',
          'aria-label': field.label,
        } as const;
        return (
          <label key={field.key} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">
              {field.label}
            </span>
            {renderField(field, common, (v) =>
              onField(section.key, field.key, v),
            )}
          </label>
        );
      })}
    </div>
  );
}

/** Props shared by every generic field control. */
interface FieldControlProps {
  readonly 'data-testid': string;
  readonly value: string;
  readonly onBlur: () => void;
  readonly className: string;
  readonly 'aria-label': string;
}

/** Render one field by its schema type (pick lists always accept free text). */
function renderField(
  field: SchemaField,
  common: FieldControlProps,
  onChange: (value: string) => void,
): JSX.Element {
  if (field.type === 'long-text') {
    return (
      <textarea
        {...common}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === 'single-choice' || field.type === 'multi-choice') {
    // A pick list offers common values via a datalist but always accepts free
    // text (CASE-003): it is a plain text input, so a value outside the list is
    // kept verbatim.
    const listId = `${common['data-testid']}-options`;
    return (
      <>
        <input
          {...common}
          list={field.allowFreeText === false ? undefined : listId}
          onChange={(e) => onChange(e.target.value)}
        />
        <datalist id={listId}>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
      </>
    );
  }
  if (field.type === 'number' || field.type === 'scale0-10') {
    return (
      <input
        {...common}
        type="number"
        inputMode="numeric"
        {...(field.type === 'scale0-10' ? { min: 0, max: 10 } : {})}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (field.type === 'date') {
    return (
      <input
        {...common}
        type="date"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return <input {...common} onChange={(e) => onChange(e.target.value)} />;
}

/** The per-doctor hide/show sections dialog (CASE-002). */
function HideSectionsDialog({
  sections,
  hidden,
  onToggle,
  onClose,
}: {
  readonly sections: readonly SchemaSection[];
  readonly hidden: Record<string, boolean>;
  readonly onToggle: (key: string) => void;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('case.form.hideSections.title')}
      data-testid="case-form-hide-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="w-[28rem] rounded border border-slate-300 bg-white p-4 shadow-lg">
        <h2 className="mb-1 text-sm font-semibold">
          {t('case.form.hideSections.title')}
        </h2>
        <p className="mb-3 text-xs text-slate-600">
          {t('case.form.hideSections.hint')}
        </p>
        <ul className="max-h-80 overflow-auto">
          {sections.map((s) => {
            const isHidden = hidden[s.key] ?? false;
            return (
              <li
                key={s.key}
                className="flex items-center justify-between py-1"
              >
                <span>{s.title}</span>
                <button
                  type="button"
                  data-testid={`case-form-hide-toggle-${s.key}`}
                  role="switch"
                  aria-checked={!isHidden}
                  onClick={() => onToggle(s.key)}
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {isHidden
                    ? t('case.form.hideSections.hiddenLabel')
                    : t('case.form.hideSections.shownLabel')}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            data-testid="case-form-hide-close"
            onClick={onClose}
            className="rounded bg-blue-600 px-3 py-1.5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-700"
          >
            {t('case.form.hideSections.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Read-only, printable case summary view (CASE-009). */
function SummaryView({
  html,
  onClose,
}: {
  readonly html: string;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('case.form.summary.title')}
      data-testid="case-form-summary-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-[48rem] flex-col rounded border border-slate-300 bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <h2 className="text-sm font-semibold">
            {t('case.form.summary.title')}
          </h2>
          <button
            type="button"
            data-testid="case-form-summary-close"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('case.form.summary.close')}
          </button>
        </div>
        {/* Read-only rendered HTML (CASE-009). The summary is produced by the
            trusted backend `case_summary_render` command; no editable control
            is rendered inside it. */}
        <div
          data-testid="case-form-summary-view"
          className="overflow-auto p-4"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
