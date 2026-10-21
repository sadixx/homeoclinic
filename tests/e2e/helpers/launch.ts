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
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

/** Tear down per-spec state and remove the whole base root. */
export function cleanupSpecData(): void {
  if (state) {
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
  await startDriver(dataDirEnv(dir));
  await browser.reloadSession();
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
        `builds; set HC_R1_APP_BINARY to the R1 build and leave the default ` +
        `target/debug/homeoclinic-desktop as the R2 build).`,
    );
  }
  const s = requireState();
  const dir = dataDir(name);
  s.current = dir;
  // The app is launched by WebKitWebDriver, which inherits XDG_DATA_HOME from
  // the driver chain; reap+respawn it pointed at `dir` first.
  await startDriver(dataDirEnv(dir));
  // Reload with the overridden application capability so THIS launch runs the
  // chosen binary. tauri-driver reads `tauri:options.application` per session.
  await browser.reloadSession({
    'tauri:options': { application: binaryPath },
    browserName: 'wry',
    'wdio:enforceWebDriverClassic': true,
  } as WebdriverIO.Capabilities);
}

/**
 * Allocate a unique base root for a spec under the system temp dir. Used by
 * `beforeSession` so each spec file is fully isolated from the others.
 */
export function makeSpecBaseRoot(label: string): string {
  const safe = label.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-40);
  return mkdtempSync(path.join(os.tmpdir(), `hc-e2e-${safe}-`));
}
