// S15 Invoice screen (docs/ui/S15-invoice.md; R5 design §7; BILL-001/002/005/
// 006; HC-MVP1-148/151/152).
//
// One invoice per visit: lines (consultation / medicine / other), a discount
// (none / percent / amount), payments by mode and the balance that feeds the
// patient's running dues. Money is integer paise; the UI only PARSES typed
// rupees into paise (shared/money) and never computes a total itself: every
// amount on screen comes from `invoice_compute_totals` or the saved invoice
// (R-ARCH-003). The first Save issues the bill and assigns its FY receipt
// number. Admin form: explicit Save (Ctrl+S), no autosave.
//
// Calls ONLY the generated typed bindings. Every control carries a stable
// testid; visible text comes from en.json (R-UI-007).

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  commands,
  type DiscountDto,
  type InvoiceScreen as InvoiceScreenData,
  type LineDto,
  type LineKind,
  type PaymentInput,
  type PaymentMode,
  type TotalsView,
  type UpiQrView,
} from '@/bindings';
import { useLeaveGuard } from '@/app/leaveGuard';
import { run } from '@/shared/command';
import { formatDate, todayIsoDate } from '@/shared/datetime';
import { formatPaise, parseRupeesToPaise } from '@/shared/money';
import { t, type StringKey } from '@/shared/strings';

import { rupees } from './billChip';
import { billingErrorMessage } from './billingErrors';
import {
  holdInvoiceDraft,
  takeInvoiceDraft,
  type InvoiceDraft,
} from './invoiceDraft';

export interface InvoiceScreenProps {
  /** The patient being billed (the route's Back chain; the visit decides). */
  readonly patientId: string;
  /** The visit this invoice belongs to (one invoice per visit). */
  readonly visitId: string;
  /** Back to where the doctor came from (case form / dashboard). */
  readonly onBack?: () => void;
  /** Open the receipt print preview for a saved invoice. */
  readonly onPrintReceipt?: (invoiceId: string) => void;
  /** Open Settings (the "add your clinic UPI ID" hint link). */
  readonly onOpenSettings?: () => void;
}

/** One editable line (raw text as typed). */
interface EditLine {
  readonly key: number;
  readonly id: string | null;
  readonly kind: LineKind;
  readonly description: string;
  readonly qty: string;
  readonly rate: string;
}

type DiscountKind = DiscountDto['kind'];

const LINE_KINDS: ReadonlyArray<{ kind: LineKind; key: StringKey }> = [
  { kind: 'consultation', key: 'billing.kind.consultation' },
  { kind: 'medicine', key: 'billing.kind.medicine' },
  { kind: 'other', key: 'billing.kind.other' },
];

const DISCOUNT_KINDS: ReadonlyArray<{ kind: DiscountKind; key: StringKey }> = [
  { kind: 'none', key: 'billing.discount.none' },
  { kind: 'percent', key: 'billing.discount.percent' },
  { kind: 'amount', key: 'billing.discount.amount' },
];

/** Payment modes in their fixed order, with their label keys. */
export const PAYMENT_MODES: ReadonlyArray<{
  mode: PaymentMode;
  key: StringKey;
}> = [
  { mode: 'cash', key: 'billing.mode.cash' },
  { mode: 'upi', key: 'billing.mode.upi' },
  { mode: 'card', key: 'billing.mode.card' },
  { mode: 'other', key: 'billing.mode.other' },
];

/** The label of a payment mode. */
export function modeLabel(mode: PaymentMode): string {
  const hit = PAYMENT_MODES.find((m) => m.mode === mode);
  return hit === undefined ? mode : t(hit.key);
}

const TOTALS_DEBOUNCE_MS = 100;
const UNDO_MS = 5000;

const INPUT =
  'h-9 w-full min-w-0 rounded border border-slate-300 px-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100 disabled:text-slate-600';
const BTN =
  'rounded border border-slate-300 px-3 py-1.5 text-base hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:cursor-not-allowed disabled:text-slate-400';
const BTN_PRIMARY =
  'rounded bg-blue-600 px-4 py-1.5 text-base font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300';

/** Rupee text for a paise amount (the editable rate / discount fields). */
function paiseToInput(paise: number): string {
  return formatPaise(paise).replace(/,/g, '');
}

/** Wire lines from the edit state, or `null` when any line is incomplete. */
function toDtos(lines: readonly EditLine[]): LineDto[] | null {
  const out: LineDto[] = [];
  for (const l of lines) {
    const qty = /^\d+$/.test(l.qty.trim()) ? Number(l.qty.trim()) : NaN;
    const rate = parseRupeesToPaise(l.rate);
    if (l.description.trim() === '' || !Number.isInteger(qty) || qty < 1) {
      return null;
    }
    if (rate === null) return null;
    out.push({
      id: l.id,
      kind: l.kind,
      description: l.description.trim(),
      qty,
      ratePaise: rate,
    });
  }
  return out;
}

/** Wire discount from the edit state, or `null` when the value is malformed. */
function toDiscount(kind: DiscountKind, value: string): DiscountDto | null {
  if (kind === 'none') return { kind: 'none' };
  // "5" -> 500 (basis points) or 500 paise: both are "x 100, 2 decimals".
  const n = value.trim() === '' ? 0 : parseRupeesToPaise(value);
  if (n === null) return null;
  return kind === 'percent'
    ? { kind: 'percent', basisPoints: n }
    : { kind: 'amount', paise: n };
}

/** The S15 invoice screen. */
export function InvoiceScreen({
  patientId,
  visitId,
  onBack,
  onPrintReceipt,
  onOpenSettings,
}: InvoiceScreenProps): JSX.Element {
  const [data, setData] = useState<InvoiceScreenData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [discountKind, setDiscountKind] = useState<DiscountKind>('none');
  const [discountValue, setDiscountValue] = useState('');
  const [totals, setTotals] = useState<TotalsView | null>(null);
  const [dirty, setDirty] = useState(false);
  const [paid, setPaid] = useState('');
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayIsoDate());
  // Any edit to the payment fields is unsaved work (r5-review-1): it guards
  // Back / the shell leave and the Print gate like a line edit, but it does
  // NOT feed the totals effect (`dirty`), which only lines and discount drive.
  const [paymentTouched, setPaymentTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [qr, setQr] = useState<UpiQrView | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [cancelPayment, setCancelPayment] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [leaving, setLeaving] = useState(false);
  // A draft held across a lock (r5-review-17): 'restored' when it was put
  // back, 'stale' when the bill changed meanwhile and it could not be.
  const [draftNotice, setDraftNotice] = useState<'restored' | 'stale' | null>(
    null,
  );
  const [removed, setRemoved] = useState<{
    line: EditLine;
    index: number;
  } | null>(null);

  const nextKey = useRef(1);
  const totalsSeq = useRef(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where the leave prompt goes on Save / Discard: the shell's pending
  // navigation (AppBar Back, Alt+Left, side nav) or, when null, `onBack`.
  const leaveTo = useRef<(() => void) | null>(null);
  // The draft parked across a lock, taken once on the first load (undefined =
  // not looked up yet). Only the latest load applies it (StrictMode-safe).
  const pendingDraft = useRef<InvoiceDraft | null | undefined>(undefined);
  const loadSeq = useRef(0);

  const editLinesFrom = useCallback((dtos: readonly LineDto[]): EditLine[] => {
    return dtos.map((l) => ({
      key: nextKey.current++,
      id: l.id,
      kind: l.kind,
      description: l.description,
      qty: String(l.qty),
      rate: paiseToInput(l.ratePaise),
    }));
  }, []);

  /** Adopt a screen payload from the backend (load / save / payment). */
  const adopt = useCallback(
    (next: InvoiceScreenData, resetLines: boolean): void => {
      setData(next);
      const inv = next.invoice;
      if (!resetLines) return;
      if (inv !== null) {
        setLines(editLinesFrom(inv.lines));
        setDiscountKind(inv.discount.kind);
        setDiscountValue(
          inv.discount.kind === 'percent'
            ? paiseToInput(inv.discount.basisPoints)
            : inv.discount.kind === 'amount'
              ? paiseToInput(inv.discount.paise)
              : '',
        );
        setTotals(inv.totals);
      } else {
        setLines(editLinesFrom(next.proposal ?? []));
        setDiscountKind('none');
        setDiscountValue('');
        setTotals(null);
      }
      setDirty(false);
    },
    [editLinesFrom],
  );

  /** Put a draft held across a lock back into the form. */
  const restoreDraft = useCallback((draft: InvoiceDraft): void => {
    setLines(draft.lines.map((l) => ({ ...l })));
    nextKey.current = Math.max(
      nextKey.current,
      ...draft.lines.map((l) => l.key + 1),
    );
    setDiscountKind(draft.discountKind);
    setDiscountValue(draft.discountValue);
    setPaid(draft.paid);
    setMode(draft.mode);
    setReference(draft.reference);
    setPaidOn(draft.paidOn);
    setPaymentTouched(draft.paymentTouched);
    setDirty(draft.dirty);
    setDraftNotice('restored');
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoadFailed(false);
    const seq = ++loadSeq.current;
    if (pendingDraft.current === undefined) {
      pendingDraft.current = takeInvoiceDraft(visitId);
    }
    try {
      const next = await run(
        commands.invoiceGetForVisit({ visitId, localToday: todayIsoDate() }),
      );
      // An unbilled proposal gets its amounts from the backend before it is
      // shown, so the prefilled consultation line never renders without one.
      let proposalTotals: TotalsView | null = null;
      if (next.invoice === null && (next.proposal ?? []).length > 0) {
        try {
          proposalTotals = await run(
            commands.invoiceComputeTotals({
              lines: next.proposal ?? [],
              discount: { kind: 'none' },
            }),
          );
        } catch {
          proposalTotals = null;
        }
      }
      if (seq !== loadSeq.current) return;
      adopt(next, true);
      if (proposalTotals !== null) setTotals(proposalTotals);
      const draft = pendingDraft.current;
      pendingDraft.current = null;
      if (draft !== null && draft !== undefined) {
        // Restore only onto the same bill version the draft was typed on.
        const same =
          draft.baseInvoiceId === (next.invoice?.invoiceId ?? null) &&
          draft.baseRowVersion === (next.invoice?.rowVersion ?? null) &&
          next.invoice?.status !== 'void';
        if (same) restoreDraft(draft);
        else setDraftNotice('stale');
      }
    } catch {
      if (seq === loadSeq.current) setLoadFailed(true);
    }
  }, [adopt, restoreDraft, visitId]);

  useEffect(() => {
    void load();
  }, [load]);

  const invoice = data?.invoice ?? null;
  const isVoid = invoice?.status === 'void';
  const saved = invoice !== null && !isVoid;

  // Live totals from the backend after an edit (debounced, last response
  // wins). Incomplete lines are not sent; the totals show as pending.
  useEffect(() => {
    if (!dirty) return undefined;
    const dtos = toDtos(lines);
    const discount = toDiscount(discountKind, discountValue);
    if (dtos === null || discount === null || dtos.length === 0) {
      setTotals(null);
      return undefined;
    }
    const seq = ++totalsSeq.current;
    const timer = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const next = await run(
            commands.invoiceComputeTotals({ lines: dtos, discount }),
          );
          if (seq === totalsSeq.current) {
            setTotals(next);
            setError(null);
          }
        } catch (err) {
          if (seq === totalsSeq.current) {
            setTotals(null);
            setError(billingErrorMessage(err));
          }
        }
      })();
    }, TOTALS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [dirty, lines, discountKind, discountValue]);

  // Clinic UPI QR for the current balance (BILL-005): only for a live bill
  // with a balance and a configured clinic UPI ID.
  const qrInvoiceId =
    saved && invoice.balancePaise > 0 && data?.upiConfigured === true
      ? invoice.invoiceId
      : null;
  const qrBalance = invoice?.balancePaise ?? 0;
  useEffect(() => {
    setQr(null);
    if (qrInvoiceId === null) return undefined;
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const next = await run(
          commands.invoiceUpiQr({ invoiceId: qrInvoiceId }),
        );
        if (!cancelled) setQr(next);
      } catch {
        if (!cancelled) setQr(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qrInvoiceId, qrBalance]);

  useEffect(() => {
    if (toast === null) return undefined;
    const timer = setTimeout(() => setToast(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(
    () => () => {
      if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    },
    [],
  );

  const edit = useCallback((next: EditLine[]): void => {
    setLines(next);
    setDirty(true);
  }, []);

  const updateLine = (index: number, patch: Partial<EditLine>): void => {
    edit(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const addLine = (kind: LineKind): void => {
    edit([
      ...lines,
      {
        key: nextKey.current++,
        id: null,
        kind,
        description: '',
        qty: '1',
        rate: '',
      },
    ]);
  };

  const removeLine = (index: number): void => {
    const line = lines[index];
    if (line === undefined) return;
    edit(lines.filter((_, i) => i !== index));
    setRemoved({ line, index });
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setRemoved(null), UNDO_MS);
  };

  const undoRemove = (): void => {
    if (removed === null) return;
    const next = [...lines];
    next.splice(Math.min(removed.index, next.length), 0, removed.line);
    edit(next);
    setRemoved(null);
  };

  /** The typed payment, `undefined` when none entered, `null` when invalid. */
  const paymentInput = (): PaymentInput | null | undefined => {
    if (paid.trim() === '') return undefined;
    const amount = parseRupeesToPaise(paid);
    if (amount === null || amount <= 0) return null;
    return {
      amountPaise: amount,
      mode,
      reference: reference.trim() === '' ? null : reference.trim(),
      paidOn,
    };
  };

  const clearPayment = (): void => {
    setPaid('');
    setReference('');
    setMode('cash');
    setPaidOn(todayIsoDate());
    setPaymentTouched(false);
  };

  /** Edit one payment field: mark the payment as unsaved work. */
  const editPayment = (apply: () => void): void => {
    apply();
    setPaymentTouched(true);
  };

  const onSave = async (): Promise<boolean> => {
    if (busy || isVoid) return false;
    const dtos = toDtos(lines);
    const discount = toDiscount(discountKind, discountValue);
    if (dtos === null || dtos.length === 0) {
      setError(t('billing.error.lines'));
      return false;
    }
    if (discount === null) {
      setError(t('billing.error.discount'));
      return false;
    }
    const payment = paymentInput();
    if (payment === null) {
      setError(t('billing.error.amount'));
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await run(
        commands.invoiceSave({
          visitId,
          invoiceId: invoice?.invoiceId ?? null,
          expectedRowVersion: invoice?.rowVersion ?? null,
          lines: dtos,
          discount,
          payment: payment ?? null,
          localToday: todayIsoDate(),
        }),
      );
      adopt(next, true);
      clearPayment();
      setDraftNotice(null);
      setToast(t('billing.toast.saved'));
      return true;
    } catch (err) {
      setError(billingErrorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onAddPayment = async (): Promise<void> => {
    if (busy || !saved) return;
    const payment = paymentInput();
    if (payment === undefined || payment === null) {
      setError(t('billing.error.amount'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await run(
        commands.paymentAdd({ invoiceId: invoice.invoiceId, payment }),
      );
      adopt(next, !dirty);
      clearPayment();
      setToast(t('billing.toast.paymentAdded'));
    } catch (err) {
      setError(billingErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onConfirmCancelPayment = async (): Promise<void> => {
    if (busy || cancelPayment === null || cancelReason.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const next = await run(
        commands.paymentVoid({
          paymentId: cancelPayment,
          reason: cancelReason.trim(),
        }),
      );
      adopt(next, !dirty);
      setCancelPayment(null);
      setCancelReason('');
      setToast(t('billing.toast.paymentCancelled'));
    } catch (err) {
      setError(billingErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onConfirmVoid = async (): Promise<void> => {
    if (busy || invoice === null || voidReason.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const next = await run(
        commands.invoiceVoid({
          invoiceId: invoice.invoiceId,
          reason: voidReason.trim(),
          expectedRowVersion: invoice.rowVersion,
        }),
      );
      adopt(next, true);
      setVoiding(false);
      setVoidReason('');
    } catch (err) {
      setError(billingErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Unsaved work on a live bill: line / discount edits or a typed payment.
  // A void bill is read-only, so it never holds unsaved work.
  const unsaved = (dirty || paymentTouched) && !isVoid;

  const printReceipt = (): void => {
    if (invoice !== null && !unsaved) onPrintReceipt?.(invoice.invoiceId);
  };

  // The window shortcuts call the latest handlers (they read live form state).
  const shortcuts = useRef({ save: onSave, print: printReceipt });
  shortcuts.current = { save: onSave, print: printReceipt };

  // EVERY exit while the bill has unsaved work asks the same Save / Discard
  // prompt (design §7; r5-review-2/15/16): the shell's navigations reach the
  // handler through the shell guard, and the screen's own exits (Back, the
  // UPI hint's "Open settings") go through the SAME `guardLeave`.
  //
  // Lock (Ctrl+L / idle) is not guarded (SET-004): just before it happens the
  // shell calls the lock hook, which parks the unsaved draft in memory so the
  // doctor gets it back after the PIN unlock (r5-review-17; invoiceDraft.ts).
  const snapshot = useRef<InvoiceDraft | null>(null);
  const guardLeave = useLeaveGuard(
    unsaved,
    (leave) => {
      leaveTo.current = leave;
      setLeaving(true);
    },
    () => {
      if (snapshot.current !== null) holdInvoiceDraft(snapshot.current);
    },
  );

  const goBack = (): void => guardLeave(() => onBack?.());
  const openSettings = (): void => guardLeave(() => onOpenSettings?.());

  snapshot.current = unsaved
    ? {
        route: `/patient/${encodeURIComponent(patientId)}/visit/${encodeURIComponent(visitId)}/invoice`,
        visitId,
        baseInvoiceId: invoice?.invoiceId ?? null,
        baseRowVersion: invoice?.rowVersion ?? null,
        lines,
        discountKind,
        discountValue,
        paid,
        mode,
        reference,
        paidOn,
        dirty,
        paymentTouched,
      }
    : null;

  /** Close the prompt and stay on the bill. */
  const stay = (): void => {
    leaveTo.current = null;
    setLeaving(false);
  };

  /** Close the prompt and go where the doctor asked (shell target or Back). */
  const leave = (): void => {
    const go = leaveTo.current;
    leaveTo.current = null;
    setLeaving(false);
    if (go !== null) go();
  };

  // Keyboard: Ctrl+S save, Ctrl+P print receipt (S15). Esc closes dialogs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.isComposing) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        void shortcuts.current.save();
      } else if (key === 'p') {
        e.preventDefault();
        shortcuts.current.print();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (loadFailed) {
    return (
      <section
        data-testid="invoice-error"
        role="alert"
        className="flex flex-col items-start gap-2 p-6 text-base text-red-700"
      >
        {t('billing.error.load')}
        <button
          type="button"
          data-testid="invoice-retry"
          className={BTN}
          onClick={() => void load()}
        >
          {t('common.retry')}
        </button>
      </section>
    );
  }

  if (data === null) {
    return (
      <section
        data-testid="invoice-loading"
        aria-busy="true"
        className="p-6 text-base text-slate-500"
      >
        <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
      </section>
    );
  }

  const readOnly = isVoid;
  const amounts =
    totals !== null && totals.lineAmountsPaise.length === lines.length
      ? totals.lineAmountsPaise
      : null;
  const visitOn = formatDate(data.visit.visitAt) ?? t('common.none');
  const numberText =
    invoice !== null
      ? `${t('billing.receiptNo')} ${invoice.number}`
      : `${t('billing.receiptNo')} ${t('billing.receiptNo.pending')}`;
  const patientLine = `${data.patient.name} · ${data.patient.code}`;
  const visitLine = `${t('billing.visit')} ${visitOn}`;
  const showUpi = saved && invoice.balancePaise > 0;

  return (
    <section
      data-testid="invoice-screen"
      aria-label={t('billing.title')}
      className="flex flex-col gap-4 p-6 text-base text-slate-900"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <button
            type="button"
            data-testid="invoice-back"
            onClick={goBack}
            className={BTN}
          >
            {t('billing.back')}
          </button>
          <h1 className="text-lg font-semibold">{t('billing.title')}</h1>
          <span data-testid="invoice-patient">{patientLine}</span>
          <span className="text-slate-600">{visitLine}</span>
        </div>
        <span data-testid="invoice-number" className="font-semibold">
          {numberText}
        </span>
      </header>

      {draftNotice !== null ? (
        <p
          data-testid="invoice-draft-notice"
          role="status"
          className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900"
        >
          {draftNotice === 'restored'
            ? t('billing.draft.restored')
            : t('billing.draft.stale')}
        </p>
      ) : null}

      {isVoid ? (
        <div
          data-testid="invoice-void-banner"
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-red-800"
        >
          <span>
            <strong>{t('billing.void.banner')}</strong>{' '}
            {invoice.voidReason ?? ''}
          </span>
          <button
            type="button"
            data-testid="invoice-rebill"
            onClick={() => void load()}
            className={BTN_PRIMARY}
          >
            {t('billing.void.rebill')}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <span data-testid="invoice-dues">
          {t('billing.patientDues')} {rupees(data.patientDuesPaise)}
        </span>
        {data.gstin !== null ? (
          <span data-testid="invoice-gstin">
            {t('billing.gstin')} {data.gstin}
          </span>
        ) : null}
      </div>

      {/* Lines (BILL-001) */}
      <fieldset className="flex flex-col gap-2" disabled={readOnly}>
        <legend className="mb-1 font-semibold">{t('billing.lines')}</legend>
        {lines.length === 0 || (invoice === null && lines.length <= 1) ? (
          <p data-testid="invoice-empty-hint" className="text-slate-600">
            {t('billing.emptyHint')}
          </p>
        ) : null}
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-600">
              <th className="w-36 py-1 pr-2 font-medium">
                {t('billing.col.kind')}
              </th>
              <th className="py-1 pr-2 font-medium">{t('billing.col.desc')}</th>
              <th className="w-20 py-1 pr-2 font-medium">
                {t('billing.col.qty')}
              </th>
              <th className="w-32 py-1 pr-2 font-medium">
                {t('billing.col.rate')}
              </th>
              <th className="w-32 py-1 pr-2 text-right font-medium">
                {t('billing.col.amount')}
              </th>
              <th className="w-24 py-1">
                <span className="sr-only">{t('billing.col.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const n = i + 1;
              const amount = amounts?.[i];
              return (
                <tr key={l.key} className="border-b border-slate-100">
                  <td className="py-1 pr-2">
                    <select
                      data-testid={`invoice-line-kind-${n}`}
                      aria-label={`${t('billing.col.kind')} ${n}`}
                      value={l.kind}
                      onChange={(e) =>
                        updateLine(i, { kind: e.target.value as LineKind })
                      }
                      className={INPUT}
                    >
                      {LINE_KINDS.map((k) => (
                        <option key={k.kind} value={k.kind}>
                          {t(k.key)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      data-testid={`invoice-line-desc-${n}`}
                      aria-label={`${t('billing.col.desc')} ${n}`}
                      value={l.description}
                      maxLength={200}
                      onChange={(e) =>
                        updateLine(i, { description: e.target.value })
                      }
                      className={INPUT}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      data-testid={`invoice-line-qty-${n}`}
                      aria-label={`${t('billing.col.qty')} ${n}`}
                      inputMode="numeric"
                      value={l.qty}
                      onChange={(e) => updateLine(i, { qty: e.target.value })}
                      className={INPUT}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      data-testid={`invoice-line-rate-${n}`}
                      aria-label={`${t('billing.col.rate')} ${n}`}
                      inputMode="decimal"
                      value={l.rate}
                      onChange={(e) => updateLine(i, { rate: e.target.value })}
                      className={INPUT}
                    />
                  </td>
                  <td
                    data-testid={`invoice-line-amount-${n}`}
                    className="py-1 pr-2 text-right tabular-nums"
                  >
                    {amount !== undefined
                      ? formatPaise(amount)
                      : t('common.none')}
                  </td>
                  <td className="py-1 text-right">
                    {!readOnly ? (
                      <button
                        type="button"
                        data-testid={`invoice-remove-line-${n}`}
                        aria-label={`${t('billing.removeLine')} ${n}`}
                        onClick={() => removeLine(i)}
                        className={BTN}
                      >
                        {t('billing.removeLine')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!readOnly ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="invoice-add-medicine"
              onClick={() => addLine('medicine')}
              className={BTN}
            >
              {t('billing.addMedicine')}
            </button>
            <button
              type="button"
              data-testid="invoice-add-line"
              onClick={() => addLine('other')}
              className={BTN}
            >
              {t('billing.addLine')}
            </button>
          </div>
        ) : null}
      </fieldset>

      {/* Discount + totals (BILL-001): amounts from the backend only. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <fieldset
          className="flex flex-col gap-2"
          disabled={readOnly}
          aria-describedby="invoice-totals-note"
        >
          <legend className="mb-1 font-semibold">
            {t('billing.discount')}
          </legend>
          <div
            data-testid="invoice-discount-type"
            role="radiogroup"
            aria-label={t('billing.discount.type')}
            className="flex flex-wrap gap-3"
          >
            {DISCOUNT_KINDS.map((d) => (
              <label key={d.kind} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="invoice-discount-type"
                  value={d.kind}
                  checked={discountKind === d.kind}
                  onChange={() => {
                    setDiscountKind(d.kind);
                    setDirty(true);
                  }}
                />
                {t(d.key)}
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            {t('billing.discount.value')}
            <input
              data-testid="invoice-discount-value"
              inputMode="decimal"
              disabled={readOnly || discountKind === 'none'}
              value={discountValue}
              onChange={(e) => {
                setDiscountValue(e.target.value);
                setDirty(true);
              }}
              className={`${INPUT} max-w-[10rem]`}
            />
          </label>
        </fieldset>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 self-start">
          <dt>{t('billing.subtotal')}</dt>
          <dd
            data-testid="invoice-subtotal"
            className="text-right tabular-nums"
          >
            {totals !== null ? rupees(totals.subtotalPaise) : t('common.none')}
          </dd>
          <dt>{t('billing.discountAmount')}</dt>
          <dd
            data-testid="invoice-discount-amount"
            className="text-right tabular-nums"
          >
            {totals !== null ? rupees(totals.discountPaise) : t('common.none')}
          </dd>
          <dt className="font-semibold">{t('billing.total')}</dt>
          <dd
            data-testid="invoice-total"
            className="text-right font-semibold tabular-nums"
          >
            {totals !== null ? rupees(totals.totalPaise) : t('common.none')}
          </dd>
          {invoice !== null ? (
            <>
              <dt>{t('billing.paid')}</dt>
              <dd
                data-testid="invoice-paid-total"
                className="text-right tabular-nums"
              >
                {rupees(invoice.paidPaise)}
              </dd>
              <dt className="font-semibold">{t('billing.balance')}</dt>
              <dd
                data-testid="invoice-balance"
                className="text-right font-semibold tabular-nums"
              >
                {rupees(invoice.balancePaise)}
              </dd>
            </>
          ) : null}
        </dl>
      </div>
      <p id="invoice-totals-note" className="sr-only">
        {t('billing.totalsNote')}
      </p>

      {/* Payment entry (BILL-001/002) */}
      {!readOnly ? (
        <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-3">
          <legend className="px-1 font-semibold">{t('billing.payment')}</legend>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              {t('billing.payment.amount')}
              <input
                data-testid="invoice-paid"
                inputMode="decimal"
                value={paid}
                onChange={(e) => editPayment(() => setPaid(e.target.value))}
                className={`${INPUT} w-32`}
              />
            </label>
            <div
              data-testid="invoice-mode"
              role="radiogroup"
              aria-label={t('billing.payment.mode')}
              className="flex flex-wrap gap-3 pb-2"
            >
              {PAYMENT_MODES.map((m) => (
                <label key={m.mode} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="invoice-mode"
                    value={m.mode}
                    checked={mode === m.mode}
                    onChange={() => editPayment(() => setMode(m.mode))}
                  />
                  {t(m.key)}
                </label>
              ))}
            </div>
            <label className="flex flex-col gap-1">
              {t('billing.payment.ref')}
              <input
                data-testid="invoice-ref"
                value={reference}
                maxLength={64}
                onChange={(e) =>
                  editPayment(() => setReference(e.target.value))
                }
                className={`${INPUT} w-40`}
              />
            </label>
            <label className="flex flex-col gap-1">
              {t('billing.payment.date')}
              <input
                data-testid="invoice-paid-on"
                type="date"
                value={paidOn}
                max={todayIsoDate()}
                onChange={(e) => editPayment(() => setPaidOn(e.target.value))}
                className={`${INPUT} w-40`}
              />
            </label>
            {saved ? (
              <button
                type="button"
                data-testid="invoice-add-payment"
                disabled={busy}
                onClick={() => void onAddPayment()}
                className={BTN}
              >
                {t('billing.payment.add')}
              </button>
            ) : null}
          </div>
          {!saved ? (
            <p className="text-slate-600">{t('billing.payment.onSave')}</p>
          ) : null}
        </fieldset>
      ) : null}

      {/* Payments recorded */}
      {invoice !== null && invoice.payments.length > 0 ? (
        <section aria-label={t('billing.payments')}>
          <h2 className="mb-1 font-semibold">{t('billing.payments')}</h2>
          <ul className="flex flex-col gap-1">
            {invoice.payments.map((p, i) => {
              const n = i + 1;
              const text = `${formatDate(p.paidOn) ?? p.paidOn} · ${modeLabel(p.mode)} · ${rupees(p.amountPaise)}${p.reference !== null ? ` · ${p.reference}` : ''}`;
              return (
                <li
                  key={p.paymentId}
                  data-testid={`invoice-payment-row-${n}`}
                  className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-1"
                >
                  <span className={p.voided ? 'line-through' : undefined}>
                    {text}
                  </span>
                  {p.voided ? (
                    <span className="font-semibold text-red-700">
                      {t('billing.payment.cancelled')}
                    </span>
                  ) : !readOnly ? (
                    <button
                      type="button"
                      data-testid={`invoice-payment-void-${n}`}
                      onClick={() => {
                        setCancelPayment(p.paymentId);
                        setCancelReason('');
                      }}
                      className={BTN}
                    >
                      {t('billing.payment.cancel')}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Clinic UPI QR (BILL-005) or the Settings hint (no dead end). */}
      {showUpi && data.upiConfigured ? (
        <section
          data-testid="invoice-upi-qr"
          aria-label={t('billing.upi.title')}
          className="flex items-center gap-4 rounded border border-slate-200 p-3"
        >
          {qr !== null && qr.available && qr.qrDataUrl !== null ? (
            <img
              src={qr.qrDataUrl}
              alt={t('billing.upi.alt')}
              className="h-40 w-40"
            />
          ) : (
            <div
              aria-busy="true"
              className="h-40 w-40 animate-pulse rounded bg-slate-100"
            />
          )}
          <p>
            {t('billing.upi.caption')} {rupees(invoice.balancePaise)}
          </p>
        </section>
      ) : null}
      {showUpi && !data.upiConfigured ? (
        <p
          data-testid="invoice-upi-hint"
          className="rounded border border-slate-200 bg-slate-50 p-3"
        >
          {t('billing.upi.hint')}{' '}
          <a
            href="#/settings"
            data-testid="invoice-upi-open-settings"
            onClick={(e) => {
              // Never let the anchor change the hash itself: the guarded
              // path decides (r5-review-16).
              e.preventDefault();
              openSettings();
            }}
            className="font-semibold text-blue-700 underline focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('billing.upi.openSettings')}
          </a>
        </p>
      ) : null}

      {error !== null ? (
        <p
          data-testid="invoice-save-error"
          role="alert"
          className="text-red-700"
        >
          {error}
        </p>
      ) : null}

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-3">
        {saved ? (
          <button
            type="button"
            data-testid="invoice-void"
            onClick={() => {
              setVoiding(true);
              setVoidReason('');
            }}
            className={`${BTN} mr-auto text-red-700`}
          >
            {t('billing.void')}
          </button>
        ) : null}
        {!readOnly ? (
          <button
            type="button"
            data-testid="invoice-save"
            disabled={busy}
            onClick={() => void onSave()}
            className={BTN_PRIMARY}
          >
            {t('billing.save')}
          </button>
        ) : null}
        <button
          type="button"
          data-testid="invoice-print"
          disabled={invoice === null || unsaved}
          title={
            invoice === null || unsaved ? t('billing.print.hint') : undefined
          }
          onClick={printReceipt}
          className={BTN}
        >
          {t('billing.print')}
        </button>
      </footer>

      {toast !== null ? (
        <div
          data-testid="invoice-toast"
          role="status"
          className="fixed bottom-12 right-6 rounded bg-slate-800 px-4 py-2 text-white shadow"
        >
          {toast}
        </div>
      ) : null}

      {removed !== null ? (
        <div
          data-testid="invoice-undo"
          role="status"
          className="fixed bottom-24 right-6 flex items-center gap-3 rounded bg-slate-800 px-4 py-2 text-white shadow"
        >
          {t('billing.lineRemoved')}
          <button
            type="button"
            data-testid="invoice-undo-remove"
            onClick={undoRemove}
            className="rounded border border-white px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-white"
          >
            {t('billing.undo')}
          </button>
        </div>
      ) : null}

      {voiding && invoice !== null ? (
        <ReasonDialog
          testId="invoice-void-dialog"
          title={t('billing.void.title')}
          body={`${t('billing.void.body')} ${rupees(invoice.paidPaise)}`}
          reasonTestId="invoice-void-reason"
          confirmTestId="invoice-void-confirm"
          cancelTestId="invoice-void-cancel"
          confirmLabel={t('billing.void.confirm')}
          reason={voidReason}
          busy={busy}
          onReason={setVoidReason}
          onConfirm={() => void onConfirmVoid()}
          onCancel={() => setVoiding(false)}
        />
      ) : null}

      {cancelPayment !== null ? (
        <ReasonDialog
          testId="invoice-payment-void-dialog"
          title={t('billing.payment.cancel.title')}
          body={t('billing.payment.cancel.body')}
          reasonTestId="invoice-payment-void-reason"
          confirmTestId="invoice-payment-void-confirm"
          cancelTestId="invoice-payment-void-cancel"
          confirmLabel={t('billing.payment.cancel.confirm')}
          reason={cancelReason}
          busy={busy}
          onReason={setCancelReason}
          onConfirm={() => void onConfirmCancelPayment()}
          onCancel={() => setCancelPayment(null)}
        />
      ) : null}

      {leaving ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('billing.leave.title')}
          data-testid="invoice-leave-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onKeyDown={(e) => {
            if (e.key === 'Escape') stay();
          }}
        >
          <div className="w-[26rem] rounded border border-slate-300 bg-white p-4 shadow-lg">
            <p className="mb-3">{t('billing.leave.body')}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="invoice-leave-stay"
                autoFocus
                onClick={stay}
                className={BTN}
              >
                {t('billing.leave.stay')}
              </button>
              <button
                type="button"
                data-testid="invoice-leave-discard"
                onClick={leave}
                className={BTN}
              >
                {t('billing.leave.discard')}
              </button>
              <button
                type="button"
                data-testid="invoice-leave-save"
                onClick={() => {
                  setLeaving(false);
                  void onSave().then((ok) => {
                    if (ok) leave();
                    else leaveTo.current = null;
                  });
                }}
                className={BTN_PRIMARY}
              >
                {t('billing.save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** A confirm dialog that needs a typed reason (cancel bill / payment). */
function ReasonDialog({
  testId,
  title,
  body,
  reasonTestId,
  confirmTestId,
  cancelTestId,
  confirmLabel,
  reason,
  busy,
  onReason,
  onConfirm,
  onCancel,
}: {
  readonly testId: string;
  readonly title: string;
  readonly body: string;
  readonly reasonTestId: string;
  readonly confirmTestId: string;
  readonly cancelTestId: string;
  readonly confirmLabel: string;
  readonly reason: string;
  readonly busy: boolean;
  readonly onReason: (value: string) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const reasonId = `${testId}-reason-input`;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <div className="flex w-[28rem] flex-col gap-3 rounded border border-slate-300 bg-white p-4 shadow-lg">
        <h2 className="font-semibold">{title}</h2>
        <p>{body}</p>
        <label htmlFor={reasonId} className="flex flex-col gap-1">
          {t('billing.reason')}
          <input
            id={reasonId}
            data-testid={reasonTestId}
            autoFocus
            maxLength={200}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onConfirm();
              }
            }}
            className={INPUT}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid={cancelTestId}
            onClick={onCancel}
            className={BTN}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            data-testid={confirmTestId}
            disabled={busy || reason.trim() === ''}
            onClick={onConfirm}
            className="rounded bg-red-600 px-3 py-1.5 text-base font-semibold text-white focus:outline-none focus:ring-2 focus:ring-red-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
