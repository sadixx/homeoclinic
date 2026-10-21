// @req VIS-004 VIS-005
// @tier stable
// @area home
// @targets linux
//
// R3 S03 Today due/overdue (HC-MVP1-217 step 3; docs/ui/S03-today.md).
// Boot-gate aware, network disabled, isolated per-spec data dir. Single launch
// on the 'main' dir; two patients provisioned through the REAL UI.
//
// The backend buckets by comparing date(patient.next_followup_on) to the date
// the UI passes (TodayScreen -> today_get_overview({ today: todayIsoDate() })):
//   due_today = date(next_followup_on) == today
//   overdue   = date(next_followup_on) <  today
// There is no runtime clock override (SystemClock is hard-wired), so the
// deterministic "test clock" is DATA + REAL-today: the spec sets one patient's
// next follow-up to TODAY (todayIso) and another's to a PAST date (today-7d),
// both via the follow-up custom-date input, then asserts the correct Today
// bucket. A patient has one next_followup_on, so two patients drive the two
// buckets at once. No sleeps — all waits via page-object waitUntil.
import { expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { casePage } from '../../pages/case.page.js';
import { followupPage } from '../../pages/followup.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { todayPage } from '../../pages/today.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { isoPlusDays, todayIso } from '../../helpers/dates.js';

const PIN = '1357';
const DUE_NAME = 'Duedra Todaypatient';
const OVERDUE_NAME = 'Overton Latepatient';
const DUE_DATE = todayIso();
const OVERDUE_DATE = isoPlusDays(-7);

/**
 * Register a patient, take a first case (so a prior visit exists), open a
 * follow-up and set its next-follow-up to `nextDate`. Returns the patientId.
 */
async function seedPatientWithFollowup(
  name: string,
  age: string,
  nextDate: string,
): Promise<string> {
  await patientsPage.openRegister();
  await expect(patientsPage.form).toBeDisplayed();
  await patientsPage.fillCore({ name, age, city: 'Pune' });
  await patientsPage.saveAndWaitForDashboard();

  await patientsPage.dashTakeCase();
  await casePage.waitForForm();
  const ids = await casePage.routeIds();
  await casePage.sensation(1).waitForDisplayed({ timeout: 15000 });
  await casePage.sensation(1).setValue(`Chief complaint for ${name}`);
  await casePage.section('chief_complaints').click();
  const caseSaved = await casePage.waitForSaved();
  expect(caseSaved).toMatch(/^Saved/);

  // Open the S09 follow-up via the deep-linkable route (same create+navigate
  // AppShell.startFollowupForPatient does) and set its next follow-up date.
  await followupPage.openForPatient(ids.patientId, ids.visitId);
  await followupPage.setNextFollowupCustom(nextDate);
  // eslint-disable-next-line no-console
  console.log(`[today] seeded "${name}" (${ids.patientId}) next follow-up = ${nextDate}`);
  return ids.patientId;
}

describe('R3 S03 Today: next follow-up classifies a patient Due-today vs Overdue (VIS-004/005)', () => {
  it('shows a patient whose next follow-up is TODAY under Due today, and one whose next follow-up is in the PAST under Overdue', async () => {
    // ---- Boot-gate + provision --------------------------------------------
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    // ---- Seed two patients with the two follow-up dates -------------------
    const dueId = await seedPatientWithFollowup(DUE_NAME, '42', DUE_DATE);
    const overdueId = await seedPatientWithFollowup(OVERDUE_NAME, '51', OVERDUE_DATE);
    expect(dueId.length).toBeGreaterThan(0);
    expect(overdueId.length).toBeGreaterThan(0);

    // ---- Today screen: assert the buckets ---------------------------------
    await todayPage.open();
    await todayPage.waitForDue();
    await todayPage.waitForOverdue();

    const dueTexts = await todayPage.dueTexts();
    const overdueTexts = await todayPage.overdueTexts();
    // eslint-disable-next-line no-console
    console.log(`[today] DUE rows    = ${JSON.stringify(dueTexts)}`);
    // eslint-disable-next-line no-console
    console.log(`[today] OVERDUE rows = ${JSON.stringify(overdueTexts)}`);

    // DUE patient appears under Due today, NOT under Overdue.
    expect(await todayPage.dueContains(DUE_NAME)).toBe(true);
    expect(await todayPage.overdueContains(DUE_NAME)).toBe(false);
    // OVERDUE patient appears under Overdue, NOT under Due today.
    expect(await todayPage.overdueContains(OVERDUE_NAME)).toBe(true);
    expect(await todayPage.dueContains(OVERDUE_NAME)).toBe(false);
    // eslint-disable-next-line no-console
    console.log(
      `[today] ASSERTED: "${DUE_NAME}" Due-today (${DUE_DATE}); ` +
        `"${OVERDUE_NAME}" Overdue (${OVERDUE_DATE})`,
    );
  });
});
