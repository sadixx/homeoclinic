// Money helpers (R-UI-006, product rule 8): money is integer paise internally
// and shown in Indian grouping. No component does money arithmetic inline; it
// goes through here.
//
// The UI only parses a doctor-typed rupee amount into integer paise before
// handing it to a typed command; all domain money logic stays in the backend
// (R-ARCH-003). Display formatting lives here too for reuse by later screens.

/**
 * Parse a doctor-typed rupee amount into integer paise.
 *
 * Accepts `"1250"`, `"1,250"`, `"1,250.50"`, `"1250.5"`; commas (Indian
 * grouping) are ignored. Returns `null` for anything that is not a
 * well-formed, non-negative amount with at most two decimal places, so the
 * caller can show an inline validation message rather than send a bad value.
 */
export function parseRupeesToPaise(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }
  const normalized = trimmed.replace(/,/g, '');
  // Optional rupee sign already stripped by the caller; accept digits with an
  // optional 1-2 digit decimal part only.
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  const [rupeesPart, paisePart = ''] = normalized.split('.');
  const rupees = Number(rupeesPart);
  const paiseFraction = Number(paisePart.padEnd(2, '0'));
  if (!Number.isSafeInteger(rupees)) {
    return null;
  }
  return rupees * 100 + paiseFraction;
}

/**
 * Format integer paise as Indian-grouped rupees, e.g. `125000` -> `1,250.00`.
 * The rupee sign is supplied by the caller/label so this stays reusable.
 */
export function formatPaise(paise: number): string {
  const rupees = Math.trunc(paise / 100);
  const fraction = Math.abs(paise % 100)
    .toString()
    .padStart(2, '0');
  const grouped = rupees.toLocaleString('en-IN');
  return `${grouped}.${fraction}`;
}
