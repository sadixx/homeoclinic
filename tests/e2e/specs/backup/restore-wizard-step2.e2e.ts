// @req BAK-002 BAK-003
// @tier regression
// @area backup
// @targets linux
// Linux only: GTK chooser seam + a GDK_BACKEND=x11 window phase.
//
// b23-n1 / b23-n1-d1 / b23-n1-d2: click through the VISIBLE S17 restore wizard
// (docs/ui/S17-backup-restore.md) end to end with a REAL .hcbak: Step 1 picks
// the archive through the typed `backup_pick_restore_file` picker, Step 2's
// rendered preview panel shows the source's real patient count, visit count and
// last visit date, and Step 3 Restore applies it. restore-clean-install.e2e.ts
// proves the same numbers at the restore_preview IPC; this spec proves the
// doctor SEES them, can finish the restore from the UI, and that the RUNNING
// app serves the restored data afterwards (b23-n1-d2: before the live-pool
// swap fix the app kept its pool on the file the engine moved to
// pre-restore-*, so the restored data appeared only after a restart and a
// write after a restore went to the moved-aside copy).
//
//   PHASE A ('main', fresh install, ONE app session, no relaunch):
//     register 3 synthetic patients through the real S04 form, save one case
//     visit for 2 of them through the real case form, Back up now (backup_now),
//     then register a 4th patient (NOT in the backup). /backup -> real click
//     "Choose backup file" -> Step 1 shows the chosen .hcbak NAME -> password ->
//     Next -> Step 2 backup-restore-preview-{patients,visits,lastvisit} read
//     3 / 2 / DD-MM-YYYY of the newest visit's UTC day -> Next -> Step 3 ->
//     real click Restore -> "done". In the SAME session the patient list (the
//     typed patient_list_query AND the rendered S05 list) is exactly the 3
//     backed-up patients (the 4th is gone). Then register a NEW patient after
//     the restore, in the same session.
//   PHASE B ('main' again): kill + relaunch + unlock with the source PIN -> the
//     list is exactly the 3 backed-up patients + the post-restore patient, the
//     4th is absent (the post-restore write landed in the LIVE restored DB).
//   PHASE C ('clean', a second fresh install, 0 patients): the same wizard
//     restores the same archive; the same session lists exactly the 3 source
//     patients; after a relaunch the clean PIN unlocks and they are still there.
//
// ── The file chooser (E2E seam, ADR 0017) ──
// The native GTK chooser cannot be driven by webdriver. On the e2e-test-keys
// build only, backup_pick_restore_file reads HC_E2E_RESTORE_FILE from the APP
// process env AT PICK TIME and, if that file exists then, returns it without
// opening the dialog (same pattern as HC_E2E_REPORT_FILE). The app inherits the
// driver's env at LAUNCH, and PHASE A must not relaunch, so the env is set to a
// FIXED path (SEAM_FILE) before the single 'main' launch and the backup_now
// archive is copied there after the backup. The release build has no seam;
// real-picker-smoke.e2e.ts proves the native dialog there.
//
// Durable markers go to <HC_E2E_OUTDIR>/evidence.log; screenshots of Step 1,
// Step 2 and the done state to <HC_E2E_OUTDIR>/screenshots/. No sleeps: every
// wait is waitUntil / waitForDisplayed with a timeout.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { browser, expect } from '@wdio/globals';

import { backupPage } from '../../pages/backup.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { searchPage } from '../../pages/search.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { relaunchInto } from '../../helpers/launch.js';
import { enterUnlockedApp, provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { evidence } from '../../helpers/evidence.js';

const SOURCE_PIN = '5813';
const CLEAN_PIN = '8642';
const BACKUP_PASSWORD = 'wizard-backup-23';

const BACKUP_DIR = process.env.HC_E2E_BACKUP_DIR;
/** Fixed path the picker seam returns; the archive is copied here after backup. */
const SEAM_FILE = path.join(BACKUP_DIR ?? '.', 'picker-seam', 'restore-wizard-step2.hcbak');

const SOURCE_PATIENTS = [
  { name: 'Wizarda Countone', age: '41', withVisit: true },
  { name: 'Wizardb Counttwo', age: '52', withVisit: true },
  { name: 'Wizardc Countthree', age: '23', withVisit: false },
] as const;
/** Registered AFTER the backup: must disappear on restore. */
const AFTER_BACKUP_PATIENT = { name: 'Wizardd Notbacked', age: '34' } as const;
/** Registered AFTER the restore, same session: must survive kill + relaunch. */
const AFTER_RESTORE_PATIENT = { name: 'Wizarde Afterrestore', age: '29' } as const;

const EXPECTED_PATIENTS = SOURCE_PATIENTS.length;
const EXPECTED_VISITS = SOURCE_PATIENTS.filter((p) => p.withVisit).length;
const SOURCE_NAMES = SOURCE_PATIENTS.map((p) => p.name).sort();

/** UTC calendar day now (visit_at is stored RFC3339 UTC; the header keeps its day). */
function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** ISO YYYY-MM-DD -> DD-MM-YYYY (shared/datetime.formatDate for a bare date). */
function dash(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function shotsDir(): string {
  const dir = path.join(process.env.HC_E2E_OUTDIR ?? '.', 'screenshots');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Element screenshot of the restore wizard, bounded so a WebKit screenshot
 * stall cannot consume the test timeout (a stall is logged, not fatal: the
 * assertions below are on the DOM, the screenshot is supporting evidence).
 */
async function shotWizard(file: string): Promise<string> {
  const target = path.join(shotsDir(), file);
  const res = await Promise.race([
    backupPage.restoreWizard.saveScreenshot(target).then(() => `screenshots/${file}`),
    new Promise<string>((resolve) => setTimeout(() => resolve(`screenshot ${file} timed out (20 s)`), 20000)),
  ]).catch((e: unknown) => `screenshot ${file} failed: ${String(e)}`);
  return res;
}

/** UTC days bracketing the PHASE A visit saves (two only across UTC midnight). */
const visitDays: string[] = [];

async function registerPatient(name: string, age: string): Promise<void> {
  await patientsPage.openRegister();
  await expect(patientsPage.form).toBeDisplayed();
  await patientsPage.fillCore({ name, age, city: 'Nagpur' });
  await patientsPage.saveAndWaitForDashboard();
}

async function registerSourcePatient(p: (typeof SOURCE_PATIENTS)[number]): Promise<void> {
  await registerPatient(p.name, p.age);
  if (!p.withVisit) return;
  await patientsPage.dashTakeCase();
  await caseRichPage.waitForForm();
  await caseRichPage.typeProse(`Chief complaint for ${p.name}`);
  await caseRichPage.save();
  expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);
}

/** Sorted names from the typed patient_list_query (all pages). */
async function ipcNames(): Promise<string[]> {
  return (await searchPage.listAllPatients()).map((r) => r.name).sort();
}

/**
 * The rendered S05 list: open it and wait until it shows `expected.length`
 * rows (or time out), then return the row texts. What the doctor SEES.
 */
async function renderedRowTexts(expected: number): Promise<string[]> {
  await patientsPage.openList();
  await browser
    .waitUntil(async () => (await patientsPage.listRows.length) === expected, { timeout: 15000, interval: 100 })
    .catch(() => undefined);
  const out: string[] = [];
  // DOM textContent, not getText(): the name/code cells are `truncate`
  // (overflow hidden) and WebKitWebDriver's visible-text heuristic drops them.
  for (const row of await patientsPage.listRows) {
    out.push(String(await row.getProperty('textContent')).replace(/\s+/g, ' ').trim());
  }
  return out;
}

/** Each expected name appears in exactly one rendered row; the count matches. */
function expectRowsAre(rows: string[], names: readonly string[], absent: readonly string[]): void {
  expect(rows.length).toBe(names.length);
  for (const n of names) expect(rows.filter((t) => t.includes(n)).length).toBe(1);
  for (const n of absent) expect(rows.some((t) => t.includes(n))).toBe(false);
}

/**
 * Drive the S17 wizard from /backup: Choose (seam) -> Step 1 name -> password ->
 * Next -> Step 2 counts -> Next -> Step 3 Restore -> done -> Close. `tag` labels
 * the evidence and screenshots of this pass.
 */
async function restoreThroughWizard(tag: string): Promise<void> {
  await backupPage.open();
  await expect(backupPage.screen).toBeDisplayed();

  // ---- Step 1: real click on "Choose backup file" ------------------------
  await backupPage.restoreChoose.waitForClickable({ timeout: 15000 });
  await backupPage.restoreChoose.click();
  await backupPage.restoreStep1Title.waitForDisplayed({ timeout: 15000 });
  const chosen = (await backupPage.restoreFile.getText()).trim();
  const shot1 = await shotWizard(`${tag}-restore-step1.png`);
  evidence(`[b23-n1 ${tag}] Step 1 shown; chosen file text ${JSON.stringify(chosen)}; ${shot1}`);
  // The typed picker returned the seam archive; Step 1 shows its NAME only.
  expect(chosen).toBe(path.basename(SEAM_FILE));
  expect(chosen.endsWith('.hcbak')).toBe(true);

  const pw = backupPage.restorePassword;
  await pw.waitForDisplayed({ timeout: 15000 });
  await pw.click();
  await pw.setValue(BACKUP_PASSWORD);
  await browser.waitUntil(async () => (await pw.getValue()) === BACKUP_PASSWORD, {
    timeout: 10000,
    timeoutMsg: 'restore password did not take the typed value',
  });
  await backupPage.restoreNext.waitForClickable({ timeout: 15000 });
  await backupPage.restoreNext.click();

  // ---- Step 2 (or the error that stopped it) -----------------------------
  const step2 = backupPage.restoreStep2Title;
  const err = backupPage.restoreError;
  const pwErr = backupPage.restorePasswordError;
  await browser
    .waitUntil(async () => (await step2.isExisting()) || (await err.isExisting()) || (await pwErr.isExisting()), {
      timeout: 20000,
      interval: 100,
    })
    .catch(() => undefined);
  const shotNext = await shotWizard(`${tag}-restore-after-next.png`);
  if (!(await step2.isExisting())) {
    const errText = (await err.isExisting()) ? (await err.getText()).trim() : '';
    const pwText = (await pwErr.isExisting()) ? (await pwErr.getText()).trim() : '';
    const details = (await backupPage.restoreErrorDetails.isExisting())
      ? (await backupPage.restoreErrorDetails.getText()).trim()
      : '';
    evidence(
      `[b23-n1 ${tag}] Step 2 NOT reached after Next with chosen ${JSON.stringify(chosen)}: error=${JSON.stringify(errText)} ` +
        `passwordError=${JSON.stringify(pwText)} details=${JSON.stringify(details)}; ${shotNext}`,
    );
    throw new Error(
      `b23-n1 ${tag}: restore wizard did not reach Step 2 (chosen ${JSON.stringify(chosen)}; error ${JSON.stringify(errText)}; ` +
        `password error ${JSON.stringify(pwText)}; details ${JSON.stringify(details)})`,
    );
  }

  await backupPage.restorePreviewPanel.waitForDisplayed({ timeout: 15000 });
  const patients = await backupPage.restorePreviewField('patients');
  const visits = await backupPage.restorePreviewField('visits');
  const lastVisit = await backupPage.restorePreviewField('lastvisit');
  const made = await backupPage.restorePreviewField('made');
  const version = await backupPage.restorePreviewField('version');
  const shot2 = await shotWizard(`${tag}-restore-step2.png`);
  evidence(
    `[b23-n1 ${tag}] Step 2 panel: patients=${JSON.stringify(patients)} visits=${JSON.stringify(visits)} lastVisit=${JSON.stringify(lastVisit)} ` +
      `made=${JSON.stringify(made)} version=${JSON.stringify(version)}; expected ${EXPECTED_PATIENTS}/${EXPECTED_VISITS}/` +
      `${visitDays.map(dash).join('|')}; ${shot2}`,
  );
  expect(patients).toBe(String(EXPECTED_PATIENTS));
  expect(visits).toBe(String(EXPECTED_VISITS));
  expect(visitDays.map(dash)).toContain(lastVisit);
  expect(made.length).toBeGreaterThan(0);
  expect(version.length).toBeGreaterThan(0);

  // ---- Step 3: confirm and restore -------------------------------------
  await backupPage.restoreNext.waitForClickable({ timeout: 15000 });
  await backupPage.restoreNext.click();
  await backupPage.restoreStep3Title.waitForDisplayed({ timeout: 15000 });
  await backupPage.restoreConfirm.waitForClickable({ timeout: 15000 });
  await backupPage.restoreConfirm.click();
  await browser.waitUntil(
    async () => (await backupPage.restoreDone.isExisting()) || (await err.isExisting()),
    { timeout: 60000, interval: 200, timeoutMsg: `b23-n1 ${tag}: Step 3 Restore neither finished nor errored in 60 s` },
  );
  const applyErr = (await err.isExisting()) ? (await err.getText()).trim() : '';
  expect(applyErr).toBe('');
  await backupPage.restoreDone.waitForDisplayed({ timeout: 15000 });
  const doneText = (await backupPage.restoreDone.getText()).trim();
  const shot3 = await shotWizard(`${tag}-restore-done.png`);
  const hash = await browser.execute(() => window.location.hash);
  evidence(`[b23-n1 ${tag}] Step 3 Restore done: ${JSON.stringify(doneText)}; route ${JSON.stringify(hash)}; ${shot3}`);
  // Still unlocked on the backup screen (a reopen failure would route to #/lock).
  expect(hash).not.toContain('/lock');
  expect((await backupPage.setupState()).completed).toBe(true);

  // The done state closes cleanly.
  await backupPage.restoreClose.click();
  await backupPage.restoreWizard.waitForDisplayed({ reverse: true, timeout: 15000 });
}

describe('b23-n1 restore wizard PHASE A: ONE session backs up 3 patients / 2 visits, adds a 4th, restores, and serves the restored data live (b23-n1-d2)', () => {
  before(async () => {
    expect(BACKUP_DIR).toBeDefined();
    // X11 like the other screenshot specs. The picker seam is read from the
    // APP env at pick time, so it is set BEFORE this single 'main' launch; the
    // file itself only appears after the backup below.
    process.env.GDK_BACKEND = 'x11';
    process.env.HC_E2E_RESTORE_FILE = SEAM_FILE;
    await relaunchInto('main');
  });

  it('b23-n1 source: registers 3 patients, saves 2 visits, backs up to a verified .hcbak, then registers a 4th patient', async () => {
    await provisionAndEnterApp('main', SOURCE_PIN);
    await shellPage.waitForShell();

    visitDays.push(utcDay());
    for (const p of SOURCE_PATIENTS) await registerSourcePatient(p);
    visitDays.push(utcDay());

    await backupPage.open();
    await expect(backupPage.screen).toBeDisplayed();
    const res = await backupPage.backupNow(BACKUP_DIR as string, BACKUP_PASSWORD);
    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(existsSync(res.filePath)).toBe(true);
    expect(res.filePath.endsWith('.hcbak')).toBe(true);

    // Hand the archive to the picker seam (identical bytes, fixed name).
    mkdirSync(path.dirname(SEAM_FILE), { recursive: true });
    copyFileSync(res.filePath, SEAM_FILE);
    expect(existsSync(SEAM_FILE)).toBe(true);
    evidence(
      `[b23-n1] PHASE A: ${EXPECTED_PATIENTS} patients, ${EXPECTED_VISITS} visits saved via UI; backup_now ok verified ` +
        `-> ${path.basename(res.filePath)} (seam copy ${path.basename(SEAM_FILE)})`,
    );

    // A patient the backup does NOT contain, written through the live pool.
    await registerPatient(AFTER_BACKUP_PATIENT.name, AFTER_BACKUP_PATIENT.age);
    const before = await ipcNames();
    evidence(`[b23-n1] PHASE A before restore (same session): patients=${before.length} ${JSON.stringify(before)}`);
    expect(before).toEqual([...SOURCE_NAMES, AFTER_BACKUP_PATIENT.name].sort());
  });

  it('b23-n1 wizard same session: Step 2 reads 3 patients, 2 visits, last visit date -> Restore complete -> the list shows exactly the 3 backed-up patients', async () => {
    await restoreThroughWizard('main');

    // What the doctor sees right after "Restore complete." in the SAME session.
    const names = await ipcNames();
    const rows = await renderedRowTexts(EXPECTED_PATIENTS);
    evidence(
      `[b23-n1] PHASE A same-session after restore: patient_list_query=${names.length} ${JSON.stringify(names)}; ` +
        `S05 rows=${rows.length} ${JSON.stringify(rows)}`,
    );
    expect(names).toEqual(SOURCE_NAMES);
    expectRowsAre(rows, SOURCE_NAMES, [AFTER_BACKUP_PATIENT.name]);
  });

  it('b23-n1 write after restore: registering a new patient in the same session lands in the restored data', async () => {
    await registerPatient(AFTER_RESTORE_PATIENT.name, AFTER_RESTORE_PATIENT.age);
    const names = await ipcNames();
    evidence(`[b23-n1] PHASE A after post-restore write (same session): patients=${names.length} ${JSON.stringify(names)}`);
    expect(names).toEqual([...SOURCE_NAMES, AFTER_RESTORE_PATIENT.name].sort());
  });
});

describe('b23-n1 restore wizard PHASE B: kill + relaunch + unlock keeps the post-restore write (b23-n1-d2)', () => {
  it('b23-n1 relaunch main: the source PIN unlocks and the list is the 3 backed-up patients + the post-restore patient, without the 4th', async () => {
    // enterUnlockedApp -> relaunchInto -> startDriver force-kills (SIGKILL)
    // the running app chain, relaunches over the SAME dir, asserts #/lock.
    await enterUnlockedApp('main', SOURCE_PIN);
    const expected = [...SOURCE_NAMES, AFTER_RESTORE_PATIENT.name].sort();
    const names = await ipcNames();
    const rows = await renderedRowTexts(expected.length);
    evidence(
      `[b23-n1] PHASE B kill + relaunch + unlock (source PIN): patient_list_query=${names.length} ${JSON.stringify(names)}; ` +
        `S05 rows=${rows.length} ${JSON.stringify(rows)}`,
    );
    expect(names).toEqual(expected);
    expectRowsAre(rows, expected, [AFTER_BACKUP_PATIENT.name]);
  });
});

describe('b23-n1 restore wizard PHASE C: the same wizard restores the archive onto a clean install (BAK-003)', () => {
  before(async () => {
    // HC_E2E_RESTORE_FILE (still set) points at SEAM_FILE, which now exists.
    expect(existsSync(SEAM_FILE)).toBe(true);
    await relaunchInto('clean');
  });

  after(() => {
    delete process.env.HC_E2E_RESTORE_FILE;
    delete process.env.GDK_BACKEND;
  });

  it('b23-n1 clean install: the wizard restores 3 patients / 2 visits and the same session lists exactly the 3 source patients', async () => {
    await provisionAndEnterApp('clean', CLEAN_PIN);
    await shellPage.waitForShell();
    const before = await ipcNames();
    evidence(`[b23-n1] PHASE C clean install: ${before.length} patients before restore`);
    expect(before.length).toBe(0);

    await restoreThroughWizard('clean');
    const names = await ipcNames();
    evidence(`[b23-n1] PHASE C same-session after restore: patients=${names.length} ${JSON.stringify(names)}`);
    expect(names).toEqual(SOURCE_NAMES);
  });

  it('b23-n1 relaunch clean: the restored clean install unlocks with the clean PIN and lists exactly the 3 source patients', async () => {
    await enterUnlockedApp('clean', CLEAN_PIN);
    const names = await ipcNames();
    evidence(`[b23-n1] PHASE C relaunch + unlock (clean PIN): patients=${names.length} ${JSON.stringify(names)}`);
    expect(names).toEqual(SOURCE_NAMES);
  });
});
