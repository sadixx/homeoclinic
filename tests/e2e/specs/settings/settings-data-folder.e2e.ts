// @req SET-006 SET-004
// @tier regression
// @area settings
// @targets linux
// Linux only: asserts the Linux data-folder layout $XDG_DATA_HOME/dev.homeoclinic.desktop (Windows uses %APPDATA%).
//
// MS (S18 Settings) data-folder move (SET-006, ADR 0020) and the boot-time
// "data folder not available" screen.
//
// Folder picker: the e2e-test-keys build's settings_pick_data_folder returns
// HC_E2E_DATA_FOLDER when it names an existing directory (same seam pattern as
// HC_E2E_RESTORE_FILE; compiled out of release). The app reads it from ITS
// process env, so the spec sets process.env and relaunches the driver chain.
//
// On Linux the default data folder is the fixed home
// $XDG_DATA_HOME/dev.homeoclinic.desktop, which also holds logs/, the
// data-location.json pointer and WebKitGTK's own files. Only the clinic
// entries (clinic.db*, files/, licence/, backups/, exports/) move.
//
//   1. Provision, register patient P1, drop stray non-app files in the home.
//   2. Settings -> Change… -> confirm <parent>/HomeoClinic -> Move -> result.
//      FS: the new folder holds clinic.db + licence/; the home holds a
//      moved-out-<stamp>/ safety copy with clinic.db; clinic.db is gone from
//      the home top level; the stray files are still in the home and were
//      neither moved nor copied; logs/ and the pointer stay in the home.
//   3. Write after the move (patient P2), relaunch + unlock: Settings shows
//      the new folder, P1 and P2 both open.
//   4. Make the new folder unreachable (rename), relaunch: the missing-folder
//      screen names it; "Use the default folder" -> Cancel backs out with
//      nothing changed (pointer kept, nothing created in the home); "Try
//      again" while still missing stays; folder back -> "Try again" -> lock
//      -> unlock -> P1 still there.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { browser, expect } from '@wdio/globals';

import { evidence } from '../../helpers/evidence.js';
import { dataDir, relaunchInto } from '../../helpers/launch.js';
import { enterUnlockedApp, provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { bootPage } from '../../pages/boot.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { searchPage } from '../../pages/search.page.js';
import { settingsPage } from '../../pages/settings.page.js';
import { shellPage } from '../../pages/shell.page.js';

const PIN = '9753';
const IDENTIFIER = 'dev.homeoclinic.desktop';
const STRAY_FILE = 'my-notes-stray.txt';
const STRAY_DIR = 'my-scans-stray';
const STRAY_TEXT = 'not HomeoClinic data, must stay where it is';

async function registerPatient(name: string): Promise<string> {
  await patientsPage.openRegister();
  await patientsPage.fillCore({ name, age: '52' });
  await patientsPage.saveAndWaitForDashboard();
  // The id the typed patient_search returns for this unique name.
  const rows = await searchPage.searchRows(name);
  expect(rows.length).toBe(1);
  const id = rows[0]?.patientId ?? '';
  expect(id).not.toBe('');
  return id;
}

async function expectPatient(id: string, name: string): Promise<void> {
  await patientsPage.openDashboard(id);
  expect(await patientsPage.dashboardText()).toContain(name);
}

function movedOutDirs(home: string): string[] {
  return readdirSync(home).filter((n) => n.startsWith('moved-out-'));
}

describe('MS settings data folder: move, relaunch, missing-folder screen (SET-006)', () => {
  let home = '';
  let newParent = '';
  let newFolder = '';
  let p1 = '';
  let p2 = '';

  after(() => {
    delete process.env.HC_E2E_DATA_FOLDER;
  });

  it('MS data folder step 1-2: move to <parent>/HomeoClinic; stray files stay; safety copy kept in the old folder', async () => {
    expect(await bootPage.waitForDecidedScreen()).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    p1 = await registerPatient('Dara Beforemove');

    home = path.join(dataDir('main'), IDENTIFIER);
    expect(existsSync(path.join(home, 'clinic.db'))).toBe(true);
    writeFileSync(path.join(home, STRAY_FILE), STRAY_TEXT);
    mkdirSync(path.join(home, STRAY_DIR), { recursive: true });
    writeFileSync(path.join(home, STRAY_DIR, 'scan-1.txt'), STRAY_TEXT);

    newParent = dataDir('newparent');
    newFolder = path.join(newParent, 'HomeoClinic');
    process.env.HC_E2E_DATA_FOLDER = newParent;
    await enterUnlockedApp('main', PIN);

    await settingsPage.openViaNav();
    const before = await settingsPage.dataFolderPath();
    expect(path.resolve(before)).toBe(path.resolve(home));

    const { target, result } = await settingsPage.moveDataFolder();
    expect(target).toContain(newParent);
    expect(result).toContain(newFolder);
    expect(result).toContain(path.join(home, 'moved-out-'));
    await browser.waitUntil(
      async () => path.resolve(await settingsPage.dataFolderPath()) === path.resolve(newFolder),
      { timeout: 15000, timeoutMsg: 'settings-datafolder did not switch to the new folder' },
    );
    evidence(`[ms-datafolder] moved: confirm target "${target}"; result names new folder + moved-out safety copy`);

    // New folder holds the data.
    expect(existsSync(path.join(newFolder, 'clinic.db'))).toBe(true);
    expect(statSync(path.join(newFolder, 'clinic.db')).size).toBeGreaterThan(0);
    expect(existsSync(path.join(newFolder, 'licence'))).toBe(true);
    // Old folder: safety copy, clinic.db gone from the top level.
    const safety = movedOutDirs(home);
    expect(safety.length).toBe(1);
    const safetyDir = path.join(home, safety[0] ?? '');
    expect(statSync(path.join(safetyDir, 'clinic.db')).size).toBeGreaterThan(0);
    expect(existsSync(path.join(safetyDir, 'licence'))).toBe(true);
    expect(existsSync(path.join(home, 'clinic.db'))).toBe(false);
    // Stray non-app files are left behind untouched.
    expect(readFileSync(path.join(home, STRAY_FILE), 'utf8')).toBe(STRAY_TEXT);
    expect(readFileSync(path.join(home, STRAY_DIR, 'scan-1.txt'), 'utf8')).toBe(STRAY_TEXT);
    for (const where of [newFolder, safetyDir]) {
      expect(existsSync(path.join(where, STRAY_FILE))).toBe(false);
      expect(existsSync(path.join(where, STRAY_DIR))).toBe(false);
    }
    // Fixed-home items stay.
    expect(existsSync(path.join(home, 'logs'))).toBe(true);
    const pointer = JSON.parse(readFileSync(path.join(home, 'data-location.json'), 'utf8')) as { dataDir?: string };
    expect(path.resolve(pointer.dataDir ?? '')).toBe(path.resolve(newFolder));
    evidence(`[ms-datafolder] fs: new/clinic.db ${statSync(path.join(newFolder, 'clinic.db')).size} B + licence/; old ${safety[0]}/clinic.db + licence/; old top-level clinic.db gone; stray file + dir still in old folder only; logs/ + pointer in home -> new folder`);
  });

  it('MS data folder step 3: a write after the move survives relaunch + unlock in the new folder', async () => {
    p2 = await registerPatient('Esha Aftermove');
    delete process.env.HC_E2E_DATA_FOLDER;
    await enterUnlockedApp('main', PIN);

    await settingsPage.openViaNav();
    expect(path.resolve(await settingsPage.dataFolderPath())).toBe(path.resolve(newFolder));
    await expectPatient(p1, 'Dara Beforemove');
    await expectPatient(p2, 'Esha Aftermove');
    expect(existsSync(path.join(home, 'clinic.db'))).toBe(false);
    evidence('[ms-datafolder] relaunch + unlock: Settings shows the new folder; P1 (before move) + P2 (after move) both open; old top level still has no clinic.db');
  });

  it('MS data folder step 4: missing folder screen - Cancel backs out unchanged, Try again recovers', async () => {
    const away = `${newFolder}.unplugged`;
    renameSync(newFolder, away);
    const pointerBefore = readFileSync(path.join(home, 'data-location.json'), 'utf8');
    await relaunchInto('main');

    await settingsPage.waitForMissingScreen();
    expect(path.resolve((await settingsPage.missingPath.getText()).trim())).toBe(path.resolve(newFolder));
    await expect(settingsPage.missingRetry).toBeDisplayed();
    await expect(settingsPage.missingUseDefault).toBeDisplayed();
    expect(await lockPage.card.isExisting()).toBe(false);

    // Use the default folder -> confirm step -> Cancel.
    await settingsPage.missingUseDefault.click();
    await expect(settingsPage.missingConfirm).toBeDisplayed();
    await expect(settingsPage.missingCancel).toBeDisplayed();
    await settingsPage.missingCancel.click();
    await settingsPage.missingConfirm.waitForExist({ timeout: 10000, reverse: true });
    await expect(settingsPage.missingScreen).toBeDisplayed();
    await expect(settingsPage.missingRetry).toBeDisplayed();
    await expect(settingsPage.missingUseDefault).toBeDisplayed();
    expect(readFileSync(path.join(home, 'data-location.json'), 'utf8')).toBe(pointerBefore);
    expect(existsSync(path.join(home, 'clinic.db'))).toBe(false);
    expect(existsSync(newFolder)).toBe(false);
    evidence('[ms-datafolder] missing screen names the folder; Use default -> data-missing-cancel backs out: confirm gone, pointer unchanged, nothing created');

    // Try again while still missing: stays on the screen.
    await settingsPage.missingRetry.click();
    await browser.waitUntil(
      async () => (await settingsPage.missingScreen.getText()).includes('The folder is still not available.'),
      { timeout: 10000, timeoutMsg: 'Try again while missing did not say it is still missing' },
    );

    // Folder back -> Try again -> lock -> unlock -> data intact.
    renameSync(away, newFolder);
    await settingsPage.missingRetry.click();
    await lockPage.card.waitForDisplayed({ timeout: 20000 });
    await lockPage.attempt(PIN);
    await shellPage.waitForShell();
    await expectPatient(p1, 'Dara Beforemove');
    await expectPatient(p2, 'Esha Aftermove');
    evidence('[ms-datafolder] still-missing retry stays; folder reconnected -> Try again -> lock -> unlock -> P1 + P2 intact');
  });
});
