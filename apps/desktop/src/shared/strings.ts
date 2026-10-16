// Typed accessor over locales/en.json (R-UI-007: visible text comes from the
// strings file, referenced by key — no hardcoded user-facing strings in
// components). Keys are the literal union of en.json keys, so a typo is a
// compile error.
import en from '@/locales/en.json';

export type StringKey = keyof typeof en;

/**
 * Resolve a user-facing string by key. Typed so only real keys compile.
 */
export function t(key: StringKey): string {
  return en[key];
}
