// S16 Reports (docs/ui/S16-reports.md; R5 design §10; BILL-004,
// HC-MVP1-153). Daily collection by mode (fixed 4 rows + TOTAL) with a totals
// card, or the monthly per-day summary with a month total. Grouped by payment
// date; aggregates only (no patient data). Export CSV / Excel goes through
// `report_export`, which opens the OS folder picker itself (the UI never sees
// a path) and returns only the saved file name. Calls ONLY the bindings.

import { useCallback, useEffect, useState } from 'react';

import {
  commands,
  type DailyCollection,
  type ExportFormat,
  type MonthlySummary,
  type ReportSpec,
} from '@/bindings';
import { billingErrorMessage } from '@/billing/billingErrors';
import { rupees } from '@/billing/billChip';
import { modeLabel } from '@/billing/InvoiceScreen';
import { run } from '@/shared/command';
import { formatDate, todayIsoDate } from '@/shared/datetime';
import { formatPaise } from '@/shared/money';
import { t } from '@/shared/strings';

type ReportType = 'daily' | 'monthly';

const BTN =
  'rounded border border-slate-300 px-3 py-1.5 text-base hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:cursor-not-allowed disabled:text-slate-400';
const INPUT =
  'h-9 rounded border border-slate-300 px-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-600';

/** The S16 Reports screen. */
export function ReportsScreen(): JSX.Element {
  const [type, setType] = useState<ReportType>('daily');
  const [date, setDate] = useState(todayIsoDate());
  const [month, setMonth] = useState(todayIsoDate().slice(0, 7));
  const [daily, setDaily] = useState<DailyCollection | null>(null);
  const [monthly, setMonthly] = useState<MonthlySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setExported(null);
    void (async (): Promise<void> => {
      try {
        if (type === 'daily') {
          if (date === '') return;
          const d = await run(commands.reportDailyCollection({ date }));
          if (!cancelled) setDaily(d);
        } else {
          if (month === '') return;
          const m = await run(commands.reportMonthlySummary({ month }));
          if (!cancelled) setMonthly(m);
        }
      } catch (err) {
        if (!cancelled) setError(billingErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [type, date, month]);

  const onExport = useCallback(
    async (format: ExportFormat): Promise<void> => {
      if (exporting) return;
      const report: ReportSpec =
        type === 'daily' ? { type: 'daily', date } : { type: 'monthly', month };
      setExporting(true);
      setError(null);
      setExported(null);
      try {
        const r = await run(commands.reportExport({ report, format }));
        if (r.saved && r.fileName !== null) setExported(r.fileName);
      } catch (err) {
        setError(billingErrorMessage(err));
      } finally {
        setExporting(false);
      }
    },
    [date, exporting, month, type],
  );

  const shownDaily = type === 'daily' && daily !== null ? daily : null;
  const shownMonthly = type === 'monthly' && monthly !== null ? monthly : null;
  const dailyTitle = `${t('reports.daily.title')} ${formatDate(date) ?? ''}`;

  return (
    <section
      data-testid="reports-screen"
      aria-label={t('reports.title')}
      className="flex flex-col gap-4 p-6 text-base text-slate-900"
    >
      <h1 className="text-lg font-semibold">{t('reports.title')}</h1>

      <div className="flex flex-wrap items-end gap-4 border-b border-slate-200 pb-3">
        <div
          data-testid="reports-type"
          role="radiogroup"
          aria-label={t('reports.type')}
          className="flex gap-3 pb-2"
        >
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="reports-type"
              checked={type === 'daily'}
              onChange={() => setType('daily')}
            />
            {t('reports.type.daily')}
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="reports-type"
              checked={type === 'monthly'}
              onChange={() => setType('monthly')}
            />
            {t('reports.type.monthly')}
          </label>
        </div>
        {type === 'daily' ? (
          <label className="flex flex-col gap-1">
            {t('reports.date')}
            <input
              data-testid="reports-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={INPUT}
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            {t('reports.month')}
            <input
              data-testid="reports-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className={INPUT}
            />
          </label>
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            data-testid="reports-export-csv"
            disabled={exporting}
            onClick={() => void onExport('csv')}
            className={BTN}
          >
            {t('reports.exportCsv')}
          </button>
          <button
            type="button"
            data-testid="reports-export-xlsx"
            disabled={exporting}
            onClick={() => void onExport('xlsx')}
            className={BTN}
          >
            {t('reports.exportXlsx')}
          </button>
        </div>
      </div>

      {exported !== null ? (
        <p
          data-testid="reports-export-done"
          role="status"
          className="text-emerald-800"
        >
          {t('reports.exportDone')} {exported}
        </p>
      ) : null}
      {error !== null ? (
        <p data-testid="reports-error" role="alert" className="text-red-700">
          {error}
        </p>
      ) : null}

      {shownDaily !== null ? (
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold">{dailyTitle}</h2>
          {shownDaily.totalCount === 0 ? (
            <p data-testid="reports-empty" className="text-slate-600">
              {t('reports.empty')}
            </p>
          ) : null}
          <div className="flex flex-wrap items-start gap-6">
            <table className="w-96 border-collapse">
              <thead>
                <tr className="border-b border-slate-300 text-left">
                  <th className="py-1 pr-2">{t('reports.col.mode')}</th>
                  <th className="py-1 pr-2 text-right">
                    {t('reports.col.count')}
                  </th>
                  <th className="py-1 text-right">{t('reports.col.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {shownDaily.byMode.map((r) => (
                  <tr
                    key={r.mode}
                    data-testid={`reports-mode-row-${r.mode}`}
                    className="border-b border-slate-100"
                  >
                    <td className="py-1 pr-2">{modeLabel(r.mode)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {r.count}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {formatPaise(r.amountPaise)}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1 pr-2">{t('reports.total')}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {shownDaily.totalCount}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatPaise(shownDaily.totalPaise)}
                  </td>
                </tr>
              </tbody>
            </table>
            <dl
              data-testid="reports-totals"
              className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 rounded border border-slate-200 p-3"
            >
              <dt>{t('reports.totalCollected')}</dt>
              <dd
                data-testid="reports-total-collected"
                className="text-right tabular-nums"
              >
                {rupees(shownDaily.totalPaise)}
              </dd>
              <dt>{t('reports.totalCount')}</dt>
              <dd
                data-testid="reports-total-count"
                className="text-right tabular-nums"
              >
                {shownDaily.totalCount}
              </dd>
              <dt>{t('reports.outstanding')}</dt>
              <dd
                data-testid="reports-outstanding"
                className="text-right tabular-nums"
              >
                {rupees(shownDaily.outstandingPaise)}
              </dd>
            </dl>
          </div>
        </div>
      ) : null}

      {shownMonthly !== null ? (
        <table className="w-full max-w-4xl border-collapse">
          <caption className="mb-1 text-left font-semibold">
            {t('reports.monthly.title')}
          </caption>
          <thead>
            <tr className="border-b border-slate-300 text-left">
              <th className="py-1 pr-2">{t('reports.col.date')}</th>
              <th className="py-1 pr-2 text-right">{t('billing.mode.cash')}</th>
              <th className="py-1 pr-2 text-right">{t('billing.mode.upi')}</th>
              <th className="py-1 pr-2 text-right">{t('billing.mode.card')}</th>
              <th className="py-1 pr-2 text-right">
                {t('billing.mode.other')}
              </th>
              <th className="py-1 pr-2 text-right">{t('reports.col.count')}</th>
              <th className="py-1 text-right">{t('reports.col.total')}</th>
            </tr>
          </thead>
          <tbody>
            {shownMonthly.days.map((d) => (
              <tr
                key={d.date}
                data-testid={`reports-day-row-${d.date}`}
                className="border-b border-slate-100"
              >
                <td className="py-1 pr-2">{formatDate(d.date) ?? d.date}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {formatPaise(d.cashPaise)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {formatPaise(d.upiPaise)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {formatPaise(d.cardPaise)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {formatPaise(d.otherPaise)}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{d.count}</td>
                <td className="py-1 text-right tabular-nums">
                  {formatPaise(d.totalPaise)}
                </td>
              </tr>
            ))}
            <tr data-testid="reports-month-total" className="font-semibold">
              <td className="py-1 pr-2">{t('reports.total')}</td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {formatPaise(shownMonthly.total.cashPaise)}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {formatPaise(shownMonthly.total.upiPaise)}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {formatPaise(shownMonthly.total.cardPaise)}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {formatPaise(shownMonthly.total.otherPaise)}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {shownMonthly.total.count}
              </td>
              <td className="py-1 text-right tabular-nums">
                {formatPaise(shownMonthly.total.totalPaise)}
              </td>
            </tr>
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
