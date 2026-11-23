// Typed synthetic wire fixtures for the R5 billing / receipt / reports UI
// tests (test-only; R-TEST-004 synthetic data). Shapes come from the generated
// `@/bindings` types so a contract change breaks the tests at `tsc` time.

import type {
  ClearDuesResult,
  DailyCollection,
  DayRow,
  InvoiceScreen,
  InvoiceView,
  LineDto,
  MonthlySummary,
  PatientDues,
  ReceiptDoc,
  UpiQrView,
  UserFacingError,
} from '@/bindings';

export const ok = <T>(data: T) => ({ status: 'ok' as const, data });
export const fail = (code: string, message = 'Safe message.') => ({
  status: 'error' as const,
  error: {
    code,
    message,
    suggestedAction: 'Try again.',
  } as UserFacingError,
});

export const consultationLine: LineDto = {
  id: null,
  kind: 'consultation',
  description: 'Consultation (follow-up)',
  qty: 1,
  ratePaise: 30000,
};

/** S15 load for an unbilled follow-up visit (Rs 300 consultation proposed). */
export function unbilledScreen(
  over: Partial<InvoiceScreen> = {},
): InvoiceScreen {
  return {
    patient: { patientId: 'p-1', code: 'HC-000001', name: 'Test Patient R5' },
    visit: {
      visitId: 'v-1',
      visitAt: '2026-10-16T05:00:00Z',
      visitType: 'follow_up',
    },
    invoice: null,
    proposal: [consultationLine],
    patientDuesPaise: 0,
    upiConfigured: false,
    gstin: null,
    ...over,
  };
}

/** The R5 demo bill: Rs 450 at 5% = Rs 427.50; Rs 200 cash paid. */
export function demoInvoice(over: Partial<InvoiceView> = {}): InvoiceView {
  return {
    invoiceId: 'inv-1',
    rowVersion: 1,
    number: '2026-27/0001',
    fy: '2026-27',
    issuedOn: '2026-10-16',
    status: 'issued',
    lines: [
      { ...consultationLine, id: 'l-1' },
      {
        id: 'l-2',
        kind: 'medicine',
        description: 'Test Remedy 30C',
        qty: 1,
        ratePaise: 15000,
      },
    ],
    discount: { kind: 'percent', basisPoints: 500 },
    totals: {
      lineAmountsPaise: [30000, 15000],
      subtotalPaise: 45000,
      discountPaise: 2250,
      totalPaise: 42750,
    },
    paidPaise: 20000,
    balancePaise: 22750,
    payments: [
      {
        paymentId: 'pay-1',
        paidOn: '2026-10-16',
        amountPaise: 20000,
        mode: 'cash',
        reference: null,
        voided: false,
      },
    ],
    voidReason: null,
    ...over,
  };
}

export function billedScreen(
  inv: Partial<InvoiceView> = {},
  over: Partial<InvoiceScreen> = {},
): InvoiceScreen {
  return unbilledScreen({
    invoice: demoInvoice(inv),
    proposal: null,
    patientDuesPaise: 22750,
    ...over,
  });
}

export const upiQr: UpiQrView = {
  available: true,
  upiUrl:
    'upi://pay?pa=testclinic@upi&pn=Test%20Clinic%20001&am=227.50&cu=INR&tn=Receipt%202026-27%2F0001',
  qrDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
  amountPaise: 22750,
};

export function receiptDoc(over: Partial<ReceiptDoc> = {}): ReceiptDoc {
  const inv = demoInvoice();
  return {
    clinicName: 'Test Clinic 001',
    clinicAddress: '1 Test Street',
    clinicPhone: null,
    gstin: null,
    doctorName: 'Test Doctor 001',
    doctorQualification: 'BHMS',
    doctorRegNo: 'TESTREG-001',
    number: inv.number,
    issuedOn: inv.issuedOn,
    patientName: 'Test Patient R5',
    patientCode: 'HC-000001',
    visitOn: '2026-10-16',
    lines: inv.lines,
    totals: inv.totals,
    discount: inv.discount,
    payments: inv.payments,
    paidPaise: inv.paidPaise,
    balancePaise: inv.balancePaise,
    paidInWords: 'Rupees Two Hundred Only',
    void: false,
    upiQrDataUrl: null,
    ...over,
  };
}

export function patientDues(over: Partial<PatientDues> = {}): PatientDues {
  return {
    patientId: 'p-1',
    duesPaise: 67750,
    openInvoices: [
      {
        invoiceId: 'inv-1',
        number: '2026-27/0001',
        issuedOn: '2026-10-15',
        balancePaise: 22750,
      },
      {
        invoiceId: 'inv-2',
        number: '2026-27/0002',
        issuedOn: '2026-10-16',
        balancePaise: 45000,
      },
    ],
    ...over,
  };
}

export const clearAll: ClearDuesResult = {
  batchId: 'batch-1',
  allocations: [
    { invoiceId: 'inv-1', number: '2026-27/0001', amountPaise: 22750 },
    { invoiceId: 'inv-2', number: '2026-27/0002', amountPaise: 45000 },
  ],
  duesPaise: 0,
};

export function daily(over: Partial<DailyCollection> = {}): DailyCollection {
  return {
    date: '2026-10-16',
    byMode: [
      { mode: 'cash', count: 2, amountPaise: 25000 },
      { mode: 'upi', count: 1, amountPaise: 10000 },
      { mode: 'card', count: 0, amountPaise: 0 },
      { mode: 'other', count: 0, amountPaise: 0 },
    ],
    totalCount: 3,
    totalPaise: 35000,
    outstandingPaise: 13250,
    ...over,
  };
}

function day(date: string, cash = 0, upi = 0, count = 0): DayRow {
  return {
    date,
    cashPaise: cash,
    upiPaise: upi,
    cardPaise: 0,
    otherPaise: 0,
    count,
    totalPaise: cash + upi,
  };
}

/** October 2026: only the 16th has money (Rs 250 cash + Rs 100 UPI). */
export function monthly(): MonthlySummary {
  const days: DayRow[] = [];
  for (let d = 1; d <= 31; d += 1) {
    const date = `2026-10-${String(d).padStart(2, '0')}`;
    days.push(d === 16 ? day(date, 25000, 10000, 3) : day(date));
  }
  return { month: '2026-10', days, total: day('2026-10', 25000, 10000, 3) };
}
