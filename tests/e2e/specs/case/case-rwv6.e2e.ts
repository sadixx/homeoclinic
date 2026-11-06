// @req CASE-001, CASE-003, VIS-001, PAT-005, PAT-009
// @tier stable
// @area case
// @targets linux, windows
//
// M3-RWv6 S08 case editor + S07 dashboard refinements, end to end on a fresh,
// isolated data dir (synthetic patients only, no network). Case-form items:
//
//   item 4: a report uploaded through Investigations -> Submitted (via the
//           HC_E2E_REPORT_FILE seam, see case-investigations.e2e.ts) opens in
//           ONE click from its link row (case-form-investigation-open-<n>),
//           showing the same file (name + data) as the dashboard Lab reports
//           & Scans preview.
//   item 5: family history Maternal recorded alone, then Paternal recorded
//           alone in the SAME entry: Paternal fills the existing table's empty
//           column from the top; a row is added only for the surplus value.
//   item 6: every table row has a delete control behind a confirm; Cancel keeps
//           the row, the header has none, deleting the last data row removes
//           the table and its section heading.
//   item 7: complaint number = highest number in the document + 1 at click
//           time: add 2, remove #2, add -> #2; add an untitled complaint,
//           clear its heading text by hand, add -> the same number again.
//   item 8: the physical generals popup has exactly the 14 requested fields in
//           order (sun aggravation a Yes/No select), no Notes.
//   item 9: Save -> the patient dashboard lists the visit under VISITS (NEWEST
//           FIRST) with today's date and type, the last-visit line shows today,
//           LAST PRESCRIPTION shows the recorded medicine, potency and dosage
//           with the R4 preview note; a follow-up visit lists ABOVE the first
//           and LAST PRESCRIPTION moves to the follow-up's prescription.
//
// Durable markers go to <HC_E2E_OUTDIR>/evidence.log. No sleeps: every wait
// is waitUntil / waitForDisplayed through the page objects.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { $, browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { investigationsPage } from '../../pages/investigations.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { relaunchInto } from '../../helpers/launch.js';
import { evidence } from '../../helpers/evidence.js';
import { todayIso } from '../../helpers/dates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PDF_FIXTURE = path.resolve(here, '..', '..', 'fixtures', 'investigations', 'lab-report.pdf');

const PIN = '1357';
const PATIENT_A = 'Visita Testpatient';
const PATIENT_B = 'Numera Testpatient';

const GENERALS_EXPECTED: [string, string][] = [
  ['case-generals-appetite', 'Appetite'],
  ['case-generals-thirst', 'Thirst'],
  ['case-generals-thermal', 'Thermal state'],
  ['case-generals-constitution', 'Constitution'],
  ['case-generals-diet', 'Diet'],
  ['case-generals-cravings', 'Cravings'],
  ['case-generals-aversions', 'Aversions'],
  ['case-generals-urine', 'Urine'],
  ['case-generals-stool', 'Stool'],
  ['case-generals-perspiration', 'Perspiration'],
  ['case-generals-sun-aggravation', 'Sun aggravation'],
  ['case-generals-sleep', 'Sleep'],
  ['case-generals-dreams', 'Dreams'],
  ['case-generals-sleep-position', 'Sleep position'],
];

let patientA = '';

/** Today in the dashboard's DD-MM-YYYY format (shared/datetime.formatDate). */
function todayDash(): string {
  const [y, m, d] = todayIso().split('-');
  return `${d}-${m}-${y}`;
}

async function waitTableRows(type: string, n: number, what: string): Promise<string[][]> {
  try {
    await browser.waitUntil(async () => (await caseRichPage.tableByType(type))?.rows.length === n, {
      timeout: 15000,
    });
  } catch {
    const all = await caseRichPage.tables();
    throw new Error(`${what}: ${type} table did not reach ${n} data row(s); tables=${JSON.stringify(all)}`);
  }
  return (await caseRichPage.tableByType(type))?.rows ?? [];
}

/** Named (non-empty) complaint headers, in order. */
async function namedHeaders(cid?: string): Promise<string[]> {
  return (await caseRichPage.complaintHeaders(cid)).map((h) => h.text).filter((t) => t !== '');
}

async function waitNamedHeaders(n: number, what: string): Promise<string[]> {
  try {
    await browser.waitUntil(async () => (await namedHeaders()).length === n, { timeout: 15000 });
  } catch {
    const all = await caseRichPage.complaintHeaders();
    throw new Error(`${what}: expected ${n} named complaint header(s); headers=${JSON.stringify(all)}`);
  }
  return namedHeaders();
}

describe('M3-RWv6 case editor + dashboard visits (CASE-001/003, VIS-001, PAT-005, PAT-009)', () => {
  before(async () => {
    process.env.HC_E2E_REPORT_FILE = PDF_FIXTURE;
    await relaunchInto('main');
  });

  it('items 8, 5, 6, 4 and 9: generals fields exact, family fill, row delete, one-click report open, save -> dashboard visit + last prescription', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    await patientsPage.openRegister();
    await patientsPage.fillCore({ name: PATIENT_A, age: '42', city: 'Pune' });
    await patientsPage.saveAndWaitForDashboard();
    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();
    ({ patientId: patientA } = await caseRichPage.routeIds());
    await caseRichPage.addComplaint('Headache');
    await waitNamedHeaders(1, 'first complaint');

    // ---- item 8: physical generals popup fields, exactly -----------------
    await caseRichPage.openGeneralsPopup();
    const fields = await caseRichPage.generalsFields();
    expect(fields.map((f) => [f.id, f.label])).toEqual(GENERALS_EXPECTED);
    const sun = fields.find((f) => f.id === 'case-generals-sun-aggravation');
    expect(sun?.tag).toBe('select');
    expect(sun?.options).toEqual(['Not recorded', 'Yes', 'No']);
    expect(fields.filter((f) => f.id !== 'case-generals-sun-aggravation').every((f) => f.tag === 'input')).toBe(true);
    expect(await $('[data-testid="case-generals-notes"]').isExisting()).toBe(false);
    expect(fields.some((f) => /notes/i.test(f.label))).toBe(false);
    const minControl = Math.min(...fields.map((f) => f.controlPx));
    const minLabel = Math.min(...fields.map((f) => f.labelPx));
    evidence(
      `[rwv6-case] item8 generals fields=${fields.length} ids=${fields.map((f) => f.id.replace('case-generals-', '')).join(',')} ` +
        `sun=${sun?.tag}[${sun?.options.join('/')}] notes=absent controlPx>=${minControl} labelPx>=${minLabel}`,
    );
    await caseRichPage.cancelGeneralsPopup();

    // ---- item 5: Maternal then Paternal fill the same rows ---------------
    await caseRichPage.recordFamilySide('maternal', ['Diabetes', 'Thyroid']);
    const famHeaders = (await caseRichPage.tableByType('family_history'))?.headers ?? [];
    const mi = famHeaders.indexOf('Maternal');
    const pi = famHeaders.indexOf('Paternal');
    expect(mi).toBeGreaterThanOrEqual(0);
    expect(pi).toBeGreaterThanOrEqual(0);
    const famA = await waitTableRows('family_history', 2, 'maternal only');
    expect(famA.map((r) => [r[mi], r[pi]])).toEqual([
      ['Diabetes', ''],
      ['Thyroid', ''],
    ]);
    await caseRichPage.recordFamilySide('paternal', ['Hypertension', 'Asthma', 'Gout']);
    const famB = await waitTableRows('family_history', 3, 'paternal after maternal');
    expect(famB.map((r) => [r[mi], r[pi]])).toEqual([
      ['Diabetes', 'Hypertension'],
      ['Thyroid', 'Asthma'],
      ['', 'Gout'],
    ]);
    expect((await caseRichPage.tables()).filter((t) => t.tableType === 'family_history').length).toBe(1);
    evidence(
      `[rwv6-case] item5 maternal-only rows=${JSON.stringify(famA.map((r) => [r[mi], r[pi]]))} -> ` +
        `paternal fill rows=${JSON.stringify(famB.map((r) => [r[mi], r[pi]]))} (one table, no offset; 1 surplus row)`,
    );

    // ---- item 6: per-row delete with confirm -----------------------------
    await caseRichPage.recordVitals({ sys: '120', dia: '80', pulse: '72' });
    await caseRichPage.recordVitals({ sys: '160', dia: '99', pulse: '99' }); // the accidental row
    const vit2 = await waitTableRows('vitals', 2, 'two vitals records');
    const tNo = await caseRichPage.tableNumber('vitals');
    const famNo = await caseRichPage.tableNumber('family_history');
    const ids = await caseRichPage.tableRowDeleteIds();
    expect(ids).toContain(`case-form-table-row-delete-${tNo}-1`);
    expect(ids).toContain(`case-form-table-row-delete-${tNo}-2`);
    expect(ids).not.toContain(`case-form-table-row-delete-${tNo}-0`);
    expect(ids).not.toContain(`case-form-table-row-delete-${tNo}-3`);
    expect(ids.filter((id) => id.startsWith(`case-form-table-row-delete-${famNo}-`)).length).toBe(3);
    const tablesBefore = (await caseRichPage.tables()).length;
    await caseRichPage.deleteTableRow(tNo, 2, false);
    expect((await caseRichPage.tableByType('vitals'))?.rows.length).toBe(2);
    await caseRichPage.deleteTableRow(tNo, 2, true);
    const vit1 = await waitTableRows('vitals', 1, 'accidental row deleted');
    expect(vit1[0]?.join(' ')).toBe(vit2[0]?.join(' '));
    expect(vit1[0]?.join(' ')).not.toContain('160');
    evidence(
      `[rwv6-case] item6 vitals table #${tNo} rows 2 -> cancel keeps 2 -> confirm delete row 2 -> 1 (kept "${vit1[0]?.join(' ')}"); ` +
        `controls=${ids.length} header has none; family table has 3 row controls`,
    );
    await caseRichPage.deleteTableRow(tNo, 1, true);
    await browser.waitUntil(async () => (await caseRichPage.tableByType('vitals')) === undefined, {
      timeout: 15000,
      timeoutMsg: 'deleting the last vitals data row did not remove the table',
    });
    const headingsAfter = await caseRichPage.sectionHeadingTexts();
    expect(headingsAfter.some((h) => /vitals/i.test(h))).toBe(false);
    expect((await caseRichPage.tables()).length).toBe(tablesBefore - 1);
    evidence(
      `[rwv6-case] item6 delete last data row -> vitals table removed (tables ${tablesBefore} -> ${tablesBefore - 1}), ` +
        `section headings now ${JSON.stringify(headingsAfter)}`,
    );

    // ---- item 4: upload via seam, then ONE click on the link row --------
    await investigationsPage.openSubmittedFor('CBC');
    await investigationsPage.uploadNewAndWaitForLink(1);
    const linkLabel = await investigationsPage.linkLabel(1);
    await caseRichPage.investigationOpenButton(1).waitForClickable({ timeout: 15000 });
    await caseRichPage.investigationOpenButton(1).click();
    await caseRichPage.investigationPreview.waitForDisplayed({ timeout: 15000 });
    const casePreview = await patientsPage.previewInfo('case-form-investigation-preview');
    expect(casePreview.href ?? '').toMatch(/^data:application\/pdf/);
    expect(await $('[data-testid="case-form-investigation-open-error"]').isExisting()).toBe(false);
    evidence(
      `[rwv6-case] item4 link row 1 "${linkLabel}" -> ONE click Open -> case-form-investigation-preview shown ` +
        `name="${casePreview.name}" download="${casePreview.download}" href=${casePreview.href?.slice(0, 28)}... (${casePreview.href?.length} chars)`,
    );
    await $('[data-testid="case-form-investigation-preview-close"]').click();
    await caseRichPage.investigationPreview.waitForDisplayed({ reverse: true, timeout: 15000 });

    // ---- item 9: record a prescription, Save ----------------------------
    await caseRichPage.addPrescriptionFull('Belladonna', '30C', '4 pills twice daily');
    await caseRichPage.save();
    expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);

    await patientsPage.openDashboard(patientA);
    await browser.waitUntil(async () => (await patientsPage.dashVisitRows()).length === 1, {
      timeout: 20000,
      timeoutMsg: 'saved case did not appear under VISITS (NEWEST FIRST)',
    });
    const rows1 = await patientsPage.dashVisitRows();
    expect(rows1).toEqual([{ date: todayDash(), type: 'First' }]);
    const last1 = await patientsPage.dashTextOrNull('patient-dash-last-visit');
    expect(last1 ?? '').toContain(todayDash());
    const rx1 = await patientsPage.dashTextOrNull('patient-dash-last-rx-items');
    expect(rx1 ?? '').toContain('Belladonna 30C, 4 pills twice daily');
    const rxNote = await patientsPage.dashTextOrNull('patient-dash-last-rx-preview');
    expect(rxNote).toBe('Preview from the case notes. Prescriptions arrive in R4.');
    const visitsTitle = await browser.execute(
      () => document.querySelector('[data-testid="patient-dash-timeline"]')?.parentElement?.querySelector('h2')?.textContent ?? '',
    );
    evidence(
      `[rwv6-case] item9 dashboard "${visitsTitle}" rows=${JSON.stringify(rows1)} lastVisit="${last1}" ` +
        `lastRx="${rx1}" note="${rxNote}"`,
    );

    // item 4 cross-check: the dashboard Lab reports preview shows the same file.
    await patientsPage.waitForLabReportsPanel();
    await patientsPage.labReportsOpen(1).waitForClickable({ timeout: 15000 });
    await patientsPage.labReportsOpen(1).click();
    await $('[data-testid="patient-dash-lab-reports-preview"]').waitForDisplayed({ timeout: 15000 });
    const dashPreview = await patientsPage.previewInfo('patient-dash-lab-reports-preview');
    expect(dashPreview.href).toBe(casePreview.href);
    expect(dashPreview.download).toBe(casePreview.download);
    evidence(
      `[rwv6-case] item4 dashboard Lab reports preview: same name=${String(dashPreview.name === casePreview.name)} ` +
        `same download=${String(dashPreview.download === casePreview.download)} same data=${String(dashPreview.href === casePreview.href)}`,
    );
    await $('[data-testid="patient-dash-lab-reports-preview-close"]').click();
  });

  it('item 9: a follow-up visit lists above the first and LAST PRESCRIPTION moves to it', async () => {
    await patientsPage.openDashboard(patientA);
    const fu = $('[data-testid="patient-dash-followup"]');
    await fu.waitForClickable({ timeout: 15000 });
    await fu.click();
    await caseRichPage.waitForForm();
    const entriesBefore = await caseRichPage.entryCount();
    await caseRichPage.addFollowupEntry();
    await browser.waitUntil(async () => (await caseRichPage.entryCount()) === entriesBefore + 1, {
      timeout: 15000,
      timeoutMsg: 'follow-up entry was not added',
    });
    await caseRichPage.addPrescriptionFull('Bryonia', '200C', 'one dose');
    await caseRichPage.save();
    expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);

    await patientsPage.openDashboard(patientA);
    await browser.waitUntil(async () => (await patientsPage.dashVisitRows()).length === 2, {
      timeout: 20000,
      timeoutMsg: 'follow-up visit did not appear under VISITS (NEWEST FIRST)',
    });
    const rows2 = await patientsPage.dashVisitRows();
    expect(rows2).toEqual([
      { date: todayDash(), type: 'Follow-up' },
      { date: todayDash(), type: 'First' },
    ]);
    const last2 = await patientsPage.dashTextOrNull('patient-dash-last-visit');
    expect(last2 ?? '').toContain(todayDash());
    const rx2 = await patientsPage.dashTextOrNull('patient-dash-last-rx-items');
    expect(rx2 ?? '').toContain('Bryonia 200C, one dose');
    evidence(`[rwv6-case] item9 after follow-up rows=${JSON.stringify(rows2)} lastVisit="${last2}" lastRx="${rx2}"`);
  });

  it('item 7: next complaint number is the highest in the document + 1 (remove #2, and clear an untitled heading by hand)', async () => {
    await patientsPage.openRegister();
    await patientsPage.fillCore({ name: PATIENT_B, age: '35', city: 'Nashik' });
    await patientsPage.saveAndWaitForDashboard();
    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();

    await caseRichPage.addComplaint('Headache');
    await waitNamedHeaders(1, 'add #1');
    await caseRichPage.addComplaint('Cough');
    const two = await waitNamedHeaders(2, 'add #2');
    expect(two[1]).toMatch(/^2\.\s*Cough/);
    const h2 = (await caseRichPage.complaintHeaders()).find((h) => h.text.startsWith('2.'));
    expect(h2?.id ?? '').not.toBe('');
    await caseRichPage.removeComplaint(h2?.id ?? '');
    await waitNamedHeaders(1, 'remove #2');
    await caseRichPage.addComplaint('Fever');
    const again = await waitNamedHeaders(2, 'add after remove');
    expect(again[1]).toMatch(/^2\.\s*Fever/);
    evidence(`[rwv6-case] item7 add 2 ${JSON.stringify(two)} -> remove #2 -> add -> ${JSON.stringify(again)}`);

    await caseRichPage.addUntitledComplaint();
    const withUntitled = await waitNamedHeaders(3, 'add untitled');
    expect(withUntitled[2]).toMatch(/^3\./);
    await caseRichPage.clearComplaintHeadingByHand(3);
    await waitNamedHeaders(2, 'heading cleared by hand');
    await caseRichPage.addComplaint('Cold');
    const afterHand = await waitNamedHeaders(3, 'add after hand delete');
    expect(afterHand[2]).toMatch(/^3\.\s*Cold/);
    evidence(
      `[rwv6-case] item7 untitled ${JSON.stringify(withUntitled[2])} cleared by hand (End + one Backspace per char) -> add -> ${JSON.stringify(afterHand)}`,
    );
  });
});
