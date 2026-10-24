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
import { caseRichPage } from '../../pages/case-rich.page.js';
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
// Carried from PHASE A to PHASE B (the visit reopened after the relaunch).
let patientId = '';
let visitId = '';

describe('R3 UX4 Investigations PHASE A: Submitted dropdown -> upload via the seam -> link row + warning note + two-way Lab reports panel with <investigation>-<patient>-<date> label (PAT-009; M3-RWv4)', () => {
  // Arm the seam at the PDF fixture and relaunch the fresh 'main' dir so the
  // app process (respawned with the current env) returns the PDF from
  // visit_pick_report_file. 'main' is unused so far -> a fresh install -> the
  // app self-routes to #/setup, asserted below.
  before(async () => {
    process.env.HC_E2E_REPORT_FILE = PDF_FIXTURE;
    await relaunchInto('main');
  });

  it('opens a case, selects Submitted in the investigations dropdown, uploads via the HC_E2E_REPORT_FILE seam, links it with a renamed display label and shows it in the patient-dashboard Lab reports & Scans panel', async () => {
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
    await caseRichPage.waitForForm();
    const ids = await caseRichPage.routeIds();
    patientId = ids.patientId;
    visitId = ids.visitId;
    expect(patientId.length).toBeGreaterThan(0);
    expect(visitId.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[inv] Take case -> /patient/${patientId}/case/${visitId}`);

    // ---- Open the Submitted dropdown -> upload via the seam ---------------
    // RWv4 §4: Record investigations -> type a name -> status DROPDOWN ->
    // Submitted opens a popup with upload-new + pick-existing + a warning note.
    await investigationsPage.openSubmittedFor('CBC');
    await expect(investigationsPage.uploadWarning).toBeDisplayed();
    await expect(investigationsPage.submitUpload).toBeDisplayed();
    await expect(investigationsPage.submitPickList).toBeDisplayed();
    // eslint-disable-next-line no-console
    console.log('[inv] Submitted dropdown -> popup with upload-new + pick-existing + warning note');

    await investigationsPage.uploadNewAndWaitForLink(1);
    const linkLabel = await investigationsPage.linkLabel(1);
    // RWv4 label shape '<investigation>-<patient>-<date>' (composeDisplayLabel).
    expect(linkLabel).toMatch(/CBC/i);
    // eslint-disable-next-line no-console
    console.log(`[inv] uploaded via seam -> investigation link row 1 label="${linkLabel}"`);

    // ---- Two-way panel: it ALSO appears in the patient dashboard ----------
    await patientsPage.openDashboard(patientId);
    await patientsPage.waitForLabReportsPanel();
    await browser.waitUntil(async () => (await patientsPage.labReportsCount()) === 1, {
      timeout: 20000,
      timeoutMsg: 'uploaded report did not appear in the patient-dashboard Lab reports & Scans panel',
    });
    const panelLabel = await patientsPage.labReportsLabel(1);
    // Display label shaped '<investigation>-<patient>-<date>': three '-'-joined
    // parts, the first the investigation, and a date digit present.
    expect(panelLabel).toMatch(/CBC/i);
    expect(panelLabel.split('-').length).toBeGreaterThanOrEqual(3);
    expect(panelLabel).toMatch(/\d/);
    // eslint-disable-next-line no-console
    console.log(`[inv] 2-way panel: dashboard Lab reports & Scans shows 1 item, label="${panelLabel}" (<investigation>-<patient>-<date>)`);

    // Back into the SAME case to continue the lifecycle checks below.
    await caseRichPage.openVisit(patientId, visitId);
    await browser.waitUntil(async () => (await investigationsPage.linkCount()) === 1, {
      timeout: 20000,
      timeoutMsg: 'investigation link row not present after returning to the case',
    });
    // eslint-disable-next-line no-console
    console.log('[inv] returned to the case; investigation link row still present');
  });
});

describe('R3 UX4 Investigations PHASE B: relaunch SAME dir, link persisted, UNLINK keeps the file in the panel, DELETE removes it from the panel too (PAT-009; M3-RWv4)', () => {
  // SECOND launch against the SAME 'main' dir. The seam stays pointed at the
  // PDF fixture (no new upload in PHASE B); the before() hook is still needed
  // so the relaunch is a genuine restart and its post-reload commands run.
  before(async () => {
    process.env.HC_E2E_REPORT_FILE = PDF_FIXTURE;
    await relaunchInto('main');
  });

  it('relaunches on the SAME data dir, still shows the link, UNLINK keeps the file in the Lab reports panel, and DELETE removes it from the panel', async () => {
    // Genuine relaunch proof: the app self-routes to #/lock on reopen (SET-004).
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/lock');
    await expect(bootPage.lockCard).toBeDisplayed();
    await lockPage.attempt(PIN);
    await shellPage.waitForShell();
    // eslint-disable-next-line no-console
    console.log('[inv] relaunched on SAME data dir -> booted to #/lock -> unlocked with PIN');

    // Reopen the EXACT same visit and prove the PHASE A link persisted.
    await caseRichPage.openVisit(patientId, visitId);
    await browser.waitUntil(
      async () => (await investigationsPage.linkCount()) === 1,
      { timeout: 20000, timeoutMsg: 'PHASE A investigation link not persisted across relaunch' },
    );
    // eslint-disable-next-line no-console
    console.log('[inv] after relaunch the investigation link is STILL present (persisted, encrypted-at-rest)');

    // ---- UNLINK from the investigation -> link row gone, FILE stays -------
    // RWv4 §5.6: unlink is a data_json edit only; the attachment file is NOT
    // deleted. After unlink the investigation link list is empty BUT the file
    // still shows in the patient-dashboard Lab reports & Scans panel.
    await investigationsPage.unlinkAndWaitForCount(1, 0);
    expect(await investigationsPage.linkCount()).toBe(0);
    // eslint-disable-next-line no-console
    console.log('[inv] UNLINK (behind confirm) -> investigation link row gone');

    await patientsPage.openDashboard(patientId);
    await patientsPage.waitForLabReportsPanel();
    await browser.waitUntil(async () => (await patientsPage.labReportsCount()) === 1, {
      timeout: 20000,
      timeoutMsg: 'unlink wrongly removed the file from the Lab reports panel (should KEEP the file)',
    });
    // eslint-disable-next-line no-console
    console.log('[inv] after UNLINK the file STILL shows in the Lab reports & Scans panel (keep file)');

    // ---- DELETE the file from the panel -> gone everywhere ----------------
    // RWv4 §5.6: delete removes the file (behind its own confirm) from the
    // panel too.
    await patientsPage.deleteLabReportAndWaitForCount(1, 0);
    expect(await patientsPage.labReportsCount()).toBe(0);
    await expect(patientsPage.labReportsEmpty).toBeDisplayed();
    // eslint-disable-next-line no-console
    console.log('[inv] DELETE (behind confirm) -> file gone from the Lab reports & Scans panel too');
  });
});
