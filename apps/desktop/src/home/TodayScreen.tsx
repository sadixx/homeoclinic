// S03 Today — R0 empty state (docs/ui/S03-today.md). At M0 there are no patients
// yet, so the screen renders its empty state: one sentence plus the primary
// "New patient" action (00-conventions §4 empty-state pattern). All visible text
// comes from locales/en.json (R-UI-007).
//
// R-DEL-002: "New patient" starts the Patients flow, which does not ship at M0.
// The action is gated by the compile-time flag `features.patients`. When OFF it
// is rendered VISIBLY DISABLED and NON-NAVIGABLE (native `disabled`,
// aria-disabled, an accessible hint that it arrives in a later update) rather
// than hidden, so the empty state still reads coherently and does not dead-end.
import { UserPlus } from 'lucide-react';

import { features } from '@/shared/features';
import { t } from '@/shared/strings';

export interface TodayScreenProps {
  /** Invoked by the primary "New patient" action when the Patients flow ships. */
  onNewPatient?: () => void;
}

/** The default home screen, empty state at R0. */
export function TodayScreen({ onNewPatient }: TodayScreenProps): JSX.Element {
  const patientsEnabled = features.patients;
  const hintId = patientsEnabled ? undefined : 'today-new-patient-hint';

  return (
    <section
      data-testid="today-screen"
      aria-label={t('nav.today')}
      className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
    >
      <p data-testid="today-empty" className="max-w-md text-base text-slate-700">
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
          if (patientsEnabled) {
            onNewPatient?.();
          }
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
    </section>
  );
}
