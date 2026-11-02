// @req SET-002, SET-003
// @tier stable
// @area settings
// @targets linux
//
// M3-RWv6 S01 first-run setup refinements, driven through the real wizard on
// a fresh, isolated data dir (no network, synthetic data only):
//
//   item 1: every registration-council option reads '<State>: <Authority>';
//           no option contains an em dash (U+2014).
//   item 2: the phone is asked ONCE, on Step 1. Step 2 renders no phone
//           control. The Step-1 number is sent as BOTH the doctor phone
//           (setup_save_doctor_profile) and the clinic phone
//           (setup_save_clinic_profile).
//   item 3: clinic timings are Morning / Evening tabs of hour + minute boxes
//           with AM/PM set automatically; hour 13 and minute 60 are rejected
//           inline, To-before-From is rejected inline, and the valid entry
//           is saved as 'Morning 9:30 AM-1:00 PM; Evening 5:00 PM-8:30 PM'.
//
// HOW THE SAVED VALUES ARE OBSERVED. No command reads the staged doctor /
// clinic profile back (bindings: setup_get_state / setup_save_* only), and
// RWv6 forbids a schema or binding change. So the spec wraps
// window.__TAURI_INTERNALS__.invoke with a PASS-THROUGH spy
// (setupPage.installIpcSpy): the real command still runs with the unchanged
// payload; the spy only records what the UI actually sent. The wizard only
// advances on an ok reply, and Finish reaching Today proves the backend
// accepted and flushed both profiles. Re-opening a stored value (parse back,
// legacy text kept as text) has no UI path today (the wizard seeds '');
// that is covered by setup/clinicTimings.rwv6.test.ts + SetupWizard.rwv6.test.tsx.
//
// No sleeps; all waits are waitUntil / waitForDisplayed via page objects.
import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { DEFAULT_COUNCIL_LABEL, setupPage } from '../../pages/setup.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { evidence } from '../../helpers/evidence.js';

const PIN = '8642';
// Synthetic 10-digit mobile (not a real person).
const PHONE = '9000012345';
const EXPECTED_TIMINGS = 'Morning 9:30 AM-1:00 PM; Evening 5:00 PM-8:30 PM';

/** Press Next on Step 2 and assert the wizard stayed on Step 2. */
async function nextStaysOnStep2(): Promise<void> {
  await setupPage.next.click();
  // The rejection is synchronous client-side validation; wait for any inline
  // timings error to render, then prove the step did not advance.
  await browser.waitUntil(
    async () =>
      (await browser.execute(
        () => document.querySelectorAll('[data-testid^="setup-clinic-timings-"][data-testid$="-error"]').length,
      )) > 0,
    { timeout: 10000, timeoutMsg: 'no inline timings error rendered after Next' },
  );
  expect(await setupPage.stepText()).toContain(' 2 ');
}

/** Wait until the inline error for `key` reads exactly `text`; return it. */
async function waitError(key: string, text: string): Promise<string> {
  await browser.waitUntil(async () => (await setupPage.timingsError(key)) === text, {
    timeout: 10000,
    timeoutMsg: `inline error for ${key} did not read "${text}"`,
  });
  return text;
}

describe('M3-RWv6 setup: council labels, phone asked once, Morning/Evening clinic timings (SET-002, SET-003)', () => {
  it('shows council options with no em dash, asks the phone once and sends it as the clinic phone, validates and saves the clock-box timings, and finishes setup', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await expect(setupPage.wizard).toBeDisplayed();
    await setupPage.installIpcSpy();

    // ---- item 1: council labels ------------------------------------------
    const options = await setupPage.councilOptionTexts();
    const listed = options.slice(1, -1); // drop the placeholder and Other
    expect(listed.length).toBeGreaterThan(20);
    expect(options.filter((o) => o.includes('\u2014'))).toEqual([]);
    expect(listed.filter((o) => !/^[^:]+: \S/.test(o))).toEqual([]);
    expect(options).toContain(DEFAULT_COUNCIL_LABEL);
    evidence(
      `[rwv6-setup] item1 council options=${options.length} listed=${listed.length} emDash=0 ` +
        `allColon=true first="${listed[0]}" maharashtra="${DEFAULT_COUNCIL_LABEL}"`,
    );

    // ---- item 2: phone on Step 1 only -------------------------------------
    await setupPage.fillDoctorBasics();
    await setupPage.setDoctorPhone(PHONE);
    await setupPage.selectCouncil(DEFAULT_COUNCIL_LABEL);
    const step1Phones = await setupPage.phoneControlIds();
    expect(step1Phones).toEqual(['setup-doctor-phone']);
    await setupPage.nextAndWaitForStep(2, 'clinic');
    const step2Phones = await setupPage.phoneControlIds();
    expect(step2Phones).toEqual([]);
    await setupPage.fillClinicBasics();
    evidence(`[rwv6-setup] item2 step1 phone controls=${JSON.stringify(step1Phones)} step2 phone controls=${JSON.stringify(step2Phones)}`);

    // ---- item 3: clock boxes, auto AM/PM, inline range + order errors ----
    await expect(setupPage.timingsTab('morning')).toBeDisplayed();
    await expect(setupPage.timingsTab('evening')).toBeDisplayed();

    // hour 13 rejected.
    await setupPage.setSession('morning', ['13', '30'], ['1', '00']);
    await nextStaysOnStep2();
    const hourErr = await waitError(setupPage.timingsBoxId('morning', 'from', 'hour'), 'Enter an hour from 1 to 12.');
    evidence(`[rwv6-setup] item3 morning From 13:30 -> Next blocked, inline error "${hourErr}", still step 2`);

    // minute 60 rejected.
    await setupPage.setTimingsBox('morning', 'from', 'hour', '9');
    await setupPage.setTimingsBox('morning', 'from', 'minute', '60');
    await nextStaysOnStep2();
    const minErr = await waitError(setupPage.timingsBoxId('morning', 'from', 'minute'), 'Enter minutes from 00 to 59.');
    expect(await setupPage.timingsError(setupPage.timingsBoxId('morning', 'from', 'hour'))).toBeNull();
    evidence(`[rwv6-setup] item3 morning From 9:60 -> Next blocked, inline error "${minErr}" (hour error cleared)`);

    // Morning 9:30 -> 1:00 reads 9:30 AM -> 1:00 PM (To hour earlier than From => PM).
    await setupPage.setTimingsBox('morning', 'from', 'minute', '30');
    const mFrom = await setupPage.ampm('morning', 'from');
    const mTo = await setupPage.ampm('morning', 'to');
    expect(mFrom).toBe('AM');
    expect(mTo).toBe('PM');
    // 12 is PM in the morning session.
    await setupPage.setTimingsBox('morning', 'to', 'hour', '12');
    const mTo12 = await setupPage.ampm('morning', 'to');
    expect(mTo12).toBe('PM');
    await setupPage.setTimingsBox('morning', 'to', 'hour', '1');
    evidence(`[rwv6-setup] item3 morning 9:30 ${mFrom} - 1:00 ${mTo} (auto); To 12 -> ${mTo12}`);

    // Morning end-before-start in the same AM hour: 9:30 -> 9:15 rejected.
    await setupPage.setTimingsBox('morning', 'to', 'hour', '9');
    await setupPage.setTimingsBox('morning', 'to', 'minute', '15');
    await nextStaysOnStep2();
    const mOrder = await waitError('setup-clinic-timings-morning', 'The To time must be after the From time.');
    evidence(`[rwv6-setup] item3 morning 9:30 -> 9:15 blocked, inline "${mOrder}"`);
    await setupPage.setTimingsBox('morning', 'to', 'hour', '1');
    await setupPage.setTimingsBox('morning', 'to', 'minute', '00');

    // Evening end-before-start: 8:30 -> 5:00 rejected; its tab comes forward.
    await setupPage.setSession('evening', ['8', '30'], ['5', '00']);
    await setupPage.selectTimingsTab('morning');
    await nextStaysOnStep2();
    await setupPage.timingsPanel('evening').waitForDisplayed({ timeout: 10000 });
    const eOrder = await waitError('setup-clinic-timings-evening', 'The To time must be after the From time.');
    expect(await setupPage.timingsError('setup-clinic-timings-morning')).toBeNull();
    evidence(`[rwv6-setup] item3 evening 8:30 -> 5:00 blocked, inline "${eOrder}", evening tab brought forward`);

    // Evening 5:00 -> 8:30, both PM.
    await setupPage.setSession('evening', ['5', '00'], ['8', '30']);
    const eFrom = await setupPage.ampm('evening', 'from');
    const eTo = await setupPage.ampm('evening', 'to');
    expect(eFrom).toBe('PM');
    expect(eTo).toBe('PM');
    evidence(`[rwv6-setup] item3 evening 5:00 ${eFrom} - 8:30 ${eTo} (auto)`);

    // No clinic save was sent while the timings were invalid.
    expect(await setupPage.spiedCalls('setup_save_clinic_profile')).toEqual([]);

    // ---- accept: Next advances, payload carries phone + timings ----------
    await setupPage.next.click();
    await browser.waitUntil(async () => (await setupPage.stepText()).includes(' 3 '), {
      timeout: 10000,
      timeoutMsg: 'valid timings did not advance to step 3',
    });
    const clinicCalls = await setupPage.spiedCalls('setup_save_clinic_profile');
    const doctorCalls = await setupPage.spiedCalls('setup_save_doctor_profile');
    expect(clinicCalls.length).toBe(1);
    expect(doctorCalls.length).toBeGreaterThanOrEqual(1);
    const clinicReq = clinicCalls[0]?.args?.req ?? {};
    const doctorReq = doctorCalls[doctorCalls.length - 1]?.args?.req ?? {};
    expect(doctorReq['phone']).toBe(PHONE);
    expect(clinicReq['phone']).toBe(PHONE);
    expect(clinicReq['timings']).toBe(EXPECTED_TIMINGS);
    evidence(
      `[rwv6-setup] item2 setup_save_doctor_profile.phone=${String(doctorReq['phone'] === PHONE)} ` +
        `setup_save_clinic_profile.phone=${String(clinicReq['phone'] === PHONE)} (same Step-1 number)`,
    );
    evidence(`[rwv6-setup] item3 setup_save_clinic_profile.timings="${String(clinicReq['timings'])}" -> step 3`);

    // ---- finish: the backend accepted and flushed both profiles ----------
    await setupPage.setPinAndRevealRecovery(PIN);
    await setupPage.ackRecoveryAndNext();
    await expect(setupPage.licenceDevTrial).toBeDisplayed();
    await setupPage.finishSetup();
    await shellPage.waitForShell();
    await expect(shellPage.todayScreen).toBeDisplayed();
    evidence('[rwv6-setup] finish -> Today (setup_set_pin flushed the staged doctor + clinic profiles)');
  });
});
