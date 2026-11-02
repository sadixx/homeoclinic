// X11 / process probes for native-window E2E checks (TEST-ONLY).
//
// WebDriver cannot see native GTK windows (the file chooser opened by
// `visit_pick_report_file`), and the Xvfb runner has no window manager and no
// xdotool. These helpers read the X11 window tree with the standard
// `xwininfo`/`xprop` tools, act on windows through scripts/x11win.py (ctypes
// libX11/libXtst), and — when gdb is available — read the app's live GTK
// toplevel list (type names) the same way the build-15 crash harness did.
//
// Never logs patient data: only window ids, titles of native windows and pids.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const X11WIN = path.resolve(here, '..', 'scripts', 'x11win.py');
const GTK_GDB = path.resolve(here, 'gtk-toplevels.gdb');

export interface X11Window {
  id: string; // 0x-hex, as printed by xwininfo
  title: string | null;
}

function run(cmd: string, args: string[], timeout = 15000): string {
  return execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Direct children of the root window (= toplevels, since Xvfb has no WM). */
export function listToplevels(): X11Window[] {
  const out = run('xwininfo', ['-root', '-children']);
  const wins: X11Window[] = [];
  for (const line of out.split('\n')) {
    const m = /^\s+(0x[0-9a-f]+)\s+(?:"((?:[^"\\]|\\.)*)"|\(has no name\))/.exec(line);
    if (m !== null && m[1] !== undefined) wins.push({ id: m[1], title: m[2] ?? null });
  }
  return wins;
}

/** True when the window is mapped and viewable. */
export function isViewable(id: string): boolean {
  try {
    return /Map State:\s+IsViewable/.test(run('xwininfo', ['-id', id]));
  } catch {
    return false; // window destroyed
  }
}

/** The `_NET_WM_PID` GDK stamps on its toplevels, or null. */
export function windowPid(id: string): number | null {
  try {
    const m = /=\s*(\d+)/.exec(run('xprop', ['-id', id, '_NET_WM_PID']));
    return m?.[1] !== undefined ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** Viewable toplevels with an exact title, owned by `pid`. */
export function viewableWindowsOf(pid: number, title: string): X11Window[] {
  return listToplevels().filter(
    (w) => w.title === title && isViewable(w.id) && windowPid(w.id) === pid,
  );
}

/** Pid of the running app binary (exact full command line), or null. */
export function appPid(binary = process.env.HC_APP_BINARY ?? ''): number | null {
  if (binary === '') return null;
  try {
    const pids = run('pgrep', ['-f', '-x', binary])
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map(Number);
    return pids[0] ?? null;
  } catch {
    return null; // pgrep exits 1 when nothing matches
  }
}

/** True when `pid` exists and is not a zombie. */
export function pidAlive(pid: number): boolean {
  try {
    const stat = run('ps', ['-o', 'stat=', '-p', String(pid)]).trim();
    return stat !== '' && !stat.startsWith('Z');
  } catch {
    return false;
  }
}

/**
 * The app's GTK toplevels (type name + title) read via gdb, or null when gdb is
 * unavailable / cannot attach. Attaching pauses the process for well under a
 * second; it is detached again before returning.
 */
export function gtkToplevels(pid: number): { type: string; title: string }[] | null {
  try {
    const out = run('gdb', ['-p', String(pid), '-batch', '-x', GTK_GDB], 60000);
    const rows: { type: string; title: string }[] = [];
    for (const line of out.split('\n')) {
      const m = /^TOPLEVEL\[\d+\] type=(\S+) title=(.*)$/.exec(line);
      if (m?.[1] !== undefined) rows.push({ type: m[1], title: (m[2] ?? '').trim() });
    }
    return /^GTK_TOPLEVELS=\d+/m.test(out) ? rows : null;
  } catch {
    return null;
  }
}

/** Ask a window to close the way a WM does (WM_DELETE_WINDOW). */
export function closeWindow(id: string): void {
  run('python3', [X11WIN, 'close', id]);
}

/** Focus a window and press Escape into it (XTest). */
export function escapeWindow(id: string): void {
  run('python3', [X11WIN, 'escape', id]);
}

/** Move/resize a toplevel directly (no WM to negotiate with under Xvfb). */
export function resizeWindow(id: string, x: number, y: number, w: number, h: number): void {
  run('python3', [X11WIN, 'resize', id, String(x), String(y), String(w), String(h)]);
}

/** The X screen size in px. */
export function screenSize(): { width: number; height: number } {
  const [w, h] = run('python3', [X11WIN, 'screen']).trim().split(/\s+/).map(Number);
  return { width: w ?? 0, height: h ?? 0 };
}
