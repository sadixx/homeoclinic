// Process-level TEST CLOCK for E2E specs (TEST-ONLY), via libfaketime.
//
// Why not the webview clock (pages/next-followup.page.ts shiftClockDays)? R5
// billing takes the FY from the webview's local date, and the backend rejects a
// local date more than one day away from its own clock (crates/hc-app/src/
// billing/mod.rs check_local_today). Reaching 31 March / 1 April therefore
// needs BOTH the Rust process and the WebKit web process on the same fake
// clock. libfaketime does that from outside the product: a wrapper script sets
// LD_PRELOAD + FAKETIME and execs the build under test; the WebKit child
// processes inherit the env. No product code changes, no seam.
//
//   FAKETIME="@YYYY-MM-DD hh:mm:ss"  start the clock there and let it run.
//   FAKETIME_DONT_FAKE_MONOTONIC=1   timers / idle lock keep real monotonic time.
//   TZ=Asia/Kolkata                  the clinic's local day (IST).
//
// The wrapper reads the clock from <dir>/clock.txt at each launch, so a spec
// moves the clock forward by rewriting the file and relaunching. Only forward
// moves are used (LIC-005 clock guard). The wrapper execs $HC_APP_BINARY, so
// driver.ts's reaper (pkill -f <HC_APP_BINARY>) still finds the app.
//
// Linux only: Windows has no libfaketime; callers skip with an infra note.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const CANDIDATES = [
  '/usr/lib/x86_64-linux-gnu/faketime/libfaketimeMT.so.1',
  '/usr/lib/faketime/libfaketimeMT.so.1',
  '/usr/lib64/faketime/libfaketimeMT.so.1',
];

/** The libfaketime (multi-threaded) library path, or null when absent. */
export function faketimeLibrary(): string | null {
  if (process.platform !== 'linux') return null;
  const env = process.env.HC_E2E_FAKETIME_LIB;
  if (env !== undefined && existsSync(env)) return env;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

export interface ClockWrapper {
  /** Absolute path of the executable wrapper (pass as the app binary). */
  readonly wrapper: string;
  /** Set the clock the NEXT launch starts at: local IST "YYYY-MM-DD hh:mm:ss". */
  setClock(localIst: string): void;
}

/** Create the wrapper under `dir` for the build under test. */
export function makeClockWrapper(dir: string, lib: string): ClockWrapper {
  const app = process.env.HC_APP_BINARY;
  if (app === undefined) throw new Error('HC_APP_BINARY is not set (wdio.conf.ts sets it at load)');
  mkdirSync(dir, { recursive: true });
  const clockFile = path.join(dir, 'clock.txt');
  const wrapper = path.join(dir, 'homeoclinic-faketime.sh');
  const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
  writeFileSync(
    wrapper,
    [
      '#!/bin/sh',
      '# E2E test clock wrapper (tests/e2e/helpers/faketime.ts). TEST-ONLY.',
      `FAKETIME="@$(cat ${q(clockFile)})"`,
      'export FAKETIME',
      `export LD_PRELOAD=${q(lib)}`,
      'export FAKETIME_DONT_FAKE_MONOTONIC=1',
      'export TZ=Asia/Kolkata',
      `exec ${q(app)} "$@"`,
      '',
    ].join('\n'),
  );
  chmodSync(wrapper, 0o755);
  return {
    wrapper,
    setClock(localIst: string): void {
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(localIst)) {
        throw new Error(`setClock wants "YYYY-MM-DD hh:mm:ss", got ${localIst}`);
      }
      writeFileSync(clockFile, `${localIst}\n`);
    },
  };
}
