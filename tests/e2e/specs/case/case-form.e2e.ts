// @req CASE-001 CASE-003 CASE-005 CASE-006 CASE-009 VIS-001
// @tier stable
// @area case
// @targets linux
//
// R3 S08 first (detailed) case form (HC-MVP1-217 step 1; docs/ui/S08-case-form.md).
// Boot-gate aware, network disabled, isolated per-spec data dir. Structured as
// TWO phases across TWO app launches against ONE data dir ('main'), mirroring
// boot-gate.e2e.ts so the relaunch is a GENUINE app restart (the relaunch runs
// in a before() hook of the second describe, the proven pattern; doing it
// mid-it() aborts the test early):
//
//   PHASE A (first launch) — provision first-run (SET-001) -> register a MALE
//     adult patient (S06) -> dashboard "Take case" -> the schema-driven S08
//     case form opens on the default template (chronic_detailed) -> its
//     CASE-001 sections render in the rail -> type a chief complaint + a
//     physical-general FREE-TEXT pick-list value (NOT in the option list,
//     CASE-003) + vitals weight+height -> live BMI updates (CASE-001/062) ->
//     autosave reaches "Saved" (CASE-005). Captures patientId+visitId.
//
//   PHASE B (SECOND launch, SAME data dir — the HEADLINE, CASE-005 flow 3
//     "nothing lost") — relaunchInto('main') restarts the driver chain at the
//     SAME XDG_DATA_HOME (crash+reopen equivalent); a fresh process over a
//     provisioned dir boots to #/lock (asserted) -> unlock with the PIN ->
//     reopen the SAME visit by deep-link -> every typed value is RESTORED ->
//     and the send-to-repertory control is ABSENT (CASE-006, pre-R7).
//
// The patient is MALE + adult (age 40, sex unset -> CaseRoute maps to 'male'),
// so menstrual_obstetric (showIf sex=female) and child_development
// (showIf ageYearsLt<14) are correctly HIDDEN — asserted as a schema-conditional
// proof. The spec owns its data (known values), so restore is deterministic.
// No sleeps. BMI 68 kg / 172 cm => 22.9 (liveBmi, matching S08).
import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { casePage } from '../../pages/case.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { relaunchInto } from '../../helpers/launch.js';

const PIN = '2468';
const PATIENT_NAME = 'Casewell Testpatient';
// Deterministic clinical values PHASE B asserts verbatim after the relaunch.
const COMPLAINT = 'Burning headache worse 3pm, better in open air';
const THERMAL_FREE_TEXT = 'Chilly but sweaty'; // NOT in the thermal option list
const WEIGHT_KG = '68';
const HEIGHT_CM = '172';
const EXPECTED_BMI = '22.9';

// Sections the default template shows for a MALE ADULT patient.
const VISIBLE_SECTIONS = [
  'chief_complaints',
  'hpi',
  'past_history',
  'family_history',
  'personal_history',
  'physical_generals',
  'mental_generals',
  'examination',
  'investigations',
  'provisional_diagnosis',
  'analysis',
];
// Sections hidden by showIf for a male adult.
const HIDDEN_SECTIONS = ['menstrual_obstetric', 'child_development'];

// Carried from PHASE A to PHASE B (the visit reopened after the relaunch).
let patientId = '';
let visitId = '';

describe('R3 S08 case form PHASE A: Take case renders the template, lives-BMI, autosaves (CASE-001/003/005)', () => {
  it('opens the case form from the dashboard, renders the default template sections, and autosaves a typed complaint + free-text general + vitals with a live BMI', async () => {
    // ---- Boot-gate + seed a patient ---------------------------------------
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    // Register a MALE adult patient (sex left unset -> male; age 40 -> adult).
    await patientsPage.openRegister();
    await expect(patientsPage.form).toBeDisplayed();
    await patientsPage.fillCore({ name: PATIENT_NAME, age: '40', city: 'Pune' });
    await patientsPage.saveAndWaitForDashboard();
    expect(await patientsPage.dashboardText()).toContain(PATIENT_NAME);
    // eslint-disable-next-line no-console
    console.log(`[case] registered patient "${PATIENT_NAME}" (male adult)`);

    // ---- Take case -> case form + sections (CASE-001/004) -----------------
    await patientsPage.dashTakeCase();
    await casePage.waitForForm();
    const ids = await casePage.routeIds();
    patientId = ids.patientId;
    visitId = ids.visitId;
    // eslint-disable-next-line no-console
    console.log(`[case] Take case -> /patient/${patientId}/case/${visitId}`);

    for (const key of VISIBLE_SECTIONS) {
      // eslint-disable-next-line no-await-in-loop
      await expect(casePage.section(key)).toBeDisplayed();
    }
    // eslint-disable-next-line no-console
    console.log(`[case] default template rail shows ${VISIBLE_SECTIONS.length} sections: ${VISIBLE_SECTIONS.join(', ')}`);
    for (const key of HIDDEN_SECTIONS) {
      // eslint-disable-next-line no-await-in-loop
      expect(await casePage.section(key).isExisting()).toBe(false);
    }
    // eslint-disable-next-line no-console
    console.log(`[case] showIf-hidden sections absent for male adult: ${HIDDEN_SECTIONS.join(', ')}`);

    // ---- type complaint + general + vitals -> live BMI + autosave ---------
    await casePage.sensation(1).waitForDisplayed({ timeout: 15000 });
    await casePage.sensation(1).setValue(COMPLAINT);

    await casePage.expandSection('physical_generals', 'case-form-generals-thermal');
    await casePage.generals('thermal').setValue(THERMAL_FREE_TEXT); // free text, not an option

    await casePage.expandSection('examination', 'case-form-vital-weight_kg');
    await casePage.vital('weight_kg').setValue(WEIGHT_KG);
    await casePage.vital('height_cm').setValue(HEIGHT_CM);
    await browser.waitUntil(async () => (await casePage.bmiText()) === EXPECTED_BMI, {
      timeout: 10000,
      timeoutMsg: `live BMI did not reach ${EXPECTED_BMI} for ${WEIGHT_KG}kg/${HEIGHT_CM}cm`,
    });
    expect(await casePage.bmiText()).toBe(EXPECTED_BMI);
    // eslint-disable-next-line no-console
    console.log(`[case] live BMI = ${await casePage.bmiText()} (${WEIGHT_KG}kg / ${HEIGHT_CM}cm) [expected ${EXPECTED_BMI}]`);

    // Blur the last vital (click a rail button) to force the on-blur autosave
    // flush, then wait for "Saved" (CASE-005). Must be persisted before PHASE B
    // relaunches the app.
    await casePage.section('chief_complaints').click();
    const savedText = await casePage.waitForSaved();
    expect(savedText).toMatch(/^Saved/);
    expect(patientId.length).toBeGreaterThan(0);
    expect(visitId.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[case] autosave status after edits = "${savedText}"; visit ${visitId} persisted`);
  });
});

describe('R3 S08 case form PHASE B: HEADLINE — relaunch SAME data dir, nothing lost, send-to-repertory absent (CASE-005 flow 3 / CASE-006)', () => {
  // SECOND app launch against the SAME 'main' dir PHASE A provisioned — the
  // crash+reopen equivalent. Done in a before() hook (the boot-gate pattern) so
  // the relaunch is a genuine restart and its post-reload commands run. A fresh
  // process over a provisioned dir self-routes to #/lock.
  before(async () => {
    await relaunchInto('main');
  });

  it('relaunched on the SAME data dir, boots to lock, and after unlock the reopened visit has every typed value RESTORED with no send-to-repertory control', async () => {
    // Genuine relaunch proof: the app chose #/lock itself on reopen (SET-004).
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/lock');
    await expect(bootPage.lockCard).toBeDisplayed();
    await lockPage.attempt(PIN);
    await shellPage.waitForShell();
    // eslint-disable-next-line no-console
    console.log('[case] relaunched on SAME data dir -> booted to #/lock -> unlocked with PIN');

    // Reopen the EXACT same visit by deep-link and prove nothing was lost.
    await casePage.openVisit(patientId, visitId);
    await casePage.expandSection('physical_generals', 'case-form-generals-thermal');
    await casePage.expandSection('examination', 'case-form-vital-weight_kg');

    const restoredComplaint = await casePage.valueOf('case-form-sensation-1');
    const restoredThermal = await casePage.valueOf('case-form-generals-thermal');
    const restoredWeight = await casePage.valueOf('case-form-vital-weight_kg');
    const restoredHeight = await casePage.valueOf('case-form-vital-height_cm');
    const restoredBmi = await casePage.bmiText();

    expect(restoredComplaint).toBe(COMPLAINT);
    expect(restoredThermal).toBe(THERMAL_FREE_TEXT);
    expect(restoredWeight).toBe(WEIGHT_KG);
    expect(restoredHeight).toBe(HEIGHT_CM);
    expect(restoredBmi).toBe(EXPECTED_BMI);
    // eslint-disable-next-line no-console
    console.log(`[case] RESTORED after relaunch -> complaint="${restoredComplaint}" | thermal="${restoredThermal}" | weight=${restoredWeight} | height=${restoredHeight} | bmi=${restoredBmi} (nothing lost)`);

    // send-to-repertory ABSENT (CASE-006 flagged off pre-R7; no dead end).
    expect(await casePage.hasSendToRepertory()).toBe(false);
    // eslint-disable-next-line no-console
    console.log('[case] send-to-repertory control ABSENT (pre-R7, no dead end)');
  });
});
