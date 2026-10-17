// Left navigation of the app shell (00-conventions §2). R0 subset: Today,
// Patients, Settings. Labels come from locales/en.json via the typed accessor
// (R-UI-007). Each item advertises its global shortcut (F3 Today, etc.).
//
// R-DEL-002: Patients and Settings do not ship at M0, so they are gated by the
// compile-time feature flags (src/shared/features.ts). A gated-OFF item still
// SHOWS its label (the R0 demo asserts nav-today / nav-patients / nav-settings
// exist) but is rendered VISIBLY DISABLED and NON-NAVIGABLE: aria-disabled,
// the native `disabled` attribute, no onNavigate call, and an accessible hint
// (title + aria-describedby) that it arrives in a later update. There is no
// route and no "coming soon" screen behind it.
//
// Router-free by design: it renders buttons with stable testids and reports the
// chosen route through `onNavigate` (AppShell wires it to the router). This keeps
// the component unit-testable without a Router provider.
import {
  CalendarDays,
  DatabaseBackup,
  Settings as SettingsIcon,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { features } from '@/shared/features';
import { t, type StringKey } from '@/shared/strings';

export type NavRoute = '/today' | '/patients' | '/backup' | '/settings';

export interface SideNavProps {
  /** The currently active route, highlighted in the nav. */
  activeRoute?: NavRoute | undefined;
  /** Called with the target route when an enabled item is activated. */
  onNavigate?: ((route: NavRoute) => void) | undefined;
}

interface NavItem {
  route: NavRoute;
  labelKey: StringKey;
  testid: string;
  shortcut: string;
  Icon: LucideIcon;
  /** Whether the target module ships in this build (compile-time flag). */
  enabled: boolean;
}

const ITEMS: readonly NavItem[] = [
  {
    route: '/today',
    labelKey: 'nav.today',
    testid: 'nav-today',
    shortcut: 'F3',
    Icon: CalendarDays,
    enabled: true,
  },
  {
    route: '/patients',
    labelKey: 'nav.patients',
    testid: 'nav-patients',
    shortcut: 'F4',
    Icon: Users,
    enabled: features.patients,
  },
  {
    route: '/backup',
    labelKey: 'nav.backup',
    testid: 'nav-backup',
    shortcut: '',
    Icon: DatabaseBackup,
    enabled: features.backup,
  },
  {
    route: '/settings',
    labelKey: 'nav.settings',
    testid: 'nav-settings',
    shortcut: '',
    Icon: SettingsIcon,
    enabled: features.settings,
  },
];

/** Vertical left nav, 180px wide, keyboard operable. */
export function SideNav({
  activeRoute,
  onNavigate,
}: SideNavProps): JSX.Element {
  return (
    <nav
      data-testid="side-nav"
      aria-label={t('nav.today')}
      className="flex w-[180px] flex-col gap-1 border-r border-slate-200 bg-slate-50 p-2 text-sm"
    >
      {ITEMS.map((item) => {
        const active = item.enabled && activeRoute === item.route;
        const hintId = item.enabled ? undefined : `${item.testid}-hint`;
        return (
          <button
            key={item.route}
            type="button"
            data-testid={item.testid}
            disabled={!item.enabled}
            aria-disabled={item.enabled ? undefined : true}
            aria-current={active ? 'page' : undefined}
            aria-describedby={hintId}
            title={item.enabled ? undefined : t('nav.comingLater')}
            onClick={() => {
              if (item.enabled) {
                onNavigate?.(item.route);
              }
            }}
            className={[
              'flex items-center gap-2 rounded px-2 py-2 text-left focus:outline-none focus:ring-2 focus:ring-blue-600',
              !item.enabled
                ? 'cursor-not-allowed text-slate-400'
                : active
                  ? 'bg-blue-100 font-semibold text-blue-900'
                  : 'text-slate-800 hover:bg-slate-100',
            ].join(' ')}
          >
            <item.Icon className="h-4 w-4" aria-hidden={true} />
            <span className="flex-1">{t(item.labelKey)}</span>
            {item.enabled && item.shortcut ? (
              <kbd className="text-xs text-slate-500">{item.shortcut}</kbd>
            ) : null}
            {hintId ? (
              <span id={hintId} className="sr-only">
                {t('nav.comingLater')}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
