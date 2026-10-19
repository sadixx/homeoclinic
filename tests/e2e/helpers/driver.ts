// Driver lifecycle manager for the HomeoClinic E2E harness.
//
// WHY THIS EXISTS (CI vs orchestrator parity):
// The committed suite runs the WHOLE suite in ONE `wdio run`. The app resolves
// its data dir from Tauri's `app.path().app_data_dir()`, which on Linux is
// `$XDG_DATA_HOME/<identifier>` (dirs::data_dir()). That env is read by the app
// process, which is spawned by WebKitWebDriver, which is spawned by
// tauri-driver. So the app inherits XDG_DATA_HOME from whatever env
// tauri-driver (and its child WebKitWebDriver) was started with — the env is
// FIXED at driver-spawn time, not per WebDriver session.
//
// The hc-e2e-orchestrator achieved per-spec / per-phase isolation by running
// ONE wdio invocation PER LAUNCH, each with its own XDG_DATA_HOME (see the
// orchestrator's run-regression.sh). To reproduce that inside a single
// `wdio run`, we must (re)start the WHOLE driver chain with the chosen
// XDG_DATA_HOME each time we want the app to launch against a different (or a
// deliberately reused) data dir:
//   - once per spec file (beforeSession), and
//   - again for every in-spec relaunch (phase) a multi-launch spec needs.
//
// This module owns spawning/killing tauri-driver (which spawns WebKitWebDriver)
// with a controlled environment, so hooks and specs can relaunch the app at an
// exact data dir — exactly what the orchestrator did with separate processes.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/** tauri-driver proxy port (what WebdriverIO connects to). */
export const TAURI_DRIVER_PORT = 4444;
/** Underlying native WebDriver (WebKitWebDriver) port. */
const NATIVE_DRIVER_PORT = 4445;

let tauriDriver: ChildProcess | undefined;

/**
 * Resolve an ABSOLUTE path to the native WebDriver (WebKitWebDriver on Linux).
 * tauri-driver rejects a bare name, so honour HC_NATIVE_DRIVER if set, else
 * locate it on PATH (`command -v`) or in common install locations.
 */
export function resolveNativeDriver(): string {
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

/** Small delay without pulling in a dependency. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until tauri-driver's proxy port accepts a TCP connection (or time out). */
async function waitForPort(port: number, timeoutMs = 20000): Promise<void> {
  const net = await import('node:net');
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const up = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (up) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `infra_incomplete: tauri-driver did not open port ${port} within ` +
          `${timeoutMs}ms`,
      );
    }
    await sleep(150);
  }
}

/**
 * Start the tauri-driver chain with the given environment overrides (notably
 * XDG_DATA_HOME / HOME). The app the native driver launches on each session
 * will inherit these, so this is the single lever that sets the app's data dir.
 * Idempotent-safe: stops any running driver first.
 */
export async function startDriver(
  envOverrides: NodeJS.ProcessEnv,
): Promise<void> {
  await stopDriver();

  const nativeDriver = resolveNativeDriver();
  tauriDriver = spawn(
    'tauri-driver',
    [
      '--port',
      String(TAURI_DRIVER_PORT),
      '--native-port',
      String(NATIVE_DRIVER_PORT),
      '--native-driver',
      nativeDriver,
    ],
    {
      stdio: [null, process.stdout, process.stderr],
      // Inherit the current env, then apply overrides. The app the native
      // driver spawns reads XDG_DATA_HOME from here.
      env: { ...process.env, ...envOverrides },
    },
  );

  let exited = false;
  tauriDriver.on('exit', () => {
    exited = true;
  });
  tauriDriver.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(`tauri-driver failed to start: ${err.message}`);
  });

  await waitForPort(TAURI_DRIVER_PORT);
  if (exited) {
    throw new Error('infra_incomplete: tauri-driver exited immediately');
  }
}

/** Stop the running tauri-driver chain (and its WebKitWebDriver child). */
export async function stopDriver(): Promise<void> {
  if (!tauriDriver) {
    return;
  }
  const proc = tauriDriver;
  tauriDriver = undefined;
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = (): void => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    proc.once('exit', done);
    proc.kill('SIGTERM');
    // Hard stop if it does not die promptly.
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
      done();
    }, 3000);
  });
  // Give the OS a moment to release the proxy port before a respawn.
  await sleep(300);
}
