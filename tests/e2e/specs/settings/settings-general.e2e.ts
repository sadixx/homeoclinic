// @req SET-002 SET-003 SET-004 SET-005 PAT-002 SUX-005 LIC-006
// @tier regression
// @area settings
// @targets linux, windows
//
// MS (S18 Settings, General tab): one admin form, one Save.
//
//   1. Provision, register patient A under the default ID prefix.
//   2. Settings -> Cancel reverts an edit (AC1, admin form, no autosave).
//   3. Edit doctor (qualification, phone, email, council) and clinic (name,
//      address, both fees, Morning + Evening timings), ID prefix, auto-lock 5,
//      font Large. Evening error path first: Evening 8:30 -> 5:00 is refused
//      with the inline order error, the Evening tab comes forward and nothing
//      is saved; fixed to 5:00 -> 8:30 the Save succeeds.
//   4. Font Large applies app-wide at once: <html data-hc-font-size="large">,
//      root 16 px (was 14 px) on Settings, Today and Patients (SET-005).
//   5. Auto-lock change takes effect in the same session: idle with no input,
//      the shell locks after ~5 min (the saved value), far before the 15 min
//      default (SET-004 / SUX-005: live applySaved, not a frozen boot value).
//   6. Close + relaunch + PIN unlock: every saved value reads back, font still
//      Large on Today (SET-002/003/005 persist).
//   7. Register patient B: its code uses the NEW prefix and the running
//      number continues; patient A keeps its old code (PAT-002).
import { browser, expect } from '@wdio/globals';

import { evidence } from '../../helpers/evidence.js';
import { enterUnlockedApp, provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { bootPage } from '../../pages/boot.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { searchPage } from '../../pages/search.page.js';
import { settingsPage } from '../../pages/settings.page.js';
import { shellPage } from '../../pages/shell.page.js';

const PIN = '2468';
const NEW_PREFIX = 'MSX-';
const NEW_COUNCIL = 'Karnataka: Karnataka Board of Homoeopathic System of Medicine';
const EVENING_ORDER_ERROR = 'The To time must be after the From time.';

const EDIT = {
  qual: 'BHMS, MD (Hom)',
  phone: '9822012345',
  email: 'clinic@example.test',
  clinicName: 'Settings Edit Homoeo Clinic',
  address: '7 Station Road, Nashik 422001',
  feeConsult: '650',
  feeFollowup: '325.50',
};

function splitCode(code: string): { prefix: string; n: number } {
  const m = /^(.*?)(\d+)$/.exec(code);
  if (m === null) throw new Error(`bad code ${code}`);
  return { prefix: m[1] ?? '', n: Number(m[2]) };
}

async function registerPatient(name: string): Promise<{ id: string; code: string }> {
  await patientsPage.openRegister();
  await patientsPage.fillCore({ name, age: '41' });
  await patientsPage.saveAndWaitForDashboard();
  // The id/code the typed patient_search returns for this unique name; the
  // dashboard the doctor sees shows that same code.
  const rows = await searchPage.searchRows(name);
  expect(rows.length).toBe(1);
  const row = rows[0];
  if (row === undefined) throw new Error(`patient ${name} not found`);
  expect(await patientsPage.dashboardText()).toContain(row.code);
  return { id: row.patientId, code: row.code };
}

async function expectRootFont(where: string, attr: string, px: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      const s = await settingsPage.fontState();
      return s.attr === attr && s.rootPx === px;
    },
    { timeout: 10000, timeoutMsg: `${where}: root font never became ${attr}/${px}` },
  );
  const s = await settingsPage.fontState();
  expect(s.bodyTextPx).toBe(px);
  evidence(`[ms-general] ${where}: html data-hc-font-size=${s.attr} root=${s.rootPx} content-area=${s.bodyTextPx}`);
}

describe('MS settings General: edit, Evening error path, font, auto-lock, relaunch, ID prefix (SET-002..005, PAT-002)', function () {
  // Step 5 waits ~5 min of real idle time; WebdriverIO wraps each it() so a
  // per-test this.timeout() is ignored -> set it on the suite (describe is not wrapped).
  this.timeout(12 * 60 * 1000);
  let patientA: { id: string; code: string };

  it('MS general step 1-2: provision, register patient A, Cancel reverts an edit', async () => {
    expect(await bootPage.waitForDecidedScreen()).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);

    patientA = await registerPatient('Anil Oldprefix');
    evidence(`[ms-general] patient A registered with code ${patientA.code}`);

    await settingsPage.openViaNav();
    const before = await settingsPage.value('settings-clinic-name');
    await settingsPage.setText('settings-clinic-name', 'Cancelled Name');
    await settingsPage.cancel.click();
    await browser.waitUntil(
      async () => (await settingsPage.value('settings-clinic-name')) === before,
      { timeout: 10000, timeoutMsg: 'Cancel did not revert the clinic name' },
    );
    expect(await settingsPage.saved.isExisting()).toBe(false);
    expect(splitCode(await settingsPage.nextId.getText()).prefix).toBe(splitCode(patientA.code).prefix);
    await expectRootFont('settings before save (Normal)', 'normal', '14px');
    evidence(`[ms-general] Cancel reverted clinic name to "${before}"`);
  });

  it('MS general step 3-4: Evening 8:30->5:00 is refused, fixed Save persists all fields, Large applies app-wide', async () => {
    await settingsPage.setText('settings-doctor-qual', EDIT.qual);
    await settingsPage.setText('settings-doctor-phone', EDIT.phone);
    await settingsPage.setText('settings-doctor-email', EDIT.email);
    await settingsPage.selectCouncil(NEW_COUNCIL);
    await settingsPage.setText('settings-clinic-name', EDIT.clinicName);
    await settingsPage.setText('settings-clinic-address', EDIT.address);
    await settingsPage.setText('settings-fee-consult', EDIT.feeConsult);
    await settingsPage.setText('settings-fee-followup', EDIT.feeFollowup);
    await settingsPage.setSession('morning', ['9', '30'], ['1', '00']);
    // Evening error path: end before start.
    await settingsPage.setSession('evening', ['8', '30'], ['5', '00']);
    await settingsPage.setText('settings-id-prefix', NEW_PREFIX);
    await settingsPage.setAutolock(5);
    await settingsPage.setFontSize('large');

    // Bring Morning forward so the Save has to bring Evening back itself.
    await settingsPage.selectTimingsTab('morning');
    await settingsPage.save.click();
    await settingsPage.waitError('settings-clinic-timings-evening', EVENING_ORDER_ERROR);
    await expect(settingsPage.timingsPanel('evening')).toBeDisplayed();
    await expect(settingsPage.formError).toBeDisplayed();
    expect(await settingsPage.saved.isExisting()).toBe(false);
    expect(await settingsPage.errorText('settings-clinic-timings-morning')).toBeNull();
    // Nothing applied: still Normal.
    expect((await settingsPage.fontState()).attr).toBe('normal');
    evidence(`[ms-general] Evening 8:30->5:00 refused: inline "${EVENING_ORDER_ERROR}", evening tab forward, form error, no save, font still normal`);

    await settingsPage.setSession('evening', ['5', '00'], ['8', '30']);
    const savedText = await settingsPage.saveAndWait();
    expect(savedText).toBe('Settings saved.');
    expect(await settingsPage.errorText('settings-clinic-timings-evening')).toBeNull();
    const nextId = await settingsPage.nextId.getText();
    expect(nextId.startsWith(NEW_PREFIX)).toBe(true);
    evidence(`[ms-general] Save ok ("${savedText}"), next id preview ${nextId}`);

    // Font Large applies app-wide at once.
    await expectRootFont('settings after save', 'large', '16px');
    await shellPage.navToday.click();
    await shellPage.todayScreen.waitForDisplayed({ timeout: 15000 });
    await expectRootFont('today', 'large', '16px');
    await patientsPage.openList();
    await expectRootFont('patients list', 'large', '16px');
  });

  it('MS general step 5: the saved 5-minute auto-lock takes effect in the same session', async () => {
    // Last user activity: a real click on the nav (resets the idle timer).
    await shellPage.navToday.click();
    await shellPage.todayScreen.waitForDisplayed({ timeout: 15000 });
    // TEST-ONLY diagnostics (no events, no product state): a page heartbeat
    // proves page JS timers keep running, and capture-phase listeners record
    // every activity event the idle timer listens to, with the time of the
    // last one. The product rule is "lock N minutes after the LAST activity";
    // on this host GTK / WebKit occasionally emit a synthetic mousemove with
    // no input (focus-out, hover update: build-4 round-1/round-4 evaluations),
    // which legitimately restarts the countdown — so the lock is timed from
    // the last recorded activity, not from the click.
    const tClick = Date.now();
    await browser.execute((t: number) => {
      const w = window as unknown as { __hcIdleDiag?: { hb: number; ev: Record<string, number>; lastMs: number } };
      const diag = { hb: 0, ev: {} as Record<string, number>, lastMs: t };
      w.__hcIdleDiag = diag;
      window.setInterval(() => {
        diag.hb += 1;
      }, 1000);
      for (const evt of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']) {
        window.addEventListener(evt, () => {
          diag.ev[evt] = (diag.ev[evt] ?? 0) + 1;
          diag.lastMs = Date.now();
        }, { capture: true, passive: true });
      }
    }, tClick);
    const diag = async (): Promise<string> =>
      JSON.stringify(
        await browser.execute(() => {
          const w = window as unknown as { __hcIdleDiag?: { hb: number; ev: Record<string, number>; lastMs: number } };
          return {
            hash: window.location.hash,
            heartbeatS: w.__hcIdleDiag?.hb ?? null,
            activity: w.__hcIdleDiag?.ev ?? null,
            lastActivity: w.__hcIdleDiag ? new Date(w.__hcIdleDiag.lastMs).toISOString() : null,
            visibility: document.visibilityState,
            hasFocus: document.hasFocus(),
          };
        }),
      );
    const t0 = Date.now();
    let polls = 0;
    try {
      await browser.waitUntil(
        async () => {
          polls += 1;
          if (polls % 30 === 0) evidence(`[ms-general] idle t+${Math.round((Date.now() - t0) / 1000)}s ${await diag()}`);
          return (await settingsPage.hash()).startsWith('#/lock');
        },
        { timeout: 10 * 60 * 1000, interval: 2000, timeoutMsg: 'idle auto-lock did not fire within 10 min of a 5 min setting' },
      );
    } catch (err) {
      evidence(`[ms-general] idle auto-lock NOT fired after ${Math.round((Date.now() - t0) / 1000)}s ${await diag().catch((e: unknown) => `diag failed: ${String(e)}`)}`);
      throw err;
    }
    const tLock = Date.now();
    const elapsedS = Math.round((tLock - t0) / 1000);
    await expect(lockPage.card).toBeDisplayed();
    const lastMs = await browser.execute(
      () => (window as unknown as { __hcIdleDiag?: { lastMs: number } }).__hcIdleDiag?.lastMs ?? 0,
    );
    const sinceLastS = Math.round((tLock - Math.max(lastMs, tClick)) / 1000);
    // 5 min configured: the lock comes ~300 s after the last activity (2 s
    // polling); the 15 min default would come at ~900 s.
    expect(sinceLastS).toBeGreaterThanOrEqual(285);
    expect(sinceLastS).toBeLessThanOrEqual(330);
    evidence(`[ms-general] idle auto-lock fired after ${elapsedS}s, ${sinceLastS}s after the last activity event (configured 5 min, default 15 min) ${await diag()}`);
    await lockPage.attempt(PIN);
    await shellPage.waitForShell();
  });

  it('MS general step 6-7: relaunch keeps every value; new patient gets the new prefix, patient A unchanged', async () => {
    await enterUnlockedApp('main', PIN);
    await expectRootFont('today after relaunch', 'large', '16px');

    await settingsPage.openViaNav();
    expect(await settingsPage.value('settings-doctor-qual')).toBe(EDIT.qual);
    expect(await settingsPage.value('settings-doctor-phone')).toBe(EDIT.phone);
    expect(await settingsPage.value('settings-doctor-email')).toBe(EDIT.email);
    expect(await settingsPage.councilText()).toBe(NEW_COUNCIL);
    expect(await settingsPage.value('settings-clinic-name')).toBe(EDIT.clinicName);
    expect(await settingsPage.value('settings-clinic-address')).toBe(EDIT.address);
    expect(await settingsPage.value('settings-fee-consult')).toBe('650.00');
    expect(await settingsPage.value('settings-fee-followup')).toBe('325.50');
    expect(await settingsPage.readSession('morning')).toEqual(['9', '30', '1', '00']);
    expect(await settingsPage.readSession('evening')).toEqual(['5', '00', '8', '30']);
    expect(await settingsPage.value('settings-id-prefix')).toBe(NEW_PREFIX);
    expect(await settingsPage.autolock.getValue()).toBe('5');
    expect(await settingsPage.checkedFontSize()).toBe('large');
    evidence(`[ms-general] after relaunch: qual/phone/email/council "${NEW_COUNCIL}"/clinic/address/fees 650.00+325.50/timings M 9:30-1:00 E 5:00-8:30/prefix ${NEW_PREFIX}/autolock 5/font large all kept`);

    const patientB = await registerPatient('Bina Newprefix');
    const a = splitCode(patientA.code);
    const b = splitCode(patientB.code);
    expect(b.prefix).toBe(NEW_PREFIX);
    expect(a.prefix).not.toBe(NEW_PREFIX);
    expect(b.n).toBe(a.n + 1);

    await patientsPage.openDashboard(patientA.id);
    expect(await patientsPage.dashboardText()).toContain(patientA.code);
    expect((await searchPage.searchRows('Anil Oldprefix'))[0]?.code).toBe(patientA.code);
    evidence(`[ms-general] patient B code ${patientB.code} (new prefix, number continues); patient A still ${patientA.code}`);
  });
});
