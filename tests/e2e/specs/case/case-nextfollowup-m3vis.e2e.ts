// @req VIS-004, VIS-005, CASE-005
// @tier stable
// @area case
// @targets linux
//
// HC-MVP1-M3vis end to end (docs/ui/S08-case-form.md): the S08 header Next
// follow-up scheduler, F5 visit resolution and Ctrl/Cmd+S force-save, on a
// fresh isolated data dir (synthetic patient only, no network). One spec file,
// one patient, two phases sharing the 'main' dir:
//
//   PHASE A (X11 window 1366x768):
//     F5 on a NEW patient's dashboard opens Take case (route without /followup).
//     First case: "7 days" -> header shows today+7 (typed command sent once,
//       saved value read back). Header fits 1366x768 (no horizontal overflow,
//       every header control inside the viewport; screenshots).
//     Past custom date -> inline alert, nothing sent, saved value unchanged.
//     Custom date = today (visible label "Custom date") -> Save -> Today lists
//       the patient under Due today.
//     Ctrl+S in the prose editor and in a table cell -> Saving… then Saved,
//       exactly one case_visit_autosave, focus/caret kept.
//     Clear -> header "Next F/U: —", saved null, Today no longer lists the
//       patient as due/overdue.
//   PHASE B (same session, then a kill/relaunch):
//     F5 on the patient (saved first case) opens the FOLLOW-UP (/followup); the
//       first visit is unchanged (no second first case).
//     Follow-up visit: "7 days" -> header today+7; with the webview TEST CLOCK
//       at today+10 the Today screen lists the patient under Overdue; at the
//       real today it is neither due nor overdue.
//     Kill/relaunch -> the follow-up's date is still today+7 in the header and
//       read back, and the patient is still Overdue under the test clock.
//
// The test clock shifts only argument-less `new Date()` in the webview (see
// pages/next-followup.page.ts); Today anchors today_get_overview on it, so a
// past follow-up is produced WITHOUT writing a past date (which the UI rejects).
//
// Durable markers go to <HC_E2E_OUTDIR>/evidence.log. No sleeps: every wait is
// waitUntil / waitForDisplayed through the page objects; negative checks are
// bounded waitUntil windows.
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { layoutPage } from '../../pages/layout.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { nextFollowupPage as nf } from '../../pages/next-followup.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { searchPage } from '../../pages/search.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { todayPage } from '../../pages/today.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { relaunchInto } from '../../helpers/launch.js';
import { evidence } from '../../helpers/evidence.js';
import { isoPlusDays, todayIso } from '../../helpers/dates.js';

const PIN = '2468';
const PATIENT = 'Vista Nextpatient';
const NONE = 'Next F/U: —';
const SET_CMD = 'visit_set_next_followup';
const SAVE_CMD = 'case_visit_autosave';
/** Longer than the control's commit pause (800 ms) with margin. */
const NO_COMMIT_WINDOW_MS = 2500;
/** Longer than the autosave debounce (2000 ms) with margin. */
const NO_EXTRA_SAVE_WINDOW_MS = 3000;

let patientId = '';
let firstVisitId = '';
let followupVisitId = '';

/** ISO YYYY-MM-DD -> the header's DD-MM-YYYY (shared/datetime.formatDate). */
function dash(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function shotsDir(): string {
  const dir = path.join(process.env.HC_E2E_OUTDIR ?? '.', 'screenshots');
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function currentHash(): Promise<string> {
  return browser.execute(() => window.location.hash);
}

/** Wait until the hash is a case route for `pid`; returns visit id + kind. */
async function waitCaseRoute(pid: string, what: string): Promise<{ visitId: string; followup: boolean }> {
  const re = /^#\/patient\/([^/]+)\/case\/([^/?]+)(\/followup)?$/;
  await browser
    .waitUntil(
      async () => {
        const m = re.exec(await currentHash());
        return m !== null && decodeURIComponent(m[1] ?? '') === pid;
      },
      { timeout: 20000, interval: 100 },
    )
    .catch(async () => {
      throw new Error(`${what}: no case route for the patient, hash=${await currentHash()}`);
    });
  await caseRichPage.waitForForm();
  const m = re.exec(await currentHash());
  return { visitId: decodeURIComponent(m?.[2] ?? ''), followup: m?.[3] !== undefined };
}

/** True when no further `cmd` call (beyond `n`) is spied within `ms` (bounded wait). */
async function noMoreCalls(cmd: string, n: number, ms: number): Promise<boolean> {
  try {
    await browser.waitUntil(async () => (await nf.spiedCalls(cmd)).length > n, { timeout: ms, interval: 100 });
    return false;
  } catch {
    return true;
  }
}

/** Open Today and wait until its lists rendered (registered-today has the patient). */
async function openTodayLoaded(): Promise<{ due: string[]; overdue: string[] }> {
  await todayPage.open();
  await todayPage.waitForRegistered();
  return { due: await todayPage.dueTexts(), overdue: await todayPage.overdueTexts() };
}

/** Put the caret in the prose editor with a real click (no content change). */
async function focusProse(): Promise<void> {
  const ed = caseRichPage.editor();
  await ed.waitForDisplayed({ timeout: 15000 });
  const pm = await ed.$('.ProseMirror');
  await pm.scrollIntoView({ block: 'center' });
  await pm.click();
  await browser
    .waitUntil(async () => (await caseRichPage.caretAndFocus()).editorFocused, { timeout: 10000, interval: 100 })
    .catch(async () => {
      throw new Error(`prose editor did not take focus: ${JSON.stringify(await caseRichPage.caretAndFocus())}`);
    });
}

/**
 * Press the REAL Ctrl+S once on a settled form and prove it saved: Saving…
 * then Saved, exactly one new case_visit_autosave, and no further write.
 */
async function ctrlSAndProve(where: string): Promise<{ seq: string[]; calls: number }> {
  // Settled: the indicator is idle (fresh mount) or Saved, never Saving….
  await browser
    .waitUntil(async () => !(await caseRichPage.saveStatusText()).startsWith('Saving'), { timeout: 20000, interval: 100 })
    .catch(async () => {
      throw new Error(`Ctrl+S in ${where}: form never settled, status ${JSON.stringify(await caseRichPage.saveStatusText())}`);
    });
  // Settled: no write pending (the autosave debounce would add one).
  const before = (await nf.spiedCalls(SAVE_CMD)).length;
  expect(await noMoreCalls(SAVE_CMD, before, NO_EXTRA_SAVE_WINDOW_MS)).toBe(true);
  await nf.startStatusRecorder();
  await nf.pressCtrlS();
  const seq = await nf.waitSavingThenSaved(`Ctrl+S in ${where}`);
  await nf.waitCalls(SAVE_CMD, before + 1, `Ctrl+S in ${where}`);
  expect(await noMoreCalls(SAVE_CMD, before + 1, NO_EXTRA_SAVE_WINDOW_MS)).toBe(true);
  const calls = (await nf.spiedCalls(SAVE_CMD)).length - before;
  expect(calls).toBe(1);
  return { seq, calls };
}

async function unlockAfterRelaunch(): Promise<void> {
  const decided = await bootPage.waitForDecidedScreen();
  expect(decided).toBe('#/lock');
  await lockPage.attempt(PIN);
  await shellPage.waitForShell();
}

describe('M3vis next follow-up PHASE A: first case scheduler, Today due, Ctrl+S, F5 Take case, 1366x768 (VIS-004/005, CASE-005)', () => {
  before(async () => {
    process.env.GDK_BACKEND = 'x11';
    await relaunchInto('main');
  });

  it('M3vis first case: F5 opens Take case, 7 days, header fit, past rejected, custom today -> Due today, Ctrl+S editor and cell, Clear', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();
    const size = await layoutPage.setSize(1366, 768);
    evidence(`[m3vis] window inner ${size.w}x${size.h} after setWindowRect 1366x768`);

    // ---- F5 on a NEW patient -> Take case ---------------------------------
    await patientsPage.openRegister();
    await patientsPage.fillCore({ name: PATIENT, age: '44', city: 'Pune' });
    await patientsPage.saveAndWaitForDashboard();
    // Open the dashboard through global search (F2 -> Enter), the path that
    // deep-links /patients?id=<id>; the shell's F5 reads the open patient from
    // that route (right after Register the URL is still ?view=new).
    await searchPage.openWithF2();
    await searchPage.searchFor(PATIENT);
    await searchPage.openFirstResult();
    await patientsPage.waitForDashboard();
    const dashHash = await currentHash();
    const m = /[?&]id=([^&]+)/.exec(dashHash);
    patientId = decodeURIComponent(m?.[1] ?? '');
    expect(patientId.length).toBeGreaterThan(0);
    await nf.pressF5();
    const take = await waitCaseRoute(patientId, 'F5 on new patient');
    expect(take.followup).toBe(false);
    firstVisitId = take.visitId;
    evidence(`[m3vis] F5 new patient: dashboard ${dashHash} -> ${await currentHash()} (Take case, followup=${String(take.followup)})`);

    await caseRichPage.typeProse('Chief complaint for the M3vis patient');
    await caseRichPage.save();
    expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);
    await nf.installIpcSpy([SET_CMD, SAVE_CMD]);

    // ---- 7 days -> today+7 -------------------------------------------------
    expect(await nf.displayText()).toBe(NONE);
    expect(await nf.clearButton.isEnabled()).toBe(false);
    const plus7 = isoPlusDays(7);
    const label7 = await nf.clickQuick('7d');
    expect(label7).toBe('7 days');
    await nf.waitDisplay(`Next F/U: ${dash(plus7)}`, '7 days');
    const set1 = await nf.waitCalls(SET_CMD, 1, '7 days');
    expect(JSON.stringify(set1[0]?.args)).toContain(plus7);
    expect((await nf.savedNextFollowup(patientId, 'first')).nextFollowupOn).toBe(plus7);
    evidence(`[m3vis] first case "7 days": header "${await nf.displayText()}" (today ${todayIso()} +7 = ${plus7}); ${SET_CMD} x1 args=${JSON.stringify(set1[0]?.args)}; read-back ${plus7}`);

    // ---- Header fit at 1366x768 (screenshots) ------------------------------
    const shots = shotsDir();
    await nf.screenshotHeader(path.join(shots, 'case-header-1366x768.png'));
    await browser.saveScreenshot(path.join(shots, 'case-form-1366x768.png'));
    const fit = await nf.headerFit();
    evidence(
      `[m3vis] header fit 1366x768: inner=${fit.innerWidth}x${fit.innerHeight} docOverflowX=${fit.docOverflowX} ` +
        `header scroll/client=${fit.headerScrollW}/${fit.headerClientW} outside=${JSON.stringify(fit.outside)} ` +
        `boxes=${JSON.stringify(fit.boxes)} screenshots=screenshots/case-header-1366x768.png,screenshots/case-form-1366x768.png`,
    );
    expect(fit.innerWidth).toBeLessThanOrEqual(1366);
    expect(fit.docOverflowX).toBeLessThanOrEqual(1);
    expect(fit.headerScrollW).toBeLessThanOrEqual(fit.headerClientW + 1);
    expect(fit.outside).toEqual([]);

    // ---- Past custom date -> rejected inline, nothing sent ----------------
    const yesterday = isoPlusDays(-1);
    await nf.setCustom(yesterday);
    const err = await nf.waitError();
    expect(err.text).toBe('Pick today or a later date.');
    expect(err.role).toBe('alert');
    expect(err.invalid).toBe('true');
    expect(await nf.displayStays(`Next F/U: ${dash(plus7)}`, NO_COMMIT_WINDOW_MS)).toBe(true);
    expect((await nf.spiedCalls(SET_CMD)).length).toBe(1);
    expect((await nf.savedNextFollowup(patientId, 'first')).nextFollowupOn).toBe(plus7);
    evidence(`[m3vis] past custom ${yesterday}: alert "${err.text}" role=${err.role} aria-invalid=${err.invalid}; ${SET_CMD} still x1; saved still ${plus7}`);

    // ---- Custom date = today -> Save -> Today Due --------------------------
    const lab = await nf.customLabelInfo();
    expect(lab).toEqual({ text: 'Custom date', displayed: true, wrapsInput: true });
    const today = todayIso();
    await nf.setCustom(today);
    await nf.waitDisplay(`Next F/U: ${dash(today)}`, 'custom today');
    await browser.waitUntil(async () => !(await nf.error.isExisting()), { timeout: 10000, timeoutMsg: 'past-date alert did not clear' });
    const set2 = await nf.waitCalls(SET_CMD, 2, 'custom today');
    expect(JSON.stringify(set2[1]?.args)).toContain(today);
    await caseRichPage.save();
    expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);
    expect((await nf.savedNextFollowup(patientId, 'first')).nextFollowupOn).toBe(today);
    const t1 = await openTodayLoaded();
    await todayPage.waitForDue();
    expect(await todayPage.dueContains(PATIENT)).toBe(true);
    expect(await todayPage.overdueContains(PATIENT)).toBe(false);
    evidence(`[m3vis] custom date label "${lab.text}" -> ${today}: header "Next F/U: ${dash(today)}"; ${SET_CMD} x2; Save; Today due=${JSON.stringify(await todayPage.dueTexts())} overdue=${JSON.stringify(t1.overdue)}`);

    // ---- Ctrl+S in the prose editor ----------------------------------------
    await caseRichPage.openVisit(patientId, firstVisitId);
    await nf.waitDisplay(`Next F/U: ${dash(today)}`, 'reopen first case');
    await focusProse();
    const ed = await ctrlSAndProve('prose editor');
    const afterEd = await caseRichPage.caretAndFocus();
    expect(afterEd.editorFocused).toBe(true);
    evidence(`[m3vis] Ctrl+S prose editor: status ${JSON.stringify(ed.seq)}; ${SAVE_CMD} +${ed.calls} (no further write in ${NO_EXTRA_SAVE_WINDOW_MS} ms); editor still focused=${String(afterEd.editorFocused)}`);

    // ---- Ctrl+S in a table cell --------------------------------------------
    await caseRichPage.recordVitals({ sys: '120', dia: '80', pulse: '72' });
    await browser.waitUntil(async () => ((await caseRichPage.tableByType('vitals'))?.rows.length ?? 0) >= 1, {
      timeout: 15000,
      timeoutMsg: 'vitals table did not appear',
    });
    await caseRichPage.clickTableCell('vitals', 1);
    await caseRichPage.waitCaretIn('vitals', 1, 'click vitals row 1');
    const cell = await ctrlSAndProve('vitals table cell');
    const afterCell = await caseRichPage.caretAndFocus();
    expect(afterCell.editorFocused).toBe(true);
    expect(afterCell.tableType).toBe('vitals');
    expect(afterCell.row).toBe(1);
    evidence(`[m3vis] Ctrl+S table cell: status ${JSON.stringify(cell.seq)}; ${SAVE_CMD} +${cell.calls}; caret still ${JSON.stringify(afterCell)}`);

    // ---- Clear -> not due ---------------------------------------------------
    const nSet = (await nf.spiedCalls(SET_CMD)).length;
    await nf.clickClear();
    await nf.waitDisplay(NONE, 'Clear');
    const set3 = await nf.waitCalls(SET_CMD, nSet + 1, 'Clear');
    expect(JSON.stringify(set3[nSet]?.args)).toContain('null');
    expect((await nf.savedNextFollowup(patientId, 'first')).nextFollowupOn).toBeNull();
    expect(await nf.clearButton.isEnabled()).toBe(false);
    const t2 = await openTodayLoaded();
    expect(t2.due.some((x) => x.includes(PATIENT))).toBe(false);
    expect(t2.overdue.some((x) => x.includes(PATIENT))).toBe(false);
    evidence(`[m3vis] Clear: header "${NONE}"; ${SET_CMD} args=${JSON.stringify(set3[nSet]?.args)}; saved null; Today due=${JSON.stringify(t2.due)} overdue=${JSON.stringify(t2.overdue)} registered=${JSON.stringify(await todayPage.registeredTexts())}`);
  });
});

describe('M3vis next follow-up PHASE B: F5 follow-up, follow-up visit scheduler, test-clock Overdue, kill/relaunch (VIS-004/005)', () => {
  it('M3vis follow-up: F5 opens the follow-up, 7 days on the follow-up, Overdue under the test clock, date survives kill/relaunch', async () => {
    // ---- F5 on a patient with a saved first case -> follow-up -------------
    await patientsPage.openDashboard(patientId);
    await nf.pressF5();
    const fu = await waitCaseRoute(patientId, 'F5 on saved-first-case patient');
    expect(fu.followup).toBe(true);
    followupVisitId = fu.visitId;
    expect(followupVisitId).not.toBe(firstVisitId);
    evidence(`[m3vis] F5 saved-first-case patient -> ${await currentHash()} (follow-up ${followupVisitId}, first was ${firstVisitId})`);

    // ---- 7 days on the follow-up visit -------------------------------------
    await nf.installIpcSpy([SET_CMD, SAVE_CMD]);
    const plus7 = isoPlusDays(7);
    const before = (await nf.spiedCalls(SET_CMD)).length;
    await nf.clickQuick('7d');
    await nf.waitDisplay(`Next F/U: ${dash(plus7)}`, 'follow-up 7 days');
    const calls = await nf.waitCalls(SET_CMD, before + 1, 'follow-up 7 days');
    expect(JSON.stringify(calls[before]?.args)).toContain(followupVisitId);
    await caseRichPage.save();
    expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);
    const fuSaved = await nf.savedNextFollowup(patientId, 'follow_up');
    expect(fuSaved).toEqual({ visitId: followupVisitId, nextFollowupOn: plus7 });
    evidence(`[m3vis] follow-up visit "7 days": header "Next F/U: ${dash(plus7)}"; ${SET_CMD} args=${JSON.stringify(calls[before]?.args)}; read-back ${JSON.stringify(fuSaved)}`);

    // No second first case: the dashboard lists exactly the follow-up above
    // the one first visit. (The read-back uses visitType follow_up only: the
    // open-or-create command reuses only the LATEST visit, so asking for
    // 'first' now would itself create a visit.)
    await patientsPage.openDashboard(patientId);
    await browser.waitUntil(async () => (await patientsPage.dashVisitRows()).length >= 2, {
      timeout: 20000,
      timeoutMsg: 'follow-up visit did not appear on the dashboard',
    });
    const rows = await patientsPage.dashVisitRows();
    expect(rows.map((r) => r.type)).toEqual(['Follow-up', 'First']);
    evidence(`[m3vis] dashboard visits after F5 follow-up: ${JSON.stringify(rows)} (one First, no second first case)`);

    // ---- Real today: neither due nor overdue (future) ----------------------
    const real = await openTodayLoaded();
    expect(real.due.some((x) => x.includes(PATIENT))).toBe(false);
    expect(real.overdue.some((x) => x.includes(PATIENT))).toBe(false);

    // ---- Test clock today+10 -> Overdue ------------------------------------
    await patientsPage.openDashboard(patientId);
    const shifted = await nf.shiftClockDays(10);
    expect(shifted).toBe(isoPlusDays(10));
    // (Registered-today is empty under the shifted clock: the patient was
    // registered on the real today, so wait on the Overdue list itself.)
    let clocked: { due: string[]; overdue: string[] };
    try {
      await todayPage.open();
      await todayPage.waitForOverdue();
      clocked = { due: await todayPage.dueTexts(), overdue: await todayPage.overdueTexts() };
    } finally {
      await nf.restoreClock();
    }
    expect(clocked.overdue.some((x) => x.includes(PATIENT))).toBe(true);
    expect(clocked.due.some((x) => x.includes(PATIENT))).toBe(false);
    evidence(`[m3vis] test clock: real today ${todayIso()} due/overdue=${JSON.stringify(real.due)}/${JSON.stringify(real.overdue)}; clock ${shifted} (follow-up ${plus7} in the past) overdue=${JSON.stringify(clocked.overdue)} due=${JSON.stringify(clocked.due)}`);

    // ---- Kill/relaunch: the date survives ----------------------------------
    await relaunchInto('main');
    await unlockAfterRelaunch();
    await caseRichPage.openFollowupVisit(patientId, followupVisitId);
    await nf.waitDisplay(`Next F/U: ${dash(plus7)}`, 'after kill/relaunch');
    const relFu = await nf.savedNextFollowup(patientId, 'follow_up');
    expect(relFu).toEqual({ visitId: followupVisitId, nextFollowupOn: plus7 });
    // The patient-level date (Today's source) survived too: Overdue under the
    // test clock again in the relaunched app.
    await patientsPage.openDashboard(patientId);
    const shifted2 = await nf.shiftClockDays(10);
    let rel: { due: string[]; overdue: string[] };
    try {
      await todayPage.open();
      await todayPage.waitForOverdue();
      rel = { due: await todayPage.dueTexts(), overdue: await todayPage.overdueTexts() };
    } finally {
      await nf.restoreClock();
    }
    expect(rel.overdue.some((x) => x.includes(PATIENT))).toBe(true);
    evidence(`[m3vis] after kill/relaunch: header "Next F/U: ${dash(plus7)}"; follow-up ${JSON.stringify(relFu)}; clock ${shifted2} overdue=${JSON.stringify(rel.overdue)}`);
  });
});
