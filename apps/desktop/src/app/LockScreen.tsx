// S02 Lock/unlock — R0 stub (docs/ui/S02-lock-unlock.md). At M0 there is no PIN
// yet (setup does not exist), so this is a presentational stub: a centered card
// with a PIN field that is present but DISABLED and an inert Unlock button.
// Real verification and the recovery flow arrive at R1. Visible text comes from
// locales/en.json (R-UI-007).
import { t } from '@/shared/strings';

/** Full-window lock overlay stub with a disabled PIN entry. */
export function LockScreen(): JSX.Element {
  return (
    <div
      data-testid="lock-screen"
      className="flex h-full min-h-screen items-center justify-center bg-slate-100 p-8"
    >
      <div
        data-testid="lock-card"
        role="dialog"
        aria-label={t('lock.title')}
        className="flex w-[420px] flex-col items-center gap-4 rounded-lg border border-slate-200 bg-white p-8 shadow"
      >
        <span className="text-lg font-semibold text-slate-900">{t('app.name')}</span>

        <label htmlFor="lock-pin-input" className="w-full text-sm text-slate-700">
          {t('lock.title')}
        </label>
        <input
          id="lock-pin-input"
          data-testid="lock-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          disabled
          aria-disabled="true"
          className="h-10 w-full rounded border border-slate-300 px-3 text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100 disabled:text-slate-400"
        />

        <button
          type="button"
          data-testid="lock-unlock"
          disabled
          className="h-10 w-full rounded bg-blue-600 text-sm font-semibold text-white disabled:bg-slate-300 disabled:text-slate-500"
        >
          {t('lock.unlock')}
        </button>
      </div>
    </div>
  );
}
