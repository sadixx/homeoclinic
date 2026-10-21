// @req PSR-001 PSR-004 PSR-005 PSR-006
// @tier stable
// @area search
// @targets linux
//
// R2 patient-register demo (HC-MVP1-216), part 2: GLOBAL SEARCH (S04) over a
// seeded >=200-patient multi-disease fixture. The fixture is imported into the
// provisioned app DB through the REAL create path (patient_import_fixture,
// feature e2e-test-keys), so FTS/trigram/phonetic are live and search runs on
// realistic data at scale. A single KNOWN patient (chosen by the spec, so the
// targets are deterministic regardless of the random fixture) is then found by
// each of the four required query shapes, each opening the RIGHT S07 dashboard:
//   1. partial name
//   2. last-4 digits of the mobile
//   3. ID (patient-code) digits
//   4. PHONETIC misspelling (Sharma <-> Sarma collide on one phonetic key)
// Network disabled, isolated data dir, boot-gate aware.
import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { searchPage } from '../../pages/search.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { seedFixtureIntoApp } from '../../helpers/fixture.js';
import { dataDir } from '../../helpers/launch.js';

const PIN = '2024';
// A known patient whose surname "Sharma" has the SAME phonetic key as the
// misspelling "Sarma" (sh->s fold), so the phonetic query is deterministic.
const PATIENT_NAME = 'Beena Sharma';
const PATIENT_NAME_PARTIAL = 'Beena';
const PATIENT_PHONETIC_MISSPELL = 'Beena Sarma';
const PATIENT_MOBILE = '9871234567';
const MOBILE_LAST4 = '4567';

describe('R2 global patient search (S04) over the >=200 fixture', () => {
  it('finds a patient by partial name, last-4 mobile, ID digits and a phonetic misspelling — each opening the right dashboard', async () => {
    // Boot-gate: provision + land unlocked on Today.
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    // Seed the >=200 multi-disease fixture through the real create path.
    const jsonl = `${dataDir('fixture')}/fixture.jsonl`;
    const imported = await seedFixtureIntoApp(jsonl, 240, 42);
    expect(imported).toBeGreaterThanOrEqual(200);
    // eslint-disable-next-line no-console
    console.log(`[R2-search] seeded ${imported} patients via patient_import_fixture (>=200 required)`);

    // Register the KNOWN target patient on top of the fixture so the four
    // query shapes are deterministic. Capture its assigned code for the
    // ID-digit search.
    await patientsPage.openRegister();
    await patientsPage.fillCore({
      name: PATIENT_NAME,
      age: '29',
      mobile: PATIENT_MOBILE,
      city: 'Pune',
    });
    await patientsPage.saveAndWaitForDashboard();
    const code = await readDashboardCode();
    const codeDigits = code.replace(/\D/g, '');
    expect(codeDigits.length).toBeGreaterThanOrEqual(4);
    // eslint-disable-next-line no-console
    console.log(`[R2-search] registered target "${PATIENT_NAME}" code=${code} mobile=${PATIENT_MOBILE}`);

    // 1) Partial name.
    await findAndAssertDashboard(PATIENT_NAME_PARTIAL, PATIENT_NAME, 'partial name');

    // 2) Last-4 of the mobile.
    await findAndAssertDashboard(MOBILE_LAST4, PATIENT_NAME, 'last-4 mobile');

    // 3) ID (patient-code) digits.
    await findAndAssertDashboard(codeDigits, PATIENT_NAME, 'ID digits');

    // 4) PHONETIC misspelling (Sarma for Sharma).
    await findAndAssertDashboard(
      PATIENT_PHONETIC_MISSPELL,
      PATIENT_NAME,
      'phonetic misspelling',
    );
  });
});

/**
 * Open F2 search, type `query`, open the first hit, and assert the resulting
 * S07 dashboard is the expected patient. Closes nothing afterwards (the
 * dashboard replaces the overlay); the next query re-opens F2 from there.
 */
async function findAndAssertDashboard(
  query: string,
  expectedName: string,
  label: string,
): Promise<void> {
  await searchPage.openWithF2();
  await searchPage.searchFor(query, 1);
  const hit = await searchPage.firstResultText();
  expect(hit).toContain('Beena');
  await searchPage.openFirstResult();
  await patientsPage.dashDemographics.waitForDisplayed({ timeout: 15000 });
  const dash = await patientsPage.dashboardText();
  expect(dash).toContain(expectedName);
  // eslint-disable-next-line no-console
  console.log(`[R2-search] ${label} "${query}" -> opened dashboard for "${expectedName}"`);
}

/** Read the patient code from the dashboard demographics line (code . age . sex). */
async function readDashboardCode(): Promise<string> {
  const text = await patientsPage.dashboardText();
  // The demographics block renders `<name>\n<code> · <age>...`; pull the code
  // token (the app code prefix is HC- followed by digits).
  const match = /HC-?\d+/.exec(text);
  if (match === null) {
    throw new Error(`could not read patient code from dashboard text: "${text}"`);
  }
  return match[0];
}
