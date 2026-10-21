// @req VIS-001 VIS-002 VIS-003 CASE-005
// @tier stable
// @area visit
// @targets linux
//
// R3 S09 follow-up visit (HC-MVP1-217 step 2; docs/ui/S09-follow-up-visit.md).
// Boot-gate aware, network disabled, isolated per-spec data dir (wdio.conf.ts
// beforeSession). Single launch on the 'main' dir.
//
// Flow (all through the REAL UI; UI -> typed commands only):
//   provision first-run (SET-001) -> register a patient (S06) -> dashboard
//   "Take case" -> S08 case form -> type a CHIEF COMPLAINT into
//   case-form-sensation-1 -> blur to autosave "Saved" (so the first visit's
//   data_json.chief_complaints is persisted; create_followup pre-loads from it,
//   VIS-002) -> back to the dashboard -> "New visit" (now that a prior visit
//   exists the dashboard resolves to a FOLLOW-UP, S09) ->
//     * the previous complaint PRE-LOADS as followup-complaint-1 (VIS-002) ;
//     * set its status Better + improvement % slider + a remedy-response radio
//       (VIS-002/003) -> autosave reaches "Saved" (CASE-005 pattern) ;
//     * the Prescribe button is DISABLED (R4, no dead end) ;
//     * the VIS-007 progress chart is ABSENT (R9, not rendered).
// No sleeps — all waits via page-object waitUntil/waitForDisplayed.
import { expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { casePage } from '../../pages/case.page.js';
import { followupPage } from '../../pages/followup.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';

const PIN = '2468';
const PATIENT_NAME = 'Followella Returnpatient';
const COMPLAINT = 'Recurring migraine, right temple, worse on waking';

describe('R3 S09 follow-up visit: pre-load, status/improvement/remedy, autosave, R4/R9 guards (VIS-001/002/003, CASE-005)', () => {
  it('opens a follow-up for a patient with a prior visit, pre-loads the previous complaint, records change + remedy response with autosave, and keeps Prescribe disabled and the progress chart absent', async () => {
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

    // ---- Take case (S08) -> type a chief complaint -> autosave ------------
    await patientsPage.dashTakeCase();
    await casePage.waitForForm();
    const ids = await casePage.routeIds();
    const patientId = ids.patientId;
    const firstVisitId = ids.visitId;
    expect(patientId.length).toBeGreaterThan(0);
    expect(firstVisitId.length).toBeGreaterThan(0);

    await casePage.sensation(1).waitForDisplayed({ timeout: 15000 });
    await casePage.sensation(1).setValue(COMPLAINT);
    // Blur onto a rail section button to force the on-blur autosave flush.
    await casePage.section('chief_complaints').click();
    const caseSaved = await casePage.waitForSaved();
    expect(caseSaved).toMatch(/^Saved/);
    // eslint-disable-next-line no-console
    console.log(`[followup] first visit ${firstVisitId} saved complaint "${COMPLAINT}"`);

    // ---- Open the S09 follow-up (the deep-linkable route) -----------------
    // AppShell.startFollowupForPatient: visit_create_followup -> navigate
    // #/patient/:id/visit/:vid/followup?prev=:firstVisitId. The dashboard
    // "New visit" button resolves to a follow-up only once the dashboard payload
    // carries prior visits (a later slice: patient_get_dashboard returns
    // visits:[] at R2), so the deep-linkable route is the real S09 entry here.
    const followupVisitId = await followupPage.openForPatient(patientId, firstVisitId);
    expect(followupVisitId.length).toBeGreaterThan(0);
    const fids = await followupPage.routeIds();
    expect(fids.patientId).toBe(patientId);
    expect(fids.prev).toBe(firstVisitId);
    // eslint-disable-next-line no-console
    console.log(`[followup] opened follow-up ${fids.visitId} (prev=${fids.prev})`);

    // ---- PROOF: previous complaint PRE-LOADS (VIS-002) --------------------
    await followupPage.waitForPreload(1);
    const preloadText = await followupPage.complaintText(1);
    expect(preloadText).toContain(COMPLAINT);
    // eslint-disable-next-line no-console
    console.log(`[followup] PRE-LOADED complaint-1 = "${preloadText}"`);

    // ---- Record change: status Better + improvement % + remedy response ---
    await followupPage.setStatus(1, 'Better');
    await followupPage.setImprovement(1, 60);
    await followupPage.setRemedyResponse('amelioration');

    // ---- Autosave reaches Saved (CASE-005 pattern) ------------------------
    const saved = await followupPage.waitForSaved();
    expect(saved).toMatch(/^Saved/);
    // eslint-disable-next-line no-console
    console.log(`[followup] autosave status after marks = "${saved}"`);

    // ---- R4 / R9 scope guards --------------------------------------------
    expect(await followupPage.prescribeIsDisabled()).toBe(true);
    expect(await followupPage.hasProgressChart()).toBe(false);
    // eslint-disable-next-line no-console
    console.log('[followup] Prescribe DISABLED (R4) and progress chart ABSENT (R9)');
  });
});
