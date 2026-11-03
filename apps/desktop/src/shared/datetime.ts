// Date/time display helpers (R-UI-006, 00-conventions §4): dates show as
// DD-MM-YYYY. No component formats dates inline; it goes through here so the
// Indian display format stays consistent and localisable.
//
// Input is always an RFC3339 string produced by a typed command (the UI never
// builds timestamps). A malformed or empty value returns `null` so the caller
// can fall back to a plain "—" placeholder rather than show "Invalid Date".

/** Two-digit zero-pad for day/month/hour/minute parts. */
function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * Format an RFC3339 timestamp as `DD-MM-YYYY HH:mm` in the local time zone,
 * or `null` when the input is missing or not a valid date.
 */
export function formatDateTime(
  rfc3339: string | null | undefined,
): string | null {
  if (rfc3339 === null || rfc3339 === undefined || rfc3339.trim() === '') {
    return null;
  }
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const d = pad2(date.getDate());
  const m = pad2(date.getMonth() + 1);
  const y = date.getFullYear();
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  return `${d}-${m}-${y} ${hh}:${mm}`;
}

/**
 * Format an RFC3339 date (or date-time) as `DD-MM-YYYY` in the local time
 * zone, or `null` when the input is missing or not a valid date.
 */
export function formatDate(rfc3339: string | null | undefined): string | null {
  if (rfc3339 === null || rfc3339 === undefined || rfc3339.trim() === '') {
    return null;
  }
  // A bare calendar date (`YYYY-MM-DD`, e.g. `next_followup_on`) is a day,
  // not an instant: `new Date('YYYY-MM-DD')` parses it as UTC midnight, which
  // shows the previous day west of UTC. Read its parts literally instead.
  const parts = parseIsoDate(rfc3339);
  if (parts !== null) {
    return `${pad2(parts.day)}-${pad2(parts.month)}-${parts.year}`;
  }
  const date = new Date(rfc3339);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
}

/** Format a `Date` as an ISO calendar date (`YYYY-MM-DD`) in local time. */
function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * The local `today` as an ISO calendar date (`YYYY-MM-DD`). Used to anchor the
 * Today screen's `today_get_overview` request and the follow-up quick-button
 * date maths (S03/S09, VIS-004/005). Local time so a clinic's "today" matches
 * the doctor's wall clock, not UTC.
 */
export function todayIsoDate(): string {
  return toIsoDate(new Date());
}

/**
 * `today + days` as an ISO calendar date (`YYYY-MM-DD`), computed in local
 * time from the current clock (VIS-004 quick buttons 7d / 15d). Pure date
 * arithmetic — no time component — so a follow-up lands on a calendar day.
 */
export function isoDatePlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/**
 * `today + months` as an ISO calendar date (`YYYY-MM-DD`), computed in local
 * time (VIS-004 quick buttons 1m / 2m): the same day of the month `months`
 * later, with year rollover. A day that does not exist in the target month is
 * clamped to that month's last day (31 Jan + 1m = 28/29 Feb), so "1 month"
 * never spills into the month after.
 */
export function isoDatePlusMonths(months: number): string {
  const now = new Date();
  const day = now.getDate();
  // Day 1 of the target month (setMonth on day 1 never overflows), then clamp.
  const target = new Date(now.getFullYear(), now.getMonth() + months, 1);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(day, lastDay));
  return toIsoDate(target);
}

/** The numeric parts of a strict `YYYY-MM-DD` calendar date, or `null`. */
function parseIsoDate(
  iso: string,
): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(year, month - 1, day);
  if (
    check.getFullYear() !== year ||
    check.getMonth() !== month - 1 ||
    check.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** True when `iso` is a valid `YYYY-MM-DD` calendar date. */
export function isValidIsoDate(iso: string): boolean {
  return parseIsoDate(iso) !== null;
}

/**
 * True when the `YYYY-MM-DD` date `iso` is before the LOCAL today (VIS-004:
 * a next follow-up may be today or later, never in the past). ISO calendar
 * dates compare correctly as strings once both are zero-padded.
 */
export function isIsoDateBeforeToday(iso: string): boolean {
  return iso < todayIsoDate();
}
