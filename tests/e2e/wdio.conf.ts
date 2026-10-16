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
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

// Cargo workspace: the Tauri app crate lives under
// apps/desktop/src-tauri but the compiled binary lands in the shared
// WORKSPACE-ROOT target dir, not a per-crate target dir.
const defaultBinary = path.join(
  repoRoot,
  'target/debug/homeoclinic-desktop',
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

// tauri-driver needs an ABSOLUTE path to the native webdriver; a bare name
// like "WebKitWebDriver" makes it report
// "can not find the supplied binary path WebKitWebDriver". Resolve to an
// absolute path: honour HC_NATIVE_DRIVER if set, otherwise locate
// WebKitWebDriver on PATH (via `command -v`) or in common install locations.
function resolveNativeDriver(): string {
  const override = process.env.HC_NATIVE_DRIVER;
  if (override) {
    const abs = path.resolve(override);
    if (!existsSync(abs)) {
      throw new Error(
        `infra_incomplete: HC_NATIVE_DRIVER points to ${abs} but no file ` +
          `exists there.`,
      );
    }
    return abs;
  }

  // Try PATH first (command -v resolves to an absolute path on Linux).
  try {
    const found = execFileSync('sh', ['-c', 'command -v WebKitWebDriver'], {
      encoding: 'utf8',
    }).trim();
    if (found && existsSync(found)) {
      return path.resolve(found);
    }
  } catch {
    // not on PATH; fall through to common locations
  }

  const commonLocations = [
    '/usr/bin/WebKitWebDriver',
    '/usr/local/bin/WebKitWebDriver',
    '/usr/lib/webkit2gtk-4.1/WebKitWebDriver',
    '/usr/lib/webkit2gtk-4.0/WebKitWebDriver',
  ];
  for (const candidate of commonLocations) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `infra_incomplete: WebKitWebDriver not found on PATH or in ` +
      `[${commonLocations.join(', ')}]. Install it (e.g. ` +
      `apt-get install webkit2gtk-driver) or set HC_NATIVE_DRIVER to the ` +
      `absolute path of the webdriver binary.`,
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
    const nativeDriver = resolveNativeDriver();
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
