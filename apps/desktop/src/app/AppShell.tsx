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
import { useCallback } from 'react';
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
import { TodayScreen } from '@/home/TodayScreen';

/** Inner shell chrome; assumes a router is present above it. */
function ShellFrame(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();

  const goToLock = useCallback(() => navigate('/lock'), [navigate]);
  const onNavigate = useCallback(
    (route: NavRoute) => navigate(route),
    [navigate],
  );

  const activeRoute: NavRoute | undefined =
    location.pathname === '/today' || location.pathname === '/'
      ? '/today'
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
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        </main>
      </div>
      <StatusBar />
    </div>
  );
}

/** Top-level shell: provides the router and renders the chrome. */
export function AppShell(): JSX.Element {
  return (
    <HashRouter>
      <Routes>
        <Route path="/lock" element={<LockScreen />} />
        <Route path="*" element={<ShellFrame />} />
      </Routes>
    </HashRouter>
  );
}
