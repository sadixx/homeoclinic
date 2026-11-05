// App shell (00-conventions §2): top bar + left nav + routed content + status
// bar, wired to a router. It owns its own HashRouter so it is self-contained
// (the unit test renders <AppShell /> with no external provider).
//
// R-DEL-002: only shipped features get a route. Patients ships at M2 Slice D
// (R2), so when the compile-time flag features.patients is on (vite.config.ts)
// the shell mounts a real /patients route AND the global S04 search overlay —
// there is no dead-end nav. Settings (S18) ships at MS behind features.settings
// and sits inside the same completion route-guard as every shell route.
//   /today    -> S03 Today (empty state at R0), the default route
//   /patients -> S05/S06/S07 patient UI (list / register+edit / dashboard),
//                deep-linked via ?id=<patientId> or ?view=new (search overlay)
//   /backup   -> S17 backup/restore (BAK-001..004)
//   /settings -> S18 settings (MS, SET-002..007)
//   /lock     -> S02 lock stub (full-window overlay, no nav)
//   /data-missing -> "data folder not available" (ADR 0020 §7, outside the
//                    shell like /lock)
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
// threaded into ShellFrame's idle timer until the saved prefs are read
// (useAppPrefs, read after every unlock; F5). A data folder that the pointer
// names but that is not present wins over everything (/data-missing).
// UI -> typed commands only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import { AppBar } from '@/app/AppBar';
import { DataFolderMissing } from '@/app/DataFolderMissing';
import { rootFontPx } from '@/app/fontScale';
import { LockScreen } from '@/app/LockScreen';
import { SearchOverlay } from '@/app/SearchOverlay';
import { SideNav, type NavRoute } from '@/app/SideNav';
import { StatusBar } from '@/app/StatusBar';
import { TopBar } from '@/app/TopBar';
import { AppPrefsProvider, useAppPrefs } from '@/app/useAppPrefs';
import { useZoom } from '@/app/useZoom';
import { BackupScreen } from '@/backup/BackupScreen';
import { commands } from '@/bindings';
import { CaseForm } from '@/case/CaseForm';
import { TodayScreen } from '@/home/TodayScreen';
import { PatientsPage } from '@/patients/PatientsPage';
import { SettingsScreen } from '@/settings/SettingsScreen';
import { SetupWizard } from '@/setup/SetupWizard';
import { run } from '@/shared/command';
import { features } from '@/shared/features';
import { t } from '@/shared/strings';
import { FollowupVisit } from '@/visit/FollowupVisit';

/**
 * Default idle auto-lock timeout in minutes (SET-004). The shell runs the idle
 * timer; the backend owns sealing/unsealing. The configured value is persisted
 * at setup and resolved by the boot/lock wiring; the shell falls back to this
 * default so it can run without a binding call (keeping it unit-testable).
 */
const DEFAULT_AUTOLOCK_MINUTES = 15;

/** The launch route chosen by the boot-gate. */
type BootRoute = '/setup' | '/lock' | '/today' | '/data-missing';

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
        // ADR 0020 §7: the pointed data folder is not present (e.g. an
        // unplugged drive). Nothing else may run until the doctor decides.
        const missing = setup.dataFolderMissing;
        if (typeof missing === 'string' && missing !== '') {
          if (!cancelled) {
            setDecision({
              route: '/data-missing',
              autolockMinutes: null,
              completed,
            });
          }
          return;
        }
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

  // Failed-open surface (D1 / R-UI-008): opening a case or follow-up can fail
  // (backend reject or transport blip). Previously the two start paths swallowed
  // the error in a silent `catch {}`, so a failed open looked identical to a
  // dead click. We instead surface a short, non-crash, patient-data-free alert
  // the doctor can see and dismiss (no stack, no SQL, no PII — R-UI-008,
  // R-PRIV-001), and log one fixed line to the console for observability.
  const [openError, setOpenError] = useState<string | null>(null);
  const dismissOpenError = useCallback(() => setOpenError(null), []);

  // Content zoom (Slice C3): a clamped, persisted scale the shared app-bar and
  // the Ctrl+= / Ctrl+- / Ctrl+0 shortcuts drive. The scale is driven onto the
  // DOCUMENT ROOT (`:root` html) font-size below; because every unit of text
  // and spacing in the app is a rem/px Tailwind utility anchored to the root
  // font-size (14px baseline, src/index.css), scaling the root scales text AND
  // layout together. Applying it to a mid-tree div was the C8 no-op bug.
  const zoom = useZoom();
  // Saved app prefs (SET-004/005/007), read after every unlock (F5).
  const prefs = useAppPrefs();

  // C8 fix + SET-005: apply the chosen font size (Normal 14 / Large 16 /
  // Extra large 18 px, 00-conventions §1) times the zoom scale to the
  // document-root font-size so all rem-based text and layout scale. Ctrl+0
  // resets the zoom to 1.0, i.e. back to the CHOSEN size (design §6). On
  // unmount (lock / setup) the inline override is cleared so the CSS baseline
  // (14px) resumes. No network call, no patient data.
  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = `${rootFontPx(prefs.fontSize, zoom.scale)}px`;
    root.setAttribute('data-hc-font-size', prefs.fontSize);
    return () => {
      // Clear the inline override on unmount so the CSS `:root` baseline (14px)
      // resumes rather than a stale scaled value lingering on the element.
      root.style.fontSize = '';
      root.removeAttribute('data-hc-font-size');
    };
  }, [prefs.fontSize, zoom.scale]);

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

  // Navigate to the S08 case form for an already-resolved visit (CASE / S08).
  // The deep-linkable URL carries both ids so the form is reachable directly
  // and the completion guard still wraps it (it is a shell route).
  const openCaseVisit = useCallback(
    (patientId: string, visitId: string): void => {
      navigate(
        `/patient/${encodeURIComponent(patientId)}/case/${encodeURIComponent(
          visitId,
        )}`,
      );
    },
    [navigate],
  );

  // Navigate to the JOURNAL case form in FOLLOW-UP mode (ADR 0018 #2 /
  // S09-delta): a follow-up REUSES the journal CaseForm (box pre-opens with the
  // prior visit's content, insert buttons read "Update vitals"/"Update
  // prescription", "Add entry" appends a new dated entry). The `/followup`
  // suffix on the deep-linkable case URL is the visit-kind marker CaseRoute
  // reads to render CaseForm with visitType='follow_up'; the retired structured
  // S09 screen is no longer on the nav path. The common Back/Alt+Left parent-
  // chain regexes still match (`/patient/:id/case/`), and CaseForm autosaves.
  const openCaseFollowup = useCallback(
    (patientId: string, visitId: string): void => {
      navigate(
        `/patient/${encodeURIComponent(patientId)}/case/${encodeURIComponent(
          visitId,
        )}/followup`,
      );
    },
    [navigate],
  );

  // Start (open-or-create) a First visit for a patient and route into the
  // case form (S08 entry points: dashboard "New visit / Take case" and F5).
  // Only the generated binding is called; the resolved `visit_id` becomes the
  // route param so the URL is deep-linkable and CaseForm restores the same
  // open visit (VIS-001, CASE-005).
  const startCaseForPatient = useCallback(
    async (patientId: string): Promise<void> => {
      try {
        const open = await run(
          commands.caseVisitOpenOrCreate({ patientId, visitType: 'first' }),
        );
        openCaseVisit(patientId, open.visitId);
      } catch {
        // A failed open must be OBSERVABLE, not a dead click (R-UI-008). Surface
        // a short, non-crash alert and log one fixed line. No patient id, SQL,
        // file path or stack is read into the message or the log (R-PRIV-001).
        setOpenError(t('app.case.openFailed'));
        console.error('[AppShell] case open failed');
      }
    },
    [openCaseVisit],
  );

  // Start (open-or-create) a Follow-up visit and route into the JOURNAL case
  // form in follow-up mode (ADR 0018 #2). The backend seeds the new follow-up
  // visit's journal from the prior visit (box pre-opens with prior content; the
  // prior complaints pre-load, VIS-002), so the UI only needs to open-or-create
  // the follow-up and route into CaseForm with visitType='follow_up'. The
  // dashboard's `onNewFollowup(patientId)` no longer needs to pass a prior
  // visit id (prevVisitId is vestigial) — the backend resolves the prior visit
  // itself — and the UI does not thread it through the URL. Only the generated
  // binding is called; the resolved `visit_id` becomes the route param
  // (deep-linkable, VIS-001/002).
  const startFollowupForPatient = useCallback(
    async (patientId: string): Promise<void> => {
      try {
        const open = await run(
          commands.caseVisitOpenOrCreate({
            patientId,
            visitType: 'follow_up',
          }),
        );
        openCaseFollowup(patientId, open.visitId);
      } catch {
        // A failed follow-up open must be OBSERVABLE (R-UI-008): surface a short
        // non-crash alert and log one fixed line, with NO patient id / SQL /
        // path / stack in either (R-PRIV-001).
        setOpenError(t('app.case.openFailed'));
        console.error('[AppShell] follow-up open failed');
      }
    },
    [openCaseFollowup],
  );

  // The patient currently in focus (if any), parsed from the active route so
  // F5 "new visit for the open patient" (S08 keyboard) knows whom to open. It
  // is set by the /patients?id=<id> dashboard deep-link and by the case route
  // (first and follow-up both live under /patient/:id/case/, ADR 0018 #2).
  const openPatientId = useMemo((): string | null => {
    const caseMatch = /^\/patient\/([^/]+)\/case\//.exec(location.pathname);
    if (caseMatch && caseMatch[1] !== undefined) {
      return decodeURIComponent(caseMatch[1]);
    }
    if (location.pathname === '/patients') {
      const params = new URLSearchParams(location.search);
      const id = params.get('id');
      if (id !== null && id !== '') return id;
    }
    return null;
  }, [location.pathname, location.search]);

  // Global Alt+Left = Back (00-conventions §3): walk one step up the logical
  // parent chain —
  //   case/follow-up -> that patient's dashboard (/patients?id=:id)
  //   dashboard (/patients?id=:id) -> patient list (/patients)
  //   list / anything else -> Today (/today)
  // It never fires mid-IME-composition and never steals a keystroke typed
  // inside a text field (input / textarea / contenteditable), so typing a
  // left-arrow in a clinical note is untouched. Back never discards data — the
  // clinical forms autosave (CASE-005).
  const goBack = useCallback((): void => {
    const path = location.pathname;
    const caseMatch = /^\/patient\/([^/]+)\/case\//.exec(path);
    if (caseMatch && caseMatch[1] !== undefined) {
      navigate(`/patients?id=${encodeURIComponent(caseMatch[1])}`);
      return;
    }
    if (path === '/patients') {
      const params = new URLSearchParams(location.search);
      const id = params.get('id');
      if (id !== null && id !== '') {
        // On a patient dashboard -> the patient list.
        navigate('/patients');
        return;
      }
    }
    // The list, Today or any other shell screen -> Today (the top).
    navigate('/today');
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' || !e.altKey || e.isComposing) return;
      // Do not hijack a left-arrow a doctor is typing inside a text control.
      const el = e.target as HTMLElement | null;
      if (el !== null) {
        const tag = el.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          el.isContentEditable
        ) {
          return;
        }
      }
      e.preventDefault();
      goBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goBack]);

  // Zoom keyboard shortcuts (Slice C3; 00-conventions §3): Ctrl+= / Ctrl++
  // zoom in, Ctrl+- zoom out, Ctrl+0 reset. They scale the whole content root
  // (text + layout). Ignored mid-IME-composition so they never fire while a
  // doctor is composing text. `=`/`+` share a key, and NumpadAdd/Subtract are
  // accepted too, so the shortcut works across keyboard layouts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.isComposing) return;
      const key = e.key;
      if (key === '=' || key === '+' || key === 'Add') {
        e.preventDefault();
        zoom.zoomIn();
      } else if (key === '-' || key === '_' || key === 'Subtract') {
        e.preventDefault();
        zoom.zoomOut();
      } else if (key === '0') {
        e.preventDefault();
        zoom.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoom]);

  // F5 "new visit for the open patient" (S08 keyboard, HC-MVP1-M3vis): the
  // same choice the dashboard makes. When the patient already has a saved
  // first case F5 opens the follow-up (the dashboard's Follow-up button path),
  // otherwise it opens Take case. The shell asks the gate itself because F5
  // also fires from inside a case, where no dashboard is mounted. A failed
  // gate read is surfaced like a failed open (R-UI-008) rather than guessing,
  // so F5 never silently starts a second first case; the dashboard buttons
  // stay available. No patient data in the log line (R-PRIV-001).
  const startVisitForPatient = useCallback(
    async (patientId: string): Promise<void> => {
      let hasSavedFirstCase: boolean;
      try {
        const gate = await run(commands.visitHasSavedFirstCase({ patientId }));
        hasSavedFirstCase = gate.hasSavedFirstCase;
      } catch {
        setOpenError(t('app.case.openFailed'));
        console.error('[AppShell] saved-first-case check failed');
        return;
      }
      if (hasSavedFirstCase) {
        await startFollowupForPatient(patientId);
      } else {
        await startCaseForPatient(patientId);
      }
    },
    [startCaseForPatient, startFollowupForPatient],
  );

  // F5: new visit for the open patient (S08 keyboard). Feature-gated with the
  // case flag (R-DEL-002); never fires during IME composition (00-conventions).
  useEffect(() => {
    if (!features.case) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'F5' || e.isComposing) return;
      if (openPatientId === null) return;
      e.preventDefault();
      void startVisitForPatient(openPatientId);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openPatientId, startVisitForPatient]);

  // Idle auto-lock (SET-004): after the configured idle timeout with no user
  // activity, lock the app. Any clinical edit is already autosaved (CASE-005),
  // so locking never loses data. Ctrl+L (TopBar) is the explicit path. The
  // saved value (useAppPrefs: read after unlock, updated by a Settings Save)
  // wins; until it is read the value from authGetLockState is used; otherwise
  // the default fallback keeps the timer running.
  const bootMinutes =
    autolockMinutes != null && autolockMinutes > 0
      ? autolockMinutes
      : DEFAULT_AUTOLOCK_MINUTES;
  const effectiveMinutes =
    prefs.loaded && prefs.autolockMinutes > 0
      ? prefs.autolockMinutes
      : bootMinutes;
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
          : location.pathname === '/settings'
            ? '/settings'
            : undefined;

  // The content root carries the zoom VARIABLE only (`--hc-font-scale`), so any
  // layout math that reads the scale still works. The actual text/layout
  // scaling is driven onto the DOCUMENT ROOT font-size by the zoom effect above
  // (C8 fix) — setting font-size on this mid-tree div was a no-op for every
  // rem-based utility, which was the bug. Typed through CSSProperties: a CSS
  // custom property is not in the lib DOM type, so the object is cast once here.
  const contentStyle = {
    '--hc-font-scale': String(zoom.scale),
  } as CSSProperties;

  return (
    <div
      data-testid="app-shell"
      className="flex h-screen min-w-0 flex-col bg-white text-[1rem]"
    >
      <TopBar onLock={goToLock} onOpenSearch={openSearch} />
      {/* Shared app-bar (Slice C2/C3): the ONE consistent place for the common
          Back and the zoom controls, so every screen shares the same slot. */}
      <AppBar
        onBack={goBack}
        onZoomIn={zoom.zoomIn}
        onZoomOut={zoom.zoomOut}
        onZoomReset={zoom.reset}
      />
      {/* Failed-open alert (R-UI-008): a non-crash, patient-data-free banner so
          a failed case/follow-up open is observable, not a dead click. Role
          `alert` + text (never colour alone); dismissible by the doctor. */}
      {openError !== null ? (
        <div
          role="alert"
          data-testid="app-open-error"
          className="flex items-center justify-between gap-4 border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800"
        >
          <span>{openError}</span>
          <button
            type="button"
            data-testid="app-open-error-dismiss"
            onClick={dismissOpenError}
            className="rounded border border-red-300 px-2 py-0.5 text-xs hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-600"
          >
            {t('common.dismiss')}
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <SideNav activeRoute={activeRoute} onNavigate={onNavigate} />
        <main
          className="min-w-0 flex-1 overflow-auto"
          data-testid="content-area"
          style={contentStyle}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route
              path="/today"
              element={
                <TodayScreen
                  onNewPatient={openNewPatient}
                  onOpenPatient={openPatient}
                  onOpenBackup={goToBackup}
                />
              }
            />
            {features.patients ? (
              <Route
                path="/patients"
                element={
                  <PatientsRoute
                    onTakeCase={startCaseForPatient}
                    onNewFollowup={startFollowupForPatient}
                  />
                }
              />
            ) : null}
            {features.case ? (
              <Route
                path="/patient/:patientId/case/:visitId"
                element={<CaseRoute onBack={openPatient} />}
              />
            ) : null}
            {features.case ? (
              <Route
                path="/patient/:patientId/case/:visitId/followup"
                element={
                  <CaseRoute onBack={openPatient} visitType="follow_up" />
                }
              />
            ) : null}
            {features.case ? (
              // Legacy structured S09 route (retired from the NAV PATH by ADR
              // 0018 #2 — the dashboard follow-up now opens the journal CaseForm
              // above). Kept as a dormant, deep-link-only surface so an existing
              // bookmark/URL still resolves; nothing in the app navigates here.
              <Route
                path="/patient/:patientId/visit/:visitId/followup"
                element={<FollowupRoute onBack={openPatient} />}
              />
            ) : null}
            {features.backup ? (
              <Route path="/backup" element={<BackupScreen />} />
            ) : null}
            {features.settings ? (
              <Route path="/settings" element={<SettingsScreen />} />
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
function PatientsRoute({
  onTakeCase,
  onNewFollowup,
}: {
  readonly onTakeCase: (patientId: string) => void;
  readonly onNewFollowup: (patientId: string, prevVisitId?: string) => void;
}): JSX.Element {
  const [params] = useSearchParams();
  const id = params.get('id') ?? undefined;
  const view = params.get('view') === 'new' ? 'new' : 'list';
  // `exactOptionalPropertyTypes` is on: pass initialPatientId only when it is a
  // real id, never an explicit `undefined`. The `key` forces a fresh
  // PatientsPage when the deep-linked id changes (a new search Enter re-opens
  // the dashboard even from within /patients).
  return id !== undefined ? (
    <PatientsPage
      key={id}
      initialPatientId={id}
      onTakeCase={onTakeCase}
      onNewFollowup={onNewFollowup}
    />
  ) : (
    <PatientsPage
      key={view}
      initialView={view}
      onTakeCase={onTakeCase}
      onNewFollowup={onNewFollowup}
    />
  );
}

/**
 * `/patient/:patientId/case/:visitId` route (S08) and its follow-up variant
 * `/patient/:patientId/case/:visitId/followup` (S09, ADR 0018 #2). Loads the
 * patient once to derive the two props the schema-driven case form needs beyond
 * its ids — the patient's sex (drives the menstrual/obstetric conditional
 * section) and whole-year age (drives the child-development section)
 * (CASE-001). Both come from the typed `patient_get_dashboard` payload; the UI
 * never reads SQL. `visitType` selects first vs follow-up journal mode: in
 * follow-up mode the inserted-table buttons read "Update vitals"/"Update
 * prescription" and the box opens with the backend-seeded prior content
 * (VIS-002). The case form itself opens-or-restores the visit's journal
 * (CASE-005).
 */
function CaseRoute({
  onBack,
  visitType = 'first',
}: {
  readonly onBack: (patientId: string) => void;
  readonly visitType?: 'first' | 'follow_up';
}): JSX.Element {
  const params = useParams<{ patientId: string; visitId: string }>();
  const patientId = params.patientId ?? '';
  const visitId = params.visitId ?? '';
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [ageYears, setAgeYears] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const dash = await run(commands.patientGetDashboard({ patientId }));
        if (cancelled) return;
        setSex(sexOf(dash.demographics.sex));
        setAgeYears(ageYearsOf(dash.demographics.ageLabel));
      } catch {
        /* fall back to the safe defaults; the form still renders (no dead end) */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  if (!loaded) {
    return (
      <section
        data-testid="case-route-loading"
        aria-busy="true"
        className="p-6 text-sm text-slate-500"
      >
        <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
      </section>
    );
  }

  return (
    <CaseForm
      patientId={patientId}
      visitId={visitId}
      visitType={visitType}
      sex={sex}
      ageYears={ageYears}
      onBack={() => onBack(patientId)}
    />
  );
}

/**
 * Legacy `/patient/:patientId/visit/:visitId/followup` route — the retired
 * structured S09 screen (ADR 0018 #2 replaces it with the journal CaseModel).
 * This route is NO LONGER on the nav path: nothing in the app navigates here
 * (the dashboard follow-up and F5 open the journal CaseForm in follow-up mode).
 * It is retained only as a dormant, deep-link-only surface so an existing
 * bookmark/URL still resolves instead of redirecting to Today. The previous
 * visit whose complaints pre-load (VIS-002) is carried in the `?prev=` hash
 * query. UI -> typed commands only.
 */
function FollowupRoute({
  onBack,
}: {
  readonly onBack: (patientId: string) => void;
}): JSX.Element {
  const params = useParams<{ patientId: string; visitId: string }>();
  const [query] = useSearchParams();
  const patientId = params.patientId ?? '';
  const visitId = params.visitId ?? '';
  const prevVisitId = query.get('prev') ?? '';
  return (
    <FollowupVisit
      patientId={patientId}
      visitId={visitId}
      prevVisitId={prevVisitId}
      onBack={() => onBack(patientId)}
    />
  );
}

/** Map the free-form demographics sex to the case form's binary conditional. */
function sexOf(sex: string | null): 'male' | 'female' {
  if (sex === null) return 'male';
  const s = sex.trim().toLowerCase();
  return s.startsWith('f') ? 'female' : 'male';
}

/** Parse whole years from an age label like `34y` / `34 y` / `6m` (-> 0). */
function ageYearsOf(ageLabel: string): number {
  const match = /^\s*(\d+)\s*y/i.exec(ageLabel);
  return match && match[1] !== undefined ? Number(match[1]) : 0;
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
  return (
    <AppPrefsProvider>
      <ShellFrame autolockMinutes={autolockMinutes} />
    </AppPrefsProvider>
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
          path="/data-missing"
          element={<DataFolderMissing onResolved={setLiveCompleted} />}
        />
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
