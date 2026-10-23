// RED test for C8 (zoom does nothing). Design: docs/adr/0018-case-big-box-
// dated-log.md (cross-cutting §UX shell: "root font-scale/CSS zoom var"),
// docs/ui/00-conventions.md §1 (14px rem baseline).
//
// ROOT CAUSE this test pins: `useZoom` produces a clamped scale and the shell
// applies it as `--hc-font-scale` AND a `fontSize` on the MID-TREE
// `content-area` <div>. But every unit of text and spacing in the app is a
// rem/px Tailwind utility (`text-sm`, `p-4`, ...), and rem is anchored to the
// DOCUMENT ROOT (`:root` html font-size = 14px, src/index.css), NOT to a
// mid-tree div's font-size. So setting font-size on the content-area div is a
// NO-OP for every rem-based utility: zooming changes nothing the doctor sees.
//
// The FIX (not implemented yet) is to drive the scale onto the DOCUMENT ROOT
// font-size — `document.documentElement.style.fontSize = 14 * scale + 'px'` —
// so all rem text + layout scale together, and restore the 14px baseline on
// reset. These assertions therefore read `document.documentElement` (the
// :root html element), NOT the content-area div. They are RED on the current
// mid-tree-div implementation and GREEN once the scale is applied to the root.
//
// CUT: the REAL <AppShell /> + <useZoom /> (the shell owns the apply). The ONLY
// faked thing is the generated binding `@/bindings` (a dependency, R-TEST-002).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  setupGetState,
  authGetLockState,
  patientGetDashboard,
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
import { ZOOM_STEP } from './useZoom';

/** The :root (html) font-size baseline (src/index.css). */
const BASELINE_PX = 14;

/** The current document-root font-size in px, as a number. */
function rootFontSizePx(): number {
  return Number.parseFloat(document.documentElement.style.fontSize);
}

beforeEach(() => {
  window.location.hash = '';
  // Start each test from the real CSS baseline: nothing set inline on :root.
  document.documentElement.style.fontSize = '';
  window.localStorage.clear();

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
      name: 'Test Patient 001',
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

afterEach(() => {
  document.documentElement.style.fontSize = '';
});

describe('C8 — zoom scales the DOCUMENT ROOT font-size (rem actually scales)', () => {
  it('zoom-in raises the :root (document element) font-size above the 14px baseline', async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await screen.findByTestId('today-screen');

    // Baseline: the root font-size resolves to 14px (either inline-set by the
    // apply or the CSS baseline). Either way zoom-in must RAISE it.
    const zoomIn = await screen.findByTestId('app-bar-zoom-in');
    await user.click(zoomIn);

    const expected = BASELINE_PX * (1 + ZOOM_STEP); // 14 * 1.1 = 15.4
    expect(rootFontSizePx()).toBeCloseTo(expected, 5);
  });

  it('reset returns the :root font-size to the 14px baseline', async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await screen.findByTestId('today-screen');

    const zoomIn = await screen.findByTestId('app-bar-zoom-in');
    const reset = await screen.findByTestId('app-bar-zoom-reset');

    await user.click(zoomIn);
    await user.click(zoomIn);
    expect(rootFontSizePx()).toBeGreaterThan(BASELINE_PX);

    await user.click(reset);
    expect(rootFontSizePx()).toBeCloseTo(BASELINE_PX, 5);
  });

  it('keyboard Ctrl+= scales the :root font-size (not a mid-tree div no-op)', async () => {
    const user = userEvent.setup();
    render(<AppShell />);
    await screen.findByTestId('today-screen');

    await act(async () => {
      await user.keyboard('{Control>}={/Control}');
    });

    const expected = BASELINE_PX * (1 + ZOOM_STEP);
    expect(rootFontSizePx()).toBeCloseTo(expected, 5);
  });
});
