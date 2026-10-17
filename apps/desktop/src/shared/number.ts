// Plain-number display helpers (R-UI-006, 00-conventions §4): integer counts
// (patients, visits, attachments) show in Indian grouping. No component groups
// numbers inline with `toLocaleString`; it goes through here so the Indian
// display format stays consistent and localisable, exactly as money goes
// through `shared/money.ts`.

/**
 * Format a non-negative integer count in Indian digit grouping,
 * e.g. `125000` -> `1,25,000`. A non-finite or negative input is clamped to
 * `0` so the UI never shows `NaN`/`-` for a count.
 */
export function formatCount(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  return safe.toLocaleString('en-IN');
}
