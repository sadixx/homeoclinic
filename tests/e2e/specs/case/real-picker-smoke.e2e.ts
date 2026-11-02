// @req PAT-009
// @tier smoke
// @area case
// @targets linux
//
// M3-RWv5 REAL-PICKER SMOKE (permanent; build-15). Proves the Investigations
// upload opens the REAL native GTK file chooser without freezing the app — the
// RWv4 crash was `visit_pick_report_file` blocking the main thread inside
// `blocking_pick_file`, so the dialog never painted and the webview stopped
// answering. RWv5 made the command async (pick_file + oneshot).
//
// Runs WITHOUT the HC_E2E_REPORT_FILE seam: point HC_APP_BINARY at a debug build
// made WITHOUT `--features e2e-test-keys` (the seam does not exist there). It
// also passes on an e2e-test-keys build as long as HC_E2E_REPORT_FILE is unset
// (the seam then falls through to the real dialog). Everything is driven
// through the UI (no fixture import).
//
// Steps: provision -> register -> Take case -> Record investigations ->
// Submitted -> click Upload new -> the dialog stays up for >= 3 s as a VIEWABLE
// X11 toplevel titled "Open File" owned by the SAME app pid, and (gdb present)
// the app's GTK toplevel list contains a GtkFileChooserDialog -> the webview
// answers a WebDriver query in < 2 s while the dialog is open -> dismiss it
// (WM_DELETE_WINDOW, the WM "close" path; Escape via XTest as fallback) -> the
// dialog is gone, the SAME pid is alive, the webview answers in < 2 s, no
// report got linked, and the upload control opens the dialog AGAIN (second
// open + dismiss) — it is still usable.
//
// Needs X11 (sets GDK_BACKEND=x11 + relaunch, like the resize spec), xwininfo,
// xprop, python3 (scripts/x11win.py). gdb is used when present; set
// HC_E2E_NO_GDB=1 to skip only the GTK type check on a runner without gdb.
import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { investigationsPage } from '../../pages/investigations.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { evidence } from '../../helpers/evidence.js';
import { relaunchInto } from '../../helpers/launch.js';
import {
  appPid,
  closeWindow,
  escapeWindow,
  gtkToplevels,
  pidAlive,
  viewableWindowsOf,
} from '../../helpers/x11.js';

const PIN = '1593';
const PATIENT_NAME = 'Pickera Testpatient';
const DIALOG_TITLE = 'Open File';

/** One WebDriver round-trip, failing fast (instead of hanging) past `ms`. */
async function timedQuery(ms = 2000): Promise<number> {
  const t0 = Date.now();
  await Promise.race([
    browser.execute(() => document.readyState),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`webview did not answer within ${ms} ms`)), ms)),
  ]);
  return Date.now() - t0;
}

async function openDialogAndAssert(pid: number, label: string): Promise<string> {
  const t0 = Date.now();
  await investigationsPage.submitUpload.waitForClickable({ timeout: 15000 });
  await investigationsPage.submitUpload.click();
  // The dialog must appear AND still be up >= 3 s after the click.
  await browser.waitUntil(
    async () => Date.now() - t0 >= 3000 && viewableWindowsOf(pid, DIALOG_TITLE).length === 1,
    { timeout: 15000, interval: 250, timeoutMsg: `${label}: no viewable "${DIALOG_TITLE}" toplevel of pid ${pid} 3 s after Upload` },
  );
  const dlg = viewableWindowsOf(pid, DIALOG_TITLE)[0]!;
  evidence(`[picker] ${label}: X11 toplevel ${dlg.id} "${DIALOG_TITLE}" viewable, _NET_WM_PID=${pid}, ${Date.now() - t0} ms after click`);

  if (process.env.HC_E2E_NO_GDB !== '1') {
    const tops = gtkToplevels(pid);
    if (tops === null) throw new Error('gdb could not read GTK toplevels (set HC_E2E_NO_GDB=1 on a runner without gdb)');
    evidence(`[picker] ${label}: GTK toplevels ${JSON.stringify(tops)}`);
    expect(tops.some((t) => t.type === 'GtkFileChooserDialog')).toBe(true);
  }

  const rt = await timedQuery(2000);
  evidence(`[picker] ${label}: webview answered a WebDriver query in ${rt} ms with the dialog open`);
  expect(rt).toBeLessThan(2000);
  return dlg.id;
}

async function dismissAndAssert(pid: number, dlgId: string, label: string): Promise<void> {
  closeWindow(dlgId);
  let via = 'WM_DELETE_WINDOW';
  const gone = await browser
    .waitUntil(async () => viewableWindowsOf(pid, DIALOG_TITLE).length === 0, { timeout: 5000, interval: 250 })
    .then(() => true)
    .catch(() => false);
  if (!gone) {
    via = 'XTest Escape';
    escapeWindow(dlgId);
    await browser.waitUntil(async () => viewableWindowsOf(pid, DIALOG_TITLE).length === 0, {
      timeout: 10000,
      interval: 250,
      timeoutMsg: `${label}: the file chooser did not close`,
    });
  }
  expect(appPid()).toBe(pid);
  expect(pidAlive(pid)).toBe(true);
  const rt = await timedQuery(2000);
  expect(rt).toBeLessThan(2000);
  expect(await investigationsPage.linkCount()).toBe(0);
  evidence(`[picker] ${label}: dismissed via ${via}; same pid ${pid} alive; webview answered in ${rt} ms; 0 links`);
}

describe('M3-RWv5 real-picker smoke: the native GTK file chooser opens without freezing and can be dismissed and reopened (PAT-009)', () => {
  before(async () => {
    delete process.env.HC_E2E_REPORT_FILE; // never the seam
    process.env.GDK_BACKEND = 'x11';
    await relaunchInto('main');
  });

  after(() => {
    delete process.env.GDK_BACKEND;
  });

  it('opens the real GtkFileChooserDialog from Investigations upload, stays responsive, dismisses, and the upload control works again', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    await patientsPage.openRegister();
    await patientsPage.fillCore({ name: PATIENT_NAME, age: '50', city: 'Pune' });
    await patientsPage.saveAndWaitForDashboard();
    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();

    const pid = appPid();
    expect(pid).not.toBeNull();
    evidence(`[picker] app pid ${pid}`);

    await investigationsPage.openSubmittedFor('CBC');
    const dlg1 = await openDialogAndAssert(pid as number, 'open #1');
    await dismissAndAssert(pid as number, dlg1, 'open #1');

    // Usable again: the upload control (still shown, or reopened) opens it again.
    if (!(await investigationsPage.submitUpload.isDisplayed().catch(() => false))) {
      await investigationsPage.openSubmittedFor('CBC');
    }
    const dlg2 = await openDialogAndAssert(pid as number, 'open #2');
    await dismissAndAssert(pid as number, dlg2, 'open #2');

    await expect(caseRichPage.form).toBeDisplayed();
    evidence('[picker] PASS: real picker opened twice, UI responsive, dismissed twice, same pid');
  });
});
