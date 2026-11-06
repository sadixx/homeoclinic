// @req VIS-001 VIS-002 VIS-003 CASE-005
// @tier stable
// @area visit
// @targets linux, windows
//
// M3-RWv2 S09 follow-up — RICH-TEXT (TipTap) model (ADR 0019 #10; docs/ui/
// S08-case-form.md; schema M3-RWv2-serialization-v3.md §9). The follow-up REUSES
// the rich CaseForm (route /patient/:id/case/:vid/followup, visitType=
// 'follow_up'); the backend copy-forward carries the WHOLE prior ProseMirror
// document forward — prior prose AND the family-history TABLE — and appends a
// new dated entry. This is the B7 reported FOLLOW-UP DATA-LOSS FIX: the prior
// family-history table must still be present when the follow-up reopens.
//
// Flow (one data dir, two phases):
//   PHASE A: provision -> register patient -> Take case -> type prose +
//     Record family history (a TWO-COLUMN table) -> Save. Capture pid.
//   PHASE B: back on the dashboard, click "Follow-up" -> the RICH editor
//     reopens (not the retired structured S09) carrying the PRIOR document incl
//     the FAMILY-HISTORY table (the fix). "Add entry" appends a NEW dated entry;
//     Save -> Saved.
//
// Synthetic patient only. No sleeps — all waits are waitUntil / waitForDisplayed.
import { $, browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';

const PIN = '1357';
const PATIENT_NAME = 'Followupina Testpatient';
const PROSE = 'Chronic migraine, right-sided, 3 years.';
const FAMILY_MATERNAL = 'Diabetes (mother)';
const FAMILY_PATERNAL = 'Hypertension (father)';
const FOLLOWUP_PROSE = 'Follow-up: 60% better after the remedy.';

let patientId = '';

describe('M3-RWv2 follow-up PHASE A: first case with a family-history table, saved (ADR 0019)', () => {
  it('provisions a patient, records prose + a family-history table in the rich editor, and saves', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    await patientsPage.openRegister();
    await expect(patientsPage.form).toBeDisplayed();
    await patientsPage.fillCore({ name: PATIENT_NAME, age: '38', city: 'Nashik' });
    await patientsPage.saveAndWaitForDashboard();

    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();
    const ids = await caseRichPage.routeIds();
    patientId = ids.patientId;
    expect(patientId.length).toBeGreaterThan(0);

    // Type prose + record a family-history TWO-COLUMN table.
    await caseRichPage.typeProse(PROSE);
    await caseRichPage.recordFamily(FAMILY_MATERNAL, FAMILY_PATERNAL);
    await browser.waitUntil(
      async () => (await caseRichPage.tableByType('family_history')) !== undefined,
      { timeout: 15000, timeoutMsg: 'family_history table was not inserted' },
    );
    const family = await caseRichPage.tableByType('family_history');
    expect(family?.headers.length).toBe(2);
    expect(await caseRichPage.tableCellText('family_history', 0, 0)).toContain('Diabetes');

    await caseRichPage.save();
    const saved = await caseRichPage.waitForSaved();
    expect(saved).toMatch(/^Saved/);
    // eslint-disable-next-line no-console
    console.log(`[rwv2-fu] PHASE A: first case saved for ${patientId} with a family-history 2-col table`);
  });
});

describe('M3-RWv2 follow-up PHASE B: dashboard Follow-up reopens the PRIOR rich document incl the family-history table (B7 data-loss fix)', () => {
  it('opens the follow-up from the dashboard; the rich editor carries the prior prose + family-history table; Add entry appends a new dated entry; Save', async () => {
    // Back on the dashboard, the first case is saved -> "Follow-up" is offered.
    await patientsPage.openDashboard(patientId);
    await patientsPage.waitForDashboard();

    const followupBtn = $('[data-testid="patient-dash-followup"]');
    await followupBtn.waitForClickable({ timeout: 15000 });
    await followupBtn.click();

    // The RICH case form opens in follow-up mode (NOT the retired structured S09
    // screen). The record button reads "Update family history" in follow-up.
    await caseRichPage.waitForForm();
    await expect(caseRichPage.editor()).toBeDisplayed();

    // ===== THE FIX: the PRIOR document, incl the family-history TABLE, is here =
    // Prior prose carried forward.
    await browser.waitUntil(
      async () => (await caseRichPage.editorText()).includes(PROSE),
      { timeout: 20000, timeoutMsg: 'prior prose was not carried forward into the follow-up' },
    );
    // The family-history table is STILL present (the reported data-loss fix).
    await browser.waitUntil(
      async () => (await caseRichPage.tableByType('family_history')) !== undefined,
      {
        timeout: 20000,
        timeoutMsg: 'B7 DATA-LOSS: prior family-history table missing on follow-up reopen',
      },
    );
    const family = await caseRichPage.tableByType('family_history');
    expect(family?.headers.length).toBe(2);
    expect(await caseRichPage.tableCellText('family_history', 0, 0)).toContain('Diabetes');
    expect(await caseRichPage.tableCellText('family_history', 0, 1)).toContain('Hypertension');
    // eslint-disable-next-line no-console
    console.log('[rwv2-fu] PHASE B: follow-up reopened the PRIOR document incl the family-history 2-col table (data-loss fixed)');

    // ===== Add a follow-up entry appends a NEW dated entry; Save ===========
    // M3-RWv4 §1 removed "Add new entry"; the surviving append control is
    // "Add follow-up entry" (case-form-add-followup-entry).
    const entriesBefore = await caseRichPage.entryCount();
    await caseRichPage.addFollowupEntry();
    await browser.waitUntil(
      async () => (await caseRichPage.entryCount()) === entriesBefore + 1,
      { timeout: 15000, timeoutMsg: 'follow-up Add entry did not append a new dated entry' },
    );
    await caseRichPage.typeProse(FOLLOWUP_PROSE);
    expect(await caseRichPage.editorText()).toContain(FOLLOWUP_PROSE);

    await caseRichPage.save();
    const saved = await caseRichPage.waitForSaved();
    expect(saved).toMatch(/^Saved/);
    // eslint-disable-next-line no-console
    console.log(`[rwv2-fu] PHASE B: appended a new dated entry (${entriesBefore} -> ${await caseRichPage.entryCount()}); Save -> "${saved}"`);
  });
});
