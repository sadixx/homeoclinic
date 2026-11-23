// In-memory hold of an unsaved S15 bill across a lock (r5-review-17, ADR 0021
// amendment). The invoice has no autosave and no draft row (ADR 0021 #1), and
// a lock (Ctrl+L, the lock button, idle auto-lock) must never be held open by
// a Save / Discard dialog (SET-004). So when the invoice unmounts with unsaved
// work that the doctor did NOT resolve (every other exit goes through the
// leave guard and ends in Save or Discard), it parks the draft here. After the
// PIN unlock the lock route returns to that bill, and the screen restores the
// draft once it has reloaded the same bill version.
//
// Memory only: never written to disk, localStorage or a log (patient data
// never leaves the encrypted DB, rule 2). One draft at a time (only one S15
// is ever mounted). Closing the app drops it, like any unsaved form.

import type { DiscountDto, LineKind, PaymentMode } from '@/bindings';

/** The editable state of one S15 bill, as typed. */
export interface InvoiceDraft {
  /** The invoice route to return to after unlock. */
  readonly route: string;
  readonly visitId: string;
  /** The bill the draft was typed against (null = not yet issued). */
  readonly baseInvoiceId: string | null;
  readonly baseRowVersion: number | null;
  readonly lines: readonly InvoiceDraftLine[];
  readonly discountKind: DiscountDto['kind'];
  readonly discountValue: string;
  readonly paid: string;
  readonly mode: PaymentMode;
  readonly reference: string;
  readonly paidOn: string;
  readonly dirty: boolean;
  readonly paymentTouched: boolean;
}

/** One editable line, raw text as typed. */
export interface InvoiceDraftLine {
  readonly key: number;
  readonly id: string | null;
  readonly kind: LineKind;
  readonly description: string;
  readonly qty: string;
  readonly rate: string;
}

let held: InvoiceDraft | null = null;

/** Park an unsaved draft (replaces any earlier one). */
export function holdInvoiceDraft(draft: InvoiceDraft): void {
  held = draft;
}

/** Take (and forget) the parked draft of `visitId`, if any. */
export function takeInvoiceDraft(visitId: string): InvoiceDraft | null {
  if (held === null || held.visitId !== visitId) return null;
  const draft = held;
  held = null;
  return draft;
}

/** The route of the parked draft, for the post-unlock return. */
export function heldInvoiceDraftRoute(): string | null {
  return held?.route ?? null;
}

/** Forget any parked draft (test isolation). */
export function clearInvoiceDraft(): void {
  held = null;
}
