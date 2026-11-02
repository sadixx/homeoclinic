// RED unit tests for M3-RWv6 item 3: the pure clinic-timings kernel.
//
// Proposed module (contract for hc-ui-dev): apps/desktop/src/setup/
// clinicTimings.ts, exporting
//
//   type ClockTime = { hour: number; minute: number }          // hour 1-12
//   type SessionTimes = { from: ClockTime; to: ClockTime }
//   type ClinicTimings = { morning: SessionTimes | null;
//                          evening: SessionTimes | null }
//
//   meridiemFor(session: 'morning' | 'evening', edge: 'from' | 'to',
//               hour: number, fromHour: number | null): 'AM' | 'PM'
//   formatClinicTimings(v: ClinicTimings): string
//   parseClinicTimings(stored: string): ClinicTimings | null   // null = legacy
//   isToAfterFrom(session: 'morning' | 'evening', s: SessionTimes): boolean
//
// AM/PM rule (task item 3): Morning hours are AM, except 12 and any To hour
// earlier than the From hour, which are PM (9:30 to 1:00 reads 9:30 AM to
// 1:00 PM). Evening hours are PM. Stored format (existing `timings` String):
// 'Morning 9:30 AM-1:00 PM; Evening 5:00 PM-8:30 PM'. Either session may be
// empty. An unparseable legacy value parses to null (the UI keeps it as text).
//
// The module is loaded through a non-literal dynamic import, so a missing
// module or export is an ASSERTION failure, not a transpile/type error.
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect } from 'vitest';

interface ClockTime {
  readonly hour: number;
  readonly minute: number;
}
interface SessionTimes {
  readonly from: ClockTime;
  readonly to: ClockTime;
}
interface ClinicTimings {
  readonly morning: SessionTimes | null;
  readonly evening: SessionTimes | null;
}
type Session = 'morning' | 'evening';
type Edge = 'from' | 'to';

const MODULE = './clinicTimings';

async function kernel(): Promise<Record<string, unknown>> {
  try {
    return (await import(/* @vite-ignore */ MODULE)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function fn<T>(name: string): Promise<T> {
  const mod = await kernel();
  expect(
    typeof mod[name],
    `setup/clinicTimings.ts must export ${name}() (RWv6 item 3)`,
  ).toBe('function');
  return mod[name] as T;
}

const meridiemFor = (): Promise<
  (s: Session, e: Edge, hour: number, fromHour: number | null) => 'AM' | 'PM'
> => fn('meridiemFor');
const formatClinicTimings = (): Promise<(v: ClinicTimings) => string> =>
  fn('formatClinicTimings');
const parseClinicTimings = (): Promise<
  (stored: string) => ClinicTimings | null
> => fn('parseClinicTimings');
const isToAfterFrom = (): Promise<
  (s: Session, times: SessionTimes) => boolean
> => fn('isToAfterFrom');

const at = (hour: number, minute: number): ClockTime => ({ hour, minute });

const FULL: ClinicTimings = {
  morning: { from: at(9, 30), to: at(1, 0) },
  evening: { from: at(5, 0), to: at(8, 30) },
};
const FULL_TEXT = 'Morning 9:30 AM-1:00 PM; Evening 5:00 PM-8:30 PM';

describe('meridiemFor (automatic AM/PM)', () => {
  it('morning From hours are AM, except 12 which is PM', async () => {
    const m = await meridiemFor();
    expect(m('morning', 'from', 9, null)).toBe('AM');
    expect(m('morning', 'from', 7, null)).toBe('AM');
    expect(m('morning', 'from', 12, null)).toBe('PM');
  });

  it('a morning To hour earlier than the From hour is PM (9:30 to 1:00 = 1:00 PM)', async () => {
    const m = await meridiemFor();
    expect(m('morning', 'to', 1, 9)).toBe('PM');
    expect(m('morning', 'to', 2, 10)).toBe('PM');
  });

  it('a morning To hour at or after the From hour is AM, and To 12 is PM', async () => {
    const m = await meridiemFor();
    expect(m('morning', 'to', 11, 9)).toBe('AM');
    expect(m('morning', 'to', 12, 9)).toBe('PM');
  });

  it('every evening hour is PM', async () => {
    const m = await meridiemFor();
    for (const h of [1, 5, 8, 11, 12]) {
      expect(m('evening', 'from', h, null), `evening from ${h}`).toBe('PM');
      expect(m('evening', 'to', h, 5), `evening to ${h}`).toBe('PM');
    }
  });
});

describe('isToAfterFrom', () => {
  it('accepts morning 9:30 to 1:00 and evening 5:00 to 8:30', async () => {
    const ok = await isToAfterFrom();
    expect(ok('morning', { from: at(9, 30), to: at(1, 0) })).toBe(true);
    expect(ok('evening', { from: at(5, 0), to: at(8, 30) })).toBe(true);
  });

  it('rejects a To that is not after From (same time, earlier minute, evening reversed)', async () => {
    const ok = await isToAfterFrom();
    expect(ok('morning', { from: at(9, 30), to: at(9, 30) })).toBe(false);
    expect(ok('morning', { from: at(9, 30), to: at(9, 15) })).toBe(false);
    expect(ok('evening', { from: at(8, 30), to: at(5, 0) })).toBe(false);
  });
});

describe('formatClinicTimings', () => {
  it('formats both sessions exactly as "Morning 9:30 AM-1:00 PM; Evening 5:00 PM-8:30 PM"', async () => {
    const format = await formatClinicTimings();
    expect(format(FULL)).toBe(FULL_TEXT);
  });

  it('pads minutes to two digits and omits an empty session', async () => {
    const format = await formatClinicTimings();
    expect(
      format({ morning: null, evening: { from: at(5, 5), to: at(8, 0) } }),
    ).toBe('Evening 5:05 PM-8:00 PM');
    expect(
      format({ morning: { from: at(10, 0), to: at(12, 0) }, evening: null }),
    ).toBe('Morning 10:00 AM-12:00 PM');
  });

  it('returns an empty string when both sessions are empty', async () => {
    const format = await formatClinicTimings();
    expect(format({ morning: null, evening: null })).toBe('');
  });
});

describe('parseClinicTimings', () => {
  it('parses the stored format back into both sessions (round trip)', async () => {
    const parse = await parseClinicTimings();
    const format = await formatClinicTimings();
    expect(parse(FULL_TEXT)).toEqual(FULL);
    expect(format(parse(FULL_TEXT)!)).toBe(FULL_TEXT);
  });

  it('parses a single-session value and leaves the other session empty', async () => {
    const parse = await parseClinicTimings();
    expect(parse('Evening 5:00 PM-8:30 PM')).toEqual({
      morning: null,
      evening: { from: at(5, 0), to: at(8, 30) },
    });
  });

  it('returns null for an unparseable legacy free-text value', async () => {
    const parse = await parseClinicTimings();
    expect(parse('Mon-Sat 10 to 2, Sunday closed')).toBeNull();
    expect(parse('Morning 13:00 AM-1:00 PM')).toBeNull();
    expect(parse('Morning 9:75 AM-1:00 PM')).toBeNull();
  });
});
