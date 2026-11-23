// Receipt print preview (R5 design §8.1; BILL-003, HC-MVP1-150).
// Route: /patient/:patientId/receipt/:invoiceId.
//
// Loads `receipt_get` and renders the printable <ReceiptDocument />. The
// toolbar picks the paper (A5 default, A4) and prints through the single
// `printPage` seam (window.print); the OS print dialog also saves a PDF. An
// in-app "Save PDF" / WhatsApp share waits for the R4 document engine and is
// not rendered (no dead end). Calls ONLY the generated bindings.

import { useCallback, useEffect, useState } from 'react';

import { commands, type ReceiptDoc } from '@/bindings';
import { billingErrorMessage } from '@/billing/billingErrors';
import { run } from '@/shared/command';
import { printPage } from '@/shared/print';
import { t } from '@/shared/strings';

import { ReceiptDocument } from './ReceiptDocument';
import './receipt.css';

export interface ReceiptPreviewProps {
  /** The patient (Back chain). */
  readonly patientId: string;
  /** The invoice whose receipt is shown. */
  readonly invoiceId: string;
  /** Back to the invoice. */
  readonly onBack?: () => void;
}

type Paper = 'A5' | 'A4';

const BTN =
  'rounded border border-slate-300 px-3 py-1.5 text-base hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600';

/** The receipt preview screen. */
export function ReceiptPreview({
  invoiceId,
  onBack,
}: ReceiptPreviewProps): JSX.Element {
  const [doc, setDoc] = useState<ReceiptDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = useState<Paper>('A5');

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);
    void (async (): Promise<void> => {
      try {
        const d = await run(commands.receiptGet({ invoiceId }));
        if (!cancelled) setDoc(d);
      } catch (err) {
        if (!cancelled) setError(billingErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  // Only the receipt prints while this screen is mounted.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('hc-printing');
    return () => root.classList.remove('hc-printing');
  }, []);

  const print = useCallback((): void => {
    if (doc !== null) printPage();
  }, [doc]);

  // Ctrl+P prints the receipt (S14 keyboard); Esc goes back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.isComposing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        print();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [print]);

  const pageCss = `@page { size: ${paper} portrait; margin: 10mm; }`;

  return (
    <section
      data-testid="receipt-preview"
      aria-label={t('receipt.title')}
      className="flex flex-col gap-4 p-6 text-base"
    >
      <style>{pageCss}</style>
      <div
        data-print-hide=""
        role="toolbar"
        aria-label={t('receipt.toolbar')}
        className="flex flex-wrap items-center gap-3 border-b border-slate-200 pb-3"
      >
        <button
          type="button"
          data-testid="receipt-back"
          onClick={() => onBack?.()}
          className={BTN}
        >
          {t('receipt.back')}
        </button>
        <label className="flex items-center gap-2">
          {t('receipt.paper')}
          <select
            data-testid="receipt-paper"
            value={paper}
            onChange={(e) => setPaper(e.target.value === 'A4' ? 'A4' : 'A5')}
            className="h-9 rounded border border-slate-300 px-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="A5">{t('receipt.paper.a5')}</option>
            <option value="A4">{t('receipt.paper.a4')}</option>
          </select>
        </label>
        <button
          type="button"
          data-testid="receipt-print"
          disabled={doc === null}
          onClick={print}
          className="rounded bg-blue-600 px-4 py-1.5 text-base font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {t('receipt.print')}
        </button>
        <span className="text-slate-600">{t('receipt.pdfHint')}</span>
      </div>

      {error !== null ? (
        <p data-testid="receipt-error" role="alert" className="text-red-700">
          {error}
        </p>
      ) : null}
      {doc === null && error === null ? (
        <div
          aria-busy="true"
          className="h-40 w-full animate-pulse rounded bg-slate-100"
        />
      ) : null}
      {doc !== null ? (
        <div className="rounded border border-slate-300 bg-slate-50 p-4">
          <ReceiptDocument doc={doc} />
        </div>
      ) : null}
    </section>
  );
}
