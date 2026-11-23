// Local calendar-date helpers for E2E specs, mirroring the app's
// shared/datetime.todayIsoDate / isoDatePlusDays (local time, YYYY-MM-DD). The
// Today due/overdue buckets compare date(patient.next_followup_on) against the
// date the UI passes (todayIsoDate), so the spec computes its follow-up dates
// the SAME way the app computes "today" — no clock seam, fully deterministic.

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local today as YYYY-MM-DD (matches shared/datetime.todayIsoDate). */
export function todayIso(): string {
  return toIsoDate(new Date());
}

/** Local today + days as YYYY-MM-DD (negative days -> a past date). */
export function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/**
 * Local today + months (same day, clamped to the target month's end), as
 * YYYY-MM-DD — mirrors shared/datetime.isoDatePlusMonths ("1 month").
 */
export function isoPlusMonths(months: number): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(now.getDate(), lastDay));
  return toIsoDate(target);
}

/** Day `day` of the month `months` after the current local month, as YYYY-MM-DD. */
export function isoDayOfMonthAhead(months: number, day: number): string {
  const now = new Date();
  return toIsoDate(new Date(now.getFullYear(), now.getMonth() + months, day));
}
