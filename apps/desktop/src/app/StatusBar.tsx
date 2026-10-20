// Status bar of the app shell (00-conventions §2): autosave state, last backup
// and licence state. The "Last backup" chip is live (BAK-004): it loads the
// backup health via the typed `commands.getBackupStatus()` binding, shows the
// last good backup time, and when the last good backup is > 7 days old (or
// there is none) it turns to a WARNING style AND adds warning TEXT — never
// colour alone (00-conventions §5). Clicking the chip opens S17 (/backup).
import { useEffect, useState } from 'react';

import {
  commands,
  type BackupStatus,
  type LicenceKind,
  type LicenceStatus,
} from '@/bindings';
import { run } from '@/shared/command';
import { formatDate, formatDateTime } from '@/shared/datetime';
import { t } from '@/shared/strings';
import { useAppInfo } from '@/shared/useAppInfo';

export interface StatusBarProps {
  /** Invoked when the "Last backup" chip is activated (opens S17). */
  onOpenBackup?: () => void;
}

/** Resolve the i18n label for a licence kind. */
function licenceKindLabel(kind: LicenceKind): string {
  switch (kind) {
    case 'trial':
      return t('status.licence.kind.trial');
    case 'active':
      return t('status.licence.kind.active');
    case 'readonly':
      return t('status.licence.kind.readonly');
    case 'unlicensed':
      return t('status.licence.kind.unlicensed');
  }
}

/**
 * Compose the licence chip text from a {@link LicenceStatus}, e.g.
 * `Licence: Trial — expires 31-01-2026 (29 days left)`. Falls back to the
 * static `Licence: —` placeholder when the status is missing or carries an
 * unformattable expiry date (R-UI-006 date helper owns the format). The
 * days-remaining count and expiry are already computed by the backend from the
 * clock-guarded effective now (LIC-005), so the UI only displays them.
 */
function licenceLabel(status: LicenceStatus | null): string {
  if (status === null) {
    return t('status.licence');
  }
  const expiry = formatDate(status.validUntil);
  if (expiry === null) {
    return t('status.licence');
  }
  const kind = licenceKindLabel(status.kind);
  const tail = status.expired
    ? `(${t('status.licence.expired')})`
    : `(${status.daysRemaining} ${t('status.licence.daysLeftSuffix')})`;
  return `${t('status.licence.prefix')} ${kind} — ${t('status.licence.expiresPrefix')} ${expiry} ${tail}`;
}

/** Thin bottom status bar (~24px). */
export function StatusBar({ onOpenBackup }: StatusBarProps): JSX.Element {
  const info = useAppInfo();
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [licence, setLicence] = useState<LicenceStatus | null>(null);

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

  useEffect(() => {
    let active = true;
    // Licence chip (Feature 1): read the clock-guarded trial status. A failed
    // read (no licence, transport error) must leave the static "Licence: —"
    // placeholder and never throw into the shell (SUX: never lock out or scare
    // a genuine doctor over a chrome read).
    try {
      void run(commands.getLicenceStatus())
        .then((status) => {
          if (active) {
            setLicence(status);
          }
        })
        .catch(() => undefined);
    } catch {
      // getLicenceStatus unavailable: keep the placeholder.
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
      <span data-testid="status-licence">{licenceLabel(licence)}</span>
      <span className="flex-1" />
      <span data-testid="status-appinfo">
        {info
          ? `${info.name} v${info.version} (${info.build_profile})`
          : `${t('app.name')} …`}
      </span>
    </footer>
  );
}
