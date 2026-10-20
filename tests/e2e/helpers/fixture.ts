// Fixture seeding helper for the R2 patient demo (HC-MVP1-216; hc-e2e-testing
// OPTION A). Generates the deterministic >=200-patient multi-disease fixture as
// plaintext JSONL via the `hc-seed` CLI (no key, synthetic data only —
// R-PRIV-001), then imports it into the ALREADY-PROVISIONED app DB through the
// real create path via the feature-gated `patient_import_fixture` command
// (searchPage.importFixture). The import loops every record through the app's
// own patient_create, so the patient_sequence, the normalised columns and the
// migration-0004 FTS/trigram triggers stay in sync and every imported patient
// is immediately findable by the running app — no key sharing with the seeder.
//
// Requires the app built with `--features e2e-test-keys`; otherwise the command
// is absent and the import throws loudly (the correct failure for a mis-built
// binary).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { searchPage } from '../pages/search.page.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

/** The hc-seed CLI binary (built into the workspace debug target dir). */
function seedBinary(): string {
  const bin =
    process.env.HC_SEED_BIN ?? path.join(repoRoot, 'target/debug/hc-seed');
  if (!existsSync(bin)) {
    throw new Error(
      `infra_incomplete: hc-seed binary not found at ${bin}. ` +
        `Build it with: cargo build -p hc-seed --bin hc-seed, ` +
        `or set HC_SEED_BIN.`,
    );
  }
  return bin;
}

/**
 * Generate the fixture JSONL at `outPath` (deterministic for a given count +
 * seed) via the hc-seed CLI. Returns nothing; the file is written to disk.
 * Runs out-of-process so no DB/key is ever touched by the test harness.
 */
export function generateFixtureJsonl(
  outPath: string,
  count = 240,
  seed = 42,
): void {
  execFileSync(
    seedBinary(),
    [
      '--fixture',
      '--count',
      String(count),
      '--seed',
      String(seed),
      '--jsonl',
      outPath,
    ],
    { stdio: 'pipe' },
  );
  if (!existsSync(outPath)) {
    throw new Error(`hc-seed did not write the fixture JSONL at ${outPath}`);
  }
}

/**
 * Seed the provisioned app with the >=200 multi-disease fixture: generate the
 * JSONL then import it through the real create path. The app must be unlocked
 * (the import runs the real patient_create, which needs the open pool). Returns
 * the number of patients imported (>= count).
 */
export async function seedFixtureIntoApp(
  jsonlPath: string,
  count = 240,
  seed = 42,
): Promise<number> {
  generateFixtureJsonl(jsonlPath, count, seed);
  return searchPage.importFixture(jsonlPath);
}
