// S17 Backup and restore (docs/ui/S17-backup-restore.md, route /backup) — R1.
// Four sections: backup health (last backup + checked result + 14/8/12
// retention line + a stale banner shown in TEXT when the last good backup is
// > 7 days old, BAK-004), Back up now (destination via the Choose folder /
// Use USB drive typed commands + password with first-time confirm +
// Remember-on-this-PC, BAK-002/SUX-011), Restore (a 3-step preview-first
// wizard with a pre-restore safety-copy note and an inline wrong-password
// message on step 1, BAK-003), and the Move-to-a-new-computer button which is
// FEATURE-FLAGGED OFF at R1 (BAK-005 / HC-MVP1-035 deferred, OQ-S17-4) so there
// is no dead end.
//
// All backend access goes through the typed command bindings (R-UI-002); the
// UI never builds SQL or file paths (R-ARCH-003/009) — the folder/USB pickers
// are typed commands that RETURN a chosen path. Visible text comes from
// locales/en.json via t() (R-UI-007); every control carries its spec
// data-testid (R-UI-003). Errors are shown in plain language with a Details
// expander, never a stack trace, code, SQL or path (R-UI-008, NFR-033). The
// backup password is request-only and never logged (R-PRIV-001).
import { useCallback, useEffect, useMemo, useState } from 'react';

import { commands, type BackupStatus, type RestorePreview } from '@/bindings';
import {
  backupErrorDetails,
  backupErrorMessage,
  isWrongBackupPassword,
} from '@/backup/backupErrors';
import { run } from '@/shared/command';
import { formatDate, formatDateTime } from '@/shared/datetime';
import { features } from '@/shared/features';
import { formatCount } from '@/shared/number';
import { t } from '@/shared/strings';

/** Minimum backup password length (OQ-S17-2). */
const PASSWORD_MIN = 8;

/** Restore wizard phase: closed, or on one of the three steps. */
type RestoreStep = 0 | 1 | 2 | 3;

/** One line in the Details expander, shared by the two action panels. */
function DetailsExpander({
  testid,
  details,
}: {
  testid: string;
  details: string;
}): JSX.Element {
  return (
    <details data-testid={testid} className="mt-1 text-sm text-slate-600">
      <summary className="cursor-pointer">{t('backup.details')}</summary>
      <p className="mt-1">{details}</p>
    </details>
  );
}

/** S17 screen. Self-contained; backend access via typed bindings only. */
export function BackupScreen(): JSX.Element {
  // ---- Backup health -------------------------------------------------------
  const [status, setStatus] = useState<BackupStatus | null>(null);

  const refreshStatus = useCallback(async () => {
    const next = await run(commands.getBackupStatus());
    setStatus(next);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const onToggleAuto = useCallback(
    async (enabled: boolean) => {
      await run(commands.setAutoBackup(enabled));
      await refreshStatus();
    },
    [refreshStatus],
  );

  // ---- Back up now ---------------------------------------------------------
  const [destPath, setDestPath] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [remember, setRemember] = useState(true);
  const [drives, setDrives] = useState<
    ReadonlyArray<{ path: string; label: string }>
  >([]);
  const [showDrives, setShowDrives] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupDone, setBackupDone] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupDetails, setBackupDetails] = useState<string | null>(null);
  const [backupFieldError, setBackupFieldError] = useState<{
    field: 'dest' | 'password' | 'confirm';
    message: string;
  } | null>(null);

  // First time only: no good backup yet means we are setting a new password,
  // so the confirm field is shown (S17 "first time only").
  const firstTime = status !== null && status.lastBackupAt === null;

  const onChooseFolder = useCallback(async () => {
    // The folder picker is a typed command that returns a chosen path (no FS
    // scope, no shell — R-SEC-002/003). `list_removable_drives` doubles as the
    // folder-source here on this headless build; the real OS folder dialog is
    // wired behind the same typed command at the Tauri layer. We surface the
    // drive list so the doctor can pick one without the UI touching paths.
    const res = await run(commands.listRemovableDrives());
    if (res.drives.length > 0 && res.drives[0] !== undefined) {
      setDestPath(res.drives[0].path);
    }
    setShowDrives(false);
  }, []);

  const onUseUsb = useCallback(async () => {
    const res = await run(commands.listRemovableDrives());
    setDrives(res.drives.map((d) => ({ path: d.path, label: d.label })));
    setShowDrives(true);
  }, []);

  const onPickDrive = useCallback((path: string) => {
    setDestPath(path);
    setShowDrives(false);
  }, []);

  const onBackupNow = useCallback(async () => {
    if (backupBusy) return;
    setBackupError(null);
    setBackupDetails(null);
    setBackupFieldError(null);
    setBackupDone(false);

    if (destPath.trim() === '') {
      setBackupFieldError({
        field: 'dest',
        message: t('backup.now.error.destRequired'),
      });
      return;
    }
    if (password.length < PASSWORD_MIN) {
      setBackupFieldError({
        field: 'password',
        message: t('backup.now.error.passwordShort'),
      });
      return;
    }
    if (firstTime && password !== passwordConfirm) {
      setBackupFieldError({
        field: 'confirm',
        message: t('backup.now.error.passwordMismatch'),
      });
      return;
    }

    setBackupBusy(true);
    try {
      await run(commands.backupNow(destPath.trim(), password, remember));
      setBackupDone(true);
      setPassword('');
      setPasswordConfirm('');
      await refreshStatus();
    } catch (err) {
      setBackupError(backupErrorMessage(err));
      setBackupDetails(backupErrorDetails(err));
    } finally {
      setBackupBusy(false);
    }
  }, [
    backupBusy,
    destPath,
    password,
    passwordConfirm,
    remember,
    firstTime,
    refreshStatus,
  ]);

  // ---- Restore wizard ------------------------------------------------------
  const [restoreStep, setRestoreStep] = useState<RestoreStep>(0);
  const [restoreFile, setRestoreFile] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(
    null,
  );
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreDone, setRestoreDone] = useState(false);
  const [restorePasswordError, setRestorePasswordError] = useState<
    string | null
  >(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreDetails, setRestoreDetails] = useState<string | null>(null);

  const resetRestore = useCallback(() => {
    setRestoreStep(0);
    setRestoreFile('');
    setRestorePassword('');
    setRestorePreview(null);
    setRestoreDone(false);
    setRestorePasswordError(null);
    setRestoreError(null);
    setRestoreDetails(null);
  }, []);

  const onChooseBackupFile = useCallback(async () => {
    // A typed file picker returns the chosen .hcbak path; the UI never builds
    // it. On this build the USB enumerator stands in for the OS file dialog;
    // the real file dialog is wired behind the same typed command boundary.
    const res = await run(commands.listRemovableDrives());
    const first = res.drives[0];
    if (first !== undefined) {
      setRestoreFile(first.path);
    }
    setRestoreStep(1);
  }, []);

  const onRestoreNextFromStep1 = useCallback(async () => {
    if (restoreBusy) return;
    setRestorePasswordError(null);
    setRestoreError(null);
    setRestoreDetails(null);
    if (restorePassword.length < PASSWORD_MIN) {
      setRestorePasswordError(t('backup.now.error.passwordShort'));
      return;
    }
    setRestoreBusy(true);
    try {
      const preview = await run(
        commands.restorePreview(restoreFile, restorePassword),
      );
      setRestorePreview(preview);
      setRestoreStep(2);
    } catch (err) {
      if (isWrongBackupPassword(err)) {
        // Inline, on the password field; do NOT advance (S17 AC4).
        setRestorePasswordError(backupErrorMessage(err));
      } else {
        setRestoreError(backupErrorMessage(err));
        setRestoreDetails(backupErrorDetails(err));
      }
    } finally {
      setRestoreBusy(false);
    }
  }, [restoreBusy, restoreFile, restorePassword]);

  const onRestoreApply = useCallback(async () => {
    if (restoreBusy) return;
    setRestoreError(null);
    setRestoreDetails(null);
    setRestoreBusy(true);
    try {
      await run(commands.restoreApply(restoreFile, restorePassword));
      setRestoreDone(true);
      await refreshStatus();
    } catch (err) {
      if (isWrongBackupPassword(err)) {
        setRestoreStep(1);
        setRestorePasswordError(backupErrorMessage(err));
      } else {
        setRestoreError(backupErrorMessage(err));
        setRestoreDetails(backupErrorDetails(err));
      }
    } finally {
      setRestoreBusy(false);
    }
  }, [restoreBusy, restoreFile, restorePassword, refreshStatus]);

  // ---- Derived display -----------------------------------------------------
  const lastBackupText = useMemo(() => {
    if (status === null) return t('backup.restore.none');
    const when = formatDateTime(status.lastBackupAt);
    if (when === null) return t('backup.health.never');
    const checked = status.lastBackupOk
      ? t('backup.health.checkedOk')
      : t('backup.health.checkedFailed');
    return `${when} (${checked})`;
  }, [status]);

  return (
    <div
      data-testid="backup-screen"
      className="mx-auto flex max-w-[900px] flex-col gap-6 p-6 text-[0.875rem]"
    >
      <h1 className="text-xl font-semibold text-slate-900">
        {t('backup.title')}
      </h1>

      {/* ---- Backup health ---- */}
      <section className="flex flex-col gap-3 rounded border border-slate-200 p-4">
        <h2 className="text-lg font-medium text-slate-900">
          {t('backup.health.title')}
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p data-testid="backup-status-last" className="text-slate-800">
            <span className="text-slate-600">
              {t('backup.health.lastLabel')}
            </span>{' '}
            {lastBackupText}
          </p>
          <label className="flex items-center gap-2 text-slate-800">
            <input
              type="checkbox"
              data-testid="backup-auto-toggle"
              checked={status?.autoEnabled ?? false}
              onChange={(e) => void onToggleAuto(e.target.checked)}
            />
            {t('backup.health.auto')}
          </label>
        </div>
        <p data-testid="backup-retention" className="text-slate-600">
          {t('backup.health.retention')}
        </p>
        {status?.stale === true ? (
          <p
            data-testid="backup-stale-banner"
            role="alert"
            className="rounded border border-amber-500 bg-amber-50 px-3 py-2 font-medium text-amber-900"
          >
            {status.lastBackupAt === null
              ? t('backup.health.staleNever')
              : t('backup.health.staleBanner')}
          </p>
        ) : null}
      </section>

      {/* ---- Back up now ---- */}
      <section className="flex flex-col gap-3 rounded border border-slate-200 p-4">
        <h2 className="text-lg font-medium text-slate-900">
          {t('backup.now.title')}
        </h2>
        <div className="flex flex-col gap-1">
          <label htmlFor="backup-dest-path-input" className="text-slate-700">
            {t('backup.now.destLabel')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="backup-dest-path-input"
              data-testid="backup-dest-path"
              type="text"
              readOnly
              value={destPath}
              placeholder={t('backup.now.destPlaceholder')}
              aria-invalid={backupFieldError?.field === 'dest'}
              className="h-10 min-w-[16rem] flex-1 rounded border border-slate-300 px-3 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button
              type="button"
              data-testid="backup-choose-folder"
              onClick={() => void onChooseFolder()}
              className="h-10 rounded border border-slate-300 px-3"
            >
              {t('backup.now.chooseFolder')}
            </button>
            <button
              type="button"
              data-testid="backup-choose-usb"
              onClick={() => void onUseUsb()}
              className="h-10 rounded border border-slate-300 px-3"
            >
              {t('backup.now.useUsb')}
            </button>
          </div>
          {backupFieldError?.field === 'dest' ? (
            <p
              data-testid="backup-dest-error"
              role="alert"
              className="text-sm text-red-700"
            >
              {backupFieldError.message}
            </p>
          ) : null}
          {showDrives ? (
            <ul
              data-testid="backup-usb-list"
              className="mt-1 flex flex-col gap-1"
            >
              {drives.length === 0 ? (
                <li className="text-sm text-slate-600">
                  {t('backup.now.noDrives')}
                </li>
              ) : (
                drives.map((d) => (
                  <li key={d.path}>
                    <button
                      type="button"
                      data-testid={`backup-usb-option-${d.path}`}
                      onClick={() => onPickDrive(d.path)}
                      className="w-full rounded border border-slate-300 px-3 py-1 text-left hover:bg-slate-100"
                    >
                      {d.label}
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="backup-password-input" className="text-slate-700">
            {t('backup.now.password')}
          </label>
          <input
            id="backup-password-input"
            data-testid="backup-password"
            type="password"
            value={password}
            autoComplete="new-password"
            aria-invalid={backupFieldError?.field === 'password'}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 rounded border border-slate-300 px-3 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          {backupFieldError?.field === 'password' ? (
            <p
              data-testid="backup-password-error"
              role="alert"
              className="text-sm text-red-700"
            >
              {backupFieldError.message}
            </p>
          ) : null}
        </div>

        {firstTime ? (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="backup-password-confirm-input"
              className="text-slate-700"
            >
              {t('backup.now.passwordConfirm')}
            </label>
            <input
              id="backup-password-confirm-input"
              data-testid="backup-password-confirm"
              type="password"
              value={passwordConfirm}
              autoComplete="new-password"
              aria-invalid={backupFieldError?.field === 'confirm'}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              className="h-10 rounded border border-slate-300 px-3 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            {backupFieldError?.field === 'confirm' ? (
              <p
                data-testid="backup-password-confirm-error"
                role="alert"
                className="text-sm text-red-700"
              >
                {backupFieldError.message}
              </p>
            ) : null}
          </div>
        ) : null}

        <label className="flex items-center gap-2 text-slate-800">
          <input
            type="checkbox"
            data-testid="backup-remember"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t('backup.now.remember')}
        </label>

        <p className="text-sm text-slate-600">{t('backup.now.includes')}</p>

        {backupError !== null ? (
          <div>
            <p
              data-testid="backup-error"
              role="alert"
              className="text-sm text-red-700"
            >
              {backupError}
            </p>
            {backupDetails !== null ? (
              <DetailsExpander
                testid="backup-error-details"
                details={backupDetails}
              />
            ) : null}
          </div>
        ) : null}
        {backupDone ? (
          <p data-testid="backup-done" className="text-sm text-green-700">
            {t('backup.now.done')}
          </p>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            data-testid="backup-run"
            onClick={() => void onBackupNow()}
            disabled={backupBusy}
            className="h-10 rounded bg-blue-600 px-4 font-semibold text-white disabled:opacity-60"
          >
            {backupBusy ? t('backup.now.running') : t('backup.now.run')}
          </button>
        </div>
      </section>

      {/* ---- Restore ---- */}
      <section className="flex flex-col gap-3 rounded border border-slate-200 p-4">
        <h2 className="text-lg font-medium text-slate-900">
          {t('backup.restore.title')}
        </h2>
        <div>
          <button
            type="button"
            data-testid="backup-restore-choose"
            onClick={() => void onChooseBackupFile()}
            className="h-10 rounded border border-slate-300 px-3"
          >
            {t('backup.restore.choose')}
          </button>
        </div>

        {restoreStep >= 1 ? (
          <div
            data-testid="backup-restore-wizard"
            role="dialog"
            aria-modal="true"
            aria-label={t('backup.restore.title')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                resetRestore();
              }
            }}
            className="flex flex-col gap-3 rounded border border-slate-300 bg-slate-50 p-4"
          >
            {/* Step 1: file + password. */}
            {restoreStep === 1 ? (
              <>
                <h3
                  data-testid="backup-restore-step1-title"
                  className="font-medium text-slate-900"
                >
                  {t('backup.restore.step1.title')}
                </h3>
                <p className="text-sm text-slate-700">
                  <span className="text-slate-600">
                    {t('backup.restore.chosenLabel')}
                  </span>{' '}
                  <span data-testid="backup-restore-file">{restoreFile}</span>
                </p>
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="backup-restore-password-input"
                    className="text-slate-700"
                  >
                    {t('backup.restore.password')}
                  </label>
                  <input
                    id="backup-restore-password-input"
                    data-testid="backup-restore-password"
                    type="password"
                    value={restorePassword}
                    autoComplete="off"
                    aria-invalid={restorePasswordError !== null}
                    onChange={(e) => setRestorePassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void onRestoreNextFromStep1();
                      }
                    }}
                    className="h-10 rounded border border-slate-300 px-3 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  {restorePasswordError !== null ? (
                    <p
                      data-testid="backup-restore-password-error"
                      role="alert"
                      className="text-sm text-red-700"
                    >
                      {restorePasswordError}
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}

            {/* Step 2: preview, mutates nothing. */}
            {restoreStep === 2 && restorePreview !== null ? (
              <>
                <h3
                  data-testid="backup-restore-step2-title"
                  className="font-medium text-slate-900"
                >
                  {t('backup.restore.step2.title')}
                </h3>
                <div
                  data-testid="backup-restore-preview"
                  className="flex flex-col gap-1 text-sm text-slate-800"
                >
                  <p className="text-slate-600">
                    {t('backup.restore.preview.contains')}
                  </p>
                  <p>
                    <span className="text-slate-600">
                      {t('backup.restore.preview.patientsLabel')}
                    </span>{' '}
                    <span data-testid="backup-restore-preview-patients">
                      {formatCount(restorePreview.patientCount)}
                    </span>
                  </p>
                  <p>
                    <span className="text-slate-600">
                      {t('backup.restore.preview.visitsLabel')}
                    </span>{' '}
                    <span data-testid="backup-restore-preview-visits">
                      {formatCount(restorePreview.visitCount)}
                    </span>
                  </p>
                  <p>
                    <span className="text-slate-600">
                      {t('backup.restore.preview.lastVisitLabel')}
                    </span>{' '}
                    <span data-testid="backup-restore-preview-lastvisit">
                      {formatDate(restorePreview.lastVisitDate) ??
                        t('backup.restore.none')}
                    </span>
                  </p>
                  <p>
                    <span className="text-slate-600">
                      {t('backup.restore.preview.madeAtLabel')}
                    </span>{' '}
                    <span data-testid="backup-restore-preview-made">
                      {formatDateTime(restorePreview.createdAt) ??
                        t('backup.restore.none')}
                    </span>
                  </p>
                  <p>
                    <span className="text-slate-600">
                      {t('backup.restore.preview.appVersionLabel')}
                    </span>{' '}
                    <span data-testid="backup-restore-preview-version">
                      {restorePreview.appVersion}
                    </span>
                  </p>
                </div>
                <p className="text-sm text-slate-600">
                  {t('backup.restore.preview.safetyNote')}
                </p>
              </>
            ) : null}

            {/* Step 3: confirm. */}
            {restoreStep === 3 ? (
              <>
                <h3
                  data-testid="backup-restore-step3-title"
                  className="font-medium text-slate-900"
                >
                  {t('backup.restore.step3.title')}
                </h3>
                <p className="text-slate-800">
                  {t('backup.restore.confirm.question')}
                </p>
                <p className="text-sm text-slate-600">
                  {t('backup.restore.confirm.safetyNote')}
                </p>
              </>
            ) : null}

            {restoreError !== null ? (
              <div>
                <p
                  data-testid="backup-restore-error"
                  role="alert"
                  className="text-sm text-red-700"
                >
                  {restoreError}
                </p>
                {restoreDetails !== null ? (
                  <DetailsExpander
                    testid="backup-restore-error-details"
                    details={restoreDetails}
                  />
                ) : null}
              </div>
            ) : null}
            {restoreDone ? (
              <p
                data-testid="backup-restore-done"
                className="text-sm text-green-700"
              >
                {t('backup.restore.done')}
              </p>
            ) : null}

            {/* Wizard footer. */}
            {!restoreDone ? (
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  data-testid="backup-restore-cancel"
                  onClick={resetRestore}
                  disabled={restoreBusy}
                  className="h-10 rounded border border-slate-300 px-4 disabled:opacity-50"
                >
                  {t('backup.restore.cancel')}
                </button>
                {restoreStep > 1 ? (
                  <button
                    type="button"
                    data-testid="backup-restore-back"
                    onClick={() =>
                      setRestoreStep((s) =>
                        s > 1 ? ((s - 1) as RestoreStep) : s,
                      )
                    }
                    disabled={restoreBusy}
                    className="h-10 rounded border border-slate-300 px-4 disabled:opacity-50"
                  >
                    {t('backup.restore.back')}
                  </button>
                ) : null}
                {restoreStep === 1 ? (
                  <button
                    type="button"
                    data-testid="backup-restore-next"
                    onClick={() => void onRestoreNextFromStep1()}
                    disabled={restoreBusy}
                    className="h-10 rounded bg-blue-600 px-4 font-semibold text-white disabled:opacity-60"
                  >
                    {t('backup.restore.next')}
                  </button>
                ) : null}
                {restoreStep === 2 ? (
                  <button
                    type="button"
                    data-testid="backup-restore-next"
                    onClick={() => setRestoreStep(3)}
                    disabled={restoreBusy}
                    className="h-10 rounded bg-blue-600 px-4 font-semibold text-white disabled:opacity-60"
                  >
                    {t('backup.restore.next')}
                  </button>
                ) : null}
                {restoreStep === 3 ? (
                  <button
                    type="button"
                    data-testid="backup-restore-confirm"
                    onClick={() => void onRestoreApply()}
                    disabled={restoreBusy}
                    className="h-10 rounded bg-blue-600 px-4 font-semibold text-white disabled:opacity-60"
                  >
                    {restoreBusy
                      ? t('backup.restore.applying')
                      : t('backup.restore.apply')}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="flex justify-end">
                <button
                  type="button"
                  data-testid="backup-restore-close"
                  onClick={resetRestore}
                  className="h-10 rounded border border-slate-300 px-4"
                >
                  {t('backup.restore.cancel')}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* ---- Move to a new computer (BAK-005, DEFERRED — flag OFF) ---- */}
      <section className="flex flex-col gap-3 rounded border border-slate-200 p-4">
        <h2 className="text-lg font-medium text-slate-900">
          {t('backup.move.title')}
        </h2>
        <p className="text-sm text-slate-600">{t('backup.move.note')}</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="backup-move-start"
            disabled={!features.backupMoveToNewComputer}
            aria-disabled={features.backupMoveToNewComputer ? undefined : true}
            title={
              features.backupMoveToNewComputer
                ? undefined
                : t('backup.move.deferred')
            }
            className="h-10 rounded border border-slate-300 px-4 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            {t('backup.move.start')}
          </button>
          {!features.backupMoveToNewComputer ? (
            <span
              data-testid="backup-move-deferred"
              className="text-sm text-slate-500"
            >
              {t('backup.move.deferred')}
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
}
