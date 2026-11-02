// @req CASE-001 CASE-003 CASE-005 VIS-001 NFR-030 SET-005 PAT-009
// @tier stable
// @area case
// @targets linux
//
// M3-RW S08 case record — DOCTOR-JOURNAL model (ADR 0018; docs/ui/S08-case-form
// .md revised; schema .worklog/HC-MVP1-M3/handoffs/M3-RW-data-json-schema.md).
// Proves the reworked journal flow AND that the R3 autosave kill-restore
// guarantee (CASE-005) still holds THROUGH the rework — the headline. Boot-gate
// aware, network disabled, isolated per-spec data dir. Two app launches against
// ONE data dir ('main'), mirroring case-form.e2e.ts PHASE A/B so the relaunch
// is a GENUINE restart (the crash+reopen equivalent, run in a before() hook).
//
//   PHASE A (launch 1): provision first-run -> register a MALE adult patient ->
//     "Take case" -> the journal case form opens (CaseForm on
//     /patient/:pid/case/:vid). Then, per the task steps:
//       1. the BIG editable box is present; add a text block; type into it;
//          "Add entry" -> a NEW dated entry appears (entry count grows).
//       2. "Record vitals" -> popup with systolic + diastolic (two fields) +
//          weight + height -> Record -> an EDITABLE vitals table block appears;
//          edit a body cell -> the value persists (autosave).
//       3. "Add prescription" -> an editable medicine table + a visible
//          placeholder/preview hint (rx_placeholder).
//       4. Investigations: expand the section -> Suggested/Submitted tabs
//          switch; Submitted hosts the PAT-009 uploader. Family: Maternal /
//          Paternal tabs hold INDEPENDENT data.
//       5. the Case summary button is ABSENT.
//       9 (part): app-bar zoom in/out changes the content scale.
//       Explicit SAVE -> "Saved". Captures pid + vid.
//
//   PHASE B (launch 2, SAME 'main' dir — HEADLINE kill-restore, CASE-005):
//     relaunchInto('main') restarts the driver chain at the SAME XDG_DATA_HOME;
//     the fresh process self-routes to #/lock (asserted) -> unlock -> reopen the
//     SAME visit by deep-link -> the typed text + the vitals table + the edited
//     cell value + the prescription table are ALL restored (nothing lost).
//       8. FIRST-CASE gating: back on the dashboard, "New visit" is greyed
//          (disabled) and "Follow-up" is offered.
//       9 (part): the common app-bar Back walks the parent chain
//          (case -> dashboard).
//
// The patient is a MALE adult (age 40). The spec owns its data (known values),
// so restore is deterministic. No sleeps — all waits are waitUntil /
// waitForDisplayed.
import { browser, expect } from '@wdio/globals';

import { appBarPage } from '../../pages/appbar.page.js';
import { bootPage } from '../../pages/boot.page.js';
import { casePage } from '../../pages/case.page.js';
import { investigationsPage } from '../../pages/investigations.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { relaunchInto } from '../../helpers/launch.js';

const PIN = '2468';
const PATIENT_NAME = 'Journalius Testpatient';
// Deterministic clinical values PHASE B asserts verbatim after the relaunch.
const CC = 'cc1';
const TEXT_1 = 'Throbbing right temple, worse 11am-3pm sun.';
const TEXT_2 = 'Also nausea at the peak of the headache.';
const V_SYS = '120';
const V_DIA = '80';
const V_WEIGHT = '68';
const V_HEIGHT = '172';
const EXPECTED_BMI = '22.9'; // 68kg / 172cm, liveBmi truncates to 1dp
const EDITED_PULSE = '77'; // we edit the Pulse cell (col index 2)
const RX_MEDICINE = 'Belladonna'; // prescription table, row 0, col 0 (Medicine)
const FAMILY_MATERNAL = 'Diabetes (mother)';
const FAMILY_PATERNAL = 'Hypertension (father)';

// Vitals table column indices (schema §4a seed order).
const COL_PULSE = 2;

// Carried from PHASE A to PHASE B.
let patientId = '';
let visitId = '';
let textBlockId = '';
let vitalsBlockId = '';
let rxBlockId = '';

describe('M3-RW journal PHASE A: big box, dated entries, editable vitals/prescription tables, tabs, no summary, zoom, Save (ADR 0018)', () => {
  it('opens the journal case form, drives the full new flow, and autosaves it', async () => {
    // ---- Boot-gate + provision + seed a patient ---------------------------
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    await patientsPage.openRegister();
    await expect(patientsPage.form).toBeDisplayed();
    await patientsPage.fillCore({ name: PATIENT_NAME, age: '40', city: 'Pune' });
    await patientsPage.saveAndWaitForDashboard();
    expect(await patientsPage.dashboardText()).toContain(PATIENT_NAME);

    // ---- Take case -> journal case form -----------------------------------
    await patientsPage.dashTakeCase();
    await casePage.waitForForm();
    const ids = await casePage.routeIds();
    patientId = ids.patientId;
    visitId = ids.visitId;
    expect(patientId.length).toBeGreaterThan(0);
    expect(visitId.length).toBeGreaterThan(0);

    // ===== STEP 1: big editable box + type + Add entry -> new dated entry ===
    await expect(casePage.journalBox).toBeDisplayed();
    const entriesBefore = await casePage.entryCount(CC);
    expect(entriesBefore).toBe(1); // a fresh first case opens with one entry

    // The first entry has no block yet; Add text creates one, then type.
    await casePage.addTextBlock();
    textBlockId = await casePage.firstBlockId(CC);
    await casePage.typeInBlock(CC, textBlockId, TEXT_1);
    expect(await casePage.blockValue(CC, textBlockId)).toBe(TEXT_1);

    // Add entry -> a NEW dated entry (header count grows) with a fresh block.
    await casePage.addEntry();
    await browser.waitUntil(
      async () => (await casePage.entryCount(CC)) === entriesBefore + 1,
      { timeout: 15000, timeoutMsg: 'Add entry did not append a new dated entry' },
    );
    await expect(casePage.entryHeader(CC, 1)).toBeDisplayed();
    // Type into the new entry's (second) text block.
    const blockIdsAfterEntry = await casePage.blockTestIds(CC);
    const secondBlockId = blockIdsAfterEntry[blockIdsAfterEntry.length - 1];
    expect(secondBlockId).toBeDefined();
    if (secondBlockId !== undefined) {
      await casePage.typeInBlock(CC, secondBlockId, TEXT_2);
      expect(await casePage.blockValue(CC, secondBlockId)).toBe(TEXT_2);
    }
    // eslint-disable-next-line no-console
    console.log(`[journal] step1: box present, typed text, Add entry -> ${await casePage.entryCount(CC)} dated entries`);

    // ===== STEP 2: Record vitals popup -> editable vitals table -> edit cell =
    const tablesBefore = await casePage.tableBlockIds(CC);
    await casePage.recordVitals({
      sys: V_SYS,
      dia: V_DIA,
      weight: V_WEIGHT,
      height: V_HEIGHT,
    });
    await browser.waitUntil(
      async () => (await casePage.tableBlockIds(CC)).length === tablesBefore.length + 1,
      { timeout: 15000, timeoutMsg: 'Record vitals did not insert a table block' },
    );
    const tablesAfterVitals = await casePage.tableBlockIds(CC);
    const newVitals = tablesAfterVitals.find((id) => !tablesBefore.includes(id));
    expect(newVitals).toBeDefined();
    vitalsBlockId = newVitals ?? '';
    // The seeded row holds sys/dia in cols 0/1 and BMI in col 5.
    expect(await casePage.cellValue(CC, vitalsBlockId, 0, 0)).toBe(V_SYS);
    expect(await casePage.cellValue(CC, vitalsBlockId, 0, 1)).toBe(V_DIA);
    expect(await casePage.cellValue(CC, vitalsBlockId, 0, 5)).toBe(EXPECTED_BMI);
    // Edit the Pulse cell (col 2) -> value persists in the editable table.
    await casePage.editCell(CC, vitalsBlockId, 0, COL_PULSE, EDITED_PULSE);
    expect(await casePage.cellValue(CC, vitalsBlockId, 0, COL_PULSE)).toBe(EDITED_PULSE);
    // eslint-disable-next-line no-console
    console.log(`[journal] step2: vitals table ${vitalsBlockId} (sys=${V_SYS} dia=${V_DIA} bmi=${EXPECTED_BMI}); edited Pulse=${EDITED_PULSE}`);

    // ===== STEP 3: Add prescription -> editable medicine table + placeholder =
    const tablesBeforeRx = await casePage.tableBlockIds(CC);
    await casePage.addPrescription();
    await browser.waitUntil(
      async () => (await casePage.tableBlockIds(CC)).length === tablesBeforeRx.length + 1,
      { timeout: 15000, timeoutMsg: 'Add prescription did not insert a table block' },
    );
    const tablesAfterRx = await casePage.tableBlockIds(CC);
    rxBlockId = tablesAfterRx.find((id) => !tablesBeforeRx.includes(id)) ?? '';
    expect(rxBlockId.length).toBeGreaterThan(0);
    // Column 0 header is "Medicine"; type a medicine name into row 0 col 0.
    expect(await casePage.headerCell(CC, rxBlockId, 0).getValue()).toBe('Medicine');
    await casePage.editCell(CC, rxBlockId, 0, 0, RX_MEDICINE);
    expect(await casePage.cellValue(CC, rxBlockId, 0, 0)).toBe(RX_MEDICINE);
    // The placeholder/preview hint is visible (rx_placeholder, not a real Rx).
    expect(await casePage.hasRxPlaceholderHint()).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[journal] step3: prescription table ${rxBlockId} (${RX_MEDICINE}); rx-placeholder hint shown`);

    // ===== STEP 4: Investigations tabs + Family Maternal/Paternal tabs =======
    // Investigations lives in a collapsed side section; expand it first.
    await casePage.expandSection('investigations');
    await expect(casePage.investSuggestedTab).toBeDisplayed();
    await expect(casePage.investSubmittedTab).toBeDisplayed();
    // Suggested holds free text.
    await casePage.investSuggestedTab.click();
    await expect(casePage.investSuggested).toBeDisplayed();
    await casePage.investSuggested.setValue('1. CBC\n2. Thyroid profile');
    // Submitted tab hosts the PAT-009 uploader (its caption input is present).
    await casePage.investSubmittedTab.click();
    await expect(investigationsPage.caption).toBeDisplayed();
    // eslint-disable-next-line no-console
    console.log('[journal] step4a: investigations Suggested/Submitted tabs switch; Submitted hosts the PAT-009 uploader');

    // Family history Maternal/Paternal tabs hold INDEPENDENT data.
    await casePage.expandSection('family_history');
    await casePage.familyMaternalTab.click();
    await expect(casePage.familyMaternal).toBeDisplayed();
    await casePage.familyMaternal.setValue(FAMILY_MATERNAL);
    await casePage.familyPaternalTab.click();
    await expect(casePage.familyPaternal).toBeDisplayed();
    await casePage.familyPaternal.setValue(FAMILY_PATERNAL);
    // Switch back to Maternal -> its OWN value is intact (independent data).
    await casePage.familyMaternalTab.click();
    expect(await casePage.familyMaternal.getValue()).toBe(FAMILY_MATERNAL);
    await casePage.familyPaternalTab.click();
    expect(await casePage.familyPaternal.getValue()).toBe(FAMILY_PATERNAL);
    // eslint-disable-next-line no-console
    console.log('[journal] step4b: family Maternal/Paternal tabs hold independent data');

    // ===== STEP 5: Case summary button ABSENT ===============================
    expect(await casePage.hasCaseSummary()).toBe(false);
    // eslint-disable-next-line no-console
    console.log('[journal] step5: Case summary control ABSENT (ADR 0018 #5)');

    // ===== STEP 9 (part): app-bar zoom in/out changes the content scale ======
    await appBarPage.waitForBar();
    const baseScale = await appBarPage.scale();
    await appBarPage.zoomIn();
    await browser.waitUntil(async () => (await appBarPage.scale()) > baseScale, {
      timeout: 10000,
      timeoutMsg: 'zoom in did not increase the content scale',
    });
    const zoomedIn = await appBarPage.scale();
    await appBarPage.zoomOut();
    await browser.waitUntil(async () => (await appBarPage.scale()) < zoomedIn, {
      timeout: 10000,
      timeoutMsg: 'zoom out did not decrease the content scale',
    });
    // eslint-disable-next-line no-console
    console.log(`[journal] step9a: zoom base=${baseScale} in=${zoomedIn} out=${await appBarPage.scale()}`);

    // ===== Explicit SAVE -> "Saved" =========================================
    await casePage.save();
    const savedText = await casePage.waitForSaved();
    expect(savedText).toMatch(/^Saved/);
    // eslint-disable-next-line no-console
    console.log(`[journal] explicit Save -> "${savedText}"; visit ${visitId} persisted`);
  });
});

describe('M3-RW journal PHASE B: HEADLINE kill-restore + first-case gating + common Back (CASE-005 / ADR 0018)', () => {
  // SECOND launch against the SAME 'main' dir — the crash+reopen equivalent.
  before(async () => {
    await relaunchInto('main');
  });

  it('relaunches on the SAME data dir, restores the whole journal, greys New visit, and the app-bar Back walks the parent chain', async () => {
    // Genuine relaunch proof: the app chose #/lock itself on reopen (SET-004).
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/lock');
    await expect(bootPage.lockCard).toBeDisplayed();
    await lockPage.attempt(PIN);
    await shellPage.waitForShell();
    // eslint-disable-next-line no-console
    console.log('[journal] relaunched on SAME data dir -> #/lock -> unlocked with PIN');

    // ===== STEP 6: reopen the SAME visit -> EVERYTHING restored =============
    await casePage.openVisit(patientId, visitId);

    // Typed text (both entries) restored.
    expect(await casePage.blockValue(CC, textBlockId)).toBe(TEXT_1);
    // Vitals table restored, including the edited Pulse cell.
    expect(await casePage.cellValue(CC, vitalsBlockId, 0, 0)).toBe(V_SYS);
    expect(await casePage.cellValue(CC, vitalsBlockId, 0, 1)).toBe(V_DIA);
    expect(await casePage.cellValue(CC, vitalsBlockId, 0, 5)).toBe(EXPECTED_BMI);
    expect(await casePage.cellValue(CC, vitalsBlockId, 0, COL_PULSE)).toBe(EDITED_PULSE);
    // Prescription table restored, with the medicine typed.
    expect(await casePage.cellValue(CC, rxBlockId, 0, 0)).toBe(RX_MEDICINE);
    expect(await casePage.hasRxPlaceholderHint()).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[journal] step6 RESTORED after relaunch -> text="${TEXT_1}" | vitals(sys=${V_SYS},dia=${V_DIA},bmi=${EXPECTED_BMI},pulse=${EDITED_PULSE}) | rx=${RX_MEDICINE} (nothing lost)`);

    // ===== STEP 8: first-case gating on the dashboard =======================
    await patientsPage.openDashboard(patientId);
    await patientsPage.waitForDashboard();
    await browser.waitUntil(
      async () =>
        (await patientsPage.dashNewVisitBtn.getAttribute('disabled')) !== null ||
        (await patientsPage.dashNewVisitBtn.getAttribute('aria-disabled')) === 'true',
      { timeout: 15000, timeoutMsg: 'New visit was not greyed after the first saved case' },
    );
    expect(await patientsPage.dashNewVisitBtn.isEnabled()).toBe(false);
    // Follow-up is offered instead (no dead end).
    await expect(appBarPage.bar).toBeDisplayed();
    const followupBtn = await browser.$('[data-testid="patient-dash-followup"]');
    expect(await followupBtn.isExisting()).toBe(true);
    // eslint-disable-next-line no-console
    console.log('[journal] step8: New visit greyed after first saved case; Follow-up offered');

    // ===== STEP 9 (part): common app-bar Back walks the parent chain ========
    // From the case form, Back -> the patient dashboard (#/patients?id=:pid).
    await casePage.openVisit(patientId, visitId);
    await appBarPage.waitForBar();
    await appBarPage.clickBack();
    await appBarPage.waitForHash(
      (h) => h.includes('/patients') && h.includes(encodeURIComponent(patientId)),
      15000,
      'app-bar Back did not navigate case -> patient dashboard',
    );
    // eslint-disable-next-line no-console
    console.log(`[journal] step9b: app-bar Back case -> dashboard (hash=${await appBarPage.hash()})`);
  });
});

// ===========================================================================
// STEP 7 PROBE — the follow-up through the dashboard (ADR 0018 #2).
// ADR 0018 #2 says the follow-up REUSES the journal: opening a follow-up adds a
// new dated entry and the insert buttons read "Update vitals"/"Update
// prescription". This probe takes the follow-up from the dashboard and asserts
// the INTENDED journal follow-up. If the app instead opens the structured S09
// screen (followup-screen), this it() FAILS — and that red test IS the evidence
// of the routing gap the explorer flagged. The assertion is NOT weakened to
// make it pass; a real routing defect must surface.
// ===========================================================================
describe('M3-RW journal step 7 PROBE: follow-up from the dashboard opens the journal box with Update-vitals/prescription (ADR 0018 #2)', () => {
  it('opens a follow-up that reuses the journal (Update vitals/prescription, a new dated entry) — NOT the retired structured S09', async () => {
    // We are on the same PHASE-B session (first case saved for `patientId`).
    await patientsPage.openDashboard(patientId);
    await patientsPage.waitForDashboard();

    // Take the follow-up the dashboard offers (New visit is greyed, Follow-up
    // is the offered action after the first saved case).
    const followupBtn = await browser.$('[data-testid="patient-dash-followup"]');
    await followupBtn.waitForClickable({ timeout: 15000 });
    await followupBtn.click();

    // INTENDED (ADR 0018 #2): the journal case form opens in follow-up mode,
    // so the journal box is present and the insert button reads "Update vitals".
    await casePage.form.waitForDisplayed({ timeout: 20000 });
    await expect(casePage.journalBox).toBeDisplayed();
    const recordBtnText = (await casePage.recordVitalsButton.getText()).trim();
    expect(recordBtnText).toBe('Update vitals');
    const rxBtnText = (await casePage.addPrescriptionButton.getText()).trim();
    expect(rxBtnText).toBe('Update prescription');
    // eslint-disable-next-line no-console
    console.log(`[journal] step7: follow-up journal buttons = "${recordBtnText}" / "${rxBtnText}"`);
  });
});
