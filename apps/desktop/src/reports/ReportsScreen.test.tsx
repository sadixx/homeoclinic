// R5 — S16 Reports (docs/ui/S16-reports.md; R5 design §10; HC-MVP1-153,
// BILL-004). Daily collection by mode (fixed 4 rows) + totals card, monthly
// per-day summary + month total, CSV and Excel export through the backend
// picker (the UI never sees a path).
//
// CUT: the REAL <ReportsScreen />. Fake: `@/bindings` only (R-TEST-002).
// Aggregates only (no patient data). RED: the §13 stub renders nothing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { reportDailyCollection, reportMonthlySummary, reportExport } =
  vi.hoisted(() => ({
    reportDailyCollection: vi.fn(),
    reportMonthlySummary: vi.fn(),
    reportExport: vi.fn(),
  }));

vi.mock('@/bindings', () => ({
  commands: { reportDailyCollection, reportMonthlySummary, reportExport },
}));

import { todayIsoDate } from '@/shared/datetime';
import { daily, ok, monthly } from '@/test/billingFixtures';
import { ReportsScreen } from './ReportsScreen';

beforeEach(() => {
  reportDailyCollection.mockReset();
  reportDailyCollection.mockResolvedValue(ok(daily()));
  reportMonthlySummary.mockReset();
  reportMonthlySummary.mockResolvedValue(ok(monthly()));
  reportExport.mockReset();
  reportExport.mockResolvedValue(
    ok({
      saved: true,
      fileName: 'collection-daily-2026-10-16.csv',
      rowCount: 4,
    }),
  );
});

async function switchToMonthly(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    within(screen.getByTestId('reports-type')).getByRole('radio', {
      name: /month/i,
    }),
  );
}

describe('S16 Reports — daily collection', () => {
  it("opens on today's daily collection with one row per mode and the totals", async () => {
    render(<ReportsScreen />);
    await waitFor(() =>
      expect(reportDailyCollection).toHaveBeenCalledWith({
        date: todayIsoDate(),
      }),
    );
    const cash = await screen.findByTestId('reports-mode-row-cash');
    expect(cash).toHaveTextContent('2');
    expect(cash).toHaveTextContent('250.00');
    expect(screen.getByTestId('reports-mode-row-upi')).toHaveTextContent(
      '100.00',
    );
    expect(screen.getByTestId('reports-mode-row-card')).toHaveTextContent(
      '0.00',
    );
    expect(screen.getByTestId('reports-mode-row-other')).toHaveTextContent(
      '0.00',
    );
    expect(screen.getByTestId('reports-total-collected')).toHaveTextContent(
      '350.00',
    );
    expect(screen.getByTestId('reports-total-count')).toHaveTextContent('3');
    expect(screen.getByTestId('reports-outstanding')).toHaveTextContent(
      '132.50',
    );
  });

  it('reloads for a picked date', async () => {
    render(<ReportsScreen />);
    await screen.findByTestId('reports-mode-row-cash');
    fireEvent.change(screen.getByTestId('reports-date'), {
      target: { value: '2026-10-15' },
    });
    await waitFor(() =>
      expect(reportDailyCollection).toHaveBeenLastCalledWith({
        date: '2026-10-15',
      }),
    );
  });

  it('shows the empty state for a day with no collections, export still enabled', async () => {
    reportDailyCollection.mockResolvedValue(
      ok(
        daily({
          byMode: daily().byMode.map((m) => ({
            ...m,
            count: 0,
            amountPaise: 0,
          })),
          totalCount: 0,
          totalPaise: 0,
          outstandingPaise: 0,
        }),
      ),
    );
    render(<ReportsScreen />);
    expect(await screen.findByTestId('reports-empty')).toHaveTextContent(
      /no collections for this date/i,
    );
    expect(screen.getByTestId('reports-export-csv')).toBeEnabled();
    expect(screen.getByTestId('reports-export-xlsx')).toBeEnabled();
  });
});

describe('S16 Reports — monthly summary', () => {
  it('lists every day (DD-MM-YYYY) and the month total', async () => {
    const user = userEvent.setup();
    render(<ReportsScreen />);
    await screen.findByTestId('reports-mode-row-cash');
    await switchToMonthly(user);
    fireEvent.change(screen.getByTestId('reports-month'), {
      target: { value: '2026-10' },
    });
    await waitFor(() =>
      expect(reportMonthlySummary).toHaveBeenLastCalledWith({
        month: '2026-10',
      }),
    );
    const d16 = await screen.findByTestId('reports-day-row-2026-10-16');
    expect(d16).toHaveTextContent('16-10-2026');
    expect(d16).toHaveTextContent('250.00');
    expect(d16).toHaveTextContent('100.00');
    expect(d16).toHaveTextContent('350.00');
    expect(screen.getAllByTestId(/^reports-day-row-/)).toHaveLength(31);
    expect(screen.getByTestId('reports-month-total')).toHaveTextContent(
      '350.00',
    );
  });
});

describe('S16 Reports — export', () => {
  it('Export CSV exports the shown daily report and confirms the file name', async () => {
    const user = userEvent.setup();
    render(<ReportsScreen />);
    await screen.findByTestId('reports-mode-row-cash');
    await user.click(screen.getByTestId('reports-export-csv'));
    await waitFor(() =>
      expect(reportExport).toHaveBeenCalledWith({
        report: { type: 'daily', date: todayIsoDate() },
        format: 'csv',
      }),
    );
    expect(await screen.findByTestId('reports-export-done')).toHaveTextContent(
      'collection-daily-2026-10-16.csv',
    );
  });

  it('Export Excel exports the shown monthly report as xlsx', async () => {
    const user = userEvent.setup();
    reportExport.mockResolvedValue(
      ok({
        saved: true,
        fileName: 'collection-monthly-2026-10.xlsx',
        rowCount: 31,
      }),
    );
    render(<ReportsScreen />);
    await screen.findByTestId('reports-mode-row-cash');
    await switchToMonthly(user);
    fireEvent.change(screen.getByTestId('reports-month'), {
      target: { value: '2026-10' },
    });
    await screen.findByTestId('reports-day-row-2026-10-16');
    await user.click(screen.getByTestId('reports-export-xlsx'));
    await waitFor(() =>
      expect(reportExport).toHaveBeenCalledWith({
        report: { type: 'monthly', month: '2026-10' },
        format: 'xlsx',
      }),
    );
    expect(await screen.findByTestId('reports-export-done')).toHaveTextContent(
      'collection-monthly-2026-10.xlsx',
    );
  });

  it('a cancelled folder picker shows nothing', async () => {
    const user = userEvent.setup();
    reportExport.mockResolvedValue(
      ok({ saved: false, fileName: null, rowCount: 0 }),
    );
    render(<ReportsScreen />);
    await screen.findByTestId('reports-mode-row-cash');
    await user.click(screen.getByTestId('reports-export-csv'));
    await waitFor(() => expect(reportExport).toHaveBeenCalled());
    expect(screen.queryByTestId('reports-export-done')).toBeNull();
  });
});
