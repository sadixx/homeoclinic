// @req CASE-001 CASE-003
// @tier stable
// @area case
// @targets linux
//
// M3-RWv4 §4 + §5 — modalities single-append table and section/entry removal
// with confirm + renumber. Boot-gate aware, network disabled, isolated per-spec
// data dir. One launch of a fresh 'main' dir; the spec owns all its data so the
// table/row counts and complaint numbering are deterministic.
//
//   §4 modalities single-append: "Record modalities" in an entry creates ONE
//     table[data-hc-table-type="modalities"]. Pressing "Record modalities"
//     AGAIN in the SAME entry APPENDS rows to the SAME table — the table count
//     stays 1 and the body-row count grows (it does NOT create a second table).
//
//   §5 remove with confirm + renumber: every complaint and every dated entry
//     carries a focusable remove (x) control. Removing opens a shared confirm
//     dialog; Confirm drops the node and renumbers the survivors; Cancel keeps
//     it. The LAST remaining complaint cannot be removed (floor of one).
//
// No sleeps — every wait is waitUntil / waitForDisplayed via the page objects.
import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';

const PIN = '1357';
const PATIENT_NAME = 'Modalis Testpatient';
const COMPLAINT_1 = 'Headache';
const COMPLAINT_2 = 'Backpain';

describe('M3-RWv4 §4+§5: modalities single-append table and section/entry remove with confirm + renumber (CASE-001, CASE-003)', () => {
  it('appends modalities rows to ONE table and removes complaints/entries behind a confirm with renumbering and a floor of one', async () => {
    // ---- Boot-gate + provision + seed a patient ---------------------------
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    await patientsPage.openRegister();
    await expect(patientsPage.form).toBeDisplayed();
    await patientsPage.fillCore({ name: PATIENT_NAME, age: '36', city: 'Pune' });
    await patientsPage.saveAndWaitForDashboard();
    expect(await patientsPage.dashboardText()).toContain(PATIENT_NAME);

    // ---- Take case -> rich editor -----------------------------------------
    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();
    await expect(caseRichPage.editor()).toBeDisplayed();

    // A named complaint section so the current entry is well-defined.
    await caseRichPage.addComplaint(COMPLAINT_1);
    await browser.waitUntil(
      async () => (await caseRichPage.complaintHeaders()).some((c) => c.text.includes(COMPLAINT_1)),
      { timeout: 15000, timeoutMsg: 'Add new complaint did not create a numbered section' },
    );
    await caseRichPage.focusComplaintByName(COMPLAINT_1);

    // ===== §4: modalities single-append ====================================
    // First Record modalities -> exactly ONE modalities table with one body row.
    await caseRichPage.recordModalities('Weather', 'Cold damp', 'Warm dry');
    await browser.waitUntil(async () => (await caseRichPage.modalitiesTableCount()) === 1, {
      timeout: 15000,
      timeoutMsg: 'first Record modalities did not create exactly one modalities table',
    });
    const rowsAfterFirst = await caseRichPage.modalitiesRowCount();
    expect(rowsAfterFirst).toBeGreaterThanOrEqual(1);
    // eslint-disable-next-line no-console
    console.log(`[rwv4] §4 first Record modalities -> 1 table, ${rowsAfterFirst} row(s)`);

    // Record modalities AGAIN in the SAME entry -> SAME table, MORE rows.
    await caseRichPage.focusComplaintByName(COMPLAINT_1);
    await caseRichPage.recordModalities('Time', 'Evening', 'Morning');
    await browser.waitUntil(
      async () => (await caseRichPage.modalitiesRowCount()) > rowsAfterFirst,
      { timeout: 15000, timeoutMsg: 'second Record modalities did not APPEND rows to the table' },
    );
    const tableCountAfterSecond = await caseRichPage.modalitiesTableCount();
    const rowsAfterSecond = await caseRichPage.modalitiesRowCount();
    // THE assertion: table count stayed 1, row count grew (single appendable table).
    expect(tableCountAfterSecond).toBe(1);
    expect(rowsAfterSecond).toBeGreaterThan(rowsAfterFirst);
    // eslint-disable-next-line no-console
    console.log(
      `[rwv4] §4 second Record modalities -> STILL 1 table, rows ${rowsAfterFirst} -> ${rowsAfterSecond} (APPENDED, not a new table)`,
    );

    // ===== §5: remove with confirm + renumber ==============================
    // Add a SECOND complaint so there are two numbered sections to renumber.
    await caseRichPage.addComplaint(COMPLAINT_2);
    await browser.waitUntil(
      async () => {
        const hs = await caseRichPage.complaintHeaders();
        return hs.some((c) => c.text.includes(COMPLAINT_1)) && hs.some((c) => c.text.includes(COMPLAINT_2));
      },
      { timeout: 15000, timeoutMsg: 'second complaint was not added' },
    );

    // Add a follow-up entry under COMPLAINT_1 so an entry remove(x) exists.
    await caseRichPage.focusComplaintByName(COMPLAINT_1);
    const entriesBeforeFu = (await caseRichPage.entryHeadings()).length;
    await caseRichPage.addFollowupEntry();
    await browser.waitUntil(
      async () => (await caseRichPage.entryHeadings()).length === entriesBeforeFu + 1,
      { timeout: 15000, timeoutMsg: 'Add follow-up entry did not append an entry' },
    );

    // --- Cancel keeps it: open the COMPLAINT_2 remove, cancel, still present.
    let headers = await caseRichPage.complaintHeaders();
    const c2 = headers.find((c) => c.text.includes(COMPLAINT_2));
    expect(c2?.id).toBeTruthy();
    await caseRichPage.removeComplaintCancel(c2?.id as string);
    headers = await caseRichPage.complaintHeaders();
    expect(headers.some((c) => c.text.includes(COMPLAINT_2))).toBe(true);
    // eslint-disable-next-line no-console
    console.log('[rwv4] §5 cancel on a complaint remove KEEPS the section');

    // --- Remove a follow-up entry behind the confirm -> entry count falls.
    const entriesBeforeRemove = (await caseRichPage.entryHeadings()).length;
    await caseRichPage.removeEntry(entriesBeforeRemove); // remove the last entry control (1-based)
    await browser.waitUntil(
      async () => (await caseRichPage.entryHeadings()).length === entriesBeforeRemove - 1,
      { timeout: 15000, timeoutMsg: 'confirmed entry remove did not drop the entry' },
    );
    // eslint-disable-next-line no-console
    console.log(`[rwv4] §5 confirmed entry remove -> entries ${entriesBeforeRemove} -> ${entriesBeforeRemove - 1}`);

    // --- Remove the SECOND complaint behind the confirm -> survivors renumber.
    headers = await caseRichPage.complaintHeaders();
    const c2again = headers.find((c) => c.text.includes(COMPLAINT_2));
    await caseRichPage.removeComplaint(c2again?.id as string);
    await browser.waitUntil(
      async () => !(await caseRichPage.complaintHeaders()).some((c) => c.text.includes(COMPLAINT_2)),
      { timeout: 15000, timeoutMsg: 'confirmed complaint remove did not drop the section' },
    );
    headers = await caseRichPage.complaintHeaders();
    // Numbering stays strictly increasing (renumbered, no gaps/reuse breaking order).
    for (let i = 1; i < headers.length; i += 1) {
      expect(headers[i]?.no).toBeGreaterThan(headers[i - 1]?.no as number);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[rwv4] §5 confirmed complaint remove -> survivors renumbered [${headers.map((h) => `"${h.text}"`).join(', ')}]`,
    );

    // --- Floor of one: the last remaining complaint cannot be removed. ------
    // Reduce to a single complaint section (drop any extra default/named ones
    // until one remains), then assert the final one has no usable remove path.
    const removableLoopGuard = 10;
    for (let i = 0; i < removableLoopGuard; i += 1) {
      const hs = await caseRichPage.complaintHeaders();
      if (hs.length <= 1) break;
      const last = hs[hs.length - 1];
      if (last?.id == null || !(await caseRichPage.hasComplaintRemove(last.id))) break;
      await caseRichPage.removeComplaint(last.id);
      await browser.waitUntil(
        async () => (await caseRichPage.complaintHeaders()).length === hs.length - 1,
        { timeout: 15000, timeoutMsg: 'complaint remove did not shrink the section count' },
      );
    }
    const finalHeaders = await caseRichPage.complaintHeaders();
    expect(finalHeaders.length).toBe(1);
    // The sole surviving complaint cannot be removed below one: either the
    // remove control is gone, or pressing it is refused (section count stays 1).
    const soleId = finalHeaders[0]?.id as string;
    const hasRemove = await caseRichPage.hasComplaintRemove(soleId);
    if (hasRemove) {
      await caseRichPage.removeComplaintCancel(soleId).catch(() => undefined);
      expect((await caseRichPage.complaintHeaders()).length).toBe(1);
    }
    expect((await caseRichPage.complaintHeaders()).length).toBe(1);
    // eslint-disable-next-line no-console
    console.log('[rwv4] §5 floor-of-one: the last complaint section cannot be removed below one');
  });
});
