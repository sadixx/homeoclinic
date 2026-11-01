// @req PAT-001, PAT-005, PAT-038, PSR-001
// @tier stable
// @area patients
// @targets linux
//
// M3-RWv5 C1 + C2 (patient form / dashboard / search):
//   C1 marital status offers exactly Single / Married / Divorced / Widowed (plus
//      the empty "none"); each can be chosen; the saved value survives a
//      dashboard Edit reopen.
//   C2 a patient with a gender and NO photo shows the default avatar for that
//      gender (male / female) on the register form, the dashboard and the
//      search row; no gender -> the plain empty placeholder; attaching a real
//      photo REPLACES the avatar (form + dashboard).
// One fresh 'main' dir; the spec registers its own two patients. No sleeps.
import { writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { $, browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { searchPage } from '../../pages/search.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { evidence } from '../../helpers/evidence.js';

const PIN = '9753';
const MALE_NAME = 'Avatarion Testpatient';
const FEMALE_NAME = 'Avatarina Testpatient';

function tinyPng(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hc-e2e-rwv5-photo-'));
  const file = path.join(dir, 'patient.png');
  writeFileSync(
    file,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  return file;
}

describe('M3-RWv5 patient marital options + default gender avatar (PAT-001/005/038)', () => {
  it('offers Single/Married/Divorced/Widowed, shows a male/female default avatar without a photo on form, dashboard and search, and a real photo replaces it', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    // ---- C1: marital options ---------------------------------------------
    await patientsPage.openRegister();
    const opts = await patientsPage.maritalOptions();
    const real = opts.filter((o) => o.value !== '');
    expect(real.map((o) => o.value)).toEqual(['single', 'married', 'divorced', 'widowed']);
    expect(real.map((o) => o.label)).toEqual(['Single', 'Married', 'Divorced', 'Widowed']);
    expect(opts.some((o) => o.value === 'other')).toBe(false);
    for (const v of ['single', 'married', 'divorced', 'widowed']) {
      await patientsPage.setMarital(v);
      expect(await patientsPage.formMarital.getValue()).toBe(v);
    }
    evidence(`[rwv5] C1 marital options ${JSON.stringify(real.map((o) => o.label))}; each selectable`);

    // ---- C2: avatar on the register form ---------------------------------
    // No gender yet -> the plain empty placeholder, no avatar.
    await expect(patientsPage.photoNone).toBeDisplayed();
    expect(await patientsPage.avatarKind('patient-form-photo-avatar')).toBeNull();
    await patientsPage.setSex('M');
    await browser.waitUntil(async () => (await patientsPage.avatarKind('patient-form-photo-avatar')) === 'male', {
      timeout: 10000,
      timeoutMsg: 'male default avatar did not appear on the form',
    });
    await patientsPage.setSex('F');
    await browser.waitUntil(async () => (await patientsPage.avatarKind('patient-form-photo-avatar')) === 'female', {
      timeout: 10000,
      timeoutMsg: 'female default avatar did not appear on the form',
    });
    await patientsPage.setSex('M');
    await browser.waitUntil(async () => (await patientsPage.avatarKind('patient-form-photo-avatar')) === 'male', {
      timeout: 10000,
      timeoutMsg: 'avatar did not switch back to male',
    });
    expect(await patientsPage.hasPhoto()).toBe(false);
    evidence('[rwv5] C2 form: none -> M male avatar -> F female avatar -> M male avatar');

    // ---- Male patient, no photo, widowed -> dashboard + search avatar -----
    await patientsPage.fillCore({ name: MALE_NAME, age: '62', city: 'Pune' });
    await patientsPage.setMarital('widowed');
    await patientsPage.saveAndWaitForDashboard();
    expect(await patientsPage.avatarKind('patient-dash-photo-avatar')).toBe('male');
    expect(await patientsPage.dashHasPhotoImg()).toBe(false);
    await patientsPage.dashEdit.click();
    await patientsPage.formMarital.waitForDisplayed({ timeout: 10000 });
    await browser.waitUntil(async () => (await patientsPage.formMarital.getValue()) === 'widowed', {
      timeout: 10000,
      timeoutMsg: 'saved marital status was not reloaded on Edit',
    });
    evidence('[rwv5] C1/C2 male saved: dashboard male avatar, marital "widowed" persisted on Edit');

    // Leave the Edit form (no changes) back to the dashboard, then search.
    await patientsPage.openList();
    await searchPage.openWithF2();
    await searchPage.searchFor('Avatarion', 1);
    await browser.waitUntil(
      async () => (await $('[data-testid="search-result-row"] [data-testid="search-row-photo-avatar"]').isExisting()),
      { timeout: 10000, timeoutMsg: 'search row did not show the default avatar' },
    );
    expect(
      await $('[data-testid="search-result-row"] [data-testid="search-row-photo-avatar"]').getAttribute('data-avatar'),
    ).toBe('male');
    await searchPage.close();
    evidence('[rwv5] C2 search row shows the male default avatar');

    // ---- Female patient: avatar, then a real photo replaces it ------------
    await patientsPage.openRegister();
    await patientsPage.fillCore({ name: FEMALE_NAME, age: '35', city: 'Pune' });
    await patientsPage.setSex('F');
    await patientsPage.setMarital('divorced');
    await browser.waitUntil(async () => (await patientsPage.avatarKind('patient-form-photo-avatar')) === 'female', {
      timeout: 10000,
      timeoutMsg: 'female default avatar did not appear on the form',
    });
    await patientsPage.attachPhotoFile(tinyPng());
    await browser.waitUntil(async () => patientsPage.hasPhoto(), {
      timeout: 15000,
      timeoutMsg: 'photo preview did not appear after file attach',
    });
    expect(await patientsPage.avatarKind('patient-form-photo-avatar')).toBeNull();
    await patientsPage.saveAndWaitForDashboard();
    await browser.waitUntil(async () => patientsPage.dashHasPhotoImg(), {
      timeout: 15000,
      timeoutMsg: 'dashboard did not show the saved photo',
    });
    expect(await patientsPage.avatarKind('patient-dash-photo-avatar')).toBeNull();
    evidence('[rwv5] C2 female: avatar shown without photo; attached photo REPLACES it on form + dashboard');
  });
});
