// Unit tests for shared/datetime (HC-MVP1-M3vis review test-1).
//
// - isoDatePlusMonths: "1 month" is the same day of the month N months on,
//   CLAMPED to the target month's last day (never spills into the month
//   after), with year rollover. All maths is on the LOCAL calendar.
// - formatDate: a bare `YYYY-MM-DD` (e.g. next_followup_on) is a calendar
//   day and is shown literally; `new Date('YYYY-MM-DD')` would parse it as
//   UTC midnight and show the PREVIOUS day west of UTC.
//
// Clock: only `Date` is faked. Synthetic dates only.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatDate,
  isIsoDateBeforeToday,
  isValidIsoDate,
  isoDatePlusDays,
  isoDatePlusMonths,
} from './datetime';

/** Fix the local wall clock at `y-m-d 10:00` (`m` is 1-based). */
function setToday(y: number, m: number, d: number): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(y, m - 1, d, 10, 0, 0));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('isoDatePlusMonths: month-end clamping and year rollover', () => {
  it.each<[string, [number, number, number], number, string]>([
    ['31 Jan + 1m = 28 Feb (common year)', [2026, 1, 31], 1, '2026-02-28'],
    ['31 Jan + 1m = 29 Feb (leap year)', [2028, 1, 31], 1, '2028-02-29'],
    ['29 Feb + 12m = 28 Feb (leap to common)', [2028, 2, 29], 12, '2029-02-28'],
    ['31 Mar + 1m = 30 Apr', [2026, 3, 31], 1, '2026-04-30'],
    ['31 Dec + 2m = 28 Feb next year', [2026, 12, 31], 2, '2027-02-28'],
    ['30 Dec + 2m = 28 Feb next year', [2026, 12, 30], 2, '2027-02-28'],
    ['15 Dec + 1m = 15 Jan next year', [2026, 12, 15], 1, '2027-01-15'],
    ['30 Nov + 2m = 30 Jan next year', [2026, 11, 30], 2, '2027-01-30'],
    ['4 Nov + 1m = 4 Dec (no clamp)', [2026, 11, 4], 1, '2026-12-04'],
    ['31 Aug + 1m = 30 Sep', [2026, 8, 31], 1, '2026-09-30'],
  ])('%s', (_name, [y, m, d], months, expected) => {
    setToday(y, m, d);
    expect(isoDatePlusMonths(months)).toBe(expected);
  });
});

describe('isoDatePlusDays: local calendar maths', () => {
  it('7 days across a month end and 15 days across a year end', () => {
    setToday(2026, 1, 28);
    expect(isoDatePlusDays(7)).toBe('2026-02-04');
    setToday(2026, 12, 25);
    expect(isoDatePlusDays(15)).toBe('2027-01-09');
  });
});

describe('formatDate: a bare YYYY-MM-DD is read literally', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it.each(['America/New_York', 'America/Los_Angeles', 'Asia/Kolkata', 'UTC'])(
    "formatDate('2026-11-04') is 04-11-2026 in %s",
    (tz) => {
      process.env.TZ = tz;
      expect(formatDate('2026-11-04')).toBe('04-11-2026');
      expect(formatDate('2026-01-01')).toBe('01-01-2026');
    },
  );

  it('the TZ override is live (UTC-midnight parsing WOULD shift the day west of UTC)', () => {
    process.env.TZ = 'America/New_York';
    // Guard that the test above really ran west of UTC: the naive parse of a
    // bare date lands on the previous local day there.
    expect(new Date('2026-11-04').getDate()).toBe(3);
  });

  it('a full RFC3339 timestamp is still shown in local time', () => {
    process.env.TZ = 'Asia/Kolkata';
    // 20:00Z on 3 Nov is 01:30 IST on 4 Nov.
    expect(formatDate('2026-11-03T20:00:00Z')).toBe('04-11-2026');
  });

  it('empty, malformed or impossible input gives null', () => {
    expect(formatDate(null)).toBeNull();
    expect(formatDate(undefined)).toBeNull();
    expect(formatDate('  ')).toBeNull();
    expect(formatDate('not a date')).toBeNull();
  });
});

describe('isValidIsoDate / isIsoDateBeforeToday', () => {
  it('accepts only real, zero-padded calendar dates', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-04-31')).toBe(false);
    expect(isValidIsoDate('2026-1-5')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
  });

  it('compares against the LOCAL today; today itself is not past', () => {
    setToday(2026, 11, 4);
    expect(isIsoDateBeforeToday('2026-11-03')).toBe(true);
    expect(isIsoDateBeforeToday('2026-11-04')).toBe(false);
    expect(isIsoDateBeforeToday('2026-11-05')).toBe(false);
  });
});
