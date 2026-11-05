// @req SET-007 PAT-038
// @tier regression
// @area settings
// @targets linux
//
// MS (S18 Settings) camera choice (SET-007, design §7).
//
//   1. Headless (xvfb, no camera granted to the webview): the Camera card says
//      "No camera found. You can still add a photo from a file."
//   2. Seam: window.__HC_E2E_CAMERAS__ (shared/camera.ts) lists two synthetic
//      cameras; Refresh shows them after "System default"; choose the 2nd,
//      Save, relaunch + unlock: the choice is kept (re-read with the seam, as
//      a fresh webview has no seam and real enumeration finds nothing).
//   3. Fallback on S06 with a saved preferred camera: the deterministic
//      __HC_E2E_CAMERA__ grant still attaches a captured frame (the seam wins,
//      precedence unchanged), and "Choose file" still attaches a photo.
//
// HOST REQUIREMENT: step 1 needs a PC with no camera. On a dev host that has
// one, WebKitGTK enumerates it through PipeWire even under xvfb; run this spec
// with PipeWire unreachable and /dev/video* hidden (the build-4 executor wraps
// it: PIPEWIRE_REMOTE=<missing socket> + a user/mount namespace masking
// /dev/video*). Nothing in the app is faked for step 1.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { browser, expect } from '@wdio/globals';

import { evidence } from '../../helpers/evidence.js';
import { dataDir } from '../../helpers/launch.js';
import { enterUnlockedApp, provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { bootPage } from '../../pages/boot.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { settingsPage } from '../../pages/settings.page.js';

const PIN = '8642';
const NO_CAMERA = 'No camera found. You can still add a photo from a file.';
const CAMS = [
  { deviceId: 'e2e-cam-front', label: 'E2E Front Desk Camera' },
  { deviceId: 'e2e-cam-exam', label: 'E2E Exam Room Camera' },
] as const;

/** Wait until the camera card has finished its first enumeration. */
async function cameraCardState(): Promise<'none' | 'select'> {
  let state: 'none' | 'select' | null = null;
  await browser.waitUntil(
    async () => {
      if (await settingsPage.cameraNone.isExisting()) state = 'none';
      else if (await settingsPage.cameraSelect.isExisting()) state = 'select';
      return state !== null;
    },
    { timeout: 20000, timeoutMsg: 'camera card never settled (none / select)' },
  );
  return state ?? 'none';
}

function tinyPng(): string {
  const file = path.join(dataDir('fixtures'), 'photo.png');
  writeFileSync(
    file,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  return file;
}

describe('MS settings camera: none under xvfb, seam list, saved choice, S06 fallback (SET-007)', () => {
  it('MS camera step 1-2: "No camera found" headless; seam cameras listed; 2nd chosen, saved, kept after relaunch', async () => {
    expect(await bootPage.waitForDecidedScreen()).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await settingsPage.openViaNav();

    expect(await cameraCardState()).toBe('none');
    expect((await settingsPage.cameraNone.getText()).trim()).toBe(NO_CAMERA);
    evidence(`[ms-camera] headless xvfb: settings-camera-none "${NO_CAMERA}"`);

    await settingsPage.setFakeCameras(CAMS);
    await settingsPage.refreshCameras();
    await settingsPage.cameraSelect.waitForDisplayed({ timeout: 15000 });
    const options = await settingsPage.cameraOptions();
    expect(options.slice(1)).toEqual(CAMS.map((c) => c.label));
    await settingsPage.cameraSelect.selectByAttribute('value', CAMS[1].deviceId);
    expect(await settingsPage.saveAndWait()).toBe('Settings saved.');
    evidence(`[ms-camera] seam list after Refresh: ${JSON.stringify(options)}; chose "${CAMS[1].label}" and saved`);

    await enterUnlockedApp('main', PIN);
    await settingsPage.openViaNav();
    // A fresh webview has no seam: still "none" headless, the choice is kept server-side.
    expect(await cameraCardState()).toBe('none');
    await settingsPage.setFakeCameras(CAMS);
    await settingsPage.refreshCameras();
    await settingsPage.cameraSelect.waitForDisplayed({ timeout: 15000 });
    await browser.waitUntil(
      async () => (await settingsPage.cameraSelect.getValue()) === CAMS[1].deviceId,
      { timeout: 10000, timeoutMsg: 'saved camera choice not selected after relaunch' },
    );
    evidence(`[ms-camera] after relaunch + unlock: saved choice ${CAMS[1].deviceId} still selected`);
  });

  it('MS camera step 3: with a saved camera, S06 webcam (seam grant) and Choose file still attach a photo', async () => {
    await patientsPage.openRegister();
    await patientsPage.fillCore({ name: 'Farah Camerasaved', age: '29' });
    await patientsPage.setCameraOverride('grant');
    await patientsPage.clickWebcam();
    await browser.waitUntil(
      async () => {
        const src = await patientsPage.photoImg.getAttribute('src');
        return typeof src === 'string' && src.startsWith('data:image/png');
      },
      { timeout: 10000, timeoutMsg: 'webcam (seam grant) did not attach a frame with a saved camera' },
    );
    evidence('[ms-camera] S06 webcam with saved preferred camera: __HC_E2E_CAMERA__ grant still attaches a data-URL frame');

    await patientsPage.removePhoto();
    await browser.waitUntil(async () => !(await patientsPage.hasPhoto()), {
      timeout: 10000,
      timeoutMsg: 'photo not removed',
    });
    await patientsPage.attachPhotoFile(tinyPng());
    await browser.waitUntil(async () => patientsPage.hasPhoto(), {
      timeout: 10000,
      timeoutMsg: 'Choose file did not attach a photo',
    });
    await patientsPage.saveAndWaitForDashboard();
    expect(await patientsPage.dashHasPhotoImg()).toBe(true);
    evidence('[ms-camera] Choose file fallback attached; patient saved with photo');
  });
});
