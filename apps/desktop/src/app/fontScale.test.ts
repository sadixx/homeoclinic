// MS (SET-005) font size x zoom. CUT: the REAL `rootFontPx()`; no fakes.
// 00-conventions §1: Normal 14 / Large 16 / Extra large 18 px; the zoom scale
// multiplies on top (design §6).

import { describe, it, expect } from 'vitest';

import { rootFontPx } from './fontScale';

describe('rootFontPx (SET-005 x zoom)', () => {
  it('multiplies the chosen size base (14/16/18 px) by the zoom scale', () => {
    const table = [
      ['normal', 1, 14],
      ['large', 1, 16],
      ['xlarge', 1, 18],
      ['large', 1.1, 17.6],
      ['normal', 0.7, 9.8],
      ['xlarge', 2, 36],
    ] as const;
    for (const [size, scale, px] of table) {
      expect(rootFontPx(size, scale), `${size} x ${scale}`).toBeCloseTo(px, 5);
    }
  });
});
