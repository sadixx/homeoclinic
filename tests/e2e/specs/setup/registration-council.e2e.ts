// @req SET-002
// @tier regression
// @area settings
// @targets linux, windows
//
// HC-MVP1-M3set: S01 Step 1 registration council is a dropdown of VERIFIED
// Indian homoeopathic registering authorities plus "Other (type manually)"
// with a required free-text box. Source of the list:
// docs/reference/registration-councils.md (Ministry of AYUSH reply to Rajya
// Sabha Unstarred Q.1768, 02.08.2022, Annexure II; NCH Act 2020; HCC Act 1973).
//
// The expected list is written out here on purpose (an independent oracle):
// the spec must fail if the app's list drifts from the verified one.
//
//   PHASE A ('main' dir): the dropdown shows exactly the verified list; pick
//     Maharashtra, Next is accepted (setup_save_doctor_profile returned ok —
//     the wizard only advances on ok), Back shows it still selected, finish
//     setup, then relaunch the SAME dir -> #/lock -> unlock -> Today.
//   PHASE B (fresh 'other' dir): Other with an empty box blocks Next with the
//     inline error; typing a (synthetic) name completes setup.
//
// Limit: there is no UI/command that reads the stored doctor profile back
// after setup (no binding change allowed in this task), so this spec proves
// the save was accepted and the choice survives Back. The exact saved string
// is asserted by apps/desktop/src/setup/SetupWizard.test.tsx.
import { expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { setupPage } from '../../pages/setup.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { relaunchInto } from '../../helpers/launch.js';

const PIN = '4321';
const MAHARASHTRA = 'Maharashtra: Maharashtra Council of Homoeopathy';
const OTHER_VALUE = '__other__';
// Synthetic, no real person or institution (Sikkim has no board per source).
const OTHER_TEXT = 'Test Council for Sikkim';

const VERIFIED = [
  'Andhra Pradesh: Andhra Boards for Ayurveda and Homoeopathy',
  'Arunachal Pradesh: Arunachal Pradesh Homoeopathy Council',
  'Assam: Board of Homoeopathic System of Medicine, Assam',
  'Bihar: Bihar Homoeopathic Board of Medicine',
  'Chandigarh (UT): Council of Homoeopathic System of Medicine, Chandigarh',
  'Chhattisgarh: State Council of Homoeopathy, Chhattisgarh',
  'Delhi: Board of Homoeopathic System of Medicine, Delhi',
  'Goa: Goa Board of Indian System of Medicine & Homoeopathy',
  'Gujarat: Council of Homoeopathic System of Medicine, Gujarat State',
  'Haryana: Council of Homoeopathic System of Medicine, Haryana',
  'Jammu & Kashmir: Jammu & Kashmir Board of Homoeopathic System of Medicine',
  'Jharkhand: Jharkhand State AYUSH Medical Council',
  'Karnataka: Karnataka Board of Homoeopathic System of Medicine',
  'Kerala: Kerala State Medical Council',
  'Madhya Pradesh: State Council of Homoeopathy, Madhya Pradesh',
  MAHARASHTRA,
  'Meghalaya: Board of Homoeopathic Medicine, Meghalaya',
  'Nagaland: Board of Homoeopathic System of Medicine, Nagaland',
  'Odisha: Directorate of AYUSH, Odisha (registering authority)',
  'Punjab: Council of Homoeopathic System of Medicine, Punjab',
  'Rajasthan: Rajasthan Board of Homoeopathic Chikitsa Board',
  'Tamil Nadu: Tamil Nadu Homoeopathic Medical Council',
  'Telangana: Boards of Indian Medicines, Telangana',
  'Tripura: Council of Homoeopathic Medicine, Tripura',
  'Uttar Pradesh: Homoeopathic Medicine Board, Uttar Pradesh',
  'Uttarakhand: Homoeopathic Medicine Board, Uttarakhand',
  'West Bengal: Council of Homoeopathic Medicine, West Bengal',
  'National: National Commission for Homoeopathy (National Register)',
  'National (legacy): Central Council of Homoeopathy (pre-2020)',
];

/** Steps 2-4 with synthetic data, then Finish -> Today on this launch. */
async function finishRemainingSteps(): Promise<void> {
  await setupPage.fillClinicAndNext();
  await setupPage.setPinAndRevealRecovery(PIN);
  await setupPage.ackRecoveryAndNext();
  await expect(setupPage.licenceDevTrial).toBeDisplayed();
  await setupPage.finishSetup();
  await shellPage.waitForShell();
  await expect(shellPage.todayScreen).toBeDisplayed();
}

describe('M3set registration council PHASE A: verified dropdown, pick Maharashtra, finish, relaunch + unlock (SET-002)', () => {
  it('lists exactly the verified councils then Other, keeps the Maharashtra pick across Back, and completes setup', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await expect(setupPage.wizard).toBeDisplayed();

    // The control is a dropdown now, not a text box.
    expect((await setupPage.council.getTagName()).toLowerCase()).toBe('select');

    const options = await setupPage.councilOptionTexts();
    expect(options).toEqual([
      'Select your registering council',
      ...VERIFIED,
      'Other (type manually)',
    ]);
    expect(options.some((o) => o.startsWith('Himachal Pradesh'))).toBe(false);
    // M3-RWv6 item 1: '<State>: <Authority>', no em dash in any option.
    expect(options.filter((o) => o.includes('\u2014'))).toEqual([]);
    // Nothing chosen yet: the Other box is not shown.
    await expect(setupPage.councilOther).not.toBeExisting();

    // No council chosen blocks Next with the inline error.
    await setupPage.fillDoctorBasics();
    await setupPage.next.click();
    await setupPage.councilError.waitForDisplayed({ timeout: 10000 });
    await expect(setupPage.stepIndicator).toHaveText(
      expect.stringContaining(' 1 '),
    );

    // Pick Maharashtra; Next is accepted by setup_save_doctor_profile.
    await setupPage.selectCouncil(MAHARASHTRA);
    expect(await setupPage.councilValue()).toBe(MAHARASHTRA);
    await setupPage.nextAndWaitForStep(2, 'clinic');

    // Back re-opens step 1 with the same listed choice, no Other box.
    await setupPage.backAndWaitForStep(1);
    expect(await setupPage.councilValue()).toBe(MAHARASHTRA);
    await expect(setupPage.councilOther).not.toBeExisting();
    await setupPage.nextAndWaitForStep(2, 'clinic');

    await finishRemainingSteps();
  });

  it('reopens the provisioned install to the lock screen and unlocks to Today', async () => {
    await relaunchInto('main');
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/lock');
    await lockPage.attempt(PIN);
    await shellPage.waitForShell();
    await expect(shellPage.todayScreen).toBeDisplayed();
  });
});

describe('M3set registration council PHASE B: Other (type manually) is required and completes setup (SET-002)', () => {
  it('blocks Next while the Other box is empty, then a typed council name completes setup', async () => {
    await relaunchInto('other');
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');

    await setupPage.fillDoctorBasics();
    await setupPage.selectCouncil('Other (type manually)');
    expect(await setupPage.councilValue()).toBe(OTHER_VALUE);
    await setupPage.councilOther.waitForDisplayed({ timeout: 10000 });

    // Empty Other -> inline error, still on step 1.
    await setupPage.next.click();
    await setupPage.councilOtherError.waitForDisplayed({ timeout: 10000 });
    await expect(setupPage.councilOtherError).toHaveText('This field is required.');
    await expect(setupPage.stepIndicator).toHaveText(
      expect.stringContaining(' 1 '),
    );

    // Whitespace-only is still empty.
    await setupPage.typeCouncilOther('   ');
    await setupPage.next.click();
    await setupPage.councilOtherError.waitForDisplayed({ timeout: 10000 });
    await expect(setupPage.stepIndicator).toHaveText(
      expect.stringContaining(' 1 '),
    );

    // A typed name is accepted.
    await setupPage.typeCouncilOther(OTHER_TEXT);
    await setupPage.nextAndWaitForStep(2, 'clinic');

    // Back keeps Other + the typed text.
    await setupPage.backAndWaitForStep(1);
    expect(await setupPage.councilValue()).toBe(OTHER_VALUE);
    await expect(setupPage.councilOther).toHaveValue(OTHER_TEXT);
    await setupPage.nextAndWaitForStep(2, 'clinic');

    await finishRemainingSteps();
  });
});
