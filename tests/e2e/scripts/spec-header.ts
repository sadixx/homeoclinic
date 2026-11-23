// Spec header parsing shared by scripts/build-index.ts (index.json) and
// wdio.conf.ts (the HC_E2E_TARGET spec filter), so the index and the run
// select specs by exactly the same rule (hc-e2e-testing "Spec tagging").
//
// A spec starts with a `//` comment header carrying @req / @tier / @area /
// @targets. Scanning stops at the first non-comment line, so a later comment
// that mentions "@targets" in the body is never read as the header.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export interface SpecHeader {
  reqs: string[];
  tier: string;
  area: string;
  targets: string[];
}

/** The E2E targets (hc-e2e-testing enum `target`). */
export const E2E_TARGETS = ['linux', 'windows'] as const;
export type E2eTarget = (typeof E2E_TARGETS)[number];

function words(s: string): string[] {
  return s
    .split(/[,\s]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** Parse the leading `//` header of a spec source. */
export function parseHeader(src: string): SpecHeader {
  const reqs: string[] = [];
  let tier = '';
  let area = '';
  let targets: string[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('//')) {
      // Stop scanning once the leading comment header ends.
      if (line.length > 0 && !line.startsWith('/*')) break;
      continue;
    }
    const body = line.replace(/^\/\/\s?/, '');
    if (body.startsWith('@req')) {
      reqs.push(...words(body.replace('@req', '')));
    } else if (body.startsWith('@tier')) {
      tier = body.replace('@tier', '').trim();
    } else if (body.startsWith('@area')) {
      area = body.replace('@area', '').trim();
    } else if (body.startsWith('@targets')) {
      targets = words(body.replace('@targets', ''));
    }
  }
  return { reqs, tier, area, targets };
}

/**
 * Every `*.e2e.ts` under `<e2eRoot>/specs`, as paths relative to `e2eRoot`
 * with forward slashes, sorted. `*.e2e.ts.superseded` files are not specs.
 */
export function findSpecs(e2eRoot: string): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.e2e.ts')) results.push(path.relative(e2eRoot, full).replace(/\\/g, '/'));
    }
  };
  walk(path.join(e2eRoot, 'specs'));
  return results.sort();
}

/** Spec paths (relative to `e2eRoot`) whose @targets header lists `target`. */
export function specsForTarget(e2eRoot: string, target: string): string[] {
  return findSpecs(e2eRoot).filter((rel) =>
    parseHeader(readFileSync(path.join(e2eRoot, rel), 'utf8')).targets.includes(target),
  );
}
