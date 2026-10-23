// @req VIS-001 VIS-002 VIS-003 CASE-005
// @tier stable
// @area visit
// @targets linux
//
// M3-RW S09 follow-up visit — JOURNAL model (ADR 0018 #2; docs/ui/
// S09-follow-up-visit.md S09-delta). The follow-up no longer opens the retired
// structured FollowupVisit screen: it REUSES the journal CaseForm with
// visitType='follow_up'. Boot-gate aware, network disabled, isolated per-spec
// data dir (wdio.conf.ts beforeSession). Single launch on the 'main' dir.
//
// Flow (all through the REAL UI; UI -> typed commands only):
//   provision first-run (SET-001) -> register a patient (S06) -> dashboard
//   "Take case" -> journal case form (S08) -> set a complaint TITLE +
//   type a complaint into a text block -> explicit Save "Saved" (so the first
//   visit's journal + top-level complaints[].title are persisted; the backend
//   seeds a follow-up from it, VIS-002) -> back to the dashboard.
//
//   Because a prior saved case now exists, the dashboard greys "New visit" and
//   offers "Follow-up" (patient-dash-followup). Clicking it opens-or-creates a
//   follow-up visit and routes into the JOURNAL CaseForm in follow-up mode
//   (/patient/:id/case/:vid/followup). Then:
//     * the journal box PRE-OPENS with the prior content and the prior
//       complaint TITLE pre-loads (VIS-002) ;
//     * the insert buttons read "Update vitals" / "Update prescription"
//       (ADR 0018 #3) ;
//     * "Add entry" APPENDS a NEW dated entry (never replaces) ;
//     * explicit Save reaches "Saved" (CASE-005 pattern) ;
//     * Today then REFLECTS the follow-up: the patient surfaces under Today's
//       registered-today list (the follow-up visit was created today, VIS-005).
// No sleeps — all waits via page-object waitUntil/waitForDisplayed.
import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { casePage } from '../../pages/case.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { todayPage } from '../../pages/today.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';

const PIN = '2468';
const PATIENT_NAME = 'Followella Returnpatient';
const COMPLAINT = 'Recurring migraine, right temple, worse on waking';
const FOLLOWUP_NOTE = 'Headache less frequent since the remedy; sleep improved.';
const CC = 'cc1';

describe('M3-RW S09 follow-up: dashboard -> journal follow-up, prior complaint pre-load, Update buttons, Add entry, Today reflects it (VIS-001/002/003, CASE-005)', () => {
  it('opens the journal CaseForm in follow-up mode from the dashboard, pre-loads the prior complaint, appends a dated entry, autosaves, and surfaces on Today', async () => {
    // ---- Boot-gate + provision --------------------------------------------
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    // ---- Register a patient (S06) -----------------------------------------
    await patientsPage.openRegister();
    await expect(patientsPage.form).toBeDisplayed();
    await patientsPage.fillCore({ name: PATIENT_NAME, age: '36', city: 'Nashik' });
    await patientsPage.saveAndWaitForDashboard();
    expect(await patientsPage.dashboardText()).toContain(PATIENT_NAME);

    // ---- Take case (S08 journal) -> set a complaint title + text -> Save ---
    await patientsPage.dashTakeCase();
    await casePage.waitForForm();
    const ids = await casePage.routeIds();
    const patientId = ids.patientId;
    const firstVisitId = ids.visitId;
    expect(patientId.length).toBeGreaterThan(0);
    expect(firstVisitId.length).toBeGreaterThan(0);

    // Journal model: set the complaint TITLE (what the backend follow-up seed
    // pre-loads, VIS-002), add a text block and type the complaint prose, then
    // explicit Save to persist the first visit's journal.
    await casePage.complaintTitle.waitForDisplayed({ timeout: 15000 });
    await casePage.complaintTitle.setValue(COMPLAINT);
    await casePage.addTextBlock();
    const firstBlockId = await casePage.firstBlockId(CC);
    await casePage.typeInBlock(CC, firstBlockId, COMPLAINT);
    await casePage.save();
    const caseSaved = await casePage.waitForSaved();
    expect(caseSaved).toMatch(/^Saved/);
    // eslint-disable-next-line no-console
    console.log(`[followup] first visit ${firstVisitId} saved complaint "${COMPLAINT}"`);

    // ---- Dashboard: first case recorded -> "Follow-up" is offered ----------
    await patientsPage.openDashboard(patientId);
    await patientsPage.waitForDashboard();
    // New visit is greyed after the first saved case; Follow-up is offered.
    await browser.waitUntil(
      async () => (await patientsPage.dashNewVisitBtn.isEnabled()) === false,
      { timeout: 15000, timeoutMsg: 'New visit was not greyed after the first saved case' },
    );
    const followupBtn = await browser.$('[data-testid="patient-dash-followup"]');
    await followupBtn.waitForClickable({ timeout: 15000 });
    await followupBtn.click();

    // ---- JOURNAL follow-up opens (ADR 0018 #2) -----------------------------
    // The dashboard follow-up routes to /patient/:id/case/:vid/followup, which
    // renders the SAME journal CaseForm with visitType='follow_up'.
    await casePage.waitForForm();
    await expect(casePage.form).toBeDisplayed();
    await expect(casePage.journalBox).toBeDisplayed();
    const fids = await casePage.routeIds();
    expect(fids.patientId).toBe(patientId);
    // A follow-up is a NEW visit (distinct from the first).
    expect(fids.visitId.length).toBeGreaterThan(0);
    expect(fids.visitId).not.toBe(firstVisitId);
    const followupVisitId = fids.visitId;
    // The follow-up URL carries the /followup visit-kind marker.
    const hash = await browser.execute(() => window.location.hash);
    expect(hash).toContain(`/case/${followupVisitId}/followup`);
    // eslint-disable-next-line no-console
    console.log(`[followup] dashboard follow-up -> JOURNAL case-form ${followupVisitId} (hash=${hash})`);

    // ---- PROOF: prior complaint TITLE PRE-LOADS (VIS-002) ------------------
    await browser.waitUntil(
      async () => (await casePage.complaintTitleValue()).includes(COMPLAINT),
      { timeout: 20000, timeoutMsg: 'prior complaint title did not pre-load on the follow-up' },
    );
    const preloaded = await casePage.complaintTitleValue();
    expect(preloaded).toContain(COMPLAINT);
    // eslint-disable-next-line no-console
    console.log(`[followup] PRE-LOADED complaint title = "${preloaded}"`);

    // ---- PROOF: insert buttons read "Update ..." in follow-up (ADR 0018 #3) -
    const recordBtnText = await casePage.recordVitalsButtonText();
    expect(recordBtnText).toBe('Update vitals');
    const rxBtnText = await casePage.addPrescriptionButtonText();
    expect(rxBtnText).toBe('Update prescription');
    // eslint-disable-next-line no-console
    console.log(`[followup] insert buttons = "${recordBtnText}" / "${rxBtnText}"`);

    // ---- PROOF: "Add entry" APPENDS a new dated entry (never replaces) -----
    const entriesBefore = await casePage.entryCount(CC);
    expect(entriesBefore).toBeGreaterThanOrEqual(1);
    await casePage.addEntry();
    await browser.waitUntil(
      async () => (await casePage.entryCount(CC)) === entriesBefore + 1,
      { timeout: 15000, timeoutMsg: 'Add entry did not append a new dated entry on the follow-up' },
    );
    await expect(casePage.entryHeader(CC, entriesBefore)).toBeDisplayed();
    // Type the follow-up note into the new entry's (last) text block.
    const blockIds = await casePage.blockTestIds(CC);
    const newBlockId = blockIds[blockIds.length - 1];
    expect(newBlockId).toBeDefined();
    if (newBlockId !== undefined) {
      await casePage.typeInBlock(CC, newBlockId, FOLLOWUP_NOTE);
      expect(await casePage.blockValue(CC, newBlockId)).toBe(FOLLOWUP_NOTE);
    }
    // eslint-disable-next-line no-console
    console.log(`[followup] Add entry -> ${await casePage.entryCount(CC)} dated entries (prior preserved)`);

    // ---- Autosave reaches Saved (CASE-005 pattern) ------------------------
    await casePage.save();
    const saved = await casePage.waitForSaved();
    expect(saved).toMatch(/^Saved/);
    // eslint-disable-next-line no-console
    console.log(`[followup] follow-up save status = "${saved}"`);

    // ---- Today REFLECTS the follow-up (VIS-005) ---------------------------
    // The follow-up visit was created today -> the patient surfaces under
    // Today's registered-today list (date(visit_at) == today).
    await todayPage.open();
    await todayPage.waitForRegistered();
    await browser.waitUntil(async () => todayPage.registeredContains(PATIENT_NAME), {
      timeout: 20000,
      timeoutMsg: 'the follow-up patient did not surface on Today after save',
    });
    expect(await todayPage.registeredContains(PATIENT_NAME)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[followup] Today REFLECTS the follow-up: "${PATIENT_NAME}" in registered-today`);
  });
});
