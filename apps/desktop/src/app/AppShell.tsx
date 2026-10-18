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
//
// Launch boot-gate (SET-001, SET-004; handoff 34): before the router mounts,
// AppShell reads commands.setupGetState() + commands.authGetLockState() once
// and decides the launch route by first-match order — /setup when setup is
// not completed (SET-001), else /lock when locked (SET-004), else /today. An
// `app-boot` splash is shown while the two reads are in flight so Today never
// flashes, and a failed read fails safe to /lock. The resolved
// autolockMinutes is threaded into ShellFrame's idle timer (replacing the
// hardcoded fallback when a value is present). UI -> typed commands only.
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { commands } from '@/bindings';
import { TodayScreen } from '@/home/TodayScreen';
import { SetupWizard } from '@/setup/SetupWizard';
import { run } from '@/shared/command';
import { features } from '@/shared/features';

/**
 * Default idle auto-lock timeout in minutes (SET-004). The shell runs the idle
 * timer; the backend owns sealing/unsealing. The configured value is persisted
 * at setup and resolved by the boot/lock wiring; the shell falls back to this
 * default so it can run without a binding call (keeping it unit-testable).
 */
const DEFAULT_AUTOLOCK_MINUTES = 15;

/** The launch route chosen by the boot-gate. */
type BootRoute = '/setup' | '/lock' | '/today';

/**
 * Boot-gate state: `undefined` while the two reads are in flight (render the
 * splash), then the resolved launch route plus the configured autolock.
 */
interface BootDecision {
  readonly route: BootRoute;
  readonly autolockMinutes: number | null;
}

/**
 * Read setup + lock state once on mount and decide the launch route.
 *
 * First-match order: /setup when setup is not completed (SET-001), else /lock
 * when locked (SET-004), else /today. Either read failing fails safe to /lock
 * (a configured install should never be left unlocked by an error). Returns
 * `undefined` until both reads settle so the caller can show the splash.
 */
function useBootDecision(): BootDecision | undefined {
  const [decision, setDecision] = useState<BootDecision | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const [setup, lock] = await Promise.all([
          run(commands.setupGetState()),
          run(commands.authGetLockState()),
        ]);
        if (cancelled) {
          return;
        }
        const route: BootRoute = !setup.completed
          ? '/setup'
          : lock.locked
            ? '/lock'
            : '/today';
        setDecision({ route, autolockMinutes: lock.autolockMinutes });
      } catch {
        // Fail safe: never leave a configured install unlocked on a read
        // error. No patient data is logged.
        if (!cancelled) {
          setDecision({ route: '/lock', autolockMinutes: null });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return decision;
}

/** Inner shell chrome; assumes a router is present above it. */
function ShellFrame({
  autolockMinutes,
}: {
  readonly autolockMinutes?: number | null;
}): JSX.Element {
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
  // so locking never loses data. Ctrl+L (TopBar) is the explicit path. The
  // configured value from authGetLockState is used when present; otherwise the
  // default fallback keeps the timer running.
  const effectiveMinutes =
    autolockMinutes != null && autolockMinutes > 0
      ? autolockMinutes
      : DEFAULT_AUTOLOCK_MINUTES;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const timeoutMs = effectiveMinutes * 60 * 1000;
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
  }, [navigate, effectiveMinutes]);

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

/** Top-level shell: runs the launch boot-gate, then provides the router. */
export function AppShell(): JSX.Element {
  const decision = useBootDecision();

  // Boot reads still in flight: show the splash so Today never flashes.
  if (decision === undefined) {
    return (
      <div
        data-testid="app-boot"
        className="flex h-screen items-center justify-center bg-white"
      />
    );
  }

  // Decision made: seed the hash with the decided launch route BEFORE the
  // HashRouter mounts, so the chosen screen is the first (and only) thing
  // rendered — no Today-then-redirect flash. At a real launch the hash is
  // empty; this is simply where the router starts. The HashRouter below then
  // owns all in-app navigation (unlock, finish-setup, idle-lock, nav).
  return (
    <BootRouter
      route={decision.route}
      autolockMinutes={decision.autolockMinutes}
    />
  );
}

/**
 * Mount the HashRouter at the decided launch route. The route is seeded once,
 * synchronously, before the router renders so the launch screen is not
 * preceded by any other screen.
 */
function BootRouter({
  route,
  autolockMinutes,
}: {
  readonly route: BootRoute;
  readonly autolockMinutes: number | null;
}): JSX.Element {
  // Seed exactly once, on first render, before HashRouter reads the hash.
  const seeded = useRef(false);
  if (!seeded.current) {
    window.location.hash = `#${route}`;
    seeded.current = true;
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/setup" element={<SetupRoute />} />
        <Route path="/lock" element={<LockRoute />} />
        <Route
          path="*"
          element={<ShellFrame autolockMinutes={autolockMinutes} />}
        />
      </Routes>
    </HashRouter>
  );
}
