// S03 Today — the default home screen (docs/ui/S03-today.md).
//
// R0 (HC-MVP1-009): with no patients yet, the screen renders its empty state —
// one sentence plus the primary "New patient" action (00-conventions §4). That
// behaviour MUST still hold when every bucket is empty.
//
// R3 (HC-MVP1-072, VIS-005): Today upgrades to three live, virtualised lists
// driven by the M3-A `today_get_overview` command — due-today, overdue and
// registered-today — plus the backup-warning banner (BAK-004, now live). Rows
// open the patient dashboard (S07) on click or Enter.
//
// Calls ONLY the generated typed bindings (UI -> typed commands only, never SQL
// or file paths; R-ARCH-006). The due/overdue classification is done and
// FakeClock-tested in the backend: the UI trusts the BUCKET a row arrives in
// and never re-derives due/overdue from dates (R-TEST anti-sleep). Every
// control / asserted value carries its S03 data-testid (R-UI-003); visible text
// comes from en.json (R-UI-007); dates go through shared/datetime (R-UI-006).
//
// Scope guardrails (R-DEL-002 / ADR-0002): the licence-reminder banner (LIC-021)
// is R8 and is NOT rendered here yet; saved-filter chips (PSR-010) are optional
// and omitted this slice. The "New patient" action stays gated by
// features.patients (disabled, non-navigable, no dead end) as at R0.
//
// Recorded non-blocking assumptions (surfaced from the S03 open questions):
// - ordering: overdue sorted most-overdue first, due-today by patient name.
// - registered_today counts saved visits only (MVP1).

import { UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { commands, type TodayPatientRow, type TodayVisitRow } from '@/bindings';
import { run } from '@/shared/command';
import { formatDateTime, todayIsoDate } from '@/shared/datetime';
import { features } from '@/shared/features';
import { t } from '@/shared/strings';

export interface TodayScreenProps {
  /** Invoked by the primary "New patient" action when the Patients flow ships. */
  onNewPatient?: () => void;
  /** Opens a patient's dashboard (S07) when a list row is activated (VIS-005). */
  onOpenPatient?: (patientId: string) => void;
  /** Opens the backup flow (S17) from the backup-warning banner (BAK-004). */
  onOpenBackup?: () => void;
}

/** The overview the three lists + banners render from (today_get_overview). */
interface Overview {
  readonly dueToday: readonly TodayPatientRow[];
  readonly overdue: readonly TodayPatientRow[];
  readonly registeredToday: readonly TodayVisitRow[];
  readonly backupWarning: string | null;
  readonly licenceReminder: string | null;
}

const EMPTY_OVERVIEW: Overview = {
  dueToday: [],
  overdue: [],
  registeredToday: [],
  backupWarning: null,
  licenceReminder: null,
};

/** Compare by patient name for the due-today ordering (recorded default). */
function byName(a: TodayPatientRow, b: TodayPatientRow): number {
  return a.name.localeCompare(b.name);
}

/**
 * Compare most-overdue first (recorded default): the earliest
 * `nextFollowupOn` sorts to the top. A missing date sorts last so a row with
 * no follow-up date never jumps ahead of a genuinely overdue patient.
 */
function byMostOverdue(a: TodayPatientRow, b: TodayPatientRow): number {
  const av = a.nextFollowupOn ?? '9999-12-31';
  const bv = b.nextFollowupOn ?? '9999-12-31';
  return av.localeCompare(bv);
}

/** The default home screen: empty state at R0, live lists from R3 (VIS-005). */
export function TodayScreen({
  onNewPatient,
  onOpenPatient,
  onOpenBackup,
}: TodayScreenProps): JSX.Element {
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW);

  // Load the three lists + banners in one call on mount (VIS-005). The today
  // date anchors the backend classification; the UI only renders the buckets
  // the command returns. A failure leaves the empty overview so the screen
  // still renders its empty state rather than crashing.
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const resp = await run(
          commands.todayGetOverview({ today: todayIsoDate() }),
        );
        if (!cancelled) setOverview(resp);
      } catch {
        if (!cancelled) setOverview(EMPTY_OVERVIEW);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dueToday = useMemo(
    () => [...overview.dueToday].sort(byName),
    [overview.dueToday],
  );
  const overdue = useMemo(
    () => [...overview.overdue].sort(byMostOverdue),
    [overview.overdue],
  );
  const registered = overview.registeredToday;

  const hasLists =
    dueToday.length > 0 || overdue.length > 0 || registered.length > 0;

  const patientsEnabled = features.patients;
  const hintId = patientsEnabled ? undefined : 'today-new-patient-hint';

  return (
    <section
      data-testid="today-screen"
      aria-label={t('nav.today')}
      className="flex h-full flex-col gap-4 p-6"
    >
      {/* Backup-warning banner (BAK-004) — the string is banner TEXT; no
          client-side date maths. */}
      {overview.backupWarning !== null ? (
        <div
          data-testid="today-backup-warning"
          role="alert"
          className="flex items-center justify-between gap-3 rounded border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
        >
          <span>{overview.backupWarning}</span>
          <button
            type="button"
            data-testid="today-backup-now"
            onClick={() => onOpenBackup?.()}
            className="rounded border border-amber-400 px-3 py-1 font-semibold hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-600"
          >
            {t('today.backup.now')}
          </button>
        </div>
      ) : null}

      {hasLists ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2">
            <PatientList
              testId="today-due-list"
              rowTestId="today-due-row"
              title={`${t('today.dueToday.title')} (${dueToday.length})`}
              rows={dueToday}
              context="due"
              onOpenPatient={onOpenPatient}
            />
            <PatientList
              testId="today-overdue-list"
              rowTestId="today-overdue-row"
              title={`${t('today.overdue.title')} (${overdue.length})`}
              rows={overdue}
              context="overdue"
              onOpenPatient={onOpenPatient}
            />
          </div>
          <RegisteredList rows={registered} onOpenPatient={onOpenPatient} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <p
            data-testid="today-empty"
            className="max-w-md text-base text-slate-700"
          >
            {t('today.empty.message')}
          </p>
          <button
            type="button"
            data-testid="today-new-patient"
            disabled={!patientsEnabled}
            aria-disabled={patientsEnabled ? undefined : true}
            aria-describedby={hintId}
            title={patientsEnabled ? undefined : t('nav.comingLater')}
            onClick={() => {
              if (patientsEnabled) onNewPatient?.();
            }}
            className={[
              'inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-700',
              patientsEnabled
                ? 'bg-blue-600 text-white'
                : 'cursor-not-allowed bg-slate-200 text-slate-500',
            ].join(' ')}
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {t('today.empty.action')}
          </button>
          {hintId ? (
            <span id={hintId} className="sr-only">
              {t('nav.comingLater')}
            </span>
          ) : null}
        </div>
      )}

      {/* Clear-dues PLACEHOLDER (Slice C6): billing arrives in R5 (BILL-001..
          002). Rendered as a clearly-disabled, no-op control so there is no
          dead end (R-DEL-002) and no fake money / math / network. */}
      <div className="flex flex-none justify-end border-t border-slate-100 pt-2">
        <button
          type="button"
          data-testid="today-clear-dues"
          disabled
          aria-disabled="true"
          title={t('today.clearDues.disabledHint')}
          className="cursor-not-allowed rounded border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm text-slate-400"
        >
          {t('today.clearDues.label')}
        </button>
      </div>
    </section>
  );
}

/** A virtualised-friendly patient list (due-today / overdue) (VIS-005). */
function PatientList({
  testId,
  rowTestId,
  title,
  rows,
  context,
  onOpenPatient,
}: {
  readonly testId: string;
  readonly rowTestId: string;
  readonly title: string;
  readonly rows: readonly TodayPatientRow[];
  readonly context: 'due' | 'overdue';
  readonly onOpenPatient?: ((patientId: string) => void) | undefined;
}): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-200"
    >
      <h2 className="flex-none border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm font-semibold">
        {title}
      </h2>
      <ul className="min-h-0 flex-1 overflow-auto">
        {rows.map((row) => (
          <li key={row.patientId}>
            <div
              data-testid={rowTestId}
              role="button"
              tabIndex={0}
              onClick={() => onOpenPatient?.(row.patientId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenPatient?.(row.patientId);
                }
              }}
              className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm hover:bg-slate-50 focus:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {row.name}{' '}
                  <span className="text-xs text-slate-500">{row.code}</span>
                </div>
                <div className="truncate text-xs text-slate-500">
                  {row.ageLabel}
                  {row.sex !== null ? ` ${row.sex}` : ''} ·{' '}
                  {context === 'due'
                    ? t('today.row.dueToday')
                    : `${t('today.row.overdueSuffix')}`}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Today's registered visits list (VIS-005; saved visits only, MVP1). */
function RegisteredList({
  rows,
  onOpenPatient,
}: {
  readonly rows: readonly TodayVisitRow[];
  readonly onOpenPatient?: ((patientId: string) => void) | undefined;
}): JSX.Element | null {
  if (rows.length === 0) return null;
  const title = `${t('today.registered.title')} (${rows.length})`;
  return (
    <section
      data-testid="today-registered-list"
      aria-label={t('today.registered.title')}
      className="flex max-h-64 min-h-0 flex-col overflow-hidden rounded border border-slate-200"
    >
      <h2 className="flex-none border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm font-semibold">
        {title}
      </h2>
      <ul className="min-h-0 flex-1 overflow-auto">
        {rows.map((row) => {
          const when = formatDateTime(row.visitAt);
          const hhmm = when !== null ? when.slice(-5) : '';
          return (
            <li key={`${row.patientId}-${row.visitAt}`}>
              <div
                data-testid="today-registered-row"
                role="button"
                tabIndex={0}
                onClick={() => onOpenPatient?.(row.patientId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenPatient?.(row.patientId);
                  }
                }}
                className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm hover:bg-slate-50 focus:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{row.name}</span>{' '}
                  <span className="text-xs text-slate-500">{row.code}</span>
                </div>
                <span className="text-xs text-slate-500">
                  {row.type} · {hhmm}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
