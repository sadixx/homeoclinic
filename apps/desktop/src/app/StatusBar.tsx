// Status bar of the app shell (00-conventions §2): autosave state, last backup
// and licence state. The "Last backup" chip is live (BAK-004): it loads the
// backup health via the typed `commands.getBackupStatus()` binding, shows the
// last good backup time, and when the last good backup is > 7 days old (or
// there is none) it turns to a WARNING style AND adds warning TEXT — never
// colour alone (00-conventions §5). Clicking the chip opens S17 (/backup).
import { useEffect, useState } from 'react';

import { commands, type BackupStatus } from '@/bindings';
import { run } from '@/shared/command';
import { formatDateTime } from '@/shared/datetime';
import { t } from '@/shared/strings';
import { useAppInfo } from '@/shared/useAppInfo';

export interface StatusBarProps {
  /** Invoked when the "Last backup" chip is activated (opens S17). */
  onOpenBackup?: () => void;
}

/** Thin bottom status bar (~24px). */
export function StatusBar({ onOpenBackup }: StatusBarProps): JSX.Element {
  const info = useAppInfo();
  const [backup, setBackup] = useState<BackupStatus | null>(null);

  useEffect(() => {
    let active = true;
    // The chip is best-effort chrome. Guard the call so a shell host that has
    // not wired this binding (or a transient read failure) leaves the
    // placeholder rather than throwing into the shell.
    try {
      void run(commands.getBackupStatus())
        .then((status) => {
          if (active) {
            setBackup(status);
          }
        })
        .catch(() => undefined);
    } catch {
      // getBackupStatus unavailable: keep the placeholder.
    }
    return () => {
      active = false;
    };
  }, []);

  const stale = backup?.stale === true;
  const when = backup !== null ? formatDateTime(backup.lastBackupAt) : null;
  const chipLabel =
    backup === null
      ? t('status.backup')
      : when === null
        ? t('status.backup.never')
        : `${t('status.backup.prefix')} ${when}`;

  return (
    <footer
      data-testid="status-bar"
      className="flex h-6 items-center gap-4 border-t border-slate-200 bg-slate-50 px-3 text-xs text-slate-600"
    >
      <span data-testid="status-autosave">{t('status.autosave')}</span>
      <button
        type="button"
        data-testid="status-backup"
        onClick={onOpenBackup}
        aria-label={t('status.backup.open')}
        title={t('status.backup.open')}
        className={[
          'rounded px-1 focus:outline-none focus:ring-2 focus:ring-blue-600',
          stale
            ? 'font-semibold text-amber-800'
            : 'text-slate-600 hover:text-slate-900',
        ].join(' ')}
      >
        {chipLabel}
        {stale ? (
          <span data-testid="status-backup-warning" className="ml-1">
            {t('status.backup.stale') === ''
              ? ''
              : `(${t('status.backup.stale')})`}
          </span>
        ) : null}
      </button>
      <span data-testid="status-licence">{t('status.licence')}</span>
      <span className="flex-1" />
      <span data-testid="status-appinfo">
        {info
          ? `${info.name} v${info.version} (${info.build_profile})`
          : `${t('app.name')} …`}
      </span>
    </footer>
  );
}
