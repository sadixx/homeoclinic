// Component tests for the S05 patient list + filters screen (HC-MVP1-052;
// docs/ui/S05-patient-list.md). CUT: the real <PatientList /> component.
//
// The ONLY fake is the dependency: the typed Tauri bindings
// (`vi.mock('@/bindings')`, R-TEST-002). Visible strings from en.json
// (R-UI-007); controls by their spec data-testid (R-UI-003). R2 slice: only
// last-visit/follow-up/age/sex/city/dues>0 + sort + CSV are active; the
// remedy/diagnosis/potency/case-note/tags controls RENDER but are DISABLED
// (R3/R4), and Save filter is deferred — asserted here so there is no dead end.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { listQuery, exportCsv } = vi.hoisted(() => ({
  listQuery: vi.fn(),
  exportCsv: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    patientListQuery: listQuery,
    patientListExportCsv: exportCsv,
  },
}));

import en from '@/locales/en.json';
import { PatientList } from './PatientList';

function row(overrides: Record<string, unknown> = {}) {
  return {
    patientId: 'p-123',
    code: 'HC-000123',
    name: 'Ramesh Kumar',
    ageLabel: '34y',
    sex: 'M',
    mobile: '9876543210',
    city: 'Pune',
    lastVisitAt: '2026-10-12T10:00:00Z',
    duesPaise: 0,
    matchType: '',
    photoPath: null,
    ...overrides,
  };
}

beforeEach(() => {
  listQuery.mockReset();
  listQuery.mockResolvedValue({
    rows: [row()],
    total: 1,
    nextCursor: null,
  });
  exportCsv.mockReset();
  exportCsv.mockResolvedValue({ filePath: '/exports/patients.csv' });
});

describe('PatientList (S05) — load + results', () => {
  it('loads the list on mount and renders a result row', async () => {
    render(<PatientList onOpenPatient={vi.fn()} />);
    const rowEl = await screen.findByTestId('patient-list-row');
    expect(rowEl).toHaveTextContent('Ramesh Kumar');
    expect(rowEl).toHaveTextContent('HC-000123');
    expect(listQuery).toHaveBeenCalled();
  });

  it('opens a patient dashboard on row click (S07)', async () => {
    const onOpenPatient = vi.fn();
    const user = userEvent.setup();
    render(<PatientList onOpenPatient={onOpenPatient} />);
    await user.click(await screen.findByTestId('patient-list-row'));
    expect(onOpenPatient).toHaveBeenCalledWith('p-123');
  });
});

describe('PatientList (S05) — R2 filters active, later filters disabled', () => {
  it('applies the sex + city filters through the typed command (PSR-008)', async () => {
    const user = userEvent.setup();
    render(<PatientList onOpenPatient={vi.fn()} />);
    await screen.findByTestId('patient-list-row');

    await user.selectOptions(
      screen.getByTestId('patient-list-filter-sex'),
      'F',
    );
    await user.type(screen.getByTestId('patient-list-filter-city'), 'Pune');
    await user.click(screen.getByTestId('patient-list-apply'));

    await waitFor(() => {
      const last = listQuery.mock.calls.at(-1)?.[0];
      expect(last.filters.sex).toBe('F');
      expect(last.filters.city).toBe('Pune');
    });
  });

  it('renders the R3/R4 filters DISABLED with a deferred note (R-DEL-002)', async () => {
    render(<PatientList onOpenPatient={vi.fn()} />);
    await screen.findByTestId('patient-list-row');
    expect(screen.getByTestId('patient-list-filter-remedy')).toBeDisabled();
    expect(screen.getByTestId('patient-list-filter-diagnosis')).toBeDisabled();
    expect(screen.getByTestId('patient-list-filter-potency')).toBeDisabled();
    expect(screen.getByTestId('patient-list-filter-casenote')).toBeDisabled();
    expect(screen.getByTestId('patient-list-filter-tags')).toBeDisabled();
    expect(screen.getByTestId('patient-list-save-filter')).toBeDisabled();
  });

  it('sorts by name when the column header is activated (PSR-008)', async () => {
    const user = userEvent.setup();
    render(<PatientList onOpenPatient={vi.fn()} />);
    await screen.findByTestId('patient-list-row');

    await user.click(screen.getByTestId('patient-list-sort-name'));
    await waitFor(() => {
      const last = listQuery.mock.calls.at(-1)?.[0];
      expect(last.sort.field).toBe('name');
    });
  });
});

describe('PatientList (S05) — export + empty states', () => {
  it('exports the current filtered, sorted list to CSV (PSR-011)', async () => {
    const user = userEvent.setup();
    render(<PatientList onOpenPatient={vi.fn()} />);
    await screen.findByTestId('patient-list-row');

    await user.click(screen.getByTestId('patient-list-export'));
    await waitFor(() => expect(exportCsv).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByTestId('patient-list-export-done'),
    ).toHaveTextContent(en['patient.list.export.done']);
  });

  it('shows the no-patients empty state with a New patient action', async () => {
    listQuery.mockResolvedValue({ rows: [], total: 0, nextCursor: null });
    const onNewPatient = vi.fn();
    const user = userEvent.setup();
    render(<PatientList onOpenPatient={vi.fn()} onNewPatient={onNewPatient} />);

    const empty = await screen.findByTestId('patient-list-empty');
    expect(empty).toHaveTextContent(en['patient.list.empty.none']);
    await user.click(screen.getByTestId('patient-list-empty-action'));
    expect(onNewPatient).toHaveBeenCalled();
  });

  it('shows the no-match empty state after a filter returns nothing', async () => {
    const user = userEvent.setup();
    render(<PatientList onOpenPatient={vi.fn()} />);
    await screen.findByTestId('patient-list-row');

    listQuery.mockResolvedValue({ rows: [], total: 0, nextCursor: null });
    await user.type(screen.getByTestId('patient-list-filter-city'), 'Nowhere');
    await user.click(screen.getByTestId('patient-list-apply'));

    expect(await screen.findByTestId('patient-list-empty')).toHaveTextContent(
      en['patient.list.empty.noMatch'],
    );
  });
});
