// @req CASE-001 CASE-003 CASE-005
// @tier stable
// @area case
// @targets linux, windows
//
// M3-RWv6 build-18: CaseForm case-open LOAD GATE. TipTap's useEditor swaps the
// empty pre-load editor for the loaded one in a passive effect AFTER the
// commit that first renders the form; before the fix the form was live on the
// EMPTY editor for about one frame, so an immediate click/save could autosave
// over the opened case. The fix keeps case-form-loading until the editor that
// holds the loaded case is active (CaseForm.tsx editorStale gate).
//
// This spec opens ONE saved case six times (5 gated opens + 1 read-back),
// across two kill/relaunches of the SAME data dir. On every open:
//   - case-form-loading is seen and clears within LOAD_BOUND_MS;
//   - an in-page MutationObserver armed BEFORE navigation sees the FIRST live
//     commit of case-form and records what the editor holds AT THAT INSTANT
//     (complaint count + the saved prose marker), then acts in the same task
//     (Save, or Add new complaint), i.e. inside the one-frame window;
//   - complaint count after the action == before (Save) or before + 1 (Add);
//     the next open (incl after relaunch) proves nothing was dropped on disk.
// Open 5 uses the normal WebDriver path (addComplaint + Save right after
// waitForForm), the closest analogue of a fast human.
//
// Synthetic patient only. No sleeps: every wait is waitUntil.
import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { evidence } from '../../helpers/evidence.js';
import { relaunchInto } from '../../helpers/launch.js';

const PIN = '2468';
const PATIENT_NAME = 'Gatekeeper Testpatient';
const PROSE = 'Loadgate marker prose for the saved case.';
const LOAD_BOUND_MS = 10000;

let patientId = '';
let visitId = '';
const names: string[] = ['Headache', 'Backpain'];

async function unlockAfterRelaunch(): Promise<void> {
  const decided = await bootPage.waitForDecidedScreen();
  expect(decided).toBe('#/lock');
  await lockPage.attempt(PIN);
  await shellPage.waitForShell();
}

/**
 * One gated open of the saved case. `mode`: 'save' / 'add' act in-page at the
 * first live commit; 'wdio-add' adds + saves via WebDriver right after the
 * form appears; 'none' only reads. Returns the complaint count after.
 */
async function gatedOpen(
  n: number,
  mode: 'save' | 'add' | 'wdio-add' | 'none',
  addName = '',
): Promise<number> {
  const before = names.length;
  // Unmount any CaseForm first so this is a real case OPEN.
  await patientsPage.openDashboard(patientId);
  const t0 = Date.now();
  await caseRichPage.openVisitWithProbe(
    patientId,
    visitId,
    mode === 'save' || mode === 'add' ? mode : 'none',
    addName,
    PROSE,
  );
  let cleared = true;
  await browser
    .waitUntil(async () => (await caseRichPage.form.isExisting()) && !(await caseRichPage.isLoading()), {
      timeout: LOAD_BOUND_MS,
      interval: 50,
    })
    .catch(() => {
      cleared = false;
    });
  const clearMs = Date.now() - t0;
  const probe = await caseRichPage.readOpenProbe();
  evidence(
    `[gate] open ${n} (${mode}) loading-cleared=${cleared} in ${clearMs} ms (bound ${LOAD_BOUND_MS}); probe=${JSON.stringify(probe)}`,
  );
  if (!cleared) {
    throw new Error(`open ${n}: case-form-loading did not clear within ${LOAD_BOUND_MS} ms`);
  }
  await caseRichPage.waitForForm();

  // The gate held: the loading state was rendered, and the FIRST live commit of
  // the form already carried the loaded case (all complaints + saved prose).
  expect(probe).not.toBeNull();
  expect(probe?.err).toBeNull();
  expect(probe?.sawLoading).toBe(true);
  expect(probe?.liveMs).not.toBeNull();
  expect(probe?.headersAtLive).toBe(before);
  expect(probe?.markerAtLive).toBe(true);

  if (mode === 'wdio-add') {
    await caseRichPage.addComplaint(addName);
    await caseRichPage.save();
  }
  const adds = mode === 'add' || mode === 'wdio-add';
  const expected = adds ? before + 1 : before;
  if (adds) names.push(addName);
  await browser.waitUntil(async () => (await caseRichPage.complaintHeaders()).length === expected, {
    timeout: 15000,
    timeoutMsg: `open ${n}: expected ${expected} complaints after ${mode}`,
  });
  if (mode !== 'none') {
    const saved = await caseRichPage.waitForSaved();
    expect(saved).toMatch(/^Saved/);
  }
  const headers = await caseRichPage.complaintHeaders();
  expect(headers.length).toBe(expected);
  names.forEach((nm, i) => {
    expect(headers[i]?.text).toMatch(new RegExp(`^${i + 1}\\.\\s*${nm}`));
  });
  expect(await caseRichPage.editorText()).toContain(PROSE);
  evidence(
    `[gate] open ${n} (${mode}) complaints before=${before} atLive=${probe?.headersAtLive} after=${headers.length} ` +
      `[${headers.map((h) => h.text).join(' | ')}] prose-present=true`,
  );
  return headers.length;
}

describe('M3-RWv6 load gate PHASE A: create + save a 2-complaint case, then gated opens 1 (immediate Save) and 2 (immediate Add new complaint)', () => {
  it('never opens the form on an empty editor and never drops complaints (same session)', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    await patientsPage.openRegister();
    await patientsPage.fillCore({ name: PATIENT_NAME, age: '52', city: 'Satara' });
    await patientsPage.saveAndWaitForDashboard();
    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();
    ({ patientId, visitId } = await caseRichPage.routeIds());

    await caseRichPage.addComplaint(names[0] as string);
    await browser.waitUntil(async () => (await caseRichPage.complaintHeaders()).length === 1, {
      timeout: 15000,
      timeoutMsg: 'first complaint not created',
    });
    await caseRichPage.typeProse(PROSE);
    await caseRichPage.addComplaint(names[1] as string);
    await browser.waitUntil(async () => (await caseRichPage.complaintHeaders()).length === 2, {
      timeout: 15000,
      timeoutMsg: 'second complaint not created',
    });
    await caseRichPage.save();
    expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);
    evidence(`[gate] seeded saved case: 2 complaints [${names.join(', ')}] + prose marker`);

    expect(await gatedOpen(1, 'save')).toBe(2);
    expect(await gatedOpen(2, 'add', 'Cough')).toBe(3);
  });
});

describe('M3-RWv6 load gate PHASE B: kill/relaunch, gated opens 3 (immediate Save) and 4 (immediate Add new complaint)', () => {
  before(async () => {
    await relaunchInto('main');
  });

  it('after kill/relaunch the gate still holds and the saved complaints survive', async () => {
    await unlockAfterRelaunch();
    expect(await gatedOpen(3, 'save')).toBe(3);
    expect(await gatedOpen(4, 'add', 'Fever')).toBe(4);
  });
});

describe('M3-RWv6 load gate PHASE C: kill/relaunch, gated open 5 (WebDriver Add + Save right after the form appears) and a read-back open', () => {
  before(async () => {
    await relaunchInto('main');
  });

  it('after a second kill/relaunch every complaint is kept and the read-back matches', async () => {
    await unlockAfterRelaunch();
    expect(await gatedOpen(5, 'wdio-add', 'Cold')).toBe(5);
    expect(await gatedOpen(6, 'none')).toBe(5);
    evidence(`[gate] FINAL read-back: 5 complaints [${names.join(', ')}] after 6 opens and 2 kill/relaunches`);
  });
});
