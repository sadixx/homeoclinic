// Component tests for the S03 Today screen (HC-MVP1-009 R0 empty state +
// HC-MVP1-072 R3 live lists; docs/ui/S03-today.md). CUT: the real
// <TodayScreen /> in this module (apps/desktop/src/home).
//
// At R3 (M3 Slice D) Today upgrades from the R0 empty state to three live,
// virtualised lists driven by the M3-A `today_get_overview` command (VIS-005):
// due-today, overdue and registered-today, plus the backup-warning banner
// (BAK-004). The R0 behaviour (empty state + "New patient" primary action) MUST
// still hold when every list is empty.
//
// The ONLY fake is the dependency: the typed Tauri bindings
// (`vi.mock('@/bindings')`, R-TEST-002) — never the component. Mock fns use
// `vi.hoisted` so they are reachable in the hoisted `vi.mock` factory (the
// established Slice-C pattern). Controls/values by their S03 data-testid
// (R-UI-003); visible empty-state text from en.json (R-UI-007).
//
// Red-first state: the current TodayScreen renders a static empty state and
// never calls `today_get_overview`; these tests fail until hc-ui-dev wires the
// command and the three lists. Driving due/overdue purely through the mocked
// command's buckets keeps the classification logic (done + FakeClock-tested in
// M3-A) out of the UI unit (R-TEST anti-sleep): the UI only renders what the
// bucket returns.
//
// The M3-A today_get_overview contract (from @/bindings):
//   todayGetOverview(req: { today }) -> {
//     dueToday: TodayPatientRow[], overdue: TodayPatientRow[],
//     registeredToday: TodayVisitRow[],
//     backupWarning: string | null, licenceReminder: string | null }
//   TodayPatientRow = { patientId, code, name, ageLabel, sex, photoPath,
//                       nextFollowupOn, duesPaise }
//   TodayVisitRow   = { patientId, code, name, photoPath, visitAt, type }

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from '@testing-library/react';

const { getOverview } = vi.hoisted(() => ({
  getOverview: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    todayGetOverview: getOverview,
  },
}));

import en from '@/locales/en.json';
import { TodayScreen } from './TodayScreen';

// Synthetic patient rows only. "today" is anchored at 16-10-2026 so due/overdue
// dates read clearly; the UI trusts the BUCKET, not the date maths.
function duePatient(overrides: Record<string, unknown> = {}) {
  return {
    patientId: 'p-1',
    code: 'HC-000123',
    name: 'Ramesh Kumar',
    ageLabel: '34 y',
    sex: 'M',
    photoPath: null,
    nextFollowupOn: '2026-10-16',
    duesPaise: 0,
    ...overrides,
  };
}

function overduePatient(overrides: Record<string, unknown> = {}) {
  return {
    patientId: 'p-2',
    code: 'HC-000087',
    name: 'Sita Devi',
    ageLabel: '51 y',
    sex: 'F',
    photoPath: null,
    nextFollowupOn: '2026-10-09',
    duesPaise: 0,
    ...overrides,
  };
}

function registeredVisit(overrides: Record<string, unknown> = {}) {
  return {
    patientId: 'p-3',
    code: 'HC-000311',
    name: 'Imran Shaikh',
    photoPath: null,
    visitAt: '2026-10-16T10:05:00Z',
    type: 'First',
    ...overrides,
  };
}

function overview(overrides: Record<string, unknown> = {}) {
  return {
    dueToday: [],
    overdue: [],
    registeredToday: [],
    backupWarning: null,
    licenceReminder: null,
    ...overrides,
  };
}

beforeEach(() => {
  getOverview.mockReset();
  getOverview.mockResolvedValue(overview());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TodayScreen (S03) — loads the overview (072/VIS-005)', () => {
  it('calls today_get_overview with an anchoring today date on mount', async () => {
    render(<TodayScreen />);
    await waitFor(() => expect(getOverview).toHaveBeenCalledTimes(1));
    const arg = getOverview.mock.calls[0]![0];
    expect(arg).toHaveProperty('today');
    expect(typeof arg.today).toBe('string');
  });
});

describe('TodayScreen (S03) — empty state still works at R0 (009)', () => {
  it('shows the empty state message and New patient action when every list is empty', async () => {
    render(<TodayScreen />);
    // After the overview resolves with all-empty buckets, the empty state holds.
    const empty = await screen.findByTestId('today-empty');
    expect(empty).toHaveTextContent(en['today.empty.message']);

    const action = screen.getByTestId('today-new-patient');
    expect(action).toBeInTheDocument();
    expect(action).toHaveTextContent(en['today.empty.action']);
  });

  it('does not render the three lists when all buckets are empty', async () => {
    render(<TodayScreen />);
    await screen.findByTestId('today-empty');
    expect(screen.queryByTestId('today-due-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('today-overdue-list')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('today-registered-list'),
    ).not.toBeInTheDocument();
  });
});

describe('TodayScreen (S03) — due-today / overdue / registered lists (072/VIS-005)', () => {
  it('renders a due-today row for a patient whose follow-up is due today', async () => {
    getOverview.mockResolvedValue(overview({ dueToday: [duePatient()] }));
    render(<TodayScreen />);

    const list = await screen.findByTestId('today-due-list');
    const rows = within(list).getAllByTestId('today-due-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Ramesh Kumar');
    expect(rows[0]).toHaveTextContent('HC-000123');
  });

  it('renders an overdue row for a patient whose follow-up is before today', async () => {
    getOverview.mockResolvedValue(overview({ overdue: [overduePatient()] }));
    render(<TodayScreen />);

    const list = await screen.findByTestId('today-overdue-list');
    const rows = within(list).getAllByTestId('today-overdue-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Sita Devi');
  });

  it('places a due-today patient under Due today and NOT under Overdue (VIS-005)', async () => {
    getOverview.mockResolvedValue(overview({ dueToday: [duePatient()] }));
    render(<TodayScreen />);

    await screen.findByTestId('today-due-list');
    expect(screen.getByTestId('today-due-list')).toHaveTextContent(
      'Ramesh Kumar',
    );
    // No overdue list rendered (empty bucket) — the due patient is not misfiled.
    expect(screen.queryByTestId('today-overdue-row')).not.toBeInTheDocument();
  });

  it('places an overdue patient under Overdue and NOT under Due today (VIS-005)', async () => {
    getOverview.mockResolvedValue(overview({ overdue: [overduePatient()] }));
    render(<TodayScreen />);

    await screen.findByTestId('today-overdue-list');
    expect(screen.getByTestId('today-overdue-list')).toHaveTextContent(
      'Sita Devi',
    );
    expect(screen.queryByTestId('today-due-row')).not.toBeInTheDocument();
  });

  it("renders a registered-today row for each of today's saved visits (VIS-OQ: saved visits only)", async () => {
    getOverview.mockResolvedValue(
      overview({ registeredToday: [registeredVisit()] }),
    );
    render(<TodayScreen />);

    const list = await screen.findByTestId('today-registered-list');
    const rows = within(list).getAllByTestId('today-registered-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Imran Shaikh');
  });

  it('orders overdue most-overdue first (VIS-OQ recorded default)', async () => {
    // Assumption S03-OQ: overdue sorted most-overdue first. The command may
    // return any order; the UI must present the earliest next_followup_on
    // (most overdue) at the top.
    const lessOverdue = overduePatient({
      patientId: 'p-a',
      name: 'Asha Patil',
      nextFollowupOn: '2026-10-14',
    });
    const mostOverdue = overduePatient({
      patientId: 'p-b',
      name: 'Bhavna Rao',
      nextFollowupOn: '2026-10-02',
    });
    getOverview.mockResolvedValue(
      overview({ overdue: [lessOverdue, mostOverdue] }),
    );
    render(<TodayScreen />);

    const list = await screen.findByTestId('today-overdue-list');
    const rows = within(list).getAllByTestId('today-overdue-row');
    expect(rows[0]).toHaveTextContent('Bhavna Rao');
    expect(rows[1]).toHaveTextContent('Asha Patil');
  });

  it('orders due-today by patient name (VIS-OQ recorded default)', async () => {
    const zed = duePatient({ patientId: 'p-z', name: 'Zara Khan' });
    const abe = duePatient({ patientId: 'p-a', name: 'Abdul Rahim' });
    getOverview.mockResolvedValue(overview({ dueToday: [zed, abe] }));
    render(<TodayScreen />);

    const list = await screen.findByTestId('today-due-list');
    const rows = within(list).getAllByTestId('today-due-row');
    expect(rows[0]).toHaveTextContent('Abdul Rahim');
    expect(rows[1]).toHaveTextContent('Zara Khan');
  });
});

describe('TodayScreen (S03) — rows open the patient dashboard (072)', () => {
  it('opens the dashboard when a due-today row is clicked', async () => {
    const onOpenPatient = vi.fn();
    getOverview.mockResolvedValue(overview({ dueToday: [duePatient()] }));
    render(<TodayScreen onOpenPatient={onOpenPatient} />);

    const row = await screen.findByTestId('today-due-row');
    fireEvent.click(row);
    expect(onOpenPatient).toHaveBeenCalledWith('p-1');
  });

  it('opens the dashboard when Enter is pressed on an overdue row', async () => {
    const onOpenPatient = vi.fn();
    getOverview.mockResolvedValue(overview({ overdue: [overduePatient()] }));
    render(<TodayScreen onOpenPatient={onOpenPatient} />);

    const row = await screen.findByTestId('today-overdue-row');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpenPatient).toHaveBeenCalledWith('p-2');
  });
});

describe('TodayScreen (S03) — backup warning banner (BAK-004)', () => {
  it('shows the backup warning banner when backup_warning text is present', async () => {
    getOverview.mockResolvedValue(
      overview({ backupWarning: 'Last backup 9 days ago' }),
    );
    render(<TodayScreen />);

    const banner = await screen.findByTestId('today-backup-warning');
    expect(banner).toHaveTextContent('Last backup 9 days ago');
    // The banner carries the Backup-now action (opens S17 at R1+).
    expect(screen.getByTestId('today-backup-now')).toBeInTheDocument();
  });

  it('hides the backup warning banner when backup_warning is null', async () => {
    getOverview.mockResolvedValue(overview({ backupWarning: null }));
    render(<TodayScreen />);
    await screen.findByTestId('today-empty');
    expect(
      screen.queryByTestId('today-backup-warning'),
    ).not.toBeInTheDocument();
  });
});
