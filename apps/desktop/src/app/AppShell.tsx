// App shell (00-conventions §2): top bar + left nav + routed content + status
// bar, wired to a router. It owns its own HashRouter so it is self-contained
// (the unit test renders <AppShell /> with no external provider).
//
// R-DEL-002: only shipped features get a route. At M0 the Patients and Settings
// modules are gated OFF by the compile-time feature flags (src/shared/features.ts),
// so there is NO /patients or /settings route and NO "coming soon" screen. Their
// nav items still render (disabled, see SideNav) but navigate nowhere.
//   /today  -> S03 Today (empty state at R0), the default route
//   /lock   -> S02 lock stub (full-window overlay, no nav)
// Unknown routes redirect to /today.
import { useCallback, useEffect, useRef } from 'react';
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import { LockScreen } from '@/app/LockScreen';
import { SideNav, type NavRoute } from '@/app/SideNav';
import { StatusBar } from '@/app/StatusBar';
import { TopBar } from '@/app/TopBar';
import { BackupScreen } from '@/backup/BackupScreen';
import { TodayScreen } from '@/home/TodayScreen';
import { SetupWizard } from '@/setup/SetupWizard';
import { features } from '@/shared/features';

/**
 * Default idle auto-lock timeout in minutes (SET-004). The shell runs the idle
 * timer; the backend owns sealing/unsealing. The configured value is persisted
 * at setup and resolved by the boot/lock wiring; the shell falls back to this
 * default so it can run without a binding call (keeping it unit-testable).
 */
const DEFAULT_AUTOLOCK_MINUTES = 15;

/** Inner shell chrome; assumes a router is present above it. */
function ShellFrame(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  const goToLock = useCallback(() => navigate('/lock'), [navigate]);
  const onNavigate = useCallback(
    (route: NavRoute) => navigate(route),
    [navigate],
  );
  const goToBackup = useCallback(() => navigate('/backup'), [navigate]);

  // Idle auto-lock (SET-004): after the configured idle timeout with no user
  // activity, lock the app. Any clinical edit is already autosaved (CASE-005),
  // so locking never loses data. Ctrl+L (TopBar) is the explicit path.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const timeoutMs = DEFAULT_AUTOLOCK_MINUTES * 60 * 1000;
    const reset = (): void => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => navigate('/lock'), timeoutMs);
    };
    const activity: ReadonlyArray<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'wheel',
      'touchstart',
    ];
    activity.forEach((evt) =>
      window.addEventListener(evt, reset, { passive: true }),
    );
    reset();
    return () => {
      activity.forEach((evt) => window.removeEventListener(evt, reset));
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [navigate]);

  const activeRoute: NavRoute | undefined =
    location.pathname === '/today' || location.pathname === '/'
      ? '/today'
      : location.pathname === '/backup'
        ? '/backup'
        : undefined;

  return (
    <div
      data-testid="app-shell"
      className="flex h-screen flex-col bg-white text-[14px]"
    >
      <TopBar onLock={goToLock} />
      <div className="flex min-h-0 flex-1">
        <SideNav activeRoute={activeRoute} onNavigate={onNavigate} />
        <main
          className="min-w-0 flex-1 overflow-auto"
          data-testid="content-area"
        >
          <Routes>
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="/today" element={<TodayScreen />} />
            {features.backup ? (
              <Route path="/backup" element={<BackupScreen />} />
            ) : null}
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        </main>
      </div>
      <StatusBar onOpenBackup={goToBackup} />
    </div>
  );
}

/** `/lock` route: unlock returns to Today (or the previous screen). */
function LockRoute(): JSX.Element {
  const navigate = useNavigate();
  const goHome = useCallback(
    () => navigate('/today', { replace: true }),
    [navigate],
  );
  return <LockScreen onUnlocked={goHome} />;
}

/** `/setup` route: finishing the wizard opens Today unlocked (S01). */
function SetupRoute(): JSX.Element {
  const navigate = useNavigate();
  const goHome = useCallback(
    () => navigate('/today', { replace: true }),
    [navigate],
  );
  const goToBackup = useCallback(
    () => navigate('/backup', { replace: true }),
    [navigate],
  );
  return <SetupWizard onComplete={goHome} onGoToBackup={goToBackup} />;
}

/** Top-level shell: provides the router and renders the chrome. */
export function AppShell(): JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route path="/setup" element={<SetupRoute />} />
        <Route path="/lock" element={<LockRoute />} />
        <Route path="*" element={<ShellFrame />} />
      </Routes>
    </HashRouter>
  );
}
