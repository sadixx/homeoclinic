// Bill-chip text for a visit (R5 design §9): "Not billed", or the receipt
// number with the amount still due, or "Paid". Shared by the S07 timeline, the
// S03 registered-today rows and the S08 billing strip so the wording is one.
import type { VisitBill } from '@/bindings';
import { formatPaise } from '@/shared/money';
import { t } from '@/shared/strings';

/**
 * The chip label of a visit's live bill (`null` = not billed). `withAmount`
 * adds the amount still due; the Today list leaves it out because its rows
 * already show the patient's running dues.
 */
export function billChipText(
  bill: VisitBill | null | undefined,
  withAmount = true,
): string {
  if (bill === null || bill === undefined) return t('billing.chip.notBilled');
  if (bill.balancePaise > 0) {
    const due = `${bill.number} · ${t('billing.chip.due')}`;
    return withAmount
      ? `${due} ${t('common.duesPrefix')}${formatPaise(bill.balancePaise)}`
      : due;
  }
  return `${bill.number} · ${t('billing.chip.paid')}`;
}

/** Rs-prefixed Indian-grouped amount, e.g. `Rs 1,23,456.75`. */
export function rupees(paise: number): string {
  return `${t('common.duesPrefix')}${formatPaise(paise)}`;
}

/** Join display parts with the middle-dot separator used across billing. */
export function joinParts(parts: ReadonlyArray<string | null>): string {
  return parts.filter((p): p is string => p !== null && p !== '').join(' · ');
}
