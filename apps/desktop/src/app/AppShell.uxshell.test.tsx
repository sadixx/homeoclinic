// RED tests for M3-RW Slice C — the UX SHELL: a COMMON Back in one consistent
// place (a shared app-bar slot) and ZOOM in/out/reset that scales TEXT AND
// LAYOUT via a root font-scale CSS var. Design: docs/adr/0018-case-big-box-
// dated-log.md (cross-cutting §UX shell), docs/ui/00-conventions.md §2/§3/§5,
// .worklog/HC-MVP1-M3/handoffs/M3-RW-template-migration-and-slice-plan.md
// (Slice C: C2 Back, C3 zoom).
//
// CUT: the REAL <AppShell /> (apps/desktop/src/app/AppShell.tsx) — the shell
// owns the common app-bar and the zoom state. The ONLY faked thing is the
// generated binding `@/bindings` (a dependency, R-TEST-002). Mock fns are
// created with `vi.hoisted` so they are reachable in the hoisted `vi.mock`
// factory (the established pattern; see AppShell.test.tsx).
//
// Red-first state: the shell currently draws Back AD-HOC per screen
// (`case-form-back` in CaseForm's own header, `followup-back` in FollowupVisit,
// `patient-dash-back` in PatientDashboard) with NO shared `app-bar`, and there
// is NO zoom control and NO root font-scale var. So `app-bar`, `app-bar-back`,
// `app-bar-zoom-*` resolve to null (queryBy) and the `--hc-font-scale`
// assertions fail — on assertions, not at import. After hc-ui-dev factors the
// common app-bar + zoom these must pass.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  setupGetState,
  authGetLockState,
  patientGetDashboard,
  patientTouchRecent,
  patientListQuery,
  patientSearch,
  patientRecent,
  caseVisitOpenOrCreate,
  caseVisitAutosave,
  visitCreateFollowup,
  visitAutosave,
  visitSetNextFollowup,
  visitListAttachments,
  visitHasSavedFirstCase,
  todayGetOverview,
} = vi.hoisted(() => ({
  setupGetState: vi.fn(),
  authGetLockState: vi.fn(),
  patientGetDashboard: vi.fn(),
  patientTouchRecent: vi.fn(),
  patientListQuery: vi.fn(),
  patientSearch: vi.fn(),
  patientRecent: vi.fn(),
  caseVisitOpenOrCreate: vi.fn(),
  caseVisitAutosave: vi.fn(),
  visitCreateFollowup: vi.fn(),
  visitAutosave: vi.fn(),
  visitSetNextFollowup: vi.fn(),
  visitListAttachments: vi.fn(),
  visitHasSavedFirstCase: vi.fn(),
  todayGetOverview: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    setupGetState,
    authGetLockState,
    appInfo: vi.fn(async () => ({
      name: 'HomeoClinic',
      version: '0.1.0',
      build_profile: 'debug' as const,
    })),
    getBackupStatus: vi.fn(async () => ({
      lastBackupAt: null,
      lastBackupOk: false,
      daysSinceGood: null,
      autoEnabled: false,
      retention: { daily: 14, weekly: 8, monthly: 12 },
      stale: true,
    })),
    listRemovableDrives: vi.fn(async () => ({ drives: [] })),
    patientGetDashboard,
    patientTouchRecent,
    patientListQuery,
    patientSearch,
    patientRecent,
    caseVisitOpenOrCreate,
    caseVisitAutosave,
    visitCreateFollowup,
    visitAutosave,
    visitSetNextFollowup,
    visitListAttachments,
    visitHasSavedFirstCase,
    todayGetOverview,
  },
}));

import { AppShell } from './AppShell';

/** Drive an in-app navigation the way a nav click / deep link would. */
async function navigateViaHash(hash: string): Promise<void> {
  await act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

/** Read the content-root font-scale CSS var the zoom controls drive. */
function fontScaleOf(el: HTMLElement): string {
  return el.style.getPropertyValue('--hc-font-scale').trim();
}

beforeEach(() => {
  window.location.hash = '';
  setupGetState.mockReset();
  setupGetState.mockResolvedValue({
    completed: true,
    currentStep: 4,
    dataDir: '/tmp/hc',
  });
  authGetLockState.mockReset();
  authGetLockState.mockResolvedValue({ locked: false, autolockMinutes: 15 });

  patientGetDashboard.mockReset();
  patientGetDashboard.mockResolvedValue({
    demographics: {
      code: 'HC-000123',
      name: 'Ramesh Kumar',
      ageLabel: '34y',
      sex: 'M',
      mobile: '9876543210',
      city: 'Pune',
      referredBy: null,
      photoPath: null,
    },
    allergies: null,
    alerts: null,
    duesPaise: 0,
    visits: [],
    lastPrescription: null,
    family: [],
  });
  patientTouchRecent.mockReset();
  patientTouchRecent.mockResolvedValue(null);
  patientListQuery.mockReset();
  patientListQuery.mockResolvedValue({ rows: [], total: 0, nextCursor: null });
  patientSearch.mockReset();
  patientSearch.mockResolvedValue({ results: [], nextCursor: null });
  patientRecent.mockReset();
  patientRecent.mockResolvedValue({ results: [] });

  caseVisitOpenOrCreate.mockReset();
  caseVisitOpenOrCreate.mockResolvedValue({
    visitId: 'v-1',
    templateId: 'journal_default',
    dataJson: '{}',
    vitalsJson: '{}',
    visitAt: '2026-10-16T10:42:00Z',
    nextFollowupOn: null,
  });
  caseVisitAutosave.mockReset();
  caseVisitAutosave.mockResolvedValue({ savedAt: '2026-10-16T10:42:30Z' });

  visitCreateFollowup.mockReset();
  visitCreateFollowup.mockResolvedValue({
    visitId: 'v-f1',
    visitAt: '2026-10-16T10:42:00Z',
    prevComplaints: [],
  });
  visitAutosave.mockReset();
  visitAutosave.mockResolvedValue({ savedAt: '2026-10-16T10:42:30Z' });
  visitSetNextFollowup.mockReset();
  visitSetNextFollowup.mockResolvedValue({ ok: true });
  visitListAttachments.mockReset();
  visitListAttachments.mockResolvedValue({ attachments: [] });
  visitHasSavedFirstCase.mockReset();
  visitHasSavedFirstCase.mockResolvedValue({ hasSavedFirstCase: false });

  todayGetOverview.mockReset();
  todayGetOverview.mockResolvedValue({
    dueToday: [],
    overdue: [],
    registeredToday: [],
    backupWarning: null,
    licenceReminder: null,
  });
});

// ---------------------------------------------------------------------------
// COMMON Back — one consistent place (Slice C2; 00-conventions §3)
// ---------------------------------------------------------------------------
describe('Slice C — common Back in a shared app-bar slot', () => {
  it('renders a single shared app-bar Back on the case form', async () => {
    render(<AppShell />);
    await screen.findByTestId('today-screen');
    await navigateViaHash('#/patient/p-123/case/v-1');
    await screen.findByTestId('case-form');

    const appBar = await screen.findByTestId('app-bar');
    const back = await screen.findByTestId('app-bar-back');
    expect(appBar).toContainElement(back);
    // Exactly one Back control in the whole shell (no ad-hoc duplicate).
    expect(screen.getAllByTestId('app-bar-back')).toHaveLength(1);
  });

  it('renders a single shared app-bar Back on the follow-up', async () => {
    render(<AppShell />);
    await screen.findByTestId('today-screen');
    await navigateViaHash('#/patient/p-123/visit/v-f1/followup?prev=v-prev');
    await screen.findByTestId('followup-screen');

    const appBar = await screen.findByTestId('app-bar');
    const back = await screen.findByTestId('app-bar-back');
    expect(appBar).toContainElement(back);
    expect(screen.getAllByTestId('app-bar-back')).toHaveLength(1);
  });

  it('renders a single shared app-bar Back on the patient dashboard', async () => {
    render(<AppShell />);
    await screen.findByTestId('today-screen');
    await navigateViaHash('#/patients?id=p-123');
    await screen.findByTestId('patient-dash-demographics');

    const appBar = await screen.findByTestId('app-bar');
    const back = await screen.findByTestId('app-bar-back');
    expect(appBar).toContainElement(back);
    expect(screen.getAllByTestId('app-bar-back')).toHaveLength(1);
  });

  it('renders a single shared app-bar Back on the patient list', async () => {
    render(<AppShell />);
    await screen.findByTestId('today-screen');
    await navigateViaHash('#/patients');
    await screen.findByTestId('patient-list-title');

    const appBar = await screen.findByTestId('app-bar');
    const back = await screen.findByTestId('app-bar-back');
    expect(appBar).toContainElement(back);
    expect(screen.getAllByTestId('app-bar-back')).toHaveLength(1);
  });

  it('keeps the shared Back in the SAME slot across screens (consistent placement)', async () => {
    render(<AppShell />);
    await screen.findByTestId('today-screen');

    // Dashboard: Back lives inside the app-bar, and nowhere else.
    await navigateViaHash('#/patients?id=p-123');
    await screen.findByTestId('patient-dash-demographics');
    const dashBar = await screen.findByTestId('app-bar');
    expect(dashBar).toContainElement(screen.getByTestId('app-bar-back'));
    expect(screen.getAllByTestId('app-bar-back')).toHaveLength(1);

    // Case form: the SAME app-bar slot carries the SAME single Back control —
    // not a second, screen-local one somewhere else.
    await navigateViaHash('#/patient/p-123/case/v-1');
    await screen.findByTestId('case-form');
    const caseBar = await screen.findByTestId('app-bar');
    expect(caseBar).toContainElement(screen.getByTestId('app-bar-back'));
    expect(screen.getAllByTestId('app-bar-back')).toHaveLength(1);
  });

  it('shared app-bar Back navigates the parent chain (case -> dashboard, not Today)', async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await screen.findByTestId('today-screen');

    await navigateViaHash('#/patients?id=p-123');
    await screen.findByTestId('patient-dash-demographics');
    await navigateViaHash('#/patient/p-123/case/v-1');
    await screen.findByTestId('case-form');

    await user.click(await screen.findByTestId('app-bar-back'));

    // One step up the parent chain: the patient dashboard, not Today.
    expect(
      await screen.findByTestId('patient-dash-demographics'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('case-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('today-screen')).not.toBeInTheDocument();
  });

  it('the shared app-bar Back is labelled (accessible name, 00-conventions §5)', async () => {
    render(<AppShell />);
    await screen.findByTestId('today-screen');
    await navigateViaHash('#/patient/p-123/case/v-1');
    await screen.findByTestId('case-form');

    const back = await screen.findByTestId('app-bar-back');
    expect(back).toHaveAccessibleName();
  });
});

// ---------------------------------------------------------------------------
// ZOOM in / out / reset — scales TEXT + LAYOUT via a root font-scale var
// (Slice C3; SET-005 extension; ADR 0018 "root font-scale/CSS zoom var")
// ---------------------------------------------------------------------------
describe('Slice C — zoom scales text + layout via a root font-scale var', () => {
  it('zoom-in raises the content-root font-scale across 3+ steps', async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await screen.findByTestId('today-screen');

    const content = screen.getByTestId('content-area');
    const zoomIn = await screen.findByTestId('app-bar-zoom-in');

    const start = fontScaleOf(content);
    const scales: string[] = [start];
    for (let i = 0; i < 3; i += 1) {
      await user.click(zoomIn);
      scales.push(fontScaleOf(content));
    }
    // Strictly increasing across the 3 steps (a real layout rem scale, not a
    // no-op label): each value parses to a larger number than the previous.
    const nums = scales.map((s) => Number(s));
    expect(nums.every((n) => Number.isFinite(n) && n > 0)).toBe(true);
    expect(nums[1]!).toBeGreaterThan(nums[0]!);
    expect(nums[2]!).toBeGreaterThan(nums[1]!);
    expect(nums[3]!).toBeGreaterThan(nums[2]!);
  });

  it('zoom-out lowers the content-root font-scale', async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await screen.findByTestId('today-screen');

    const content = screen.getByTestId('content-area');
    const zoomIn = await screen.findByTestId('app-bar-zoom-in');
    const zoomOut = await screen.findByTestId('app-bar-zoom-out');

    await user.click(zoomIn);
    await user.click(zoomIn);
    const high = Number(fontScaleOf(content));
    await user.click(zoomOut);
    const lower = Number(fontScaleOf(content));
    expect(lower).toBeLessThan(high);
  });

  it('clamps zoom at a maximum (repeated zoom-in stops rising)', async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await screen.findByTestId('today-screen');

    const content = screen.getByTestId('content-area');
    const zoomIn = await screen.findByTestId('app-bar-zoom-in');

    // Press far past any sane number of steps; the scale must plateau.
    for (let i = 0; i < 20; i += 1) await user.click(zoomIn);
    const atMax = Number(fontScaleOf(content));
    await user.click(zoomIn);
    expect(Number(fontScaleOf(content))).toBe(atMax);
    // And the clamp is a real upper bound (not an absurd value).
    expect(atMax).toBeLessThanOrEqual(3);
  });

  it('clamps zoom at a minimum (repeated zoom-out stops falling, stays positive)', async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await screen.findByTestId('today-screen');

    const content = screen.getByTestId('content-area');
    const zoomOut = await screen.findByTestId('app-bar-zoom-out');

    for (let i = 0; i < 20; i += 1) await user.click(zoomOut);
    const atMin = Number(fontScaleOf(content));
    await user.click(zoomOut);
    expect(Number(fontScaleOf(content))).toBe(atMin);
    expect(atMin).toBeGreaterThan(0);
  });

  it('reset returns the font-scale to the 1.0 baseline', async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await screen.findByTestId('today-screen');

    const content = screen.getByTestId('content-area');
    const zoomIn = await screen.findByTestId('app-bar-zoom-in');
    const reset = await screen.findByTestId('app-bar-zoom-reset');

    await user.click(zoomIn);
    await user.click(zoomIn);
    expect(Number(fontScaleOf(content))).not.toBe(1);

    await user.click(reset);
    expect(Number(fontScaleOf(content))).toBe(1);
  });

  it('keyboard Ctrl+= zooms in, Ctrl+- zooms out and Ctrl+0 resets (00-conventions §3)', async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await screen.findByTestId('today-screen');

    const content = screen.getByTestId('content-area');
    const base = Number(fontScaleOf(content));

    await user.keyboard('{Control>}={/Control}');
    const afterIn = Number(fontScaleOf(content));
    expect(afterIn).toBeGreaterThan(base);

    await user.keyboard('{Control>}-{/Control}');
    expect(Number(fontScaleOf(content))).toBeLessThan(afterIn);

    await user.keyboard('{Control>}0{/Control}');
    expect(Number(fontScaleOf(content))).toBe(1);
  });

  it('the zoom controls are labelled (accessible names, 00-conventions §5)', async () => {
    render(<AppShell />);
    await screen.findByTestId('today-screen');

    expect(await screen.findByTestId('app-bar-zoom-in')).toHaveAccessibleName();
    expect(
      await screen.findByTestId('app-bar-zoom-out'),
    ).toHaveAccessibleName();
    expect(
      await screen.findByTestId('app-bar-zoom-reset'),
    ).toHaveAccessibleName();
  });
});
