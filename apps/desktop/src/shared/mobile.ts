// Mobile-number display helper (R-UI-006, 00-conventions §4): mobiles are
// stored as digits only and shown grouped, e.g. `9876543210` -> `98765 43210`.
// No component groups a number inline; it goes through here so the Indian
// display format stays consistent, exactly as money/date/number do.
//
// MVP1 is single-doctor, so there is NO masking (PSR-005 open-Q): the full
// number is shown. The value always arrives from a typed command.

/**
 * Format a stored digits-only mobile as a space-grouped number. A 10-digit
 * Indian mobile groups as `5 + 5` (`98765 43210`); other lengths are returned
 * with a single space after the first five digits when longer than five, else
 * as-is. A missing/empty value returns the `—` placeholder.
 */
export function formatMobile(mobile: string | null | undefined): string {
  if (mobile === null || mobile === undefined) {
    return '—';
  }
  const digits = mobile.replace(/\D/g, '');
  if (digits === '') {
    return '—';
  }
  if (digits.length <= 5) {
    return digits;
  }
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}
