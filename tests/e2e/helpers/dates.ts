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
