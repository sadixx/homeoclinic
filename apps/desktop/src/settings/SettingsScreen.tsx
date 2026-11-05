// S18 Settings screen (MS; docs/ui/S18-settings.md, design §8).
//
// Tab bar + the General panel. The later-feature tabs (case templates, advice
// library, print layout, recycle bin, audit log, maintenance) render visibly
// disabled with an "Available in a later update" hint and never open a panel
// (R-DEL-002, same pattern as the disabled SideNav items). The General panel
// holds the one-Save form and, as its own flow, the data-folder card.
//
// A11y: WAI-ARIA tabs (tablist / tab / tabpanel, aria-selected,
// aria-controls); Left/Right/Home/End move focus between tabs, a disabled tab
// can be focused (so it is discoverable) but never activated.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { commands } from '@/bindings';
import type { SettingsView } from '@/bindings';
import { run } from '@/shared/command';
import { t } from '@/shared/strings';
import type { StringKey } from '@/shared/strings';

import { DataFolderCard } from './DataFolderCard';
import { GeneralSettings } from './GeneralSettings';

interface TabDef {
  readonly id: string;
  readonly labelKey: StringKey;
  readonly enabled: boolean;
}

const TABS: readonly TabDef[] = [
  { id: 'general', labelKey: 'settings.tab.general', enabled: true },
  { id: 'templates', labelKey: 'settings.tab.templates', enabled: false },
  { id: 'advice', labelKey: 'settings.tab.advice', enabled: false },
  { id: 'print', labelKey: 'settings.tab.print', enabled: false },
  { id: 'recycle', labelKey: 'settings.tab.recycle', enabled: false },
  { id: 'audit', labelKey: 'settings.tab.audit', enabled: false },
  { id: 'maintenance', labelKey: 'settings.tab.maintenance', enabled: false },
];

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly view: SettingsView };

/** `/settings` route element. */
export function SettingsScreen(): JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  // Bumped only by a full (re)load so the General form re-seeds; a data-folder
  // move only refreshes the folder line and keeps unsaved form edits.
  const [formKey, setFormKey] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const read = useCallback(async (): Promise<SettingsView | null> => {
    try {
      return await run(commands.settingsGet());
    } catch {
      return null;
    }
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    setLoad({ kind: 'loading' });
    const view = await read();
    if (view === null) {
      setLoad({ kind: 'error' });
      return;
    }
    setLoad({ kind: 'ready', view });
    setFormKey((k) => k + 1);
  }, [read]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onSaved = useCallback((view: SettingsView): void => {
    setLoad({ kind: 'ready', view });
  }, []);

  const onMoved = useCallback(async (): Promise<void> => {
    const view = await read();
    if (view === null) return;
    setLoad((prev) =>
      prev.kind === 'ready'
        ? { kind: 'ready', view: { ...prev.view, dataFolder: view.dataFolder } }
        : { kind: 'ready', view },
    );
  }, [read]);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    tabRefs.current[next]?.focus();
  };

  return (
    <section
      data-testid="settings-screen"
      aria-labelledby="settings-title"
      className="flex min-w-0 flex-col gap-4 p-6"
    >
      <h1 id="settings-title" className="text-xl font-semibold text-slate-900">
        {t('settings.title')}
      </h1>
      <div className="flex flex-col gap-1">
        <div
          role="tablist"
          aria-label={t('settings.tabs.label')}
          data-testid="settings-tabs"
          className="flex flex-wrap gap-2 border-b border-slate-200 pb-2"
        >
          {TABS.map((tab, i) => {
            const selected = tab.id === 'general';
            const hintId = `settings-tab-${tab.id}-hint`;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`settings-tab-${tab.id}`}
                data-testid={`settings-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={selected ? 'settings-panel-general' : undefined}
                aria-disabled={tab.enabled ? undefined : true}
                aria-describedby={tab.enabled ? undefined : hintId}
                title={tab.enabled ? undefined : t('settings.comingLater')}
                tabIndex={selected ? 0 : -1}
                onKeyDown={(e) => onTabKey(e, i)}
                onClick={() => undefined}
                className={
                  selected
                    ? 'h-10 rounded border border-blue-600 bg-blue-50 px-3 text-base font-semibold text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600'
                    : 'h-10 cursor-not-allowed rounded border border-dashed border-slate-300 px-3 text-base text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600'
                }
              >
                {t(tab.labelKey)}
                {tab.enabled ? null : (
                  <span id={hintId} data-testid={hintId} className="sr-only">
                    {t('settings.comingLater')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-base text-slate-500">
          {t('settings.tabs.laterNote')}
        </p>
      </div>

      <div
        role="tabpanel"
        id="settings-panel-general"
        aria-labelledby="settings-tab-general"
        className="flex min-w-0 flex-col gap-4"
      >
        {load.kind === 'loading' ? (
          <div aria-busy="true" className="flex flex-col gap-2">
            <span className="sr-only">{t('settings.loading')}</span>
            <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
            <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
          </div>
        ) : null}
        {load.kind === 'error' ? (
          <div
            role="alert"
            data-testid="settings-load-error"
            className="flex flex-wrap items-center gap-3 text-base text-red-700"
          >
            <span>{t('settings.loadError')}</span>
            <button
              type="button"
              data-testid="settings-load-retry"
              onClick={() => void reload()}
              className="h-10 rounded border border-slate-300 px-3 text-base text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {t('settings.retry')}
            </button>
          </div>
        ) : null}
        {load.kind === 'ready' ? (
          <>
            <GeneralSettings
              key={formKey}
              initial={load.view}
              onSaved={onSaved}
            />
            <DataFolderCard
              dataFolder={load.view.dataFolder}
              onMoved={() => void onMoved()}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}
