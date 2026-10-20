// @req PAT-005 PAT-006 PAT-008 PAT-001
// @tier stable
// @area patients
// @targets linux
//
// R2 patient-register demo (HC-MVP1-216), part 3: the S07 dashboard and the
// record lifecycle on a KNOWN patient (registered by the spec, so assertions
// are deterministic):
//   - dashboard shows demographics (PAT-005), a family block (PAT-006) and an
//     HONEST-EMPTY visit timeline (R2: 0 visits),
//   - edit the patient via S06 edit mode and see the change on the dashboard,
//   - recycle (soft-delete) the patient and then restore it (PAT-008).
// Network disabled, isolated data dir, boot-gate aware.
import { $$, browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';

const PIN = '8642';
const PATIENT_NAME = 'Harish Kulkarni';
const EDITED_CITY = 'Nashik';

describe('R2 patient dashboard, edit and recycle/restore (S07)', () => {
  it('shows dashboard, edits, recycles and restores a patient', async () => {
    // Boot-gate: provision + land unlocked on Today.
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    // Register a known patient to drive the dashboard/edit/recycle flow.
    await patientsPage.openRegister();
    await patientsPage.fillCore({
      name: PATIENT_NAME,
      age: '51',
      mobile: '9820011223',
      city: 'Pune',
    });
    await patientsPage.saveAndWaitForDashboard();

    // ---- Dashboard (PAT-005/006) ------------------------------------------
    await expect(patientsPage.dashDemographics).toBeDisplayed();
    expect(await patientsPage.dashboardText()).toContain(PATIENT_NAME);
    // Family block renders (empty at R2 is honest — the element exists).
    await expect(patientsPage.dashFamily).toBeDisplayed();
    // Visit timeline is HONEST-EMPTY at R2 (element present, no visit rows).
    await expect(patientsPage.dashTimeline).toBeDisplayed();
    const visitRows = await $$('[data-testid="patient-dash-visit-row"]').length;
    expect(visitRows).toBe(0);
    // eslint-disable-next-line no-console
    console.log('[R2-dash] demographics + family + honest-empty R2 timeline shown (0 visit rows)');

    // ---- Edit (PAT-001) ----------------------------------------------------
    await patientsPage.dashEdit.click();
    await expect(patientsPage.form).toBeDisplayed();
    await patientsPage.formCity.waitForDisplayed({ timeout: 10000 });
    // Overwrite the city; clear then set.
    await patientsPage.formCity.setValue(EDITED_CITY);
    await patientsPage.saveAndWaitForDashboard();
    await browser.waitUntil(
      async () => (await patientsPage.dashboardText()).includes(EDITED_CITY),
      { timeout: 15000, timeoutMsg: 'edited city did not appear on the dashboard' },
    );
    // eslint-disable-next-line no-console
    console.log(`[R2-dash] edit saved -> dashboard shows city "${EDITED_CITY}"`);

    // ---- Recycle + restore (PAT-008) --------------------------------------
    await patientsPage.recycle();
    await expect(patientsPage.dashDeletedBanner).toBeDisplayed();
    // eslint-disable-next-line no-console
    console.log('[R2-dash] recycle -> soft-deleted, recycle-bin banner shown');

    await patientsPage.restore();
    await browser.waitUntil(
      async () => !(await patientsPage.dashDeletedBanner.isExisting()),
      { timeout: 15000, timeoutMsg: 'patient still in recycle bin after restore' },
    );
    // After restore the record is live again (demographics still shown).
    await expect(patientsPage.dashDemographics).toBeDisplayed();
    expect(await patientsPage.dashboardText()).toContain(PATIENT_NAME);
    // eslint-disable-next-line no-console
    console.log('[R2-dash] restore -> patient live again, banner gone');
  });
});
