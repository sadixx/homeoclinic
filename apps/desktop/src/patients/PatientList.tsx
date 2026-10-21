// S05 Patient list and filters (docs/ui/S05-patient-list.md; HC-MVP1-050/051/
// 052). PSR-008/009/010/011.
//
// Calls ONLY the generated typed bindings (UI -> typed commands only; never
// SQL or raw filesystem paths). Every control / asserted value carries its
// spec data-testid (R-UI-003); all visible text comes from en.json (R-UI-007).
//
// R2 slice (R-DEL-002): the ACTIVE filters are the ones that only need patient
// + visit columns — last-visit-older-than, next follow-up (today/overdue/
// range), age, sex, city and dues > 0 — plus sort and Export CSV. The filters
// that depend on later data (Remedy, Diagnosis, Potency, Case-note, Tags) and
// Save filter RENDER but are DISABLED with a no-dead-end note (R3/R4), so the
// UI contract is frozen without leading the doctor anywhere.
//
// Results are keyset-paginated (20 rows, "load more" by cursor — no OFFSET
// scans, per the S05 data-model note); a true windowing library is deferred
// (none is a dependency and MVP1 adds no new ones without justification).

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  commands,
  type PatientFilter,
  type PatientSort,
  type SearchRow,
  type SortField,
  type SortDir,
} from '@/bindings';
import { run } from '@/shared/command';
import { formatDate } from '@/shared/datetime';
import { formatPaise } from '@/shared/money';
import { formatCount } from '@/shared/number';
import { t } from '@/shared/strings';

/** First-page / page size (conventions §4: 20 rows first, more on scroll). */
const PAGE_LIMIT = 20;

export interface PatientListProps {
  /** Open a patient's dashboard (S07). */
  readonly onOpenPatient: (patientId: string) => void;
  /** Start a new registration from the empty state (S06). */
  readonly onNewPatient?: () => void;
}

/** Editable filter form state (strings; parsed into PatientFilter on apply). */
interface FilterForm {
  lastVisitOlderThanDays: string;
  followup: 'none' | 'today' | 'overdue' | 'range';
  followupFrom: string;
  followupTo: string;
  ageMin: string;
  ageMax: string;
  sex: string;
  city: string;
  duesPositive: boolean;
}

const EMPTY_FILTERS: FilterForm = {
  lastVisitOlderThanDays: '',
  followup: 'none',
  followupFrom: '',
  followupTo: '',
  ageMin: '',
  ageMax: '',
  sex: '',
  city: '',
  duesPositive: false,
};

/** Build the typed, fully-populated {@link PatientFilter} from the form. */
function toPatientFilter(form: FilterForm): PatientFilter {
  const num = (s: string): number | null => {
    const n = Number(s.trim());
    return s.trim() === '' || !Number.isFinite(n) ? null : n;
  };
  return {
    visitFrom: null,
    visitTo: null,
    lastVisitOlderThanDays: num(form.lastVisitOlderThanDays),
    followup: form.followup,
    followupFrom:
      form.followup === 'range' && form.followupFrom !== ''
        ? form.followupFrom
        : null,
    followupTo:
      form.followup === 'range' && form.followupTo !== ''
        ? form.followupTo
        : null,
    ageMin: num(form.ageMin),
    ageMax: num(form.ageMax),
    sex: form.sex === '' ? null : form.sex,
    city: form.city.trim() === '' ? null : form.city.trim(),
    tags: null,
    diagnosisText: null,
    remedyId: null,
    potency: null,
    duesPositive: form.duesPositive ? true : null,
    casenoteText: null,
  };
}

/** True when any R2-active filter departs from its empty default. */
function isFiltered(form: FilterForm): boolean {
  return (
    form.lastVisitOlderThanDays.trim() !== '' ||
    form.followup !== 'none' ||
    form.ageMin.trim() !== '' ||
    form.ageMax.trim() !== '' ||
    form.sex !== '' ||
    form.city.trim() !== '' ||
    form.duesPositive
  );
}

/** The S05 patient list. */
export function PatientList({
  onOpenPatient,
  onNewPatient,
}: PatientListProps): JSX.Element {
  const [form, setForm] = useState<FilterForm>(EMPTY_FILTERS);
  // The filter/sort actually in force (only Apply / a sort header commits).
  const [appliedFilters, setAppliedFilters] = useState<PatientFilter>(() =>
    toPatientFilter(EMPTY_FILTERS),
  );
  const [sort, setSort] = useState<PatientSort>({ field: 'name', dir: 'asc' });
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [exported, setExported] = useState(false);
  // True once at least one query has returned, so an empty result shows the
  // right empty state rather than the first-load skeleton.
  const [queried, setQueried] = useState(false);
  // Whether the in-force query carries any active filter (drives which empty
  // state is shown; captured at query time so it is stable across edits).
  const [filteredQuery, setFilteredQuery] = useState(false);

  // Run one fresh query (first page) for the given filter/sort.
  const query = useCallback(
    async (
      filters: PatientFilter,
      nextSort: PatientSort,
      wasFiltered: boolean,
    ): Promise<void> => {
      setLoading(true);
      setErrored(false);
      setFilteredQuery(wasFiltered);
      try {
        const res = await run(
          commands.patientListQuery({
            filters,
            sort: nextSort,
            cursor: null,
            limit: PAGE_LIMIT,
          }),
        );
        setRows(res.rows);
        setTotal(res.total);
        setNextCursor(res.nextCursor);
      } catch {
        setErrored(true);
        setRows([]);
      } finally {
        setLoading(false);
        setQueried(true);
      }
    },
    [],
  );

  // Initial load (default filters + name-asc sort).
  const initial = useRef(true);
  useEffect(() => {
    if (!initial.current) return;
    initial.current = false;
    void query(
      toPatientFilter(EMPTY_FILTERS),
      { field: 'name', dir: 'asc' },
      false,
    );
  }, [query]);

  const onApply = useCallback((): void => {
    const filters = toPatientFilter(form);
    setAppliedFilters(filters);
    setExported(false);
    void query(filters, sort, isFiltered(form));
  }, [form, sort, query]);

  const onClear = useCallback((): void => {
    setForm(EMPTY_FILTERS);
    const filters = toPatientFilter(EMPTY_FILTERS);
    setAppliedFilters(filters);
    setExported(false);
    void query(filters, sort, false);
  }, [sort, query]);

  // Sort header: toggle direction when the same field is re-activated.
  const onSort = useCallback(
    (field: SortField): void => {
      const dir: SortDir =
        sort.field === field && sort.dir === 'asc' ? 'desc' : 'asc';
      const nextSort: PatientSort = { field, dir };
      setSort(nextSort);
      void query(appliedFilters, nextSort, filteredQuery);
    },
    [sort, appliedFilters, filteredQuery, query],
  );

  const onLoadMore = useCallback(async (): Promise<void> => {
    if (nextCursor === null || loading) return;
    setLoading(true);
    try {
      const res = await run(
        commands.patientListQuery({
          filters: appliedFilters,
          sort,
          cursor: nextCursor,
          limit: PAGE_LIMIT,
        }),
      );
      setRows((prev) => [...prev, ...res.rows]);
      setNextCursor(res.nextCursor);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, [nextCursor, loading, appliedFilters, sort]);

  const onExport = useCallback(async (): Promise<void> => {
    try {
      await run(
        commands.patientListExportCsv({ filters: appliedFilters, sort }),
      );
      setExported(true);
    } catch {
      setErrored(true);
    }
  }, [appliedFilters, sort]);

  const set = useCallback(
    <K extends keyof FilterForm>(key: K, value: FilterForm[K]): void => {
      setForm((f) => ({ ...f, [key]: value }));
    },
    [],
  );

  const empty = queried && !loading && !errored && rows.length === 0;
  const showEmptyNone = empty && !filteredQuery;
  const showEmptyNoMatch = empty && filteredQuery;

  return (
    <section
      aria-label={t('patient.list.title')}
      className="flex flex-col gap-3 p-6 text-[0.875rem] text-slate-900"
    >
      <header className="flex items-center justify-between">
        <h1 data-testid="patient-list-title" className="text-lg font-semibold">
          {t('patient.list.title')}
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="patient-list-save-filter"
            disabled
            aria-disabled="true"
            title={t('patient.list.saveFilter.deferred')}
            className="cursor-not-allowed rounded border border-slate-200 px-3 py-1.5 text-slate-400"
          >
            {t('patient.list.saveFilter')}
          </button>
          <button
            type="button"
            data-testid="patient-list-export"
            onClick={() => void onExport()}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('patient.list.exportCsv')}
          </button>
        </div>
      </header>

      {exported ? (
        <p
          role="status"
          data-testid="patient-list-export-done"
          className="text-sm text-green-700"
        >
          {t('patient.list.export.done')}
        </p>
      ) : null}

      <div className="flex gap-4">
        {/* Filter panel */}
        <aside
          aria-label={t('patient.list.filters.title')}
          className="flex w-64 flex-none flex-col gap-3 rounded border border-slate-200 p-3"
        >
          <h2 className="text-xs font-semibold uppercase text-slate-500">
            {t('patient.list.filters.title')}
          </h2>

          <label className="flex flex-col gap-1 text-xs text-slate-600">
            {t('patient.list.filter.lastVisitOlder')}
            <input
              data-testid="patient-list-filter-lastvisit-older"
              inputMode="numeric"
              value={form.lastVisitOlderThanDays}
              onChange={(e) => set('lastVisitOlderThanDays', e.target.value)}
              className="input"
            />
          </label>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs text-slate-600">
              {t('patient.list.filter.followup')}
            </legend>
            <div
              data-testid="patient-list-filter-followup"
              role="radiogroup"
              aria-label={t('patient.list.filter.followup')}
              className="flex flex-wrap gap-2 text-xs"
            >
              {(
                [
                  ['today', t('patient.list.filter.followup.today')],
                  ['overdue', t('patient.list.filter.followup.overdue')],
                  ['range', t('patient.list.filter.followup.range')],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="patient-list-followup"
                    value={value}
                    checked={form.followup === value}
                    onChange={() => set('followup', value)}
                  />
                  {label}
                </label>
              ))}
            </div>
            {form.followup === 'range' ? (
              <div
                data-testid="patient-list-filter-followup-range"
                className="flex items-center gap-1 text-xs"
              >
                <input
                  type="date"
                  aria-label={t('patient.list.filter.followup.range')}
                  value={form.followupFrom}
                  onChange={(e) => set('followupFrom', e.target.value)}
                  className="input"
                />
                <span>{t('patient.list.filter.ageTo')}</span>
                <input
                  type="date"
                  aria-label={t('patient.list.filter.followup.range')}
                  value={form.followupTo}
                  onChange={(e) => set('followupTo', e.target.value)}
                  className="input"
                />
              </div>
            ) : null}
          </fieldset>

          <div
            data-testid="patient-list-filter-age"
            className="flex items-end gap-1 text-xs text-slate-600"
          >
            <label className="flex flex-1 flex-col gap-1">
              {t('patient.list.filter.age')}
              <input
                inputMode="numeric"
                aria-label={t('patient.list.filter.age')}
                value={form.ageMin}
                onChange={(e) => set('ageMin', e.target.value)}
                className="input"
              />
            </label>
            <span className="pb-2">{t('patient.list.filter.ageTo')}</span>
            <label className="flex flex-1 flex-col gap-1">
              <span className="sr-only">{t('patient.list.filter.ageTo')}</span>
              <input
                inputMode="numeric"
                aria-label={t('patient.list.filter.ageTo')}
                value={form.ageMax}
                onChange={(e) => set('ageMax', e.target.value)}
                className="input"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs text-slate-600">
            {t('patient.list.filter.sex')}
            <select
              data-testid="patient-list-filter-sex"
              value={form.sex}
              onChange={(e) => set('sex', e.target.value)}
              className="input"
            >
              <option value="">{t('common.none')}</option>
              {(
                [
                  ['M', t('patient.form.sex.male')],
                  ['F', t('patient.form.sex.female')],
                  ['O', t('patient.form.sex.other')],
                ] as const
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-slate-600">
            {t('patient.list.filter.city')}
            <input
              data-testid="patient-list-filter-city"
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
              className="input"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              data-testid="patient-list-filter-dues"
              checked={form.duesPositive}
              onChange={(e) => set('duesPositive', e.target.checked)}
            />
            {t('patient.list.filter.dues')}
          </label>

          {/* R3/R4 deferred filters — rendered DISABLED, no dead end */}
          <fieldset className="flex flex-col gap-2 border-t border-slate-200 pt-2">
            <legend className="text-xs font-medium text-slate-500">
              {t('patient.list.filter.deferred.title')}
            </legend>
            <input
              data-testid="patient-list-filter-remedy"
              disabled
              aria-disabled="true"
              title={t('patient.list.filter.deferredNote')}
              placeholder={t('patient.list.filter.remedy')}
              className="input cursor-not-allowed bg-slate-100 text-slate-400"
            />
            <input
              data-testid="patient-list-filter-diagnosis"
              disabled
              aria-disabled="true"
              title={t('patient.list.filter.deferredNote')}
              placeholder={t('patient.list.filter.diagnosis')}
              className="input cursor-not-allowed bg-slate-100 text-slate-400"
            />
            <select
              data-testid="patient-list-filter-potency"
              disabled
              aria-disabled="true"
              title={t('patient.list.filter.deferredNote')}
              aria-label={t('patient.list.filter.potency')}
              className="input cursor-not-allowed bg-slate-100 text-slate-400"
            >
              <option>{t('patient.list.filter.potency')}</option>
            </select>
            <input
              data-testid="patient-list-filter-casenote"
              disabled
              aria-disabled="true"
              title={t('patient.list.filter.deferredNote')}
              placeholder={t('patient.list.filter.casenote')}
              className="input cursor-not-allowed bg-slate-100 text-slate-400"
            />
            <input
              data-testid="patient-list-filter-tags"
              disabled
              aria-disabled="true"
              title={t('patient.list.filter.deferredNote')}
              placeholder={t('patient.list.filter.tags')}
              className="input cursor-not-allowed bg-slate-100 text-slate-400"
            />
            <p className="text-[0.7rem] text-slate-400">
              {t('patient.list.filter.deferredNote')}
            </p>
          </fieldset>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              data-testid="patient-list-apply"
              onClick={onApply}
              className="rounded bg-blue-600 px-3 py-1.5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-700"
            >
              {t('patient.list.apply')}
            </button>
            <button
              type="button"
              data-testid="patient-list-clear"
              onClick={onClear}
              className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {t('patient.list.clear')}
            </button>
          </div>
        </aside>

        {/* Results */}
        <div className="flex-1">
          <p className="mb-1 text-xs text-slate-500">
            {total === null
              ? t('patient.list.counting')
              : `${formatCount(total)} ${t('patient.list.count.suffix')}`}
          </p>

          {errored ? (
            <p
              role="alert"
              data-testid="patient-list-error"
              className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {t('patient.list.error.message')}
            </p>
          ) : showEmptyNone ? (
            <div
              data-testid="patient-list-empty"
              className="p-4 text-sm text-slate-700"
            >
              <p className="mb-2">{t('patient.list.empty.none')}</p>
              <button
                type="button"
                data-testid="patient-list-empty-action"
                onClick={() => onNewPatient?.()}
                className="rounded bg-blue-600 px-3 py-1.5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-700"
              >
                {t('patient.list.empty.none.action')}
              </button>
            </div>
          ) : showEmptyNoMatch ? (
            <div
              data-testid="patient-list-empty"
              className="p-4 text-sm text-slate-700"
            >
              <p className="mb-2">{t('patient.list.empty.noMatch')}</p>
              <button
                type="button"
                data-testid="patient-list-empty-action"
                onClick={onClear}
                className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {t('patient.list.empty.noMatch.action')}
              </button>
            </div>
          ) : (
            <div
              data-testid="patient-list-results"
              className="max-h-[70vh] overflow-auto rounded border border-slate-200"
              role="table"
              aria-label={t('patient.list.title')}
            >
              <div
                role="row"
                className="sticky top-0 grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600"
              >
                <SortHeader
                  testid="patient-list-sort-name"
                  label={t('patient.list.col.name')}
                  field="name"
                  sort={sort}
                  onSort={onSort}
                />
                <SortHeader
                  testid="patient-list-sort-id"
                  label={t('patient.list.col.id')}
                  field="id"
                  sort={sort}
                  onSort={onSort}
                />
                <span>{t('patient.list.col.ageSex')}</span>
                <SortHeader
                  testid="patient-list-sort-lastvisit"
                  label={t('patient.list.col.lastVisit')}
                  field="lastVisit"
                  sort={sort}
                  onSort={onSort}
                />
                <SortHeader
                  testid="patient-list-sort-nextfollowup"
                  label={t('patient.list.col.nextFollowup')}
                  field="nextFollowup"
                  sort={sort}
                  onSort={onSort}
                />
              </div>

              <ul>
                {rows.map((r) => (
                  <li
                    key={r.patientId}
                    role="row"
                    data-testid="patient-list-row"
                    tabIndex={0}
                    onClick={() => onOpenPatient(r.patientId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onOpenPatient(r.patientId);
                    }}
                    className="grid cursor-pointer grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-slate-50 focus:bg-blue-50 focus:outline-none"
                  >
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="truncate text-slate-500">{r.code}</span>
                    <span className="text-slate-600">
                      {r.ageLabel}
                      {r.sex ? ` ${r.sex}` : ''}
                    </span>
                    <span className="text-slate-600">
                      {formatDate(r.lastVisitAt) ?? t('common.none')}
                    </span>
                    <span className="text-slate-600">
                      {t('common.duesPrefix')}
                      {formatPaise(r.duesPaise)}
                    </span>
                  </li>
                ))}
              </ul>

              {nextCursor !== null ? (
                <div className="p-2 text-center">
                  <button
                    type="button"
                    data-testid="patient-list-load-more"
                    disabled={loading}
                    onClick={() => void onLoadMore()}
                    className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    {t('patient.list.loadMore')}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** A sortable column header rendered as a button (keyboard + AA, §5). */
function SortHeader({
  testid,
  label,
  field,
  sort,
  onSort,
}: {
  readonly testid: string;
  readonly label: string;
  readonly field: SortField;
  readonly sort: PatientSort;
  readonly onSort: (field: SortField) => void;
}): JSX.Element {
  const active = sort.field === field;
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={() => onSort(field)}
      aria-sort={
        active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
      }
      className="flex items-center gap-1 text-left font-semibold text-slate-700 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
    >
      {label}
      {active ? (
        <span aria-hidden="true">{sort.dir === 'asc' ? '▲' : '▼'}</span>
      ) : null}
    </button>
  );
}
