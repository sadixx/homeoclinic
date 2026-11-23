// "Data folder not available" boot screen (MS, SET-006, ADR 0020 §7; design
// §8). Shown before anything else when the data-location pointer names a
// folder that is not present (e.g. an unplugged USB drive). The app never
// creates folders at the missing path. Two choices:
//   - Try again: re-check; once the folder is back the app switches to it and
//     continues to the lock screen (or setup for an unfinished install).
//   - Use the default folder: after a confirm, forget the pointer and continue
//     on the default folder; the data in the missing folder is not touched.
// Outside the shell like /lock (no nav). UI -> typed commands only.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { commands } from '@/bindings';
import { run } from '@/shared/command';
import { t } from '@/shared/strings';

/** Props of {@link DataFolderMissing}. */
export interface DataFolderMissingProps {
  /** Reports the setup completion of the folder the app now uses. */
  readonly onResolved: (completed: boolean) => void;
}

const BUTTON =
  'h-10 rounded border px-4 text-base focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60';

/** Blocking screen for a missing data folder. */
export function DataFolderMissing({
  onResolved,
}: DataFolderMissingProps): JSX.Element {
  const navigate = useNavigate();
  const [path, setPath] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // The doctor's first move is to plug the drive in and retry.
  const retryRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!confirming) retryRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    let alive = true;
    void (async (): Promise<void> => {
      try {
        const setup = await run(commands.setupGetState());
        if (alive) setPath(setup.dataFolderMissing ?? '');
      } catch {
        // The path is display only; the choices still work.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Continue to the screen the now-current folder needs. */
  const proceed = useCallback(async (): Promise<void> => {
    let completed = false;
    try {
      completed = (await run(commands.setupGetState())).completed;
    } catch {
      completed = false;
    }
    onResolved(completed);
    navigate(completed ? '/lock' : '/setup', { replace: true });
  }, [navigate, onResolved]);

  const onRetry = useCallback(async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const check = await run(commands.settingsRecheckDataFolder());
      if (check.available) {
        await proceed();
        return;
      }
      setMessage(t('dataMissing.stillMissing'));
    } catch {
      setMessage(t('dataMissing.error'));
    } finally {
      setBusy(false);
    }
  }, [proceed]);

  const onUseDefault = useCallback(async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await run(commands.settingsForgetDataFolder());
      await proceed();
    } catch {
      setMessage(t('dataMissing.error'));
      setBusy(false);
    }
  }, [proceed]);

  return (
    <main
      data-testid="data-missing-screen"
      aria-labelledby="data-missing-title"
      className="flex min-h-screen items-center justify-center bg-white p-6"
    >
      <div className="flex w-full max-w-xl flex-col gap-4 rounded border border-slate-200 p-6">
        <h1
          id="data-missing-title"
          className="text-xl font-semibold text-slate-900"
        >
          {t('dataMissing.title')}
        </h1>
        <p className="text-base text-slate-700">{t('dataMissing.body')}</p>
        <p className="flex flex-col gap-1 text-base text-slate-700">
          <span>{t('dataMissing.pathLabel')}</span>
          <code
            data-testid="data-missing-path"
            className="break-all rounded bg-slate-50 px-2 py-1 text-slate-900"
          >
            {path}
          </code>
        </p>
        {message !== null ? (
          <p role="alert" className="text-base text-red-700">
            {message}
          </p>
        ) : null}
        {confirming ? (
          <div className="flex flex-col gap-3 rounded border border-amber-300 bg-amber-50 p-3">
            <p className="text-base text-amber-900">
              {t('dataMissing.confirmNote')}
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                data-testid="data-missing-cancel"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className={`${BUTTON} border-slate-300 text-slate-800 hover:bg-slate-50`}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="data-missing-confirm"
                onClick={() => void onUseDefault()}
                disabled={busy}
                className={`${BUTTON} border-amber-700 bg-amber-700 font-semibold text-white hover:bg-amber-800`}
              >
                {t('dataMissing.confirm')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              data-testid="data-missing-use-default"
              onClick={() => setConfirming(true)}
              disabled={busy}
              className={`${BUTTON} border-slate-300 text-slate-800 hover:bg-slate-50`}
            >
              {t('dataMissing.useDefault')}
            </button>
            <button
              type="button"
              data-testid="data-missing-retry"
              onClick={() => void onRetry()}
              disabled={busy}
              aria-busy={busy}
              ref={retryRef}
              className={`${BUTTON} border-blue-700 bg-blue-700 font-semibold text-white hover:bg-blue-800`}
            >
              {t('dataMissing.retry')}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
