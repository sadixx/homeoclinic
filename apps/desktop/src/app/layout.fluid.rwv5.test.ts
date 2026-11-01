// RED test for the M3-RWv5 fix "layout reflows when the window is tiled or
// resized at any zoom".
//
// Zoom scales the document-root font-size (AppShell C8). So every layout
// width written in rem scales and reflows with it, but a FIXED PIXEL width
// (`w-[180px]`, `max-w-[900px]`, `w-[420px]`, ...) does not. At high zoom such
// a box overflows a tiled/half-width window and squeezes or caps the main
// content instead of reflowing. jsdom has no layout engine, so the testable
// contract is structural: no screen in the app may size a box with a fixed px
// width utility. Fluid (`w-full`, `flex-1`, `min-w-0`) and rem/% based widths
// are fine.
//
// CUT: the real source of every non-test .tsx under src/ (read raw through
// Vite's import.meta.glob). Nothing is faked.
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** src/ root (this file lives in src/app). */
const SRC_ROOT = resolve(__dirname, '..');

/** Every non-test .tsx under src/, as [relative path, source]. */
function screenSources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx')) {
        out.push([relative(SRC_ROOT, p), readFileSync(p, 'utf8')]);
      }
    }
  };
  walk(SRC_ROOT);
  return out;
}

const SOURCES = screenSources();

/** Tailwind width utilities with a fixed pixel arbitrary value. */
const FIXED_PX_WIDTH = /(?<![\w-])(?:min-|max-)?w-\[\d+(?:\.\d+)?px\]/g;

describe('RWv5 C — layout is fluid under resize at any zoom', () => {
  it('scans the real screen sources', () => {
    expect(SOURCES.length).toBeGreaterThan(10);
  });

  it('no component sizes a box with a fixed px width (w-/min-w-/max-w-[<n>px])', () => {
    const offenders: string[] = [];
    for (const [path, src] of SOURCES) {
      for (const m of src.matchAll(FIXED_PX_WIDTH)) {
        offenders.push(`src/${path}: ${m[0]}`);
      }
    }
    expect(
      offenders,
      'fixed px widths do not scale with zoom and do not reflow when tiled; use rem / fluid widths',
    ).toEqual([]);
  });
});
