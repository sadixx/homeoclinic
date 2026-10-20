// S04 Global patient search overlay (docs/ui/S04-global-search.md;
// HC-MVP1-050/051). PSR-001..007.
//
// Calls ONLY the generated typed bindings. Opened over any screen from the
// top-bar search box or F2 / Ctrl+K (wired in the shell). Every control carries
// its spec data-testid (R-UI-003); visible text comes from en.json (R-UI-007).
//
// - 80 ms input debounce; a new keystroke cancels the in-flight query via a
//   per-query sequence guard so results never flicker backwards (PSR-001).
// - Empty box shows the last-20 recently opened patients (PSR-007).
// - Each row shows photo/name/id/age-sex/mobile/city/last-visit/dues + a
//   match-type tag rendered as TEXT, never colour alone (conventions §5).
// - Keyboard: Up/Down move, Enter opens the highlighted patient (PSR-006),
//   Esc closes. No-results offers a New patient action.

import { useCallback, useEffect, useRef, useState } from 'react';

import { commands, type SearchRow } from '@/bindings';
import { run } from '@/shared/command';
import { formatDate } from '@/shared/datetime';
import { formatMobile } from '@/shared/mobile';
import { formatPaise } from '@/shared/money';
import { t, type StringKey } from '@/shared/strings';

/** Page size for the first page of results / recent list (PSR-005/007). */
const PAGE_LIMIT = 20;
/** Input debounce in milliseconds (PSR-001). */
const DEBOUNCE_MS = 80;

export interface SearchOverlayProps {
  /** Whether the overlay is shown. */
  readonly open: boolean;
  /** Close the overlay (Esc / backdrop / after opening a patient). */
  readonly onClose: () => void;
  /** Open the given patient's dashboard (S07). */
  readonly onOpenPatient: (patientId: string) => void;
  /** Start a new registration from the no-results state (S06). */
  readonly onNewPatient?: () => void;
}

/** Resolve the match-type tag to a localised label (never colour alone). */
function matchTypeLabel(matchType: string): string {
  const key = `search.matchtype.${matchType}` as StringKey;
  // Fall back to "other" for any unknown tag so a new backend value never
  // throws a missing-key error at the doctor.
  const known: ReadonlySet<string> = new Set([
    'exact_id',
    'exact_mobile',
    'exact_name',
    'name_prefix',
    'phonetic',
    'other',
  ]);
  return known.has(matchType) ? t(key) : t('search.matchtype.other');
}

/** The S04 overlay. */
export function SearchOverlay({
  open,
  onClose,
  onOpenPatient,
  onNewPatient,
}: SearchOverlayProps): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [recent, setRecent] = useState<SearchRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [errored, setErrored] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Monotonic sequence: only the latest query's result is accepted, which
  // cancels any in-flight older query (PSR-001).
  const seqRef = useRef(0);

  // Focus the box and load the recent list whenever the overlay opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setRows([]);
    setSelected(0);
    setErrored(false);
    setSearched(false);
    inputRef.current?.focus();
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const res = await run(commands.patientRecent({ limit: PAGE_LIMIT }));
        if (!cancelled) setRecent(res.results);
      } catch {
        if (!cancelled) setRecent([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Debounced live search; a new keystroke supersedes the in-flight query.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q === '') {
      setRows([]);
      setSearched(false);
      setErrored(false);
      return;
    }
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const res = await run(
            commands.patientSearch({
              query: q,
              limit: PAGE_LIMIT,
              cursor: null,
            }),
          );
          // Drop a stale response (a newer keystroke already fired).
          if (seq !== seqRef.current) return;
          setRows(res.results);
          setSelected(0);
          setSearched(true);
          setErrored(false);
        } catch {
          if (seq !== seqRef.current) return;
          setErrored(true);
          setSearched(true);
        }
      })();
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, open]);

  const list = query.trim() === '' ? recent : rows;

  const openAt = useCallback(
    (index: number): void => {
      const row = list[index];
      if (row === undefined) return;
      onOpenPatient(row.patientId);
      onClose();
    },
    [list, onOpenPatient, onClose],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelected((s) => Math.min(s + 1, Math.max(list.length - 1, 0)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        setSelected(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        setSelected(Math.max(list.length - 1, 0));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        openAt(selected);
      }
    },
    [list.length, onClose, openAt, selected],
  );

  if (!open) return null;

  const showEmpty =
    query.trim() !== '' && searched && !errored && rows.length === 0;
  // Pre-composed so the empty message renders an identifier, not a JSX string
  // literal (R-UI-007 / jsx-no-literals).
  const emptyQueryLabel = `\u2018${query.trim()}\u2019.`;

  return (
    <div
      data-testid="search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('search.overlay.label')}
      className="fixed inset-0 z-50 flex justify-center bg-black/30 pt-14"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="h-fit max-h-[80vh] w-[47.5rem] overflow-hidden rounded border border-slate-300 bg-white shadow-lg"
        onKeyDown={onKeyDown}
      >
        <div className="border-b border-slate-200 p-2">
          <label htmlFor="search-overlay-input" className="sr-only">
            {t('search.placeholder')}
          </label>
          <input
            id="search-overlay-input"
            ref={inputRef}
            data-testid="search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-keyshortcuts="F2 Control+K"
            className="input"
          />
        </div>

        <div className="max-h-[60vh] overflow-auto">
          {errored ? (
            <div
              data-testid="search-error"
              role="alert"
              className="flex items-center justify-between p-3 text-sm text-red-700"
            >
              <span>{t('search.error.message')}</span>
              <button
                type="button"
                data-testid="search-error-retry"
                onClick={() => setQuery((q) => q)}
                className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-100"
              >
                {t('search.error.retry')}
              </button>
            </div>
          ) : showEmpty ? (
            <div
              data-testid="search-empty"
              className="p-4 text-sm text-slate-700"
            >
              <p className="mb-2">
                {t('search.empty.prefix')} {emptyQueryLabel}
              </p>
              <button
                type="button"
                data-testid="search-empty-new-patient"
                onClick={() => {
                  onNewPatient?.();
                  onClose();
                }}
                className="rounded bg-blue-600 px-3 py-1.5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-700"
              >
                {t('search.empty.newPatient')}
              </button>
            </div>
          ) : query.trim() === '' ? (
            <div data-testid="search-recent">
              <p className="px-3 pt-2 text-xs font-semibold uppercase text-slate-500">
                {t('search.recent.title')}
              </p>
              {recent.length === 0 ? (
                <p className="p-3 text-sm text-slate-500">
                  {t('search.recent.empty')}
                </p>
              ) : (
                <ul role="listbox" aria-label={t('search.recent.title')}>
                  {recent.map((r, i) => (
                    <ResultRow
                      key={r.patientId}
                      row={r}
                      selected={i === selected}
                      recent
                      onClick={() => openAt(i)}
                    />
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <ul
              data-testid="search-results"
              role="listbox"
              aria-label={t('search.overlay.label')}
            >
              {rows.map((r, i) => (
                <ResultRow
                  key={r.patientId}
                  row={r}
                  selected={i === selected}
                  onClick={() => openAt(i)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** One search / recent result row (PSR-005). */
function ResultRow({
  row,
  selected,
  recent = false,
  onClick,
}: {
  readonly row: SearchRow;
  readonly selected: boolean;
  readonly recent?: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  const lastVisit = formatDate(row.lastVisitAt) ?? t('common.none');
  const dues = `${t('common.duesPrefix')}${formatPaise(row.duesPaise)}`;
  return (
    <li
      role="option"
      aria-selected={selected}
      data-testid={recent ? 'search-recent-row' : 'search-result-row'}
      onClick={onClick}
      className={[
        'flex cursor-pointer items-center gap-3 px-3 py-2 text-sm',
        selected ? 'bg-blue-100' : 'hover:bg-slate-50',
      ].join(' ')}
    >
      <span className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded bg-slate-100 text-xs text-slate-400">
        {row.photoPath ? (
          <img
            src={row.photoPath}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          row.name.charAt(0)
        )}
      </span>
      <span className="flex-1 truncate">
        <span className="font-medium">{row.name}</span>{' '}
        <span className="text-slate-500">{row.code}</span>
        <span className="block text-xs text-slate-500">
          {row.ageLabel}
          {row.sex ? ` ${row.sex}` : ''} · {formatMobile(row.mobile)} ·{' '}
          {row.city ?? t('common.none')} · {lastVisit} · {dues}
        </span>
      </span>
      {!recent && row.matchType !== '' ? (
        <span
          data-testid="search-result-matchtype"
          className="flex-none rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700"
        >
          {matchTypeLabel(row.matchType)}
        </span>
      ) : null}
    </li>
  );
}
