// r5-review-2/15/16/17 (design R5 §7, "Esc never discards silently"):
// leaving a dirty S15 invoice by ANY route — the AppBar Back, Alt+Left, every
// side-nav item, the status-bar backup chip, the search overlay (F2, Ctrl+K,
// the top-bar box; recent row and "New patient"), the screen's own Back and
// the UPI hint's "Open settings" — must show the invoice's own Save/Discard
// prompt and stay put until the doctor decides; Discard then goes to the
// target. Keys that are not exits on S15 leave the bill alone. Lock (Ctrl+L,
// the lock button, idle) never prompts (SET-004) but keeps the unsaved bill in
// memory and gives it back after the unlock. The exit list is documented in
// .worklog/HC-MVP1-dev-r5-settings/handoffs/R5-leave-guard-exits.md.
//
// CUT: the REAL <AppShell /> + real <InvoiceScreen />. The ONLY fake is the
// generated binding `@/bindings` (R-TEST-002). Synthetic data only.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  act,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  invoiceGetForVisit,
  invoiceComputeTotals,
  invoiceSave,
  authUnlock,
  patientSearch,
} = vi.hoisted(() => ({
  invoiceGetForVisit: vi.fn(),
  invoiceComputeTotals: vi.fn(),
  invoiceSave: vi.fn(),
  authUnlock: vi.fn(),
  patientSearch: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    setupGetState: vi.fn(async () => ({
      completed: true,
      currentStep: 4,
      dataDir: '/tmp/hc',
    })),
    authGetLockState: vi.fn(async () => ({
      locked: false,
      autolockMinutes: 15,
    })),
    settingsGet: vi.fn(() => new Promise(() => {})),
    appInfo: vi.fn(async () => ({
      name: 'HomeoClinic',
      version: '0.1.0',
      build_profile: 'debug' as const,
    })),
    getBackupStatus: vi.fn(() => new Promise(() => {})),
    getLicenceStatus: vi.fn(() => new Promise(() => {})),
    patientRecent: vi.fn(async () => ({
      results: [
        {
          patientId: 'p-9',
          code: 'HC-000009',
          name: 'Recent Patient',
          ageLabel: '40y',
          sex: null,
          mobile: null,
          city: null,
          lastVisitAt: null,
          duesPaise: 0,
          matchType: '',
          photoPath: null,
        },
      ],
    })),
    patientSearch,
    authUnlock,
    todayGetOverview: vi.fn(async () => ({
      dueToday: [],
      overdue: [],
      registeredToday: [],
      backupWarning: null,
      licenceReminder: null,
    })),
    // The dashboard the shell Back lands on: never resolves (not under test).
    patientGetDashboard: vi.fn(() => new Promise(() => {})),
    patientTouchRecent: vi.fn(() => new Promise(() => {})),
    invoiceGetForVisit,
    invoiceComputeTotals,
    invoiceSave,
    paymentAdd: vi.fn(),
    paymentVoid: vi.fn(),
    invoiceVoid: vi.fn(),
    invoiceUpiQr: vi.fn(() => new Promise(() => {})),
  },
}));

import { clearInvoiceDraft } from '@/billing/invoiceDraft';
import { billedScreen, ok } from '@/test/billingFixtures';
import { AppShell } from './AppShell';

const INVOICE_HASH = '#/patient/p-1/visit/v-1/invoice';

/** Boot the shell, then open the S15 invoice of visit v-1. */
async function openInvoice(): Promise<void> {
  render(<AppShell />);
  await screen.findByTestId('today-screen');
  act(() => {
    window.location.hash = INVOICE_HASH;
  });
  await screen.findByTestId('invoice-number');
}

/** Make the invoice dirty with an unsaved payment (r5-review-1). */
async function typePayment(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('invoice-paid'), '100');
  // Blur the field so Alt+Left is not swallowed by the text-control rule.
  act(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
  invoiceGetForVisit.mockReset();
  invoiceGetForVisit.mockResolvedValue(ok(billedScreen()));
  invoiceComputeTotals.mockReset();
  invoiceComputeTotals.mockResolvedValue(ok(billedScreen().invoice!.totals));
  invoiceSave.mockReset();
  authUnlock.mockReset();
  authUnlock.mockResolvedValue(ok({ ok: true }));
  patientSearch.mockReset();
  patientSearch.mockResolvedValue(ok({ results: [], nextCursor: null }));
  clearInvoiceDraft();
});

type User = ReturnType<typeof userEvent.setup>;

/** Open the search overlay with `open`, then pick the recent patient. */
function searchRecent(
  open: (user: User) => Promise<void> | void,
): (user: User) => Promise<void> {
  return async (user: User): Promise<void> => {
    await open(user);
    await user.click(await screen.findByTestId('search-recent-row'));
  };
}

/**
 * EVERY exit reachable while S15 is mounted (r5-review-15/16 close the
 * class). Each row: how the doctor leaves, and where Discard must then land.
 */
const EXITS: ReadonlyArray<{
  readonly exit: string;
  readonly leave: (user: User) => Promise<void>;
  readonly target: string;
}> = [
  {
    exit: 'AppBar Back',
    leave: async (user) => user.click(screen.getByTestId('app-bar-back')),
    target: '#/patients?id=p-1',
  },
  {
    exit: 'Alt+Left',
    leave: async () => {
      fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });
    },
    target: '#/patients?id=p-1',
  },
  {
    exit: 'side nav Today',
    leave: async (user) => user.click(screen.getByTestId('nav-today')),
    target: '#/today',
  },
  {
    exit: 'side nav Patients',
    leave: async (user) => user.click(screen.getByTestId('nav-patients')),
    target: '#/patients',
  },
  {
    exit: 'side nav Reports',
    leave: async (user) => user.click(screen.getByTestId('nav-reports')),
    target: '#/reports',
  },
  {
    exit: 'side nav Backup',
    leave: async (user) => user.click(screen.getByTestId('nav-backup')),
    target: '#/backup',
  },
  {
    exit: 'side nav Settings',
    leave: async (user) => user.click(screen.getByTestId('nav-settings')),
    target: '#/settings',
  },
  {
    // r5-review-15
    exit: 'status-bar backup chip',
    leave: async (user) => user.click(screen.getByTestId('status-backup')),
    target: '#/backup',
  },
  {
    exit: 'search overlay via F2, recent patient',
    leave: searchRecent(() => {
      fireEvent.keyDown(window, { key: 'F2' });
    }),
    target: '#/patients?id=p-9',
  },
  {
    exit: 'search overlay via Ctrl+K, recent patient',
    leave: searchRecent(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    }),
    target: '#/patients?id=p-9',
  },
  {
    exit: 'search overlay via the top-bar box, recent patient',
    leave: searchRecent(async (user) => {
      await user.click(screen.getByTestId('topbar-search'));
    }),
    target: '#/patients?id=p-9',
  },
  {
    exit: 'search overlay "New patient" (no results)',
    leave: async (user) => {
      fireEvent.keyDown(window, { key: 'F2' });
      await user.type(await screen.findByTestId('search-input'), 'zzz');
      await user.click(await screen.findByTestId('search-empty-new-patient'));
    },
    target: '#/patients?view=new',
  },
  {
    exit: "the invoice's own Back",
    leave: async (user) => user.click(screen.getByTestId('invoice-back')),
    target: '#/patients?id=p-1',
  },
  {
    // r5-review-16
    exit: 'UPI hint "Open settings" link',
    leave: async (user) =>
      user.click(screen.getByTestId('invoice-upi-open-settings')),
    target: '#/settings',
  },
];

describe('Every exit from a dirty invoice asks Save / Discard (r5-review-15/16)', () => {
  it.each(EXITS)(
    '$exit: prompts and stays, then Discard goes to $target',
    async ({ leave, target }) => {
      const user = userEvent.setup();
      await openInvoice();
      await typePayment(user);

      await leave(user);

      expect(
        await screen.findByTestId('invoice-leave-dialog'),
      ).toBeInTheDocument();
      expect(window.location.hash).toBe(INVOICE_HASH);
      expect(screen.getByTestId('invoice-paid')).toHaveValue('100');

      await user.click(screen.getByTestId('invoice-leave-discard'));
      await waitFor(() => expect(window.location.hash).toBe(target));
      expect(screen.queryByTestId('invoice-leave-dialog')).toBeNull();
    },
  );

  it.each(EXITS)(
    '$exit on a CLEAN invoice leaves at once to $target',
    async ({ leave, target }) => {
      const user = userEvent.setup();
      await openInvoice();

      await leave(user);

      await waitFor(() => expect(window.location.hash).toBe(target));
      expect(screen.queryByTestId('invoice-leave-dialog')).toBeNull();
    },
  );
});

/** Keys and buttons on S15 that are NOT exits: the bill stays as typed. */
const NOT_EXITS: ReadonlyArray<{
  readonly key: string;
  readonly press: (user: User) => Promise<void> | void;
}> = [
  {
    key: 'F1 (help)',
    press: () => void fireEvent.keyDown(window, { key: 'F1' }),
  },
  { key: 'F3', press: () => void fireEvent.keyDown(window, { key: 'F3' }) },
  { key: 'F4', press: () => void fireEvent.keyDown(window, { key: 'F4' }) },
  { key: 'F5', press: () => void fireEvent.keyDown(window, { key: 'F5' }) },
  { key: 'F8', press: () => void fireEvent.keyDown(window, { key: 'F8' }) },
  {
    key: 'Ctrl+P',
    press: () => void fireEvent.keyDown(window, { key: 'p', ctrlKey: true }),
  },
  {
    key: 'Print receipt button (disabled while unsaved)',
    press: async (user) => {
      const print = screen.getByTestId('invoice-print');
      expect(print).toBeDisabled();
      await user.click(print);
    },
  },
];

describe('Non-exits on a dirty invoice leave it alone', () => {
  it.each(NOT_EXITS)(
    '$key keeps the bill and its typed payment',
    async ({ press }) => {
      const user = userEvent.setup();
      await openInvoice();
      await typePayment(user);

      await press(user);

      expect(screen.queryByTestId('invoice-leave-dialog')).toBeNull();
      expect(window.location.hash).toBe(INVOICE_HASH);
      expect(screen.getByTestId('invoice-paid')).toHaveValue('100');
    },
  );
});

/** Unlock with a PIN on the lock screen. */
async function unlock(user: User): Promise<void> {
  await user.type(await screen.findByTestId('lock-pin'), '1234');
  await user.click(screen.getByTestId('lock-unlock'));
}

describe('Lock on a dirty invoice never prompts and never loses the bill (r5-review-17)', () => {
  const LOCKS: ReadonlyArray<{
    readonly lock: string;
    readonly press: (user: User) => Promise<void> | void;
  }> = [
    {
      lock: 'Ctrl+L',
      press: () => void fireEvent.keyDown(window, { key: 'l', ctrlKey: true }),
    },
    {
      lock: 'the top-bar lock button',
      press: async (user) => user.click(screen.getByTestId('topbar-lock')),
    },
  ];

  it.each(LOCKS)(
    '$lock locks at once; after the unlock the typed payment is back',
    async ({ press }) => {
      const user = userEvent.setup();
      await openInvoice();
      await typePayment(user);

      await press(user);

      expect(await screen.findByTestId('lock-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('invoice-leave-dialog')).toBeNull();

      await unlock(user);

      expect(
        await screen.findByTestId('invoice-draft-notice'),
      ).toHaveTextContent(/kept while HomeoClinic was locked/i);
      expect(window.location.hash).toBe(INVOICE_HASH);
      expect(screen.getByTestId('invoice-paid')).toHaveValue('100');
    },
  );

  it('idle auto-lock locks without a prompt and keeps the bill too', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({
        advanceTimers: vi.advanceTimersByTime.bind(vi),
      });
      await openInvoice();
      await typePayment(user);

      act(() => {
        vi.advanceTimersByTime(15 * 60 * 1000 + 1);
      });

      expect(await screen.findByTestId('lock-screen')).toBeInTheDocument();
      await unlock(user);

      expect(
        await screen.findByTestId('invoice-draft-notice'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('invoice-paid')).toHaveValue('100');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a bill changed while locked is not overwritten; the doctor is told', async () => {
    const user = userEvent.setup();
    await openInvoice();
    await typePayment(user);
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
    await screen.findByTestId('lock-screen');

    invoiceGetForVisit.mockResolvedValue(ok(billedScreen({ rowVersion: 2 })));
    await unlock(user);

    expect(await screen.findByTestId('invoice-draft-notice')).toHaveTextContent(
      /could not be put back/i,
    );
    expect(screen.getByTestId('invoice-paid')).toHaveValue('');
  });

  it('a lock on a clean invoice holds nothing: the unlock opens Today', async () => {
    const user = userEvent.setup();
    await openInvoice();
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
    await screen.findByTestId('lock-screen');

    await unlock(user);

    expect(await screen.findByTestId('today-screen')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/today');
  });
});

describe('Shell leave guard on a dirty invoice (r5-review-2)', () => {
  it('AppBar Back on a dirty invoice shows the Save/Discard prompt and stays', async () => {
    const user = userEvent.setup();
    await openInvoice();
    await typePayment(user);

    await user.click(screen.getByTestId('app-bar-back'));

    expect(screen.getByTestId('invoice-leave-dialog')).toBeInTheDocument();
    expect(window.location.hash).toBe(INVOICE_HASH);
  });

  it('Alt+Left on a dirty invoice shows the prompt and stays', async () => {
    const user = userEvent.setup();
    await openInvoice();
    await typePayment(user);

    fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });

    expect(
      await screen.findByTestId('invoice-leave-dialog'),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe(INVOICE_HASH);
  });

  it('the side nav on a dirty invoice shows the prompt; Discard then goes there', async () => {
    const user = userEvent.setup();
    await openInvoice();
    await typePayment(user);

    await user.click(screen.getByTestId('nav-today'));
    expect(screen.getByTestId('invoice-leave-dialog')).toBeInTheDocument();
    expect(window.location.hash).toBe(INVOICE_HASH);

    await user.click(screen.getByTestId('invoice-leave-discard'));
    expect(await screen.findByTestId('today-screen')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/today');
  });

  it('Stay keeps the doctor on the invoice with the typed payment intact', async () => {
    const user = userEvent.setup();
    await openInvoice();
    await typePayment(user);

    await user.click(screen.getByTestId('nav-reports'));
    await user.click(screen.getByTestId('invoice-leave-stay'));

    expect(screen.queryByTestId('invoice-leave-dialog')).toBeNull();
    expect(window.location.hash).toBe(INVOICE_HASH);
    expect(screen.getByTestId('invoice-paid')).toHaveValue('100');
  });

  it('Save in the shell-raised prompt saves, then goes where the doctor asked', async () => {
    const user = userEvent.setup();
    invoiceSave.mockResolvedValue(
      ok(billedScreen({ paidPaise: 30000, balancePaise: 12750 })),
    );
    await openInvoice();
    await typePayment(user);

    await user.click(screen.getByTestId('nav-today'));
    await user.click(screen.getByTestId('invoice-leave-save'));

    await waitFor(() => expect(invoiceSave).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('today-screen')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/today');
  });

  it('AppBar Back on a clean invoice leaves at once (no prompt)', async () => {
    const user = userEvent.setup();
    await openInvoice();

    await user.click(screen.getByTestId('app-bar-back'));

    expect(screen.queryByTestId('invoice-leave-dialog')).toBeNull();
    await waitFor(() => expect(window.location.hash).toBe('#/patients?id=p-1'));
  });
});
