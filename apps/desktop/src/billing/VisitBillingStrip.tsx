// S08 case-form billing strip (R5 design §9; BILL-001/002, HC-MVP1-149).
// Replaces the R3 "dues placeholder": the patient's REAL running dues, this
// visit's bill state with "Bill this visit" / "Open bill", and Clear dues
// (enabled when dues > 0; the same ClearDuesDialog as the dashboard). Reads
// `billing_visit_status` only; the UI does no money maths.

import { useCallback, useEffect, useState } from 'react';

import { commands, type VisitBillingStatus } from '@/bindings';
import { run } from '@/shared/command';
import { t } from '@/shared/strings';

import { billChipText, rupees } from './billChip';
import { ClearDuesDialog } from './ClearDuesDialog';

export interface VisitBillingStripProps {
  /** The patient of the visit. */
  readonly patientId: string;
  /** The (saved) visit. */
  readonly visitId: string;
  /** Open this visit's S15 invoice. */
  readonly onOpenInvoice?:
    | ((patientId: string, visitId: string) => void)
    | undefined;
  /** Open a receipt from the Clear dues result (as on the dashboard). */
  readonly onPrintReceipt?:
    | ((patientId: string, invoiceId: string) => void)
    | undefined;
}

const BTN =
  'rounded border border-slate-300 bg-white px-3 py-1 text-base hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400';

/** The billing strip under a saved case. */
export function VisitBillingStrip({
  patientId,
  visitId,
  onOpenInvoice,
  onPrintReceipt,
}: VisitBillingStripProps): JSX.Element {
  const [status, setStatus] = useState<VisitBillingStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [clearing, setClearing] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    setFailed(false);
    try {
      setStatus(await run(commands.billingVisitStatus({ visitId })));
    } catch {
      // Observable, retryable failure (R-UI-008): never "Loading…" forever.
      setStatus(null);
      setFailed(true);
    }
  }, [visitId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dues = status?.patientDuesPaise ?? 0;
  const bill = status?.bill ?? null;

  return (
    <section
      data-testid="case-form-billing"
      aria-label={t('case.form.dues.title')}
      className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2 text-base text-slate-700"
    >
      <span className="flex flex-wrap items-center gap-3">
        <strong>{t('billing.patientDues')}</strong>
        <span data-testid="case-form-dues" className="tabular-nums">
          {status !== null
            ? rupees(dues)
            : failed
              ? t('common.none')
              : t('common.loading')}
        </span>
        {failed ? (
          <span
            data-testid="case-form-billing-error"
            role="alert"
            className="flex items-center gap-2 text-red-700"
          >
            {t('billing.strip.loadFailed')}
            <button
              type="button"
              data-testid="case-form-billing-retry"
              onClick={() => void reload()}
              className={BTN}
            >
              {t('common.retry')}
            </button>
          </span>
        ) : null}
        {status !== null ? (
          <span data-testid="case-form-billchip">{billChipText(bill)}</span>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {status !== null && bill === null ? (
          <button
            type="button"
            data-testid="case-form-bill-visit"
            onClick={() => onOpenInvoice?.(patientId, visitId)}
            className={BTN}
          >
            {t('billing.billThisVisit')}
          </button>
        ) : null}
        {bill !== null ? (
          <button
            type="button"
            data-testid="case-form-open-bill"
            onClick={() => onOpenInvoice?.(patientId, visitId)}
            className={BTN}
          >
            {t('billing.openBill')}
          </button>
        ) : null}
        <button
          type="button"
          data-testid="case-form-dues-clear"
          disabled={dues <= 0}
          title={dues <= 0 ? t('billing.clearDues.noneHint') : undefined}
          onClick={() => setClearing(true)}
          className={BTN}
        >
          {t('case.form.dues.clear')}
        </button>
      </span>
      <ClearDuesDialog
        patientId={patientId}
        open={clearing}
        onClose={() => setClearing(false)}
        onCleared={() => void reload()}
        {...(onPrintReceipt !== undefined
          ? {
              onPrintReceipt: (invoiceId: string) =>
                onPrintReceipt(patientId, invoiceId),
            }
          : {})}
      />
    </section>
  );
}
