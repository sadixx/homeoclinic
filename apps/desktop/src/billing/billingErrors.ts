// R5 billing error presentation (R-UI-007/008, NFR-033): map a mapped
// `UserFacingError` code to the plain-language en.json string the billing,
// receipt and reports screens show. No raw message, SQL or path is shown.
import type { ErrorCode } from '@/bindings';
import { isUserFacingError } from '@/shared/command';
import { t, type StringKey } from '@/shared/strings';

const KEYS: Partial<Record<ErrorCode, StringKey>> = {
  payment_exceeds_balance: 'billing.error.paymentExceedsBalance',
  total_below_paid: 'billing.error.totalBelowPaid',
  invoice_voided: 'billing.error.invoiceVoided',
  conflict: 'billing.error.conflict',
  validation: 'billing.error.validation',
  not_found: 'billing.error.notFound',
  export_failed: 'billing.error.exportFailed',
};

/** Plain-language message for a failed billing / report command. */
export function billingErrorMessage(err: unknown): string {
  const code = isUserFacingError(err) ? err.code : null;
  const key = code === null ? undefined : KEYS[code];
  return t(key ?? 'billing.error.generic');
}
