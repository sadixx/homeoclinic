// Per-spec data-dir isolation + in-spec relaunch helper.
//
// Reproduces, inside a single `wdio run`, the hc-e2e-orchestrator's model of
// "one launch per phase, each with its own XDG_DATA_HOME" (see
// .worklog/.../run-regression.sh). Every spec file gets its own base temp root
// (set up in wdio.conf.ts `beforeSession`); within a spec, multi-phase flows
// call these helpers to launch the app against a FRESH dir, a REUSED dir
// (relaunch of a provisioned install), or a shared backup folder.
//
// The first app launch of a spec is created by WebdriverIO's own session
// (started right after `beforeSession` points the driver at the spec's primary
// dir). Subsequent phases call `relaunchFresh` / `relaunchReusing`, which
// restart the driver chain at the chosen dir and `reloadSession()` so the Tauri
// app is relaunched there — the exact "separate launch, specific data dir"
// behaviour the orchestrator got from separate processes.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { browser } from '@wdio/globals';

import { startDriver } from './driver.js';

/** State for the currently running spec, owned by wdio.conf.ts hooks. */
interface SpecDataState {
  /** Unique base temp root for this spec file (cleaned in afterSession). */
  baseRoot: string;
  /** Named data dirs allocated so far (name -> absolute XDG_DATA_HOME). */
  dirs: Map<string, string>;
  /** The XDG dir the driver is CURRENTLY pointed at. */
  current: string;
  /** A shared backup folder for this spec (two-dir backup/restore flows). */
  backupDir?: string;
}

let state: SpecDataState | undefined;

/**
 * The PREVIOUS-release binary (relaunchIntoWithBinary) currently running, if
 * any. driver.ts reaps only the default HC_APP_BINARY by path, so an R1/R2
 * worktree app could otherwise outlive its session and keep the data dir's
 * SQLCipher DB open while the next build launches over the SAME dir. Reaped
 * (SIGKILL, matched by executable — see killByExecutable) before every
 * relaunch. The previous-release app is idle by then (its writes committed).
 */
let previousBinaryRunning: string | undefined;

function reapPreviousBinary(): void {
  if (previousBinaryRunning === undefined) return;
  killByExecutable(previousBinaryRunning);
  previousBinaryRunning = undefined;
}

/**
 * SIGKILL every process whose executable IS `binary` (Linux /proc/<pid>/exe).
 * Matching the executable rather than `pkill -f <path>` means a shell or
 * runner whose command LINE merely mentions the path (e.g. an
 * `HC_R2_APP_BINARY=<path> xvfb-run …` invocation) is never hit. Best-effort;
 * a no-op where /proc is absent (Windows reaps through the driver chain).
 */
function killByExecutable(binary: string): void {
  const want = path.resolve(binary);
  let pids: string[];
  try {
    pids = readdirSync('/proc').filter((d) => /^\d+$/.test(d));
  } catch {
    return;
  }
  for (const pid of pids) {
    let exe: string;
    try {
      exe = readlinkSync(`/proc/${pid}/exe`);
    } catch {
      continue; // not ours / already gone
    }
    if (exe === want || exe === `${want} (deleted)`) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        // already exited
      }
    }
  }
}

/**
 * (Re)initialise per-spec state. Called from `beforeSession` with a unique base
 * root. Allocates the spec's PRIMARY data dir ('main') and returns the env the
 * driver must be started with so WebdriverIO's first session launches the app
 * against it.
 */
export function initSpecData(baseRoot: string): NodeJS.ProcessEnv {
  mkdirSync(baseRoot, { recursive: true });
  const primary = path.join(baseRoot, 'main');
  mkdirSync(primary, { recursive: true });
  state = {
    baseRoot,
    dirs: new Map([['main', primary]]),
    current: primary,
  };
  return dataDirEnv(primary);
}

/**
 * Copy every `logs/app.log*` under the spec's data dirs into
 * `<HC_E2E_OUTDIR>/app-logs/` before cleanup, so the analyzer can scan the
 * app's own log for panics / patient data. Opt-in via HC_E2E_KEEP_APP_LOGS=1;
 * best-effort (never fails a run).
 */
function retainAppLogs(s: SpecDataState): void {
  const outDir = process.env.HC_E2E_OUTDIR;
  if (process.env.HC_E2E_KEEP_APP_LOGS !== '1' || outDir === undefined) return;
  const dest = path.join(outDir, 'app-logs');
  const walk = (dir: string, dirName: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, dirName);
      } else if (
        path.basename(dir) === 'logs' &&
        entry.name.startsWith('app.log')
      ) {
        mkdirSync(dest, { recursive: true });
        copyFileSync(full, path.join(dest, `${dirName}-${entry.name}`));
      }
    }
  };
  for (const [name, dir] of s.dirs) {
    try {
      walk(dir, name);
    } catch {
      // best-effort: a missing or unreadable dir must not fail teardown
    }
  }
}

/** Tear down per-spec state and remove the whole base root. */
export function cleanupSpecData(): void {
  reapPreviousBinary();
  if (state) {
    retainAppLogs(state);
    try {
      rmSync(state.baseRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; never fail a run on teardown
    }
    state = undefined;
  }
}

function requireState(): SpecDataState {
  if (!state) {
    throw new Error(
      'spec data state not initialised — initSpecData must run in beforeSession',
    );
  }
  return state;
}

/** Build the env overrides that point the app at `dir` as its data dir. */
function dataDirEnv(dir: string): NodeJS.ProcessEnv {
  // XDG_DATA_HOME drives Tauri's app_data_dir() on Linux
  // (dirs::data_dir() -> $XDG_DATA_HOME/<identifier>). HOME is pointed at the
  // same dir too so nothing leaks into the real ~/.local/share and the
  // encrypted-file keystore fallback (NFR-020) stays inside the isolated dir.
  return { XDG_DATA_HOME: dir, HOME: dir };
}

/** Absolute path of a named data dir, allocating a fresh one on first use. */
export function dataDir(name: string): string {
  const s = requireState();
  let dir = s.dirs.get(name);
  if (!dir) {
    dir = path.join(s.baseRoot, name);
    mkdirSync(dir, { recursive: true });
    s.dirs.set(name, dir);
  }
  return dir;
}

/** A shared backup folder for this spec (same across its phases). */
export function sharedBackupDir(): string {
  const s = requireState();
  if (!s.backupDir) {
    s.backupDir = path.join(s.baseRoot, 'backup-shared');
    mkdirSync(s.backupDir, { recursive: true });
  }
  return s.backupDir;
}

/**
 * Relaunch the app against the NAMED data dir, restarting the driver chain so
 * the app inherits that dir, then reloading the WebDriver session. If the name
 * is new, a FRESH empty dir is created (a clean install); if it already exists
 * (e.g. 'main' or a dir a prior phase provisioned), the SAME dir is reused (a
 * provisioned-install relaunch). This is the in-spec equivalent of the
 * orchestrator starting a new process with a chosen XDG_DATA_HOME.
 */
export async function relaunchInto(name: string): Promise<void> {
  const s = requireState();
  const dir = dataDir(name);
  s.current = dir;
  // A session reloaded WITHOUT capabilities keeps the LAST session's
  // `tauri:options.application`. After relaunchIntoWithBinary(previous build)
  // a bare reloadSession() would therefore relaunch the PREVIOUS build again,
  // not the build under test — so switch back to the default binary
  // explicitly. (This is what makes upgrade-path's "install N over N-1"
  // relaunch actually run build N.)
  const switchBack = previousBinaryRunning !== undefined;
  reapPreviousBinary();
  await startDriver(dataDirEnv(dir));
  if (switchBack) {
    await browser.reloadSession(defaultCapabilities());
  } else {
    await browser.reloadSession();
  }
}

/** The build-under-test capabilities (wdio.conf.ts), with HC_APP_BINARY. */
function defaultCapabilities(): WebdriverIO.Capabilities {
  const app = process.env.HC_APP_BINARY;
  if (app === undefined) {
    throw new Error('HC_APP_BINARY is not set (wdio.conf.ts sets it at load)');
  }
  return {
    'tauri:options': { application: app },
    browserName: 'wry',
    'wdio:enforceWebDriverClassic': true,
  } as WebdriverIO.Capabilities;
}

/** Relaunch into a brand-new clean data dir identified by `name`. */
export async function relaunchFresh(name: string): Promise<void> {
  // Allocate (or reuse by name) — callers pass a NEW name for a clean install.
  await relaunchInto(name);
}

/**
 * Relaunch the app against the NAMED data dir using a SPECIFIC application
 * binary, restarting the driver chain and reloading the session with the
 * chosen `tauri:options.application`. This is the lever the upgrade-path
 * harness needs: it must launch the PREVIOUS-release build (e.g. the R1 app)
 * to provision/age a data dir, then launch the CURRENT-release build (the R2
 * app under test) over the SAME dir — a genuine "install N over N-1".
 *
 * tauri-driver takes the app binary from the `tauri:options.application`
 * capability at session-init, so passing it to `reloadSession` switches which
 * binary the next launch runs. The XDG_DATA_HOME is still set on the driver
 * chain (startDriver) so the launched app — whichever build — resolves the
 * SAME on-disk data dir. `binaryPath` must be an existing, absolute path.
 */
export async function relaunchIntoWithBinary(
  name: string,
  binaryPath: string,
): Promise<void> {
  if (!existsSync(binaryPath)) {
    throw new Error(
      `infra_incomplete: application binary not found at ${binaryPath} ` +
        `(upgrade-path harness needs both the previous- and current-release ` +
        `builds; set HC_R1_APP_BINARY / HC_R2_APP_BINARY to the previous-release ` +
        `build and leave the default target/debug/homeoclinic-desktop as ` +
        `the build under test).`,
    );
  }
  const s = requireState();
  const dir = dataDir(name);
  s.current = dir;
  // The app is launched by WebKitWebDriver, which inherits XDG_DATA_HOME from
  // the driver chain; reap+respawn it pointed at `dir` first.
  reapPreviousBinary();
  await startDriver(dataDirEnv(dir));
  // Reload with the overridden application capability so THIS launch runs the
  // chosen binary. tauri-driver reads `tauri:options.application` per session.
  await browser.reloadSession({
    'tauri:options': { application: binaryPath },
    browserName: 'wry',
    'wdio:enforceWebDriverClassic': true,
  } as WebdriverIO.Capabilities);
  if (path.resolve(binaryPath) !== process.env.HC_APP_BINARY) {
    previousBinaryRunning = path.resolve(binaryPath);
  }
}

/**
 * Allocate a unique base root for a spec under the system temp dir. Used by
 * `beforeSession` so each spec file is fully isolated from the others.
 */
export function makeSpecBaseRoot(label: string): string {
  const safe = label.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-40);
  return mkdtempSync(path.join(os.tmpdir(), `hc-e2e-${safe}-`));
}
