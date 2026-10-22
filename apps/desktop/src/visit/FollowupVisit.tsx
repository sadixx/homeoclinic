// S09 Follow-up visit (docs/ui/S09-follow-up-visit.md; HC-MVP1-069..071).
// Requirements VIS-001..004. Route /patient/:patientId/visit/:visitId/followup.
//
// The routine return consultation. On open it pre-loads the previous visit's
// complaints (VIS-002), records how each changed (status / improvement % /
// note), captures the remedy response (VIS-003) and sets the next follow-up
// date (VIS-004), with far less typing than the first case (S08).
//
// Calls ONLY the generated typed bindings (UI -> typed commands only; never
// SQL or raw filesystem paths, R-ARCH-006). Every control / asserted value
// carries its S09 spec data-testid (R-UI-003); all visible text comes from
// en.json (R-UI-007); dates go through shared/datetime (R-UI-006).
//
// Autosave (CASE-005 clinical-form pattern): 2 s after the last change AND on
// blur, through `visit_autosave`; the status bar shows Saving.../Saved hh:mm.
// There is no Save button on this clinical form.
//
// Scope guardrails (R-DEL-002 / ADR-0002):
// - the per-complaint progress chart (VIS-007) is R9: it is NOT rendered
//   (no dead-end control) until its feature flag turns on.
// - Prescribe (S13) is R4: the button is rendered for layout coherence but is
//   visibly disabled so it is not a dead-end navigation.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { commands } from '@/bindings';
import { run } from '@/shared/command';
import {
  formatDateTime,
  isoDatePlusDays,
  isoDatePlusMonths,
} from '@/shared/datetime';
import { t, type StringKey } from '@/shared/strings';

/** Visit type (VIS-001). */
type VisitType = 'first' | 'follow_up' | 'acute' | 'tele';

/** The five per-complaint status values (VIS-002). */
type ComplaintStatus = 'better' | 'same' | 'worse' | 'new' | 'resolved';

/** One pre-loaded or added complaint row, with the doctor's follow-up marks. */
interface ComplaintRow {
  /** Stable key from the previous visit, or a synthetic key for added rows. */
  readonly key: string;
  /** Complaint text (sensation / summary). */
  readonly text: string;
  /** Complaint location, or empty. */
  readonly location: string;
  /** Whether the doctor added this row this visit (vs pre-loaded, VIS-002). */
  readonly added: boolean;
  /** Chosen status, or `null` while unset (VIS-002: pre-loaded rows start unset). */
  status: ComplaintStatus | null;
  /** Improvement %, 0-100, default 0 (VIS-002, VIS-OQ-3 optional). */
  improvementPct: number;
  /** Free-text note for this complaint (VIS-002). */
  note: string;
}

/** Autosave status shown in the status bar (CASE-005). */
type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'error' };

/** How the follow-up screen is opened (route params). */
export interface FollowupVisitProps {
  /** Patient the follow-up belongs to. */
  readonly patientId: string;
  /** The follow-up visit id. */
  readonly visitId: string;
  /** The previous visit whose complaints pre-load (VIS-002). */
  readonly prevVisitId: string;
  /** Opens the S13 Rx for this visit (R4; the button is disabled until then). */
  readonly onPrescribe?: () => void;
  /** Opens the patient dashboard (used by callers for back navigation). */
  readonly onOpenPatient?: (patientId: string) => void;
  /**
   * Return to the logical parent (the patient dashboard). When provided, a
   * first-class Back control is rendered top-left (00-conventions §3). Back
   * never discards data — the follow-up form already autosaves (CASE-005).
   */
  readonly onBack?: () => void;
}

const AUTOSAVE_DEBOUNCE_MS = 2000;

/** The five status options in wireframe order (VIS-002). */
const STATUS_OPTIONS: ReadonlyArray<{
  value: ComplaintStatus;
  key: StringKey;
}> = [
  { value: 'better', key: 'followup.status.better' },
  { value: 'same', key: 'followup.status.same' },
  { value: 'worse', key: 'followup.status.worse' },
  { value: 'new', key: 'followup.status.new' },
  { value: 'resolved', key: 'followup.status.resolved' },
];

/** The four visit-type options (VIS-001). */
const TYPE_OPTIONS: ReadonlyArray<{ value: VisitType; key: StringKey }> = [
  { value: 'first', key: 'followup.type.first' },
  { value: 'follow_up', key: 'followup.type.followup' },
  { value: 'acute', key: 'followup.type.acute' },
  { value: 'tele', key: 'followup.type.tele' },
];

/** The six Hering-aware remedy-response options in wireframe order (VIS-003). */
const REMEDY_RESPONSE_OPTIONS: ReadonlyArray<{
  value: string;
  key: StringKey;
}> = [
  { value: 'amelioration', key: 'followup.remedyResponse.amelioration' },
  { value: 'agg_then_amel', key: 'followup.remedyResponse.aggThenAmel' },
  { value: 'no_change', key: 'followup.remedyResponse.noChange' },
  { value: 'aggravation', key: 'followup.remedyResponse.aggravation' },
  { value: 'new_symptoms', key: 'followup.remedyResponse.newSymptoms' },
  { value: 'old_symptoms', key: 'followup.remedyResponse.oldSymptoms' },
];

/** The vitals captured on a follow-up (VIS-001), by key and label. */
const VITAL_FIELDS: ReadonlyArray<{ key: string; label: StringKey }> = [
  { key: 'bpSys', label: 'followup.vital.bpSys' },
  { key: 'bpDia', label: 'followup.vital.bpDia' },
  { key: 'pulse', label: 'followup.vital.pulse' },
  { key: 'weightKg', label: 'followup.vital.weightKg' },
];

/**
 * The routine follow-up consultation (S09). Pre-loads previous complaints,
 * records their change, captures the remedy response and schedules the next
 * follow-up; autosaves throughout.
 */
export function FollowupVisit({
  patientId,
  visitId,
  prevVisitId,
  onPrescribe,
  onOpenPatient,
  onBack,
}: FollowupVisitProps): JSX.Element {
  const [type, setType] = useState<VisitType>('follow_up');
  const [complaints, setComplaints] = useState<ComplaintRow[]>([]);
  const [remedyResponse, setRemedyResponse] = useState<string | null>(null);
  const [observations, setObservations] = useState('');
  const [vitals, setVitals] = useState<Record<string, number>>({});
  const [customDate, setCustomDate] = useState('');
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Latest in-memory values for the debounce/blur flush, read from refs so a
  // save always serialises the newest state (the CaseForm autosave pattern).
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeRef = useRef(type);
  const complaintsRef = useRef(complaints);
  const remedyRef = useRef(remedyResponse);
  const observationsRef = useRef(observations);
  const vitalsRef = useRef(vitals);
  typeRef.current = type;
  complaintsRef.current = complaints;
  remedyRef.current = remedyResponse;
  observationsRef.current = observations;
  vitalsRef.current = vitals;

  // On open, pre-load the previous visit's complaints (VIS-002). Each row
  // starts with an UNSET status for the doctor to mark; a Resolved-last-time
  // complaint still pre-loads (VIS-OQ-1) — the service decides what to return
  // and the UI renders a row for every entry.
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const resp = await run(
          commands.visitCreateFollowup({ patientId, prevVisitId }),
        );
        if (cancelled) return;
        setComplaints(
          resp.prevComplaints.map((c) => ({
            key: c.key,
            text: c.text,
            location: c.location,
            added: false,
            status: null,
            improvementPct: 0,
            note: '',
          })),
        );
      } catch {
        if (!cancelled) setErrored(true);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, prevVisitId]);

  // ---- Autosave (CASE-005) -------------------------------------------------

  /** Serialise the full follow-up payload and persist it now (VIS-002/003). */
  const flushSave = useCallback(async (): Promise<void> => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setStatus({ kind: 'saving' });
    try {
      const statusMap: Record<string, string> = {};
      const improvementMap: Record<string, number> = {};
      for (const c of complaintsRef.current) {
        if (c.status !== null) statusMap[c.key] = c.status;
        improvementMap[c.key] = c.improvementPct;
      }
      const res = await run(
        commands.visitAutosave({
          visitId,
          type: typeRef.current,
          complaintStatusJson: JSON.stringify(statusMap),
          improvementPctJson: JSON.stringify(improvementMap),
          remedyResponse: remedyRef.current,
          vitalsJson: JSON.stringify(vitalsRef.current),
          observations: observationsRef.current,
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

  // Clear any pending timer on unmount so no save fires after teardown.
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  // ---- Mutations -----------------------------------------------------------

  const updateComplaint = useCallback(
    (index: number, patch: Partial<ComplaintRow>): void => {
      setComplaints((prev) => {
        const next = prev.slice();
        const current = next[index];
        if (current === undefined) return prev;
        next[index] = { ...current, ...patch };
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  const addComplaint = useCallback((): void => {
    setComplaints((prev) => [
      ...prev,
      {
        key: `new-${prev.length + 1}`,
        text: '',
        location: '',
        added: true,
        status: null,
        improvementPct: 0,
        note: '',
      },
    ]);
    scheduleSave();
  }, [scheduleSave]);

  const setVital = useCallback(
    (key: string, value: string): void => {
      setVitals((prev) => {
        const next = { ...prev };
        const num = value.trim() === '' ? NaN : Number(value);
        if (Number.isNaN(num)) delete next[key];
        else next[key] = num;
        return next;
      });
      scheduleSave();
    },
    [scheduleSave],
  );

  // ---- Next follow-up (VIS-004) -------------------------------------------

  /** Persist the next follow-up date (RFC3339 calendar date) (VIS-004). */
  const setNextFollowup = useCallback(
    async (nextFollowupOn: string): Promise<void> => {
      try {
        await run(commands.visitSetNextFollowup({ visitId, nextFollowupOn }));
      } catch {
        setStatus({ kind: 'error' });
      }
    },
    [visitId],
  );

  const onQuickFollowup = useCallback(
    (iso: string): void => {
      setCustomDate(iso);
      void setNextFollowup(iso);
    },
    [setNextFollowup],
  );

  const onCustomFollowup = useCallback(
    (iso: string): void => {
      setCustomDate(iso);
      if (iso.trim() !== '') void setNextFollowup(iso);
    },
    [setNextFollowup],
  );

  const prevLabel = useMemo(() => {
    if (status.kind === 'saved') {
      const when = formatDateTime(status.at);
      return when !== null ? when.slice(-5) : '';
    }
    return '';
  }, [status]);

  if (errored && !loaded) {
    return (
      <section
        data-testid="followup-error"
        role="alert"
        className="p-6 text-sm text-red-700"
      >
        {t('followup.error.generic')}
      </section>
    );
  }

  return (
    <section
      data-testid="followup-screen"
      aria-label={t('followup.type.followup')}
      className="flex h-full min-h-0 flex-col text-[0.875rem] text-slate-900"
      onBlur={() => void flushSave()}
    >
      {/* Header: visit type + autosave status (CASE-005). */}
      <header className="flex flex-none items-center justify-between gap-3 border-b border-slate-200 px-4 py-2">
        <div className="flex items-center gap-3">
          {/* Back to the patient dashboard (00-conventions §3). Rendered when
              a destination is wired (onBack preferred; onOpenPatient kept as a
              fallback for existing callers), so there is no dead-end control
              (ADR-0002). Back never discards data — the form autosaves. */}
          {onBack !== undefined || onOpenPatient !== undefined ? (
            <button
              type="button"
              data-testid="followup-back"
              aria-label={t('followup.back')}
              onClick={() =>
                onBack !== undefined ? onBack() : onOpenPatient?.(patientId)
              }
              className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {t('followup.back')}
            </button>
          ) : null}
          <fieldset
            data-testid="followup-type"
            role="radiogroup"
            aria-label={t('followup.type.label')}
            className="flex items-center gap-3"
          >
            <legend className="sr-only">{t('followup.type.label')}</legend>
            {TYPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-1 text-sm"
              >
                <input
                  type="radio"
                  name="followup-type"
                  value={opt.value}
                  checked={type === opt.value}
                  onChange={() => {
                    setType(opt.value);
                    scheduleSave();
                  }}
                  className="focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {t(opt.key)}
              </label>
            ))}
          </fieldset>
        </div>
        <SaveIndicator status={status} savedHhmm={prevLabel} />
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {/* Pre-loaded complaints (VIS-002). */}
        <h2 className="mb-2 text-sm font-semibold">
          {t('followup.complaints.title')}
        </h2>
        {complaints.length === 0 ? (
          <p data-testid="followup-complaints-empty" className="text-slate-600">
            {t('followup.complaints.empty')}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {complaints.map((row, index) => (
              <ComplaintCard
                key={row.key}
                row={row}
                n={index + 1}
                onStatus={(s) => updateComplaint(index, { status: s })}
                onImprove={(v) => updateComplaint(index, { improvementPct: v })}
                onNote={(v) => updateComplaint(index, { note: v })}
                onBlur={() => void flushSave()}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          data-testid="followup-add-complaint"
          onClick={addComplaint}
          className="mt-3 rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          {t('followup.addComplaint')}
        </button>

        {/* Remedy response (VIS-003). */}
        <fieldset
          data-testid="followup-remedy-response"
          role="radiogroup"
          aria-label={t('followup.remedyResponse.label')}
          className="mt-5"
        >
          <legend className="mb-1 text-sm font-semibold">
            {t('followup.remedyResponse.label')}
          </legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {REMEDY_RESPONSE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-1 text-sm"
              >
                <input
                  type="radio"
                  name="followup-remedy-response"
                  value={opt.value}
                  checked={remedyResponse === opt.value}
                  onChange={() => {
                    setRemedyResponse(opt.value);
                    scheduleSave();
                  }}
                  className="focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {t(opt.key)}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Observations + vitals (VIS-001). */}
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold">
              {t('followup.observations.label')}
            </span>
            <textarea
              data-testid="followup-observations"
              value={observations}
              rows={3}
              onChange={(e) => {
                setObservations(e.target.value);
                scheduleSave();
              }}
              onBlur={() => void flushSave()}
              className="input"
              aria-label={t('followup.observations.label')}
            />
          </label>
          <fieldset>
            <legend className="mb-1 text-sm font-semibold">
              {t('followup.vitals.label')}
            </legend>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {VITAL_FIELDS.map((v) => (
                <label key={v.key} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-600">
                    {t(v.label)}
                  </span>
                  <input
                    data-testid={`followup-vital-${v.key}`}
                    type="number"
                    inputMode="numeric"
                    value={
                      vitals[v.key] === undefined ? '' : String(vitals[v.key])
                    }
                    onChange={(e) => setVital(v.key, e.target.value)}
                    onBlur={() => void flushSave()}
                    className="input"
                    aria-label={t(v.label)}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {/* Next follow-up (VIS-004) + R4/R9 scope-guarded controls. */}
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-slate-200 pt-4">
          <fieldset>
            <legend className="mb-1 text-sm font-semibold">
              {t('followup.nextFollowup.label')}
            </legend>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="followup-next-7d"
                onClick={() => onQuickFollowup(isoDatePlusDays(7))}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {t('followup.next.7d')}
              </button>
              <button
                type="button"
                data-testid="followup-next-15d"
                onClick={() => onQuickFollowup(isoDatePlusDays(15))}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {t('followup.next.15d')}
              </button>
              <button
                type="button"
                data-testid="followup-next-1m"
                onClick={() => onQuickFollowup(isoDatePlusMonths(1))}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {t('followup.next.1m')}
              </button>
              <button
                type="button"
                data-testid="followup-next-2m"
                onClick={() => onQuickFollowup(isoDatePlusMonths(2))}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {t('followup.next.2m')}
              </button>
              <label className="flex items-center gap-1 text-sm">
                <span className="text-xs font-medium text-slate-600">
                  {t('followup.next.custom')}
                </span>
                <input
                  data-testid="followup-next-custom"
                  type="date"
                  value={customDate}
                  onChange={(e) => onCustomFollowup(e.target.value)}
                  className="input"
                  aria-label={t('followup.next.custom')}
                />
              </label>
            </div>
          </fieldset>

          {/* Prescribe (S13) is R4: rendered but disabled — no dead end
              (ADR-0002). The progress chart (VIS-007) is R9 and is NOT
              rendered at all until its flag turns on. */}
          <button
            type="button"
            data-testid="followup-prescribe"
            disabled
            aria-disabled="true"
            title={t('followup.prescribe.comingLater')}
            onClick={() => onPrescribe?.()}
            className="cursor-not-allowed rounded bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-500"
          >
            {t('followup.prescribe')}
          </button>
        </div>
      </div>
    </section>
  );
}

/** One complaint row: status segmented control, improvement % slider, note. */
function ComplaintCard({
  row,
  n,
  onStatus,
  onImprove,
  onNote,
  onBlur,
}: {
  readonly row: ComplaintRow;
  readonly n: number;
  readonly onStatus: (status: ComplaintStatus) => void;
  readonly onImprove: (value: number) => void;
  readonly onNote: (value: string) => void;
  readonly onBlur: () => void;
}): JSX.Element {
  const title =
    row.location.trim() === '' ? row.text : `${row.text} (${row.location})`;
  return (
    <fieldset
      data-testid={`followup-complaint-${n}`}
      className="rounded border border-slate-200 p-3"
    >
      <legend className="px-1 text-sm font-semibold text-slate-700">
        {title}
      </legend>

      <div className="flex flex-wrap items-center gap-4">
        {/* Status segmented control (VIS-002) — aria-pressed per button, none
            pressed until the doctor marks it. */}
        <div
          data-testid={`followup-status-${n}`}
          role="group"
          aria-label={t('followup.status.label')}
          className="flex items-center gap-1"
        >
          <span className="mr-1 text-xs font-medium text-slate-600">
            {t('followup.status.label')}
          </span>
          {STATUS_OPTIONS.map((opt) => {
            const selected = row.status === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onStatus(opt.value)}
                onBlur={onBlur}
                className={[
                  'rounded border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-600',
                  selected
                    ? 'border-blue-600 bg-blue-50 font-semibold text-blue-800'
                    : 'border-slate-300 hover:bg-slate-100',
                ].join(' ')}
              >
                {t(opt.key)}
              </button>
            );
          })}
        </div>

        {/* Improvement % slider (VIS-002, VIS-OQ-3 optional, default 0). */}
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          {t('followup.improve.label')}
          <input
            data-testid={`followup-improve-${n}`}
            type="range"
            min={0}
            max={100}
            value={row.improvementPct}
            onChange={(e) => onImprove(Number(e.target.value))}
            onBlur={onBlur}
            aria-label={t('followup.improve.label')}
          />
          <span className="w-8 tabular-nums">{row.improvementPct}%</span>
        </label>
      </div>

      {/* Free-text note per complaint (VIS-002). */}
      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">
          {t('followup.note.label')}
        </span>
        <input
          data-testid={`followup-note-${n}`}
          value={row.note}
          onChange={(e) => onNote(e.target.value)}
          onBlur={onBlur}
          className="input"
          aria-label={t('followup.note.label')}
        />
      </label>
    </fieldset>
  );
}

/** Status-bar autosave indicator (Saving.../Saved hh:mm) (CASE-005). */
function SaveIndicator({
  status,
  savedHhmm,
}: {
  readonly status: SaveStatus;
  readonly savedHhmm: string;
}): JSX.Element {
  let text: string;
  if (status.kind === 'saving') {
    text = t('followup.save.saving');
  } else if (status.kind === 'saved') {
    text = `${t('followup.save.savedPrefix')} ${savedHhmm}`.trim();
  } else if (status.kind === 'error') {
    text = t('followup.save.error');
  } else {
    text = t('followup.save.idle');
  }
  return (
    <span
      data-testid="followup-save-status"
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
