// Top bar of the app shell (00-conventions §2): logo + product name, the
// global search box (F2 / Ctrl+K focus target), and the Help / Lock buttons.
// It renders the app version from the typed `commands.appInfo()` binding
// (useAppInfo), proving the UI -> IPC path (R-UI-002).
//
// Rendered standalone in tests (no Router), so navigation is injected via
// optional callbacks with no-op defaults rather than calling router hooks here.
import { useCallback, useEffect, useRef } from 'react';
import { HelpCircle, Lock } from 'lucide-react';

import { t } from '@/shared/strings';
import { useAppInfo } from '@/shared/useAppInfo';

export interface TopBarProps {
  /** Invoked when the Help button or F1 is pressed. */
  onHelp?: () => void;
  /** Invoked when the Lock button or Ctrl+L is pressed. */
  onLock?: () => void;
}

/** Fixed-height top bar with global search and Help/Lock actions. */
export function TopBar({ onHelp, onLock }: TopBarProps): JSX.Element {
  const info = useAppInfo();
  const searchRef = useRef<HTMLInputElement>(null);

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
  }, []);

  // Global shortcuts: F2 / Ctrl+K focus search; F1 help; Ctrl+L lock
  // (00-conventions §3). Ignored while an IME composition is active.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) {
        return;
      }
      const ctrlK =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if (event.key === 'F2' || ctrlK) {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (event.key === 'F1') {
        event.preventDefault();
        onHelp?.();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        onLock?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focusSearch, onHelp, onLock]);

  const version = info ? info.version : '…';

  return (
    <header
      data-testid="topbar"
      className="flex h-12 items-center gap-3 border-b border-slate-200 bg-white px-3 text-sm text-slate-900"
    >
      <span className="font-semibold" data-testid="topbar-brand">
        {t('app.name')}
      </span>

      <label htmlFor="topbar-search-input" className="sr-only">
        {t('search.placeholder')}
      </label>
      <input
        id="topbar-search-input"
        ref={searchRef}
        data-testid="topbar-search"
        type="search"
        placeholder={`${t('search.placeholder')} (F2)`}
        aria-keyshortcuts="F2 Control+K"
        className="h-8 flex-1 rounded border border-slate-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
      />

      <button
        type="button"
        data-testid="topbar-help"
        onClick={onHelp}
        aria-label={t('topbar.help')}
        title={`${t('topbar.help')} (F1)`}
        className="inline-flex h-8 w-8 items-center justify-center rounded text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
      >
        <HelpCircle className="h-5 w-5" aria-hidden="true" />
      </button>

      <button
        type="button"
        data-testid="topbar-lock"
        onClick={onLock}
        aria-label={t('topbar.lock')}
        title={`${t('topbar.lock')} (Ctrl+L)`}
        className="inline-flex h-8 w-8 items-center justify-center rounded text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
      >
        <Lock className="h-5 w-5" aria-hidden="true" />
      </button>

      <span data-testid="topbar-version" className="text-xs text-slate-500">
        v{version}
      </span>
    </header>
  );
}
