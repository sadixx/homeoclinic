// WebdriverIO + tauri-driver configuration for the HomeoClinic desktop app
// (hc-e2e-testing). Linux: WebKitWebDriver under xvfb. Windows: Edge
// WebDriver (msedgedriver, HC_NATIVE_DRIVER) against WebView2. macOS is not a
// target.
//
// tauri-driver is a thin WebDriver proxy that spawns the platform webdriver
// (Linux: WebKitWebDriver, Windows: msedgedriver) and the Tauri application
// binary.
//
// ── SPEC SELECTION BY TARGET ─────────────────────────────────────────────────
// HC_E2E_TARGET=<linux|windows> runs only the specs whose `// @targets` header
// lists that target (scripts/spec-header.ts, the same parser index.json is
// built with). The Windows CI job sets HC_E2E_TARGET=windows so the X11-only
// specs (real GTK picker, xvfb resize, GDK_BACKEND=x11 windows) never run
// there. Unset = every spec (the Linux job and local runs). `--spec` on the
// command line still narrows further, as usual.
//
// WINDOWS DATA-DIR CAVEAT: the per-spec isolation below works through
// XDG_DATA_HOME, which Tauri's app_data_dir() honours on Linux only. On
// Windows app_data_dir() is the Known Folder %APPDATA%\dev.homeoclinic.desktop
// and ignores the environment, so Windows specs share one data dir until the
// app or the harness gains a Windows isolation lever.
//
// ── DATA-DIR ISOLATION (CI parity with hc-e2e-orchestrator) ─────────────────
// The app resolves its data dir from Tauri's app.path().app_data_dir(), which
// on Linux is $XDG_DATA_HOME/<identifier> (dirs::data_dir()). When the WHOLE
// suite runs in ONE `wdio run`, a single shared XDG_DATA_HOME makes the
// provisioning specs COLLIDE: a "fresh install" spec sees a data dir another
// spec already provisioned. The hc-e2e-orchestrator avoided this by running one
// invocation PER LAUNCH, each with its OWN XDG_DATA_HOME.
//
// To reproduce that inside a single `wdio run` we start the tauri-driver chain
// PER SPEC (beforeSession) with a unique XDG_DATA_HOME, and tear it down
// afterwards (afterSession). The app the native driver launches inherits that
// env, so every spec file gets a FRESH, isolated data dir. Multi-phase specs
// relaunch the app at a chosen dir mid-spec via tests/e2e/helpers/launch.ts
// (restart driver + reloadSession), which is the in-process equivalent of the
// orchestrator's separate per-phase processes. maxInstances:1 keeps this
// strictly serial so a single shared driver port (4444) is never contended.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

import {
  cleanupSpecData,
  initSpecData,
  makeSpecBaseRoot,
  sharedBackupDir,
} from './helpers/launch.js';
import { startDriver, stopDriver, resolveNativeDriver } from './helpers/driver.js';
import { E2E_TARGETS, specsForTarget } from './scripts/spec-header.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

// Cargo workspace: the Tauri app crate lives under apps/desktop/src-tauri but
// the compiled binary lands in the shared WORKSPACE-ROOT target dir.
const exe = process.platform === 'win32' ? '.exe' : '';
const defaultBinary = path.join(repoRoot, `target/debug/homeoclinic-desktop${exe}`);
const appBinary = process.env.HC_APP_BINARY
  ? path.resolve(process.env.HC_APP_BINARY)
  : defaultBinary;

if (!existsSync(appBinary)) {
  throw new Error(
    `infra_incomplete: application binary not found at ${appBinary}. ` +
      `Build it with: npm --prefix apps/desktop run tauri build -- --debug, ` +
      `or set HC_APP_BINARY to the built binary path.`,
  );
}

// Expose the resolved binary path so helpers/driver.ts can reap a lingering app
// process by its ABSOLUTE path (a string the wdio runner's own command line
// never contains), without a broad pkill that could hit the runner.
process.env.HC_APP_BINARY = appBinary;

// Fail fast with a clear message if the native driver cannot be resolved,
// rather than deep inside the first beforeSession.
resolveNativeDriver();

const tauriDriverPort = 4444;

/**
 * The spec list: every spec, or (HC_E2E_TARGET set) only those whose @targets
 * header lists the target. An unknown target or an empty selection fails
 * loudly: a filter that selects nothing must never pass green.
 */
function selectSpecs(): string[] {
  const target = process.env.HC_E2E_TARGET?.trim();
  if (target === undefined || target === '') return ['./specs/**/*.e2e.ts'];
  if (!(E2E_TARGETS as readonly string[]).includes(target)) {
    throw new Error(`HC_E2E_TARGET=${target} is not one of ${E2E_TARGETS.join(', ')}`);
  }
  const picked = specsForTarget(here, target);
  if (picked.length === 0) {
    throw new Error(`HC_E2E_TARGET=${target}: no spec lists ${target} in its @targets header`);
  }
  // eslint-disable-next-line no-console
  console.log(`[wdio] HC_E2E_TARGET=${target}: ${picked.length} spec(s): ${picked.join(', ')}`);
  return picked.map((rel) => path.join(here, rel));
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: tauriDriverPort,
  path: '/',

  specs: selectSpecs(),
  // Strictly serial: one spec (and thus one driver + one app) at a time. The
  // per-spec driver lifecycle below depends on this.
  maxInstances: 1,

  capabilities: [
    {
      'tauri:options': {
        application: appBinary,
      },
      browserName: 'wry',
      // WebKitWebDriver is classic-only: force classic so it does not reject
      // the BiDi webSocketUrl capability WebdriverIO 9 adds by default.
      'wdio:enforceWebDriverClassic': true,
    } as WebdriverIO.Capabilities,
  ],

  logLevel: 'debug',
  outputDir: process.env.HC_E2E_OUTDIR ?? './',
  bail: 0,
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },

  reporters: [
    'spec',
    [
      'junit',
      {
        outputDir: process.env.HC_E2E_OUTDIR ?? './',
        outputFileFormat: () => 'junit.xml',
      },
    ],
  ],

  // The driver is NO LONGER started once in onPrepare. It is started per spec
  // in beforeSession (below) so each spec gets a fresh, isolated XDG_DATA_HOME.

  /**
   * Per-spec setup: allocate a unique base temp root, point the driver (and so
   * the app) at this spec's primary data dir, and expose a shared backup folder
   * via HC_E2E_BACKUP_DIR for backup/restore specs. Runs in the worker BEFORE
   * WebdriverIO creates the session, so the first app launch already lands in
   * the isolated dir.
   */
  beforeSession: async function (_cfg, _caps, specs) {
    const label = (specs && specs[0]) ? path.basename(specs[0]) : 'spec';
    const baseRoot = makeSpecBaseRoot(label);
    const env = initSpecData(baseRoot);

    // Every spec gets a per-spec shared backup folder. Backup/restore specs
    // read process.env.HC_E2E_BACKUP_DIR in the worker; set it here so the two
    // phases of a two-dir backup/restore flow share one folder within the spec.
    process.env.HC_E2E_BACKUP_DIR = sharedBackupDir();

    await startDriver(env);
  },

  /** Per-spec teardown: stop the driver and remove the spec's temp dirs. */
  afterSession: async function () {
    await stopDriver();
    cleanupSpecData();
    delete process.env.HC_E2E_BACKUP_DIR;
  },

  /** Safety net: ensure no driver leaks if a worker is torn down abruptly. */
  onComplete: async function () {
    await stopDriver();
  },
};
