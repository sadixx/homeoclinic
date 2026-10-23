// S07 Patient dashboard (docs/ui/S07-patient-dashboard.md; HC-MVP1-040/041/
// 042/043). PAT-005/006/008/011, BILL-002.
//
// Calls ONLY the generated typed bindings (UI -> typed commands only; never
// SQL or raw filesystem paths). Every control / asserted value carries its
// spec data-testid (R-UI-003); all visible text comes from en.json (R-UI-007).
//
// R2 slice (R-DEL-002): the visit timeline is HONEST-EMPTY (0 visits), the
// last-prescription card shows its honest-empty note, the dues badge shows
// Rs 0 (billing is R5), and the four consultation quick buttons (New visit /
// Repertorise / Prescribe / Bill) are HIDDEN — not disabled — so there is no
// dead end (ADR-0002 point 5). Demographics, alerts, family, recycle-bin
// (soft-delete + restore) and export (PDF/JSON) are REAL.

import { useCallback, useEffect, useState } from 'react';

import {
  commands,
  type PatientDashboard as PatientDashboardData,
} from '@/bindings';
import { run } from '@/shared/command';
import { formatDate } from '@/shared/datetime';
import { features } from '@/shared/features';
import { formatMobile } from '@/shared/mobile';
import { formatPaise } from '@/shared/money';
import { t } from '@/shared/strings';

export interface PatientDashboardProps {
  /** The patient to show. */
  readonly patientId: string;
  /** Open another patient's dashboard (family quick switch, PAT-006). */
  readonly onOpenPatient?: (patientId: string) => void;
  /** Open the S06 edit form for this patient. */
  readonly onEdit?: (patientId: string) => void;
  /** Go back to the list (S05). */
  readonly onBack?: () => void;
  /**
   * Start a new First visit / take the case for this patient (S08 entry
   * point). Shipped at R3 (CASE / VIS-001): replaces the R2 hidden-buttons
   * dead end with a real, enabled action.
   */
  readonly onTakeCase?: (patientId: string) => void;
  /**
   * Start a Follow-up visit for this patient (ADR 0018 #2: opens the journal
   * CaseForm in follow-up mode). The backend resolves the prior visit itself
   * (crates/hc-app visit::open_or_create -> latest_visit_for_patient +
   * seed_followup_data_json; VIS-002), so the UI does NOT need to pass one.
   * `prevVisitId` is therefore OPTIONAL and vestigial — a follow-up fires with
   * the patient id alone, even when the dashboard's visit list is empty/stale
   * right after the first case is saved (D1 fix). Shipped at R3.
   */
  readonly onNewFollowup?: (patientId: string, prevVisitId?: string) => void;
  /** Render already in the recycle bin (deep-link into a soft-deleted row). */
  readonly initiallyDeleted?: boolean;
}

/** The single-patient dashboard. */
export function PatientDashboard({
  patientId,
  onOpenPatient,
  onEdit,
  onBack,
  onTakeCase,
  onNewFollowup,
  initiallyDeleted = false,
}: PatientDashboardProps): JSX.Element {
  const [data, setData] = useState<PatientDashboardData | null>(null);
  const [errored, setErrored] = useState(false);
  const [deleted, setDeleted] = useState(initiallyDeleted);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // First-case gating (Slice C5, ADR 0018): once a saved `first` visit exists
  // for this patient, starting another first case is greyed and a Follow-up is
  // offered instead. The signal comes from the typed Slice A command, never a
  // client-side guess.
  const [hasSavedFirstCase, setHasSavedFirstCase] = useState(false);

  // Load the full patient in one call and record the open in the recent list
  // (PSR-007). A fresh load whenever the patient id changes (family switch).
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErrored(false);
    setConfirmingDelete(false);
    setDeleted(initiallyDeleted);
    void (async (): Promise<void> => {
      try {
        const d = await run(commands.patientGetDashboard({ patientId }));
        if (cancelled) return;
        setData(d);
      } catch {
        if (!cancelled) setErrored(true);
      }
      try {
        await run(commands.patientTouchRecent({ patientId }));
      } catch {
        /* recording the open is best-effort and never blocks the view */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, initiallyDeleted]);

  // First-case gating (Slice C5, ADR 0018): ask the typed Slice A command
  // whether a saved `first` visit already exists for this patient. A failed or
  // absent read leaves the gate OPEN (New visit enabled) so a genuine first
  // case is never blocked by a transport blip (no dead end). No patient data
  // is read into logs (R-PRIV-001).
  useEffect(() => {
    let cancelled = false;
    setHasSavedFirstCase(false);
    const cmd = commands.visitHasSavedFirstCase;
    if (typeof cmd !== 'function') return undefined;
    void (async (): Promise<void> => {
      try {
        const res = await run(cmd({ patientId }));
        if (!cancelled) setHasSavedFirstCase(res.hasSavedFirstCase);
      } catch {
        /* leave the gate open on failure — never block a real first case */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const onConfirmDelete = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await run(commands.patientSoftDelete({ patientId }));
      setDeleted(true);
      setConfirmingDelete(false);
    } catch {
      setErrored(true);
    } finally {
      setBusy(false);
    }
  }, [busy, patientId]);

  const onRestore = useCallback(async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await run(commands.patientRestore({ patientId }));
      setDeleted(false);
    } catch {
      setErrored(true);
    } finally {
      setBusy(false);
    }
  }, [busy, patientId]);

  const onExportPdf = useCallback((): void => {
    void run(commands.patientExportPdf({ patientId })).catch(() => {
      setErrored(true);
    });
  }, [patientId]);

  const onExportJson = useCallback((): void => {
    void run(commands.patientExportJson({ patientId })).catch(() => {
      setErrored(true);
    });
  }, [patientId]);

  if (errored && data === null) {
    return (
      <section
        data-testid="patient-dash-error"
        role="alert"
        className="p-6 text-sm text-red-700"
      >
        {t('patient.dash.error.message')}
      </section>
    );
  }

  if (data === null) {
    return (
      <section
        data-testid="patient-dash-loading"
        aria-busy="true"
        className="p-6 text-sm text-slate-500"
      >
        <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
      </section>
    );
  }

  const demo = data.demographics;
  // Pre-composed so the confirm dialog renders an identifier, not a JSX literal
  // (R-UI-007 / jsx-no-literals); the names come from the loaded record.
  const deleteTarget = `${demo.name} (${demo.code})`;

  return (
    <section
      aria-label={demo.name}
      className="flex flex-col gap-4 p-6 text-[0.875rem] text-slate-900"
    >
      {/* Recycle-bin banner (PAT-008) */}
      {deleted ? (
        <div
          role="status"
          data-testid="patient-dash-deleted-banner"
          className="flex items-center justify-between rounded border border-amber-400 bg-amber-50 p-2 text-sm"
        >
          <span>{t('patient.dash.deleted.banner')}</span>
          <button
            type="button"
            data-testid="patient-dash-restore"
            disabled={busy}
            onClick={() => void onRestore()}
            className="rounded bg-blue-600 px-3 py-1 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {t('patient.dash.restore')}
          </button>
        </div>
      ) : null}

      {/* Alerts banner: text + role, never colour alone (PAT-005, §5) */}
      {data.allergies || data.alerts ? (
        <div
          role="alert"
          data-testid="patient-dash-alerts"
          className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800"
        >
          {data.allergies ? (
            <span className="mr-3">
              <strong>{t('patient.dash.alerts.allergy')}</strong>{' '}
              {data.allergies}
            </span>
          ) : null}
          {data.alerts ? (
            <span>
              <strong>{t('patient.dash.alerts.alert')}</strong> {data.alerts}
            </span>
          ) : null}
        </div>
      ) : null}

      <header className="flex items-start justify-between gap-4">
        <div className="flex gap-4">
          {/* Photo */}
          <div
            data-testid="patient-dash-photo"
            className="flex h-28 w-28 flex-none items-center justify-center overflow-hidden rounded border border-slate-300 bg-slate-50 text-xs text-slate-400"
          >
            {demo.photoPath ? (
              <img
                src={demo.photoPath}
                alt={demo.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <span>{t('patient.dash.photo.none')}</span>
            )}
          </div>

          {/* Demographics block (PAT-005) */}
          <div
            data-testid="patient-dash-demographics"
            className="flex flex-col gap-0.5"
          >
            <span className="text-lg font-semibold">{demo.name}</span>
            <span className="text-slate-500">
              {demo.code} · {demo.ageLabel}
              {demo.sex ? ` · ${demo.sex}` : ''}
            </span>
            <span className="text-slate-600">
              {formatMobile(demo.mobile)} · {demo.city ?? t('common.none')}
            </span>
            {demo.referredBy ? (
              <span className="text-slate-600">
                {t('patient.dash.referred')} {demo.referredBy}
              </span>
            ) : null}
            <span
              data-testid="patient-dash-dues"
              className="mt-1 inline-flex w-fit rounded bg-slate-100 px-2 py-0.5 text-slate-700"
            >
              {t('patient.dash.dues')} {t('common.duesPrefix')}
              {formatPaise(data.duesPaise)}
            </span>
          </div>
        </div>

        {/* Record actions */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            data-testid="patient-dash-back"
            onClick={() => onBack?.()}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('patient.dash.back')}
          </button>
          <button
            type="button"
            data-testid="patient-dash-edit"
            onClick={() => onEdit?.(patientId)}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('patient.dash.edit')}
          </button>
          <button
            type="button"
            data-testid="patient-dash-export-pdf"
            onClick={onExportPdf}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('patient.dash.exportPdf')}
          </button>
          <button
            type="button"
            data-testid="patient-dash-export-json"
            onClick={onExportJson}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('patient.dash.exportJson')}
          </button>
          {!deleted ? (
            <button
              type="button"
              data-testid="patient-dash-delete"
              onClick={() => setConfirmingDelete(true)}
              className="rounded border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {t('patient.dash.delete')}
            </button>
          ) : null}
        </div>
      </header>

      {/* Consultation entry (S08). At R3 the case form ships, so the "New
          visit / Take case" action is REAL and enabled — flipping the R2
          dead-end (buttons hidden, ADR-0002) into a working entry point. It is
          compile-time gated on features.case so a pre-R3 build still hides it,
          and suppressed while the record is in the recycle bin. Repertorise /
          Prescribe / Bill stay hidden until their screens ship (R5+). */}
      {features.case && !deleted ? (
        <div
          data-testid="patient-dash-consult"
          className="flex flex-wrap items-center gap-2"
        >
          <h2 className="sr-only">{t('patient.dash.consult.title')}</h2>
          <button
            type="button"
            data-testid="patient-dash-new-visit"
            disabled={hasSavedFirstCase}
            aria-disabled={hasSavedFirstCase ? true : undefined}
            title={
              hasSavedFirstCase
                ? t('patient.dash.newVisit.gatedHint')
                : undefined
            }
            onClick={() => {
              // Once the first case is saved (ADR 0018), starting another first
              // case is greyed — the doctor uses Follow-up instead.
              if (hasSavedFirstCase) return;
              // A patient with a prior visit routes to a Follow-up (S09); with
              // no prior visit, start a First case (S08). The follow-up does
              // NOT need a prevVisitId — the backend resolves the prior visit
              // itself (open_or_create -> latest_visit_for_patient), so the
              // click fires even when `data.visits` is empty/stale (D1 fix).
              const hasPrior = data.visits.length > 0;
              if (hasPrior && onNewFollowup !== undefined) {
                onNewFollowup(patientId);
              } else {
                onTakeCase?.(patientId);
              }
            }}
            className={[
              'rounded px-3 py-1.5 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-700',
              hasSavedFirstCase
                ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                : 'bg-blue-600 text-white hover:bg-blue-700',
            ].join(' ')}
          >
            {t('patient.dash.newVisit')}
          </button>
          {/* When the first case is gated, offer Follow-up instead so there is
              no dead end (ADR 0018: "offer Follow-up instead"). */}
          {hasSavedFirstCase ? (
            <button
              type="button"
              data-testid="patient-dash-followup"
              onClick={() => {
                // D1 fix: fire the follow-up UNCONDITIONALLY — do NOT gate on
                // `data.visits`. Right after the first case is saved the visit
                // list is empty/stale, so the old `prev !== undefined` guard
                // made this click a silent no-op (CaseRoute never mounted). The
                // backend resolves the prior visit itself (open_or_create ->
                // latest_visit_for_patient + seed_followup_data_json, VIS-002),
                // so the patient id alone is enough; prevVisitId is vestigial.
                onNewFollowup?.(patientId);
              }}
              className="rounded bg-blue-600 px-3 py-1.5 font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700"
            >
              {t('patient.dash.followup')}
            </button>
          ) : null}
          <button
            type="button"
            data-testid="patient-dash-take-case"
            onClick={() => onTakeCase?.(patientId)}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('patient.dash.takeCase')}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Visit timeline — HONEST-EMPTY at R2 */}
        <div>
          <h2 className="mb-1 text-xs font-semibold uppercase text-slate-500">
            {t('patient.dash.visits.title')}
          </h2>
          <div
            data-testid="patient-dash-timeline"
            className="rounded border border-slate-200"
          >
            {data.visits.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">
                {t('patient.dash.visits.empty')}
              </p>
            ) : (
              <ul>
                {data.visits.map((v) => (
                  <li
                    key={v.visitId}
                    data-testid="patient-dash-visit-row"
                    className="flex items-center justify-between border-b border-slate-100 px-3 py-2 last:border-0"
                  >
                    <span>{formatDate(v.visitAt) ?? t('common.none')}</span>
                    <span className="text-slate-600">{v.kind}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* Last prescription — honest-empty at R2 */}
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase text-slate-500">
              {t('patient.dash.lastRx.title')}
            </h2>
            <div
              data-testid="patient-dash-last-rx"
              className="rounded border border-slate-200 p-3 text-sm text-slate-500"
            >
              {data.lastPrescription === null
                ? t('patient.dash.lastRx.none')
                : data.lastPrescription.itemsPreview}
            </div>
          </div>

          {/* Family links + quick switch (PAT-006) */}
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase text-slate-500">
              {t('patient.dash.family')}
            </h2>
            <ul
              data-testid="patient-dash-family"
              className="flex flex-col gap-1"
            >
              {data.family.length === 0 ? (
                <li className="text-sm text-slate-500">{t('common.none')}</li>
              ) : (
                data.family.map((m) => {
                  const relationLabel = `(${m.relation})`;
                  return (
                    <li
                      key={m.patientId}
                      className="flex items-center justify-between rounded border border-slate-200 px-2 py-1 text-sm"
                    >
                      <span>
                        {m.name}{' '}
                        <span className="text-slate-500">{relationLabel}</span>
                      </span>
                      <button
                        type="button"
                        data-testid={`patient-dash-family-switch-${m.patientId}`}
                        onClick={() => onOpenPatient?.(m.patientId)}
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        {t('patient.dash.family.switch')}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* Move-to-bin confirm dialog, names the patient (PAT-008, §4) */}
      {confirmingDelete ? (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="patient-dash-delete-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          aria-label={t('patient.dash.delete')}
        >
          <div className="w-[26rem] rounded border border-slate-300 bg-white p-4 shadow-lg">
            <p className="mb-3 text-sm">
              {t('patient.dash.delete.confirmPrefix')} {deleteTarget}{' '}
              {t('patient.dash.delete.confirmSuffix')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="patient-dash-delete-cancel"
                onClick={() => setConfirmingDelete(false)}
                className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {t('patient.dash.delete.cancel')}
              </button>
              <button
                type="button"
                data-testid="patient-dash-delete-confirm"
                disabled={busy}
                onClick={() => void onConfirmDelete()}
                className="rounded bg-red-600 px-3 py-1.5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {t('patient.dash.delete.confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
