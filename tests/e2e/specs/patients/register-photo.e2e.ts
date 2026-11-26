// @req PAT-001 PAT-002 PAT-038 PSR-001
// @tier stable
// @area patients
// @targets linux, windows
//
// R2 patient-register demo (HC-MVP1-216), part 1: register a patient via the
// S06 form WITH a photo, exercising the full photo lifecycle —
//   file attach  ->  forced-grant webcam capture  ->  delete  ->  recapture —
// then save and prove the patient is immediately findable by global search
// (S04). Network disabled, isolated data dir, boot-gate aware (the shared
// provision flow completes first-run setup + lands unlocked), camera grant
// forced deterministically via window.__HC_E2E_CAMERA__ (photo.ts seam).
//
// The patient's name/mobile are KNOWN (chosen by the spec), so the findability
// assertion is deterministic regardless of the random fixture — this spec owns
// its data (hc-e2e-testing: each spec seeds its own data; no ordering deps).
import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { searchPage } from '../../pages/search.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';

const PIN = '1357';
// A known, unusual name so the findability search is unambiguous.
const PATIENT_NAME = 'Zephyrina Qadirbux';
const PATIENT_MOBILE = '9876500042';

describe('R2 patient register with photo (S06)', () => {
  it('registers a patient with a photo through the full file->webcam->delete->recapture lifecycle, saves, and the patient is immediately findable', async () => {
    // Boot-gate: fresh dir self-routes to setup; provision + land on Today.
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    // Open the S06 register form (the search no-results "New patient" path).
    await patientsPage.openRegister();
    await expect(patientsPage.form).toBeDisplayed();
    await expect(patientsPage.photoNone).toBeDisplayed();

    // Core demographics (name + age required; mobile for later search proof).
    await patientsPage.fillCore({
      name: PATIENT_NAME,
      age: '37',
      mobile: PATIENT_MOBILE,
      city: 'Pune',
    });

    // ---- Photo lifecycle (PAT-038) ----------------------------------------
    // 1) File attach: write a tiny PNG and set it on the file input (the page
    //    object momentarily unhides the sr-only input so WebKitWebDriver can
    //    upload, then restores it — the production attach path is unchanged).
    await patientsPage.attachPhotoFile(await tinyPngPath());
    await browser.waitUntil(async () => patientsPage.hasPhoto(), {
      timeout: 10000,
      timeoutMsg: 'photo preview did not appear after file attach',
    });
    await expect(patientsPage.photoImg).toBeDisplayed();
    // A FILE photo keeps the webcam button on 'Use webcam' (not 'Retake'), still
    // exactly one webcam button and no legacy retake button.
    await expectPhotoColumn('Use webcam', 'blob:');
    // eslint-disable-next-line no-console
    console.log('[R2-photo] file attach -> preview shown; webcam button still "Use webcam"');

    // 2) Forced-grant webcam capture: override the sim to GRANT, then capture.
    await patientsPage.setCameraOverride('grant');
    await patientsPage.clickWebcam();
    await browser.waitUntil(
      async () => {
        const src = await patientsPage.photoImg.getAttribute('src');
        return typeof src === 'string' && src.startsWith('data:image/png');
      },
      {
        timeout: 10000,
        timeoutMsg: 'webcam capture did not attach a data-URL frame after forced grant',
      },
    );
    // After a webcam capture the SAME webcam button reads 'Retake': exactly one
    // such button, the duplicate patient-form-photo-retake is gone, and Choose
    // file + Remove photo are still offered.
    await expectPhotoColumn('Retake', 'data:image/png');
    // eslint-disable-next-line no-console
    console.log('[R2-photo] forced-grant webcam capture -> data-URL frame attached; ONE button, text "Retake"');

    // 2b) Click the 'Retake' (webcam) button once: the preview stays attached
    //     and there is still exactly ONE retake/webcam button.
    await patientsPage.clickWebcam();
    await patientsPage.waitForWebcamButtonLabel('Retake');
    await expectPhotoColumn('Retake', 'data:image/png');

    // 3) Delete the photo.
    await patientsPage.removePhoto();
    await browser.waitUntil(async () => !(await patientsPage.hasPhoto()), {
      timeout: 10000,
      timeoutMsg: 'photo was not removed',
    });
    await expect(patientsPage.photoNone).toBeDisplayed();
    // With no photo the webcam button is back to 'Use webcam' (one button, no
    // legacy retake) and Remove photo is gone while Choose file remains.
    const afterDelete = await patientsPage.waitForWebcamButtonLabel('Use webcam');
    expect(afterDelete.imgSrc).toBeNull();
    expect(afterDelete.removeCount).toBe(0);
    expect(afterDelete.chooseFileCount).toBe(1);
    // eslint-disable-next-line no-console
    console.log('[R2-photo] delete -> photo removed, empty placeholder shown; webcam button "Use webcam"');

    // 4) Recapture via webcam (still forced-grant).
    await patientsPage.clickWebcam();
    await browser.waitUntil(async () => patientsPage.hasPhoto(), {
      timeout: 10000,
      timeoutMsg: 'photo was not re-captured after delete',
    });
    await expect(patientsPage.photoImg).toBeDisplayed();
    await expectPhotoColumn('Retake', 'data:image/png');
    // eslint-disable-next-line no-console
    console.log('[R2-photo] recapture -> photo attached again; ONE button, text "Retake"');

    // ---- Save + findability -----------------------------------------------
    await patientsPage.saveAndWaitForDashboard();
    const dash = await patientsPage.dashboardText();
    expect(dash).toContain(PATIENT_NAME);
    // eslint-disable-next-line no-console
    console.log(`[R2-photo] saved -> dashboard shows "${PATIENT_NAME}"`);

    // Immediately findable by global search (PSR-001): open F2, type part of
    // the known name, Enter opens the right dashboard.
    await searchPage.openWithF2();
    await searchPage.searchFor('Zephyrina', 1);
    const hit = await searchPage.firstResultText();
    expect(hit).toContain('Zephyrina');
    await searchPage.openFirstResult();
    await patientsPage.dashDemographics.waitForDisplayed({ timeout: 15000 });
    expect(await patientsPage.dashboardText()).toContain(PATIENT_NAME);
    // eslint-disable-next-line no-console
    console.log('[R2-photo] saved patient is immediately findable by name search');
  });
});

/**
 * Assert the photo column layout after the duplicate Retake button was removed:
 * exactly ONE webcam button carrying `label`, zero `patient-form-photo-retake`,
 * Choose file + Remove photo present, and a preview <img> whose src starts with
 * `srcPrefix` ('data:image/png' for a webcam frame, 'blob:' for a file photo).
 */
async function expectPhotoColumn(label: 'Retake' | 'Use webcam', srcPrefix: string): Promise<void> {
  const state = await patientsPage.waitForWebcamButtonLabel(label);
  expect(state.webcamCount).toBe(1);
  expect(state.legacyRetakeCount).toBe(0);
  expect(state.webcamLabel).toBe(label);
  expect(state.chooseFileCount).toBe(1);
  expect(state.removeCount).toBe(1);
  expect(state.imgSrc).not.toBeNull();
  expect((state.imgSrc as string).startsWith(srcPrefix)).toBe(true);
}

/**
 * Write a tiny valid 1x1 PNG to the spec temp area and return its absolute
 * path, for the file-attach branch of the photo lifecycle.
 */
async function tinyPngPath(): Promise<string> {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hc-e2e-photo-'));
  const file = path.join(dir, 'patient.png');
  // 1x1 transparent PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  writeFileSync(file, png);
  return file;
}
