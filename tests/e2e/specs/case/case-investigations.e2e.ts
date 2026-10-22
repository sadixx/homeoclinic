// @req PAT-009
// @tier stable
// @area case
// @targets linux
//
// R3 UX3 S08 Investigations — lab-report attachments (HC-MVP1-M3ux3; PAT-009;
// docs/ui/S08-case-form.md; ADR 0017). Boot-gate aware, network disabled,
// isolated per-spec data dir.
//
// THE NATIVE-PICKER PROBLEM AND THE SEAM. The Investigations upload calls the
// typed `visit_pick_report_file` command, which in a normal build opens the
// native GTK file chooser (`blocking_pick_file`) — a window webdriver cannot
// click. The release build is UNCHANGED. Under the E2E build
// (`--features e2e-test-keys`) that command FIRST consults the
// `HC_E2E_REPORT_FILE` env var and, if it names a file that exists, returns
// THAT path as the picked file instead of opening the dialog (mirrors the
// `window.__HC_E2E_CAMERA__` camera seam; the path is never logged,
// R-PRIV-001). The app process inherits its env from the tauri-driver chain,
// which is (re)spawned with `{ ...process.env }` by helpers/driver.ts; so this
// spec sets `process.env.HC_E2E_REPORT_FILE` and relaunches the driver chain to
// point the seam at a specific fixture per upload.
//
// Because the env is fixed at driver-spawn time, the two uploads need two
// launches of the SAME 'main' data dir:
//
//   PHASE A (first launch, seam -> fixture PDF) — provision first-run
//     (SET-001) -> register an adult patient (S06) -> Take case -> S08 form ->
//     expand the Investigations rail section -> Upload with a caption ->
//     the report LISTS as item 1 with a PDF badge -> Open it -> the in-app
//     preview dialog shows (PDF -> "Save to open" download anchor, no embedded
//     object per CSP) -> close. Captures patientId + visitId.
//
//   PHASE B (SECOND launch, SAME data dir, seam -> fixture PNG) — relaunch
//     'main' (a genuine restart; boots to #/lock, unlock with the PIN) ->
//     reopen the SAME visit by deep-link -> the PDF from PHASE A is STILL listed
//     (persisted, encrypted-at-rest) -> Upload the PNG -> it LISTS as a second
//     item with an Image badge -> Open the image -> the preview shows the <img>
//     -> close -> Remove the image behind the confirm dialog -> the list
//     shrinks back to the single PDF (list updates). Encrypted-at-rest is
//     asserted at the Rust layer (attachment_service_test.rs); here we assert
//     the webview-observable lifecycle end to end.
//
// The spec owns its data (fixed fixtures + caption), so the badges/counts are
// deterministic. No sleeps; all waits go through the page objects' waitUntil.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { casePage } from '../../pages/case.page.js';
import { investigationsPage } from '../../pages/investigations.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { relaunchInto } from '../../helpers/launch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// tests/e2e/specs/case -> tests/e2e/fixtures/investigations
const FIXTURES = path.resolve(here, '..', '..', 'fixtures', 'investigations');
const PDF_FIXTURE = path.join(FIXTURES, 'lab-report.pdf');
const PNG_FIXTURE = path.join(FIXTURES, 'scan.png');

// The seam reads HC_E2E_REPORT_FILE from the APP process, which inherits its
// env from the tauri-driver chain spawned by helpers/driver.ts as
// `{ ...process.env, ...overrides }`. wdio imports this spec file AFTER the
// first session is already created in `beforeSession`, so a module-top
// assignment is too late to arm the first launch. Instead each phase's
// `before()` hook sets `process.env.HC_E2E_REPORT_FILE` and then
// `relaunchInto('main')`, which RESPAWNS the driver chain with the current env
// — so the app process always has the fixture path the phase needs (PDF for
// PHASE A, PNG for PHASE B) before any upload click.

const PIN = '7531';
const PATIENT_NAME = 'Reporta Testpatient';
const PDF_CAPTION = 'CBC blood report';
const PNG_CAPTION = 'USG abdomen scan';

// Carried from PHASE A to PHASE B (the visit reopened after the relaunch).
let patientId = '';
let visitId = '';

describe('R3 UX3 Investigations PHASE A: upload a PDF report via the seam, list with a PDF badge, open the preview (PAT-009)', () => {
  // Arm the seam at the PDF fixture and relaunch the fresh 'main' dir so the
  // app process (respawned with the current env) returns the PDF from
  // visit_pick_report_file. 'main' is unused so far -> a fresh install -> the
  // app self-routes to #/setup, asserted below.
  before(async () => {
    process.env.HC_E2E_REPORT_FILE = PDF_FIXTURE;
    await relaunchInto('main');
  });

  it('opens a case, uploads a PDF through the HC_E2E_REPORT_FILE seam, lists it with a PDF badge and opens its in-app preview', async () => {
    // ---- Boot-gate + provision + seed a patient ---------------------------
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    await patientsPage.openRegister();
    await expect(patientsPage.form).toBeDisplayed();
    await patientsPage.fillCore({ name: PATIENT_NAME, age: '45', city: 'Pune' });
    await patientsPage.saveAndWaitForDashboard();
    expect(await patientsPage.dashboardText()).toContain(PATIENT_NAME);

    // ---- Take case -> S08 form, open the Investigations section -----------
    await patientsPage.dashTakeCase();
    await casePage.waitForForm();
    const ids = await casePage.routeIds();
    patientId = ids.patientId;
    visitId = ids.visitId;
    expect(patientId.length).toBeGreaterThan(0);
    expect(visitId.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[inv] Take case -> /patient/${patientId}/case/${visitId}`);

    await casePage.expandSection(
      'investigations',
      'case-form-investigations-upload',
    );
    await investigationsPage.waitForEmpty();
    expect(await investigationsPage.itemCount()).toBe(0);
    // eslint-disable-next-line no-console
    console.log('[inv] Investigations panel open, empty-state shown');

    // ---- Upload the PDF via the seam -> lists with a PDF badge ------------
    await investigationsPage.setCaption(PDF_CAPTION);
    await investigationsPage.uploadAndWaitForCount(1);
    await expect(investigationsPage.item(1)).toBeDisplayed();
    const pdfBadge = await investigationsPage.badgeText(1);
    expect(pdfBadge.toUpperCase()).toBe('PDF');
    // eslint-disable-next-line no-console
    console.log(`[inv] uploaded PDF via seam -> item 1 badge="${pdfBadge}" (PAT-009 upload + PDF badge)`);

    // ---- Open the PDF -> in-app preview (download anchor, CSP: no embed) ---
    await investigationsPage.openItem(1);
    await expect(investigationsPage.previewDownload).toBeDisplayed();
    // eslint-disable-next-line no-console
    console.log('[inv] opened PDF -> in-app preview dialog shows the "Save to open" download anchor (visit_open_attachment)');
    await investigationsPage.closePreview();
  });
});

describe('R3 UX3 Investigations PHASE B: relaunch SAME dir, PDF persisted, upload an image (Image badge), open, then remove -> list updates (PAT-009)', () => {
  // SECOND launch against the SAME 'main' dir, with the seam now pointed at the
  // PNG fixture. Done in a before() hook (the boot-gate/case-form pattern) so
  // the relaunch is a genuine restart and its post-reload commands run.
  before(async () => {
    process.env.HC_E2E_REPORT_FILE = PNG_FIXTURE;
    await relaunchInto('main');
  });

  it('relaunches on the SAME data dir, still lists the PDF, uploads a PNG with an Image badge, opens its preview, and removes it so the list updates', async () => {
    // Genuine relaunch proof: the app self-routes to #/lock on reopen (SET-004).
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/lock');
    await expect(bootPage.lockCard).toBeDisplayed();
    await lockPage.attempt(PIN);
    await shellPage.waitForShell();
    // eslint-disable-next-line no-console
    console.log('[inv] relaunched on SAME data dir -> booted to #/lock -> unlocked with PIN');

    // Reopen the EXACT same visit and prove the PHASE A PDF persisted.
    await casePage.openVisit(patientId, visitId);
    await casePage.expandSection(
      'investigations',
      'case-form-investigations-list',
    );
    await browser.waitUntil(
      async () => (await investigationsPage.itemCount()) === 1,
      { timeout: 20000, timeoutMsg: 'PHASE A PDF not persisted across relaunch' },
    );
    expect((await investigationsPage.badgeText(1)).toUpperCase()).toBe('PDF');
    // eslint-disable-next-line no-console
    console.log('[inv] after relaunch the PDF report is STILL listed (persisted, encrypted-at-rest)');

    // ---- Upload the PNG via the seam -> second item, Image badge ----------
    await investigationsPage.setCaption(PNG_CAPTION);
    await investigationsPage.uploadAndWaitForCount(2);
    await expect(investigationsPage.item(2)).toBeDisplayed();
    const imageBadge = await investigationsPage.badgeText(2);
    expect(imageBadge.toUpperCase()).toBe('IMAGE');
    // eslint-disable-next-line no-console
    console.log(`[inv] uploaded PNG via seam -> item 2 badge="${imageBadge}" (PAT-009 upload + Image badge)`);

    // ---- Open the image -> preview shows the <img> ------------------------
    await investigationsPage.openItem(2);
    await expect(investigationsPage.previewImage).toBeDisplayed();
    // eslint-disable-next-line no-console
    console.log('[inv] opened image -> in-app preview dialog shows the <img> (visit_open_attachment, data: URL)');
    await investigationsPage.closePreview();

    // ---- Remove the image behind the confirm -> list updates --------------
    await investigationsPage.removeItemAndWaitForCount(2, 1);
    expect(await investigationsPage.itemCount()).toBe(1);
    expect((await investigationsPage.badgeText(1)).toUpperCase()).toBe('PDF');
    // eslint-disable-next-line no-console
    console.log('[inv] removed the image behind the confirm dialog -> list updates back to the single PDF (visit_delete_attachment)');
  });
});
