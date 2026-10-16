// WebdriverIO + tauri-driver configuration for the HomeoClinic desktop app
// on Linux (hc-e2e-testing: WebKitWebDriver under xvfb). macOS/Windows are
// handled elsewhere; this file targets linux only.
//
// tauri-driver is a thin WebDriver proxy that spawns the platform webdriver
// (Linux: WebKitWebDriver) and the Tauri application binary. We start
// tauri-driver ourselves in onPrepare/onComplete so a single `wdio run`
// invocation is self-contained under `xvfb-run -a`.
//
// The application binary path is taken from HC_APP_BINARY (set by the
// executor to the freshly built --debug binary); it falls back to the
// conventional Tauri v2 debug output path.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const defaultBinary = path.join(
  repoRoot,
  'apps/desktop/src-tauri/target/debug/homeoclinic-desktop',
);
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

const nativeDriverPort = 4445;
const tauriDriverPort = 4444;

let tauriDriver: ChildProcess | undefined;

export const config: WebdriverIO.Config = {
  runner: 'local',
  hostname: '127.0.0.1',
  port: tauriDriverPort,
  path: '/',

  specs: ['./specs/**/*.e2e.ts'],
  maxInstances: 1,

  capabilities: [
    {
      // tauri-driver custom capability: point it at the app binary.
      // The Linux native driver is WebKitWebDriver.
      'tauri:options': {
        application: appBinary,
      },
      // WebdriverIO requires a browserName; tauri-driver ignores it but it
      // keeps the session negotiation happy.
      browserName: 'wry',
      // WebKitWebDriver is classic-only: it rejects the BiDi `webSocketUrl`
      // capability WebdriverIO 9 adds by default, which surfaces as
      // "Failed to match capabilities / session not created". Force classic.
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
    timeout: 60000,
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

  // Start tauri-driver before the session; it proxies to WebKitWebDriver.
  onPrepare: () => {
    const nativeDriver =
      process.env.HC_NATIVE_DRIVER ?? 'WebKitWebDriver';
    tauriDriver = spawn(
      'tauri-driver',
      [
        '--port',
        String(tauriDriverPort),
        '--native-port',
        String(nativeDriverPort),
        '--native-driver',
        nativeDriver,
      ],
      { stdio: [null, process.stdout, process.stderr] },
    );
    tauriDriver.on('error', (err) => {
      // Surfaced verbatim so the executor can classify infra_incomplete.
      // eslint-disable-next-line no-console
      console.error(`tauri-driver failed to start: ${err.message}`);
      process.exit(1);
    });
  },

  onComplete: () => {
    tauriDriver?.kill();
  },
};
