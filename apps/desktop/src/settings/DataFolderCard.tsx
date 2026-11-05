// S18 data-folder card (SET-006, ADR 0020; design §8). Its own flow, not part
// of the General Save: Change… opens the native folder picker (an async,
// non-blocking backend command; the UI never builds a path), a confirm dialog
// names the chosen folder, then the backend copies + verifies the data, switches
// to it and keeps the old data as a safety copy. A move that needs the PIN to
// reopen the data routes to the lock screen.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { commands } from '@/bindings';
import type { MoveDataFolderResponse } from '@/bindings';
import { run } from '@/shared/command';
import { t } from '@/shared/strings';

import { dataFolderErrorMessage, errorCodeOf } from './settingsErrors';

/** Props of {@link DataFolderCard}. */
export interface DataFolderCardProps {
  /** The current data folder (display only). */
  readonly dataFolder: string;
  /** Called after a successful move so the screen re-reads the settings. */
  readonly onMoved: () => void;
}

const BUTTON =
  'h-10 rounded border px-4 text-base focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60';

/** Current data folder + the safe move flow. */
export function DataFolderCard({
  dataFolder,
  onMoved,
}: DataFolderCardProps): JSX.Element {
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const [parent, setParent] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MoveDataFolderResponse | null>(null);
  const moveRef = useRef<HTMLButtonElement | null>(null);
  const changeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (parent !== null) moveRef.current?.focus();
  }, [parent]);

  // While moving both buttons are disabled: keep focus on the dialog itself so
  // keys stay inside the modal (ms-review-8).
  useEffect(() => {
    if (moving) dialogRef.current?.focus();
  }, [moving]);

  const onChange = useCallback(async (): Promise<void> => {
    setError(null);
    setResult(null);
    setPicking(true);
    try {
      const picked = await run(commands.settingsPickDataFolder());
      if (picked.parentPath !== null) setParent(picked.parentPath);
    } catch (err: unknown) {
      setError(dataFolderErrorMessage(err));
    } finally {
      setPicking(false);
    }
  }, []);

  const closeDialog = useCallback((): void => {
    if (moving) return;
    setParent(null);
    setError(null);
    changeRef.current?.focus();
  }, [moving]);

  const onMove = useCallback(async (): Promise<void> => {
    if (parent === null) return;
    setError(null);
    setMoving(true);
    try {
      const moved = await run(
        commands.settingsMoveDataFolder({ parentPath: parent }),
      );
      setParent(null);
      setResult(moved);
      onMoved();
    } catch (err: unknown) {
      if (errorCodeOf(err) === 'data_folder_reopen_failed') {
        // The data was moved; the PIN unlock opens the new folder.
        navigate('/lock');
        return;
      }
      setError(dataFolderErrorMessage(err));
    } finally {
      setMoving(false);
    }
  }, [parent, navigate, onMoved]);

  const onDialogKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Modal: no shell shortcut (nav, search) may act behind the dialog, or a
    // busy move could unmount this card and drop its result / lock redirect.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog();
      return;
    }
    if (e.key === 'Tab') trapTab(e, dialogRef.current);
  };

  return (
    <section
      aria-labelledby="settings-datafolder-heading"
      className="flex flex-col gap-2 rounded border border-slate-200 p-4"
    >
      <h2
        id="settings-datafolder-heading"
        className="text-base font-semibold text-slate-900"
      >
        {t('settings.section.dataFolder')}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-base text-slate-700">
          {t('settings.dataFolder.current')}
        </span>
        <code
          data-testid="settings-datafolder"
          className="min-w-0 break-all rounded bg-slate-50 px-2 py-1 text-base text-slate-900"
        >
          {dataFolder}
        </code>
        <button
          ref={changeRef}
          type="button"
          data-testid="settings-datafolder-change"
          onClick={() => void onChange()}
          disabled={picking || moving}
          className={`${BUTTON} border-slate-300 text-slate-800 hover:bg-slate-50`}
        >
          {t('settings.dataFolder.change')}
        </button>
      </div>

      {result !== null ? (
        <div
          data-testid="settings-datafolder-result"
          role="status"
          className="flex flex-col gap-1 rounded border border-green-300 bg-green-50 p-3 text-base text-green-900"
        >
          <span className="font-semibold">{t('settings.dataFolder.done')}</span>
          <span className="break-all">
            {t('settings.dataFolder.newLabel')} {result.dataFolder}
          </span>
          <span className="break-all">
            {t('settings.dataFolder.safetyLabel')} {result.safetyCopyFolder}
          </span>
        </div>
      ) : null}

      {error !== null && parent === null ? (
        <p
          data-testid="settings-datafolder-error"
          role="alert"
          className="text-base text-red-700"
        >
          {error}
        </p>
      ) : null}

      {parent !== null ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onKeyDown={onDialogKey}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-datafolder-confirm-title"
            data-testid="settings-datafolder-confirm"
            className="flex w-full max-w-xl flex-col gap-3 rounded bg-white p-5 shadow-lg focus:outline-none"
          >
            <h3
              id="settings-datafolder-confirm-title"
              className="text-lg font-semibold text-slate-900"
            >
              {t('settings.dataFolder.confirmTitle')}
            </h3>
            <p
              data-testid="settings-datafolder-target"
              className="break-all text-base text-slate-900"
            >
              <code className="rounded bg-slate-50 px-1">{parent}</code>{' '}
              {t('settings.dataFolder.targetSuffix')}
            </p>
            <p className="text-base text-slate-700">
              {t('settings.dataFolder.safetyNote')}
            </p>
            {moving ? (
              <p
                data-testid="settings-datafolder-busy"
                role="status"
                aria-live="polite"
                className="text-base font-medium text-blue-800"
              >
                {t('settings.dataFolder.moving')}
              </p>
            ) : null}
            {error !== null ? (
              <p
                data-testid="settings-datafolder-error"
                role="alert"
                className="text-base text-red-700"
              >
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                data-testid="settings-datafolder-cancel"
                onClick={closeDialog}
                disabled={moving}
                className={`${BUTTON} border-slate-300 text-slate-800 hover:bg-slate-50`}
              >
                {t('common.cancel')}
              </button>
              <button
                ref={moveRef}
                type="button"
                data-testid="settings-datafolder-move"
                onClick={() => void onMove()}
                disabled={moving}
                aria-busy={moving}
                className={`${BUTTON} border-blue-700 bg-blue-700 font-semibold text-white hover:bg-blue-800`}
              >
                {t('settings.dataFolder.move')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Keep Tab / Shift+Tab cycling inside `dialog` (focus trap). */
function trapTab(
  e: KeyboardEvent<HTMLDivElement>,
  dialog: HTMLElement | null,
): void {
  if (dialog === null) return;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  );
  e.preventDefault();
  if (focusable.length === 0) {
    dialog.focus();
    return;
  }
  const index = focusable.indexOf(document.activeElement as HTMLElement);
  const step = e.shiftKey ? -1 : 1;
  const next =
    index === -1
      ? e.shiftKey
        ? focusable.length - 1
        : 0
      : (index + step + focusable.length) % focusable.length;
  focusable[next]?.focus();
}
