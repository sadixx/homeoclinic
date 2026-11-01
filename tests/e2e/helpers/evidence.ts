// Durable evidence markers for E2E runs (TEST-ONLY).
//
// WebdriverIO does not keep worker console output in the run logs, so specs
// that must PROVE a behaviour ran (hc-e2e-testing analyzer gate: "evidence
// that the changed path ran") append one timestamped line per marker to
// `<HC_E2E_OUTDIR>/evidence.log` (falls back to the cwd) and echo it to the
// console. Never pass patient data other than the spec's synthetic fixtures.
import { appendFileSync } from 'node:fs';
import path from 'node:path';

export function evidence(line: string): void {
  const out = path.join(process.env.HC_E2E_OUTDIR ?? '.', 'evidence.log');
  const msg = `${new Date().toISOString()} ${line}`;
  appendFileSync(out, `${msg}\n`);
  // eslint-disable-next-line no-console
  console.log(msg);
}
