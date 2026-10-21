// App shell (00-conventions §2): top bar + left nav + routed content + status
// bar, wired to a router. It owns its own HashRouter so it is self-contained
// (the unit test renders <AppShell /> with no external provider).
//
// R-DEL-002: only shipped features get a route. Patients ships at M2 Slice D
// (R2), so when the compile-time flag features.patients is on (vite.config.ts)
// the shell mounts a real /patients route AND the global S04 search overlay —
// there is no dead-end nav. Settings is still gated OFF at M0/M1: its nav item
// renders (disabled, see SideNav) but has no route and no "coming soon" screen.
//   /today    -> S03 Today (empty state at R0), the default route
//   /patients -> S05/S06/S07 patient UI (list / register+edit / dashboard),
//                deep-linked via ?id=<patientId> or ?view=new (search overlay)
//   /backup   -> S17 backup/restore (BAK-001..004)
//   /lock     -> S02 lock stub (full-window overlay, no nav)
// Unknown routes redirect to /today.
//
// Launch boot-gate (SET-001, SET-004; handoff 34): before the router mounts,
// AppShell reads commands.setupGetState() + commands.authGetLockState() once
// and decides the launch route by first-match order — /setup when setup is
// not completed (SET-001), else /lock when locked (SET-004), else /today. An
// `app-boot` splash is shown while the reads are in flight so Today never
// flashes. The fail-safe to /lock is NARROWED to a KNOWN-provisioned install:
// a fresh/unknown install (setup not completed, or the setup read itself
// failing) always goes to /setup so a brand-new, PIN-less user is never
// stranded on the lock screen; only a provisioned install whose lock read is
// uncertain fails safe to /lock (handoff 46). The resolved autolockMinutes is
// threaded into ShellFrame's idle timer (replacing the hardcoded fallback when
// a value is present). UI -> typed commands only.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';

import { LockScreen } from '@/app/LockScreen';
import { SearchOverlay } from '@/app/SearchOverlay';
import { SideNav, type NavRoute } from '@/app/SideNav';
import { StatusBar } from '@/app/StatusBar';
import { TopBar } from '@/app/TopBar';
import { BackupScreen } from '@/backup/BackupScreen';
import { commands } from '@/bindings';
import { TodayScreen } from '@/home/TodayScreen';
import { PatientsPage } from '@/patients/PatientsPage';
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
  /**
   * Whether setup is completed (SET-001). Threaded through so the in-session
   * completion route-guard can keep shell routes unreachable until the
   * licence/trial is activated — consistent with the boot decision, which
   * already sends `!completed -> /setup`. `false` whenever provisioning is
   * not observed as complete (including an uncertain/failed setup read).
   */
  readonly completed: boolean;
}

/**
 * Read setup + lock state once on mount and decide the launch route.
 *
 * `setup_get_state().completed` is the PRIMARY signal (SET-001): a fresh,
 * unprovisioned install (no keystore record) must always reach the first-run
 * wizard, never the PIN-less dead end that is the lock screen. The fail-safe to
 * `/lock` is therefore NARROWED to a KNOWN-provisioned install (SET-004): it
 * only applies once `completed === true` is actually observed.
 *
 * First-match order and failure handling (handoff 46):
 * - setup read throws -> provisioning UNKNOWN -> `/setup` (a brand-new user is
 *   never stranded on `/lock`; a transport blip must not look like a lock).
 * - not completed -> `/setup` (SET-001), regardless of the lock read.
 * - completed + lock read throws -> `/lock` (SET-004 fail-safe, provisioned
 *   install stays sealed on an uncertain read).
 * - completed + locked -> `/lock`; completed + unlocked -> `/today`.
 *
 * The two reads are awaited INDEPENDENTLY (not a single `Promise.all`) so a
 * failed lock read never discards an already-known setup signal. `run()`
 * normalises any IPC transport reject into a typed `UserFacingError`
 * (`boot_read_failed`); here only the pass/fail of each read matters, so the
 * error value is caught and discarded — no patient data, SQL or stack is read
 * or logged (R-PRIV-001, R-UI-008). Returns `undefined` until the decision is
 * made so the caller can show the splash.
 */
function useBootDecision(): BootDecision | undefined {
  const [decision, setDecision] = useState<BootDecision | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      // Provisioning is the primary signal. If the setup read fails,
      // provisioning is UNKNOWN and a fresh user must not be stranded on the
      // lock screen, so default to the wizard (SET-001).
      let completed: boolean;
      try {
        const setup = await run(commands.setupGetState());
        completed = setup.completed;
      } catch {
        if (!cancelled) {
          setDecision({
            route: '/setup',
            autolockMinutes: null,
            completed: false,
          });
        }
        return;
      }

      // Not provisioned -> first-run wizard, never /lock (SET-001). The lock
      // read is irrelevant for a fresh install, so it is not even awaited.
      if (!completed) {
        if (!cancelled) {
          setDecision({
            route: '/setup',
            autolockMinutes: null,
            completed: false,
          });
        }
        return;
      }

      // KNOWN-provisioned: now the lock read decides, and an uncertain read
      // fails safe to /lock (SET-004) — a configured install is never left
      // unlocked by a transport error.
      try {
        const lock = await run(commands.authGetLockState());
        if (!cancelled) {
          setDecision({
            route: lock.locked ? '/lock' : '/today',
            autolockMinutes: lock.autolockMinutes,
            completed: true,
          });
        }
      } catch {
        if (!cancelled) {
          setDecision({
            route: '/lock',
            autolockMinutes: null,
            completed: true,
          });
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
  // Global search overlay (S04): the shell owns its open state so it floats
  // over every screen. Opened from the top-bar box or F2 / Ctrl+K (TopBar
  // reports the intent via onOpenSearch); Esc / backdrop / opening a patient
  // closes it.
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  const goToLock = useCallback(() => navigate('/lock'), [navigate]);
  const onNavigate = useCallback(
    (route: NavRoute) => navigate(route),
    [navigate],
  );
  const goToBackup = useCallback(() => navigate('/backup'), [navigate]);

  // Enter on a search result opens that patient's dashboard: navigate into the
  // /patients route carrying the id in the hash query so PatientsPage deep-
  // links straight to the S07 dashboard (consistent with its initialPatientId).
  const openPatient = useCallback(
    (patientId: string): void => {
      navigate(`/patients?id=${encodeURIComponent(patientId)}`);
    },
    [navigate],
  );
  // The no-results "New patient" action opens the register form (S06).
  const openNewPatient = useCallback((): void => {
    navigate('/patients?view=new');
  }, [navigate]);

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
      : location.pathname === '/patients'
        ? '/patients'
        : location.pathname === '/backup'
          ? '/backup'
          : undefined;

  return (
    <div
      data-testid="app-shell"
      className="flex h-screen flex-col bg-white text-[14px]"
    >
      <TopBar onLock={goToLock} onOpenSearch={openSearch} />
      <div className="flex min-h-0 flex-1">
        <SideNav activeRoute={activeRoute} onNavigate={onNavigate} />
        <main
          className="min-w-0 flex-1 overflow-auto"
          data-testid="content-area"
        >
          <Routes>
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route
              path="/today"
              element={<TodayScreen onNewPatient={openNewPatient} />}
            />
            {features.patients ? (
              <Route path="/patients" element={<PatientsRoute />} />
            ) : null}
            {features.backup ? (
              <Route path="/backup" element={<BackupScreen />} />
            ) : null}
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        </main>
      </div>
      <StatusBar onOpenBackup={goToBackup} />
      {/* S04 global search overlay, floating over the whole shell. */}
      {features.patients ? (
        <SearchOverlay
          open={searchOpen}
          onClose={closeSearch}
          onOpenPatient={openPatient}
          onNewPatient={openNewPatient}
        />
      ) : null}
    </div>
  );
}

/**
 * `/patients` route wrapper (S05/S06/S07). Reads an optional deep-link from the
 * hash query — `?id=<patientId>` opens straight to that patient's dashboard
 * (S07, used by the search overlay's Enter), `?view=new` opens the register
 * form (S06, used by the no-results "New patient" action) — and otherwise
 * lands on the patient list (S05). The query is the single source of the
 * initial view, so the same URL is shareable/deep-linkable and the `key`
 * forces a fresh PatientsPage when the deep-linked id changes (a new search
 * Enter must re-open the dashboard even from within /patients).
 */
function PatientsRoute(): JSX.Element {
  const [params] = useSearchParams();
  const id = params.get('id') ?? undefined;
  const view = params.get('view') === 'new' ? 'new' : 'list';
  // `exactOptionalPropertyTypes` is on: pass initialPatientId only when it is a
  // real id, never an explicit `undefined`. The `key` forces a fresh
  // PatientsPage when the deep-linked id changes (a new search Enter re-opens
  // the dashboard even from within /patients).
  return id !== undefined ? (
    <PatientsPage key={id} initialPatientId={id} />
  ) : (
    <PatientsPage key={view} initialView={view} />
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

/**
 * `/setup` route: finishing the wizard opens Today unlocked (S01).
 *
 * Finishing the wizard flips the LIVE completion signal (`markCompleted`)
 * BEFORE navigating to `/today`, so the completion route-guard (`ShellRoute`)
 * admits the shell on this same process. Without this the guard would still
 * read the frozen boot-time `completed === false` and bounce `/today` back to
 * `/setup`, stranding a brand-new doctor until a close/reopen + PIN unlock
 * (the user-reported SET-001 defect).
 */
function SetupRoute({
  onCompleted,
}: {
  readonly onCompleted: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const goHome = useCallback(() => {
    // Flip the live completion signal first so the guard lets the shell mount,
    // THEN navigate — order matters (guard reads completion synchronously).
    onCompleted();
    navigate('/today', { replace: true });
  }, [navigate, onCompleted]);
  return <SetupWizard onComplete={goHome} />;
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
      completed={decision.completed}
    />
  );
}

/**
 * Completion route-guard (SET-001): the shell (`/today`, `/backup`, any shell
 * path) is only reachable once setup is completed. While `completed === false`
 * — the same signal the boot decision uses to send a fresh install to the
 * wizard — any in-session navigation to a shell route (a stray in-app link, a
 * stale hash, a deep link) is redirected to `/setup`, so nothing in the app is
 * accessible before the licence/trial is activated. `/setup` and `/lock` are
 * dedicated routes and are never wrapped by this guard, so the wizard itself
 * and the lock screen stay reachable.
 */
function ShellRoute({
  autolockMinutes,
  completed,
}: {
  readonly autolockMinutes: number | null;
  readonly completed: boolean;
}): JSX.Element {
  if (!completed) {
    return <Navigate to="/setup" replace />;
  }
  return <ShellFrame autolockMinutes={autolockMinutes} />;
}

/**
 * Mount the HashRouter at the decided launch route. The route is seeded once,
 * synchronously, before the router renders so the launch screen is not
 * preceded by any other screen.
 */
function BootRouter({
  route,
  autolockMinutes,
  completed,
}: {
  readonly route: BootRoute;
  readonly autolockMinutes: number | null;
  readonly completed: boolean;
}): JSX.Element {
  // Seed exactly once, on first render, before HashRouter reads the hash.
  const seeded = useRef(false);
  if (!seeded.current) {
    window.location.hash = `#${route}`;
    seeded.current = true;
  }

  // The completion route-guard must use a LIVE signal, not the frozen boot
  // value (SET-001, user-reported defect). Seed it from the boot decision; the
  // wizard's completion (`markCompleted`) flips it to true in THIS process so
  // ShellRoute admits the shell immediately after Finish — no close/reopen +
  // PIN round-trip. A guard reading the frozen boot `completed === false` would
  // bounce the post-Finish `/today` navigation straight back to `/setup`.
  const [liveCompleted, setLiveCompleted] = useState(completed);
  const markCompleted = useCallback(() => setLiveCompleted(true), []);

  return (
    <HashRouter>
      <Routes>
        <Route
          path="/setup"
          element={<SetupRoute onCompleted={markCompleted} />}
        />
        <Route path="/lock" element={<LockRoute />} />
        <Route
          path="*"
          element={
            <ShellRoute
              autolockMinutes={autolockMinutes}
              completed={liveCompleted}
            />
          }
        />
      </Routes>
    </HashRouter>
  );
}
