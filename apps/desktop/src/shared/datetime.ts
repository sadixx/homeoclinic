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
 * time (VIS-004 quick buttons 1m / 2m). `Date.setMonth` handles year rollover;
 * a day that does not exist in the target month (e.g. 31 Jan + 1m) overflows
 * into the following month per the platform `Date` semantics, which is
 * acceptable for an advisory follow-up date.
 */
export function isoDatePlusMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return toIsoDate(d);
}
