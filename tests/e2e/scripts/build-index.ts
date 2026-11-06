// Generates tests/e2e/index.json from the @req/@tier/@area/@targets header
// comments in each spec (hc-e2e-testing "Spec tagging"). Selection reads only
// this index and spec sources; it never guesses ids. The header parser is
// shared with wdio.conf.ts's HC_E2E_TARGET filter (scripts/spec-header.ts).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { findSpecs, parseHeader, type SpecHeader } from './spec-header.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(here, '..');

interface SpecEntry extends SpecHeader {
  path: string;
}

const specs: SpecEntry[] = findSpecs(e2eRoot).map((rel) => {
  const src = readFileSync(path.join(e2eRoot, rel), 'utf8');
  return { path: `tests/e2e/${rel}`, ...parseHeader(src) };
});

const index = { generatedAt: new Date().toISOString(), specs };
writeFileSync(path.join(e2eRoot, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
// eslint-disable-next-line no-console
console.log(`wrote index.json with ${specs.length} spec(s)`);
