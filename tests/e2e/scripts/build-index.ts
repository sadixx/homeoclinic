// Generates tests/e2e/index.json from the @req/@tier/@area/@targets header
// comments in each spec (hc-e2e-testing "Spec tagging"). Selection reads only
// this index and spec sources; it never guesses ids.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(here, '..');

interface SpecEntry {
  path: string;
  reqs: string[];
  tier: string;
  area: string;
  targets: string[];
}

function parseHeader(src: string): Omit<SpecEntry, 'path'> {
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
      reqs.push(
        ...body
          .replace('@req', '')
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (body.startsWith('@tier')) {
      tier = body.replace('@tier', '').trim();
    } else if (body.startsWith('@area')) {
      area = body.replace('@area', '').trim();
    } else if (body.startsWith('@targets')) {
      targets = body
        .replace('@targets', '')
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return { reqs, tier, area, targets };
}

function findSpecs(): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.e2e.ts')) results.push(path.relative(e2eRoot, full));
    }
  };
  walk(path.join(e2eRoot, 'specs'));
  return results;
}

const specs: SpecEntry[] = findSpecs()
  .sort()
  .map((rel) => {
    const src = readFileSync(path.join(e2eRoot, rel), 'utf8');
    return { path: `tests/e2e/${rel.replace(/\\/g, '/')}`, ...parseHeader(src) };
  });

const index = { generatedAt: new Date().toISOString(), specs };
writeFileSync(path.join(e2eRoot, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
// eslint-disable-next-line no-console
console.log(`wrote index.json with ${specs.length} spec(s)`);
