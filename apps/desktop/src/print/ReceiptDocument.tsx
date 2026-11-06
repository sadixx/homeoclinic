// Printable receipt body (R5 design §8.1; BILL-003/005/006, HC-MVP1-150).
// Pure presentational: everything comes from `receipt_get` (number, totals,
// amount in words); amounts are formatted, never computed (R-ARCH-003).
// Dates print DD-MM-YYYY, money in Indian grouping.

import type { ReceiptDoc } from '@/bindings';
import { formatDate } from '@/shared/datetime';
import { formatPaise } from '@/shared/money';
import { t } from '@/shared/strings';

import { joinParts, rupees } from '@/billing/billChip';
import { modeLabel } from '@/billing/InvoiceScreen';

export interface ReceiptDocumentProps {
  /** The receipt content from `receipt_get`. */
  readonly doc: ReceiptDoc;
}

/** The receipt itself (what prints). */
export function ReceiptDocument({ doc }: ReceiptDocumentProps): JSX.Element {
  const issued = formatDate(doc.issuedOn) ?? doc.issuedOn;
  const visitOn = formatDate(doc.visitOn) ?? t('common.none');
  const doctorLine = `${doc.doctorName}, ${doc.doctorQualification} · ${t('receipt.regNo')} ${doc.doctorRegNo}`;
  const patientLine = `${doc.patientName} (${doc.patientCode})`;
  const discountLabel =
    doc.discount.kind === 'percent'
      ? `${t('billing.discountAmount')} (${formatPaise(doc.discount.basisPoints)}%)`
      : t('billing.discountAmount');

  return (
    <article
      data-testid="receipt-document"
      aria-label={t('receipt.title')}
      className="receipt-document relative mx-auto flex w-full max-w-[148mm] flex-col gap-3 bg-white p-6 text-base text-slate-900"
    >
      {doc.void ? (
        <p
          data-testid="receipt-void"
          role="note"
          className="rounded border-2 border-red-700 py-1 text-center text-lg font-bold tracking-widest text-red-700"
        >
          {t('receipt.cancelled')}
        </p>
      ) : null}

      <header className="flex flex-col items-center gap-0.5 border-b border-slate-300 pb-2 text-center">
        <h1 className="text-lg font-bold">{doc.clinicName}</h1>
        <p>{doc.clinicAddress}</p>
        {doc.clinicPhone !== null ? <p>{doc.clinicPhone}</p> : null}
        <p>{doctorLine}</p>
        {doc.gstin !== null ? (
          <p data-testid="receipt-gstin">
            {t('billing.gstin')} {doc.gstin}
          </p>
        ) : null}
      </header>

      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="text-base font-semibold">{t('receipt.title')}</h2>
        <span>
          {t('billing.receiptNo')}{' '}
          <strong data-testid="receipt-number">{doc.number}</strong>
        </span>
        <span>
          {t('receipt.date')} {issued}
        </span>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <span>
          {t('receipt.patient')} {patientLine}
        </span>
        <span>
          {t('receipt.visitOn')} {visitOn}
        </span>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-400 text-left">
            <th className="py-1 pr-2">{t('billing.col.desc')}</th>
            <th className="w-12 py-1 pr-2 text-right">
              {t('billing.col.qty')}
            </th>
            <th className="w-24 py-1 pr-2 text-right">
              {t('billing.col.rate')}
            </th>
            <th className="w-24 py-1 text-right">{t('billing.col.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={l.id ?? i} className="border-b border-slate-200">
              <td className="py-1 pr-2">{l.description}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{l.qty}</td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {formatPaise(l.ratePaise)}
              </td>
              <td className="py-1 text-right tabular-nums">
                {formatPaise(doc.totals.lineAmountsPaise[i] ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto grid w-64 grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
        <dt>{t('billing.subtotal')}</dt>
        <dd className="text-right tabular-nums">
          {rupees(doc.totals.subtotalPaise)}
        </dd>
        <dt>{discountLabel}</dt>
        <dd className="text-right tabular-nums">
          {rupees(doc.totals.discountPaise)}
        </dd>
        <dt className="font-semibold">{t('billing.total')}</dt>
        <dd
          data-testid="receipt-total"
          className="text-right font-semibold tabular-nums"
        >
          {rupees(doc.totals.totalPaise)}
        </dd>
        <dt>{t('billing.paid')}</dt>
        <dd data-testid="receipt-paid" className="text-right tabular-nums">
          {rupees(doc.paidPaise)}
        </dd>
        <dt className="font-semibold">{t('billing.balance')}</dt>
        <dd
          data-testid="receipt-balance"
          className="text-right font-semibold tabular-nums"
        >
          {rupees(doc.balancePaise)}
        </dd>
      </dl>

      {doc.payments.length > 0 ? (
        <section aria-label={t('billing.payments')}>
          <h3 className="font-semibold">{t('billing.payments')}</h3>
          <ul>
            {doc.payments.map((p) => (
              <li key={p.paymentId}>
                {joinParts([
                  formatDate(p.paidOn) ?? p.paidOn,
                  modeLabel(p.mode),
                  p.reference,
                  rupees(p.amountPaise),
                ])}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p>
        {t('receipt.receivedWithThanks')}{' '}
        <strong data-testid="receipt-words">{doc.paidInWords}</strong>
      </p>

      {doc.upiQrDataUrl !== null ? (
        <figure className="flex items-center gap-3">
          <img
            data-testid="receipt-qr"
            src={doc.upiQrDataUrl}
            alt={t('billing.upi.alt')}
            className="h-28 w-28"
          />
          <figcaption>
            {t('billing.upi.caption')} {rupees(doc.balancePaise)}
          </figcaption>
        </figure>
      ) : null}
    </article>
  );
}
