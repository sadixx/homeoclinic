// RED unit tests for M3-RWv6 item 1: registration-council labels without
// dashes. CUT: the real registrationCouncils.ts (pure data + helpers).
//
// Contract:
//  - Every display label is `<State>: <Authority>`. No label contains an em
//    dash (U+2014) or an en dash (U+2013).
//  - A doctor profile saved before RWv6 holds the OLD label
//    `<State> \u2014 <Authority>`. Re-opening it must still select the SAME
//    listed option (now shown with the new label), never fall back to "Other".
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect } from 'vitest';

import {
  REGISTRATION_COUNCILS,
  REGISTRATION_COUNCIL_LABELS,
  councilLabel,
  councilSelectionFor,
} from './registrationCouncils';

const EM_DASH = '\u2014';
const EN_DASH = '\u2013';

/** The pre-RWv6 stored label for a council (what old profiles hold). */
function legacyLabel(state: string, authority: string): string {
  return `${state} ${EM_DASH} ${authority}`;
}

describe('registration council labels (RWv6 item 1)', () => {
  it('no council label contains an em dash or an en dash', () => {
    const offenders = REGISTRATION_COUNCIL_LABELS.filter(
      (l) => l.includes(EM_DASH) || l.includes(EN_DASH),
    );
    expect(offenders, 'labels still carrying a dash').toEqual([]);
  });

  it('every label reads "<State>: <Authority>"', () => {
    for (const c of REGISTRATION_COUNCILS) {
      expect(councilLabel(c)).toBe(`${c.state}: ${c.authority}`);
    }
    expect(REGISTRATION_COUNCIL_LABELS).toContain(
      'Maharashtra: Maharashtra Council of Homoeopathy',
    );
  });

  it('a stored legacy em-dash label re-opens as the SAME listed option (new label)', () => {
    const sel = councilSelectionFor(
      legacyLabel('Maharashtra', 'Maharashtra Council of Homoeopathy'),
    );
    expect(sel).toEqual({
      choice: 'listed',
      text: 'Maharashtra: Maharashtra Council of Homoeopathy',
    });
  });

  it('every legacy em-dash label maps to its own option, never to Other', () => {
    for (const c of REGISTRATION_COUNCILS) {
      const sel = councilSelectionFor(legacyLabel(c.state, c.authority));
      expect(sel.choice, `legacy label for ${c.state}`).toBe('listed');
      expect(sel.text).toBe(`${c.state}: ${c.authority}`);
    }
  });

  it('a new-format label still selects its listed option, and free text stays Other', () => {
    expect(councilSelectionFor('Kerala: Kerala State Medical Council')).toEqual(
      { choice: 'listed', text: 'Kerala: Kerala State Medical Council' },
    );
    expect(councilSelectionFor('Sikkim Medical Board')).toEqual({
      choice: 'other',
      text: 'Sikkim Medical Board',
    });
  });
});
