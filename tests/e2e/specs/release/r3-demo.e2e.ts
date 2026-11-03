// @req CASE-001 CASE-005 VIS-001 VIS-004 VIS-005
// @tier regression
// @area release
// @targets linux, windows
//
// HC-MVP1-217 — the R3 "Paper replacement" demo as ONE regression spec, end to
// end on the built Tauri app (docs/milestones/R3-brief.md demo script;
// R-DEL-005 release gate). Network disabled (product rule 1), boot-gate aware,
// isolated per-spec data dir, synthetic patient only.
//
// ── The demo AS DELIVERED (journal case model) ──────────────────────────────
// The brief's demo step 2 reads "Add a follow-up with complaint statuses and
// improvement %". The product owner replaced the structured S09 status /
// improvement sliders with the journal case model (ADR 0019; docs/ui/
// S08-case-form.md): ONE rich case document of numbered complaint sections,
// where a follow-up is a DATED FOLLOW-UP ENTRY (`<name>-follow-up — <date>`)
// under the complaint, carrying its own record tables. This spec runs the demo
// as delivered; it does not look for sliders.
//
//   Demo 1 (CASE-001, CASE-005 headline) — PHASE A + B, one data dir 'main':
//     A: provision -> register a patient -> Take case -> Add new complaint ->
//        type case text -> Record vitals + physical generals + family history.
//        That earlier part is persisted by AUTOSAVE alone (Save is never
//        clicked): the spec waits for a case_visit_autosave call and the
//        "Saved" indicator, then for the form to settle (no further write).
//        Then MORE typing goes in with the caret left in the editor (no blur
//        flush) and the app is KILLED at once: relaunchInto('main') reaps the
//        app with SIGKILL (helpers/driver.ts reapDriverChain, pkill -9).
//     B: relaunch on the SAME data dir -> #/lock -> PIN -> reopen the visit ->
//        everything up to the last autosave is restored: the complaint
//        section, the case text, and the vitals / generals / family tables
//        with their values. Whether the in-flight tail (typed < 2 s before the
//        kill) survived is logged, not asserted — the guarantee is "nothing
//        that was autosaved is lost".
//   Demo 2 (VIS-001) — PHASE C: dashboard Follow-up -> the follow-up visit
//     opens with the prior record pre-loaded (case text + family history);
//     Add follow-up entry under the complaint -> a `<name>-follow-up` entry;
//     Record vitals there -> a NEW vitals table in the follow-up entry (the
//     first entry's vitals unchanged). Save.
//   Demo 3 (VIS-004, VIS-005) — PHASE C: Next follow-up = today on the
//     follow-up -> Today lists the patient under Due today; the webview TEST
//     CLOCK moved one day on (pages/next-followup.page.ts shiftClockDays, as
//     case-nextfollowup-m3vis.e2e.ts does) -> the patient is under Overdue.
//     Today anchors today_get_overview on new Date(), so no past date is ever
//     written (the UI rejects one).
//   Dashboard Visits (VIS-001) — PHASE C: newest first, both visits listed
//     (Follow-up above First).
//   Demo 4 ("upgrade install over R2 keeps all patients") is the R2 -> R3 hop
//     of specs/release/upgrade-path.e2e.ts (PHASE E/F), same regression tier;
//     not duplicated here.
//
// Windows: @targets includes windows; there is no Windows runner in this
// environment, so the spec has been validated on Linux only.
//
// Durable markers go to <HC_E2E_OUTDIR>/evidence.log. No sleeps: every wait is
// waitUntil / waitForDisplayed through the page objects; negative checks are
// bounded waitUntil windows.
import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { nextFollowupPage as nf } from '../../pages/next-followup.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { todayPage } from '../../pages/today.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { relaunchInto } from '../../helpers/launch.js';
import { evidence } from '../../helpers/evidence.js';
import { isoPlusDays, todayIso } from '../../helpers/dates.js';

const PIN = '3579';
const PATIENT = 'Revati Demopatient';
const COMPLAINT = 'Migraine';
const FOLLOWUP_SUFFIX = '-follow-up';
const SAVE_CMD = 'case_visit_autosave';
/** Longer than the autosave debounce (2000 ms) with margin. */
const SETTLE_WINDOW_MS = 3000;

const CASE_TEXT = 'Right-sided throbbing headache for 3 years, worse from sun and noise.';
const TAIL_TEXT = 'Still typing when the power went off';
const V = { sys: '128', dia: '84', pulse: '76', weight: '61', height: '160' };
const GENERALS = { appetite: 'Poor in mornings', thirst: 'Thirstless', thermal: 'Chilly', constitution: 'Lean' };
const FAMILY_MATERNAL = 'Diabetes (mother)';
const FAMILY_PATERNAL = 'Hypertension (father)';
const FU_V = { sys: '118', dia: '78', pulse: '70' };
const FU_TEXT = 'Follow-up: headaches less frequent, sleep better.';

// Vitals seed column order (schema §4a): BP sys, BP dia, Pulse, Weight, Height, BMI, Temp, SpO2.
const COL_SYS = 0;
const COL_DIA = 1;
const COL_PULSE = 2;

let patientId = '';
let firstVisitId = '';

type Entries = Awaited<ReturnType<typeof caseRichPage.entryTables>>;

/** ISO YYYY-MM-DD -> the header's DD-MM-YYYY (shared/datetime.formatDate). */
function dash(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function tablesOf(entries: Entries, entry: number, type: string): { rows: string[][] }[] {
  return (entries[entry]?.tables ?? []).filter((t) => t.type === type);
}

/** All cell text of every table of `type` in the editor, joined (order-free checks). */
async function tableText(type: string): Promise<string> {
  const ts = (await caseRichPage.tables()).filter((t) => t.tableType === type);
  return ts.map((t) => t.rows.map((r) => r.join(' | ')).join('\n')).join('\n');
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

/**
 * Wait until AUTOSAVE (never the Save button) has persisted the form: at
 * least `minCalls` case_visit_autosave calls, the indicator reads "Saved…",
 * and no further write follows within the debounce window. Returns the calls.
 */
async function waitAutosaveSettled(minCalls: number, what: string): Promise<number> {
  await nf.waitCalls(SAVE_CMD, minCalls, what, 20000);
  for (let i = 0; i < 10; i += 1) {
    await caseRichPage.waitForSaved();
    const n = (await nf.spiedCalls(SAVE_CMD)).length;
    if (await noMoreCalls(SAVE_CMD, n, SETTLE_WINDOW_MS)) {
      if ((await caseRichPage.saveStatusText()).startsWith('Saved')) return n;
    }
  }
  throw new Error(`${what}: autosave never settled (status ${JSON.stringify(await caseRichPage.saveStatusText())})`);
}

async function unlockAfterRelaunch(): Promise<void> {
  const decided = await bootPage.waitForDecidedScreen();
  expect(decided).toBe('#/lock');
  await expect(bootPage.lockCard).toBeDisplayed();
  await lockPage.attempt(PIN);
  await shellPage.waitForShell();
}

describe('HC-MVP1-217 R3 demo PHASE A: detailed case with vitals, physical generals and family history; autosave; KILL mid-typing (CASE-001, CASE-005)', () => {
  it('registers a patient, takes the case, records the tables, lets autosave persist it, types more and kills the app', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    // ---- Register a patient -> dashboard -> Take case ---------------------
    await patientsPage.openRegister();
    await expect(patientsPage.form).toBeDisplayed();
    await patientsPage.fillCore({ name: PATIENT, age: '36', city: 'Pune' });
    await patientsPage.saveAndWaitForDashboard();
    expect(await patientsPage.dashboardText()).toContain(PATIENT);

    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();
    ({ patientId, visitId: firstVisitId } = await caseRichPage.routeIds());
    expect(patientId.length).toBeGreaterThan(0);
    expect(firstVisitId.length).toBeGreaterThan(0);
    await nf.installIpcSpy([SAVE_CMD]);

    // ---- Add new complaint + case text ------------------------------------
    await caseRichPage.addComplaint(COMPLAINT);
    await browser.waitUntil(
      async () => (await caseRichPage.complaintHeaders()).some((c) => c.text.includes(COMPLAINT)),
      { timeout: 15000, timeoutMsg: 'Add new complaint did not create the numbered complaint section' },
    );
    await caseRichPage.typeProse(CASE_TEXT);

    // ---- Record vitals + physical generals + family history ---------------
    await caseRichPage.recordVitals(V);
    await caseRichPage.recordGenerals(GENERALS);
    await caseRichPage.recordFamily(FAMILY_MATERNAL, FAMILY_PATERNAL);
    await browser.waitUntil(
      async () => {
        const types = (await caseRichPage.tables()).map((t) => t.tableType);
        return ['vitals', 'physical_generals', 'family_history'].every((t) => types.includes(t));
      },
      { timeout: 15000, timeoutMsg: 'vitals / physical generals / family history tables were not all inserted' },
    );
    expect(await caseRichPage.tableCellText('vitals', 0, COL_SYS)).toBe(V.sys);
    expect(await caseRichPage.tableCellText('vitals', 0, COL_DIA)).toBe(V.dia);
    expect(await caseRichPage.tableCellText('vitals', 0, COL_PULSE)).toBe(V.pulse);

    // ---- AUTOSAVE (no Save click) persists the earlier part ---------------
    const calls = await waitAutosaveSettled(1, 'autosave of the case text + tables');
    const savedStatus = await caseRichPage.saveStatusText();
    evidence(
      `[r3demo] A: patient ${patientId} visit ${firstVisitId}; complaint "${COMPLAINT}" + case text + vitals/generals/family; ` +
        `autosaved WITHOUT Save: ${SAVE_CMD} x${calls}, status "${savedStatus}", settled (no write in ${SETTLE_WINDOW_MS} ms)`,
    );

    // ---- More typing, caret left in the editor, then KILL -----------------
    await caseRichPage.typeProse(TAIL_TEXT, undefined, false);
    const typedAt = Date.now();
    await relaunchInto('main');
    evidence(
      `[r3demo] A: typed "${TAIL_TEXT}" with no blur flush, then KILLED the app (SIGKILL via relaunch) ` +
        `${Date.now() - typedAt} ms later (autosave debounce 2000 ms)`,
    );
  });
});

describe('HC-MVP1-217 R3 demo PHASE B: relaunch on the same data dir restores everything up to the last autosave (CASE-005 headline)', () => {
  it('unlocks the relaunched app and the reopened case holds the complaint, case text and all three tables with their values', async () => {
    await unlockAfterRelaunch();
    await caseRichPage.openVisit(patientId, firstVisitId);

    await browser.waitUntil(
      async () => (await caseRichPage.complaintHeaders()).some((c) => c.text.includes(COMPLAINT)),
      { timeout: 20000, timeoutMsg: 'complaint section was not restored after the kill' },
    );
    const text = await caseRichPage.editorText();
    expect(text).toContain(CASE_TEXT);
    expect(await caseRichPage.tableCellText('vitals', 0, COL_SYS)).toBe(V.sys);
    expect(await caseRichPage.tableCellText('vitals', 0, COL_DIA)).toBe(V.dia);
    expect(await caseRichPage.tableCellText('vitals', 0, COL_PULSE)).toBe(V.pulse);
    const generals = await tableText('physical_generals');
    for (const v of Object.values(GENERALS)) expect(generals).toContain(v);
    const family = await tableText('family_history');
    expect(family).toContain('Diabetes');
    expect(family).toContain('Hypertension');
    evidence(
      `[r3demo] B: after kill + relaunch + PIN: complaint "${COMPLAINT}", case text, vitals ${V.sys}/${V.dia} pulse ${V.pulse}, ` +
        `generals [${Object.values(GENERALS).join(', ')}], family [${FAMILY_MATERNAL}; ${FAMILY_PATERNAL}] restored; ` +
        `in-flight tail survived=${String(text.includes(TAIL_TEXT))}`,
    );
  });
});

describe('HC-MVP1-217 R3 demo PHASE C: follow-up entry with its own vitals, next follow-up Due today then Overdue on the test clock, dashboard visits newest first (VIS-001, VIS-004, VIS-005)', () => {
  it('opens the follow-up from the dashboard with the prior record, adds a follow-up entry with vitals, schedules today, and Today moves the patient from Due to Overdue', async () => {
    // ---- Follow-up from the dashboard -> prior record pre-loaded ----------
    await patientsPage.openDashboard(patientId);
    await patientsPage.dashFollowup();
    await caseRichPage.waitForForm();
    const hash = await browser.execute(() => window.location.hash);
    expect(hash).toMatch(/\/followup$/);
    const followupVisitId = (await caseRichPage.routeIds()).visitId;
    expect(followupVisitId).not.toBe(firstVisitId);
    await browser.waitUntil(async () => (await caseRichPage.editorText()).includes(CASE_TEXT), {
      timeout: 20000,
      timeoutMsg: 'prior case text was not pre-loaded into the follow-up',
    });
    await browser.waitUntil(async () => (await caseRichPage.tableByType('family_history')) !== undefined, {
      timeout: 20000,
      timeoutMsg: 'prior family-history table was not pre-loaded into the follow-up',
    });
    expect(await tableText('family_history')).toContain('Diabetes');
    expect(await tableText('family_history')).toContain('Hypertension');
    evidence(`[r3demo] C: dashboard Follow-up -> ${hash}; prior case text + family history pre-loaded`);

    // ---- Add follow-up entry under the complaint -> '<name>-follow-up' ----
    await caseRichPage.focusComplaintByName(COMPLAINT);
    const before = (await caseRichPage.entryHeadings()).length;
    await caseRichPage.addFollowupEntry();
    await browser.waitUntil(async () => (await caseRichPage.entryHeadings()).length === before + 1, {
      timeout: 15000,
      timeoutMsg: 'Add follow-up entry did not append an entry',
    });
    const headings = await caseRichPage.entryHeadings();
    const fu = headings[headings.length - 1];
    expect(fu?.kind).toBe('follow_up');
    expect(fu?.text).toContain(`${COMPLAINT}${FOLLOWUP_SUFFIX}`);

    // ---- Record vitals in the follow-up entry -> a NEW table there --------
    let entries = await caseRichPage.entryTables();
    const last = entries.length - 1;
    expect(tablesOf(entries, last, 'vitals').length).toBe(0);
    const firstEntryVitals = JSON.stringify(tablesOf(entries, 0, 'vitals'));
    await caseRichPage.recordVitals(FU_V);
    await browser.waitUntil(
      async () => tablesOf(await caseRichPage.entryTables(), last, 'vitals').length === 1,
      { timeout: 15000, timeoutMsg: 'Record vitals in the follow-up entry did not create a vitals table there' },
    );
    entries = await caseRichPage.entryTables();
    const fuRow = tablesOf(entries, last, 'vitals')[0]?.rows[0] ?? [];
    expect(fuRow[COL_SYS]).toBe(FU_V.sys);
    expect(fuRow[COL_DIA]).toBe(FU_V.dia);
    expect(fuRow[COL_PULSE]).toBe(FU_V.pulse);
    expect(JSON.stringify(tablesOf(entries, 0, 'vitals'))).toBe(firstEntryVitals);
    await caseRichPage.typeProse(FU_TEXT);
    await caseRichPage.save();
    expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);
    evidence(
      `[r3demo] C: follow-up entry "${fu?.text}" (kind ${fu?.kind}) with its OWN vitals table ${JSON.stringify(fuRow)}; ` +
        `first entry vitals unchanged; saved`,
    );

    // ---- Next follow-up = today -> Today: Due today -----------------------
    const today = todayIso();
    await nf.setCustom(today);
    await nf.waitDisplay(`Next F/U: ${dash(today)}`, 'next follow-up today');
    await caseRichPage.save();
    expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);
    expect(await nf.savedNextFollowup(patientId, 'follow_up')).toEqual({
      visitId: followupVisitId,
      nextFollowupOn: today,
    });
    await todayPage.open();
    await todayPage.waitForDue();
    expect(await todayPage.dueContains(PATIENT)).toBe(true);
    expect(await todayPage.overdueContains(PATIENT)).toBe(false);
    evidence(`[r3demo] C: next follow-up ${today} -> Today due=${JSON.stringify(await todayPage.dueTexts())}`);

    // ---- Test clock past the date -> Today: Overdue -----------------------
    await patientsPage.openDashboard(patientId);
    const shifted = await nf.shiftClockDays(1);
    expect(shifted).toBe(isoPlusDays(1));
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
    evidence(
      `[r3demo] C: test clock ${shifted} (follow-up ${today} now past) -> Today overdue=${JSON.stringify(clocked.overdue)} ` +
        `due=${JSON.stringify(clocked.due)}`,
    );

    // ---- Dashboard Visits: newest first, both visits ----------------------
    await patientsPage.openDashboard(patientId);
    await browser.waitUntil(async () => (await patientsPage.dashVisitRows()).length >= 2, {
      timeout: 20000,
      timeoutMsg: 'dashboard did not list both visits',
    });
    const rows = await patientsPage.dashVisitRows();
    expect(rows.map((r) => r.type)).toEqual(['Follow-up', 'First']);
    for (const r of rows) expect(r.date.length).toBeGreaterThan(0);
    evidence(`[r3demo] C: dashboard visits newest first = ${JSON.stringify(rows)}`);
  });
});
