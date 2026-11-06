// Clear-dues dialog (R5 design §9; BILL-002, HC-MVP1-149). Opened from the
// S07 dashboard and the S08 case-form billing strip.
//
// Lists the patient's open bills oldest first, defaults the amount to the
// total dues (editable down), and records ONE payment through
// `patient_clear_dues`, which allocates it oldest bill first. The dues the
// dialog opened with are sent as `expectedDuesPaise`, so a stale dialog is a
// conflict, never a wrong allocation. After success it shows where the money
// went, with a receipt link per bill. Calls ONLY the generated bindings.

import { useEffect, useState } from 'react';

import {
  commands,
  type ClearDuesResult,
  type PatientDues,
  type PaymentMode,
} from '@/bindings';
import { run } from '@/shared/command';
import { formatDate, todayIsoDate } from '@/shared/datetime';
import { formatPaise, parseRupeesToPaise } from '@/shared/money';
import { t } from '@/shared/strings';

import { joinParts, rupees } from './billChip';
import { billingErrorMessage } from './billingErrors';
import { PAYMENT_MODES } from './InvoiceScreen';

export interface ClearDuesDialogProps {
  /** The patient whose dues are cleared. */
  readonly patientId: string;
  /** Whether the dialog is shown. */
  readonly open: boolean;
  /** Close without paying (or close the result view). */
  readonly onClose: () => void;
  /** After a successful payment (caller refreshes its dues). */
  readonly onCleared?: (result: ClearDuesResult) => void;
  /** Open the receipt of one allocated invoice. */
  readonly onPrintReceipt?: (invoiceId: string) => void;
}

const INPUT =
  'h-9 w-full min-w-0 rounded border border-slate-300 px-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-600';
const BTN =
  'rounded border border-slate-300 px-3 py-1.5 text-base hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600';

/** The Clear-dues dialog. */
export function ClearDuesDialog({
  patientId,
  open,
  onClose,
  onCleared,
  onPrintReceipt,
}: ClearDuesDialogProps): JSX.Element | null {
  const [dues, setDues] = useState<PatientDues | null>(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayIsoDate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClearDuesResult | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setDues(null);
    setResult(null);
    setError(null);
    setMode('cash');
    setReference('');
    setPaidOn(todayIsoDate());
    void (async (): Promise<void> => {
      try {
        const d = await run(commands.patientDuesGet({ patientId }));
        if (cancelled) return;
        setDues(d);
        setAmount(formatPaise(d.duesPaise).replace(/,/g, ''));
      } catch (err) {
        if (!cancelled) setError(billingErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, patientId]);

  if (!open) return null;

  const onSubmit = async (): Promise<void> => {
    if (busy || dues === null) return;
    const paise = parseRupeesToPaise(amount);
    if (paise === null || paise <= 0) {
      setError(t('billing.error.amount'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await run(
        commands.patientClearDues({
          patientId,
          payment: {
            amountPaise: paise,
            mode,
            reference: reference.trim() === '' ? null : reference.trim(),
            paidOn,
          },
          expectedDuesPaise: dues.duesPaise,
        }),
      );
      setResult(r);
      onCleared?.(r);
    } catch (err) {
      setError(billingErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('billing.clearDues.title')}
      data-testid="clear-dues-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-[32rem] flex-col gap-3 overflow-auto rounded border border-slate-300 bg-white p-4 text-base shadow-lg">
        <h2 className="text-base font-semibold">
          {t('billing.clearDues.title')}
        </h2>

        {result !== null ? (
          <div data-testid="clear-dues-result" role="status">
            <p className="mb-2">{t('billing.clearDues.receivedAgainst')}</p>
            <ul className="mb-2 flex flex-col gap-1">
              {result.allocations.map((a) => (
                <li
                  key={a.invoiceId}
                  className="flex items-center justify-between gap-2"
                >
                  <span>{joinParts([a.number, rupees(a.amountPaise)])}</span>
                  {onPrintReceipt !== undefined ? (
                    <button
                      type="button"
                      data-testid={`clear-dues-receipt-${a.invoiceId}`}
                      onClick={() => onPrintReceipt(a.invoiceId)}
                      className={BTN}
                    >
                      {t('billing.clearDues.printReceipt')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <p>
              {t('billing.clearDues.duesNow')} {rupees(result.duesPaise)}
            </p>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                data-testid="clear-dues-done"
                autoFocus
                onClick={onClose}
                className={BTN}
              >
                {t('billing.clearDues.done')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {dues === null && error === null ? (
              <div
                aria-busy="true"
                className="h-16 animate-pulse rounded bg-slate-100"
              />
            ) : null}
            {dues !== null ? (
              <>
                <p>
                  {t('billing.clearDues.total')} {rupees(dues.duesPaise)}
                </p>
                <ul className="flex flex-col gap-1">
                  {dues.openInvoices.map((o, i) => (
                    <li
                      key={o.invoiceId}
                      data-testid={`clear-dues-open-${i + 1}`}
                      className="flex justify-between gap-2 rounded border border-slate-200 px-2 py-1"
                    >
                      <span>
                        {joinParts([
                          o.number,
                          formatDate(o.issuedOn) ?? o.issuedOn,
                        ])}
                      </span>
                      <span className="tabular-nums">
                        {rupees(o.balancePaise)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    {t('billing.payment.amount')}
                    <input
                      data-testid="clear-dues-amount"
                      inputMode="decimal"
                      autoFocus
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void onSubmit();
                        }
                      }}
                      className={INPUT}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    {t('billing.payment.mode')}
                    <select
                      data-testid="clear-dues-mode"
                      value={mode}
                      onChange={(e) => setMode(e.target.value as PaymentMode)}
                      className={INPUT}
                    >
                      {PAYMENT_MODES.map((m) => (
                        <option key={m.mode} value={m.mode}>
                          {t(m.key)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    {t('billing.payment.ref')}
                    <input
                      data-testid="clear-dues-ref"
                      maxLength={64}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      className={INPUT}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    {t('billing.payment.date')}
                    <input
                      data-testid="clear-dues-date"
                      type="date"
                      max={todayIsoDate()}
                      value={paidOn}
                      onChange={(e) => setPaidOn(e.target.value)}
                      className={INPUT}
                    />
                  </label>
                </div>
              </>
            ) : null}
            {error !== null ? (
              <p
                data-testid="clear-dues-error"
                role="alert"
                className="text-red-700"
              >
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="clear-dues-cancel"
                onClick={onClose}
                className={BTN}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-testid="clear-dues-submit"
                disabled={busy || dues === null}
                onClick={() => void onSubmit()}
                className="rounded bg-blue-600 px-4 py-1.5 text-base font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {t('billing.clearDues.submit')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
