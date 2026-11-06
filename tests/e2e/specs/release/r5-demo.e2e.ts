// @req BILL-001 BILL-002 BILL-003 BILL-004
// @tier regression
// @area release
// @targets linux, windows
//
// R5 "Clinic basics" release demo as ONE regression spec, end to end on the
// built Tauri app (M8, HC-MVP1-148..153, ADR 0021; R-DEL-005 release gate).
// Network disabled (product rule 1), boot-gate aware, isolated per-spec data
// dirs, synthetic patients only. Money is checked as the UI shows it
// ("Rs 1,234.00", integer paise underneath).
//
//   PHASE A (BILL-001, BILL-003): provision (wizard fees: first 500, follow-up
//     300) -> close, reopen, unlock (SET-004; the relaunch also hands the e2e
//     build HC_E2E_EXPORT_FOLDER) -> register a patient -> Take case -> "Bill
//     this visit" -> S15 proposes the consultation line at the first-visit fee
//     -> add a medicine line (2 x 150) -> total 800 -> partial payment 500
//     cash -> Save -> receipt number <FY>/0001, paid 500, balance 300. The
//     S16 receipt shows the FY number and the paid amount in words.
//   PHASE B (r5-review-15/16, the leave-guard class; R5-leave-guard-exits.md):
//     on the saved bill a typed payment makes it dirty; leaving via the AppBar
//     Back and via the invoice's own Back, via the STATUS-BAR BACKUP CHIP, and
//     via the UPI hint "Open settings" link each opens the Save/Discard dialog
//     and keeps the hash; Stay keeps the typed value; Discard lands on the
//     target and saves nothing. A clean bill leaves via the chip at once.
//   PHASE C (BILL-002): dues 300 on the patient dashboard -> Clear dues
//     (prefilled 300, UPI + reference) records the rest -> dues 0 -> the bill
//     is paid 800 / balance 0, receipt words "Rupees Eight Hundred Only".
//   PHASE D (BILL-004): Reports -> daily collection today: Cash 1 x
//     500, UPI 1 x 300, total 800 / 2 payments, outstanding 0 -> Export CSV
//     and Excel; both files are read back from the export folder and their
//     content checked (CSV text; xlsx unzipped in node, helpers/zip.ts).
//   PHASE E (BILL-003 FY numbering): a second data dir under a process TEST
//     CLOCK (helpers/faketime.ts, libfaketime): 31-03-2027 22:30 IST -> bill
//     -> 2026-27/0001; relaunch at 01-04-2027 09:00 IST -> bill a follow-up
//     -> 2027-28/0001, and the March bill still reads 2026-27/0001.
//
// Windows: @targets includes windows; there is no Windows runner here, so the
// spec is validated on Linux only. PHASE E needs libfaketime and skips on a
// host without it (logged as infra in evidence.log, never a silent pass).
//
// Durable markers go to <HC_E2E_OUTDIR>/evidence.log. No sleeps: every wait
// is waitUntil / waitForDisplayed through the page objects.
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { browser, expect } from '@wdio/globals';

import { appBarPage } from '../../pages/appbar.page.js';
import { billingPage, invoiceHash } from '../../pages/billing.page.js';
import { bootPage } from '../../pages/boot.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { reportsPage } from '../../pages/reports.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { enterUnlockedApp, provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { dataDir, relaunchIntoWithBinary } from '../../helpers/launch.js';
import { evidence } from '../../helpers/evidence.js';
import { todayIso } from '../../helpers/dates.js';
import { faketimeLibrary, makeClockWrapper, type ClockWrapper } from '../../helpers/faketime.js';
import { readZipEntries } from '../../helpers/zip.js';

const PIN = '2468';
const PATIENT = 'Ishaan Billingdemo';
const FY_PATIENT = 'Meera Yearend';
const MEDICINE = 'Arnica montana 30C';
const COMPLAINT = 'Bruised knee';

let patientId = '';
let visitId = '';
let exportDir = '';
let clock: ClockWrapper | null = null;
let fyPatientId = '';
let fyFirstVisitId = '';

/** FY label of a local date, as hc-domain billing::FinancialYear ("2026-27"). */
function fyLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** YYYY-MM-DD -> DD-MM-YYYY (the export title format). */
function dash(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** The webview's local date (what InvoiceScreen sends as local_today). */
async function webviewToday(): Promise<string> {
  return browser.execute(() => {
    const t = new Date();
    const p = (n: number): string => n.toString().padStart(2, '0');
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
  });
}

async function unlockAfterRelaunch(): Promise<void> {
  const decided = await bootPage.waitForDecidedScreen();
  expect(decided).toBe('#/lock');
  await expect(lockPage.card).toBeDisplayed();
  await lockPage.attempt(PIN);
  await shellPage.waitForShell();
}

/**
 * Register a patient, Take case, record a complaint and Save (the billing
 * strip appears only once the visit has been saved, CaseForm savedOnce, R5
 * design §9), then open S15 from the case-form strip.
 */
async function registerTakeCaseAndBill(name: string): Promise<{ patientId: string; visitId: string }> {
  await patientsPage.openRegister();
  await patientsPage.fillCore({ name, age: '41', city: 'Nashik' });
  await patientsPage.saveAndWaitForDashboard();
  expect(await patientsPage.dashboardText()).toContain(name);
  await patientsPage.dashTakeCase();
  await caseRichPage.waitForForm();
  const ids = await caseRichPage.routeIds();
  await saveVisit(COMPLAINT, 'Bruised soreness after a fall, worse from touch.');
  await billingPage.billFromCaseForm();
  expect(await billingPage.hash()).toBe(invoiceHash(ids.patientId, ids.visitId));
  return ids;
}

/** Add a complaint with a line of text and Save the visit (case form). */
async function saveVisit(complaint: string, text: string): Promise<void> {
  await caseRichPage.addComplaint(complaint);
  await browser.waitUntil(
    async () => (await caseRichPage.complaintHeaders()).some((c) => c.text.includes(complaint)),
    { timeout: 15000, timeoutMsg: 'Add new complaint did not create the complaint section' },
  );
  await caseRichPage.typeProse(text);
  await caseRichPage.save();
  await caseRichPage.waitForSaved();
}

/** Open the saved bill of the main visit from its patient dashboard. */
async function openBillFromDashboard(): Promise<void> {
  await patientsPage.openDashboard(patientId);
  await billingPage.openFromDashboardChip(visitId);
  expect(await billingPage.hash()).toBe(invoiceHash(patientId, visitId));
}

/** New files in the export folder with the given extension. */
function exportedFiles(ext: string): string[] {
  return readdirSync(exportDir).filter((f) => f.endsWith(ext)).sort();
}

describe('R5 demo PHASE A: bill a visit with consultation + medicine lines and a partial payment; receipt FY number + amount in words (BILL-001, BILL-003)', () => {
  it('provisions, reopens with the PIN, bills the first visit: consultation 500 + medicine 2 x 150, pays 500 cash, saves receipt <FY>/0001', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);

    // The export folder the e2e build uses instead of the OS folder picker.
    exportDir = path.join(dataDir('exports'), 'out');
    mkdirSync(exportDir, { recursive: true });
    process.env.HC_E2E_EXPORT_FOLDER = exportDir;
    await enterUnlockedApp('main', PIN);

    ({ patientId, visitId } = await registerTakeCaseAndBill(PATIENT));
    const today = todayIso();
    const fy = fyLabel(today);
    expect(await billingPage.number.getText()).not.toMatch(/\d{4}-\d{2}\/\d{4}/);

    // The unbilled first visit proposes ONE consultation line at the first-visit fee.
    expect(await billingPage.lineCount()).toBe(1);
    expect(await billingPage.lineKindValue(1)).toBe('consultation');
    await billingPage.waitForLineAmount(1, '500.00');

    await billingPage.addMedicine(2, MEDICINE, '2', '150');
    expect(await billingPage.lineKindValue(2)).toBe('medicine');
    await billingPage.waitForLineAmount(2, '300.00');
    await browser.waitUntil(async () => (await billingPage.total.getText()).includes('800.00'), {
      timeout: 15000,
      timeoutMsg: 'invoice total never showed 800.00',
    });

    await billingPage.typePaid('500');
    await billingPage.chooseMode('cash');
    const number = await billingPage.saveAndWaitForNumber();
    expect(number).toContain(`${fy}/0001`);
    await billingPage.waitForPaidBalance('500.00', '300.00');
    evidence(
      `[r5demo] A: patient ${patientId} visit ${visitId}; lines consultation 500.00 + medicine 2 x 150 = 300.00; ` +
        `total ${await billingPage.total.getText()}; paid 500 cash; saved "${number}" (FY ${fy} of ${today}); ` +
        `paid ${await billingPage.paidTotal.getText()} balance ${await billingPage.balance.getText()}`,
    );
  });

  it('the S16 receipt shows the FY number and the paid amount in words', async () => {
    await billingPage.openReceipt();
    const r = await billingPage.receipt();
    const fy = fyLabel(todayIso());
    expect(r.number).toBe(`${fy}/0001`);
    expect(r.words).toBe('Rupees Five Hundred Only');
    expect(r.total).toContain('800.00');
    expect(r.paid).toContain('500.00');
    expect(r.balance).toContain('300.00');
    evidence(`[r5demo] A: receipt number "${r.number}" words "${r.words}" total ${r.total} paid ${r.paid} balance ${r.balance}`);
    await billingPage.receiptBack();
    await billingPage.waitForScreen();
  });
});

describe('R5 demo PHASE B: leaving a dirty invoice prompts Save/Discard via Back, the status-bar backup chip and the UPI hint link (r5-review-15, r5-review-16)', () => {
  it('Back (AppBar and the invoice Back) on a dirty bill asks first; Stay keeps the typed payment; Discard leaves and saves nothing', async () => {
    await openBillFromDashboard();
    const bill = invoiceHash(patientId, visitId);

    await billingPage.typePaid('100');
    await appBarPage.clickBack();
    await billingPage.waitForLeaveDialog();
    expect(await billingPage.hash()).toBe(bill);
    await billingPage.stay();
    expect(await billingPage.hash()).toBe(bill);
    expect(await billingPage.paidValue()).toBe('100');
    evidence('[r5demo] B: dirty bill + AppBar Back -> leave dialog, hash kept; Stay -> typed payment 100 kept');

    await billingPage.back.click();
    await billingPage.waitForLeaveDialog();
    expect(await billingPage.hash()).toBe(bill);
    await billingPage.discard();
    const landed = await billingPage.waitForHash((h) => h.startsWith('#/patients?id='), 'Discard after invoice Back');
    await patientsPage.waitForDashboard();
    expect(await billingPage.dashboardDues()).toContain('300.00');
    evidence(`[r5demo] B: dirty bill + invoice Back -> leave dialog; Discard -> ${landed}; dues still 300.00 (nothing saved)`);
  });

  it('the status-bar backup chip on a dirty bill asks first; Stay keeps it; Discard opens Backup; a clean bill leaves at once', async () => {
    await openBillFromDashboard();
    const bill = invoiceHash(patientId, visitId);

    await billingPage.typePaid('100');
    await billingPage.clickStatusBackup();
    await billingPage.waitForLeaveDialog();
    expect(await billingPage.hash()).toBe(bill);
    await billingPage.stay();
    expect(await billingPage.hash()).toBe(bill);
    expect(await billingPage.paidValue()).toBe('100');
    evidence('[r5demo] B: dirty bill + status-bar backup chip -> leave dialog, hash kept; Stay -> typed payment 100 kept');

    await billingPage.clickStatusBackup();
    await billingPage.waitForLeaveDialog();
    await billingPage.discard();
    await billingPage.waitForHash((h) => h === '#/backup', 'Discard after the backup chip');
    evidence('[r5demo] B: status-bar backup chip -> Discard -> #/backup');

    // Clean bill: the chip leaves at once, no dialog.
    await openBillFromDashboard();
    await billingPage.clickStatusBackup();
    await billingPage.waitForHash((h) => h === '#/backup', 'clean bill + backup chip');
    expect(await billingPage.leaveDialog.isExisting()).toBe(false);
    evidence('[r5demo] B: clean bill + status-bar backup chip -> #/backup at once, no dialog');
  });

  it('the UPI hint "Open settings" link on a dirty bill asks first; Discard opens Settings', async () => {
    await openBillFromDashboard();
    const bill = invoiceHash(patientId, visitId);
    await billingPage.upiOpenSettings.waitForDisplayed({ timeout: 15000 });
    await billingPage.typePaid('50');
    await billingPage.upiOpenSettings.click();
    await billingPage.waitForLeaveDialog();
    expect(await billingPage.hash()).toBe(bill);
    await billingPage.discard();
    await billingPage.waitForHash((h) => h.startsWith('#/settings'), 'Discard after UPI Open settings');
    evidence('[r5demo] B: dirty bill + UPI hint "Open settings" -> leave dialog, hash kept; Discard -> #/settings');
  });
});

describe('R5 demo PHASE C: dues on the dashboard; Clear dues records the rest (BILL-002)', () => {
  it('shows dues 300 on the dashboard, clears them by UPI, and the bill and receipt read paid 800 / balance 0', async () => {
    await patientsPage.openDashboard(patientId);
    expect(await billingPage.dashboardDues()).toContain('300.00');
    await billingPage.openClearDuesFromDashboard();
    expect(await billingPage.clearAmountValue()).toBe('300.00');
    const result = await billingPage.clearDues('upi', 'UTR-E2E-0001');
    await billingPage.closeClearDialog();
    await billingPage.waitForDashboardDues('0.00');
    evidence(`[r5demo] C: dashboard dues 300.00 -> Clear dues 300.00 UPI -> result "${result.replace(/\s+/g, ' ')}"; dues now ${await billingPage.dashboardDues()}`);

    await billingPage.openFromDashboardChip(visitId);
    await billingPage.waitForPaidBalance('800.00', '0.00');
    await billingPage.openReceipt();
    const r = await billingPage.receipt();
    expect(r.number).toBe(`${fyLabel(todayIso())}/0001`);
    expect(r.words).toBe('Rupees Eight Hundred Only');
    expect(r.paid).toContain('800.00');
    expect(r.balance).toContain('0.00');
    evidence(`[r5demo] C: bill paid 800.00 balance 0.00; receipt "${r.number}" words "${r.words}"`);
  });
});

describe('R5 demo PHASE D: daily collection totals by mode; export CSV and Excel with file content checks (BILL-004)', () => {
  it('daily collection today: Cash 1 x 500, UPI 1 x 300, total 800 from 2 payments, outstanding 0', async () => {
    await reportsPage.openFromNav();
    await reportsPage.waitForDailyCount(2);
    const cash = await reportsPage.modeRow('cash');
    const upi = await reportsPage.modeRow('upi');
    expect(cash).toEqual({ label: 'Cash', count: '1', amount: '500.00' });
    expect(upi).toEqual({ label: 'UPI', count: '1', amount: '300.00' });
    for (const m of ['card', 'other']) {
      const row = await reportsPage.modeRow(m);
      if (row !== null) {
        expect(row.count).toBe('0');
        expect(row.amount).toBe('0.00');
      }
    }
    expect(await reportsPage.totalCollected.getText()).toContain('800.00');
    expect(await reportsPage.outstanding.getText()).toContain('0.00');
    evidence(
      `[r5demo] D: daily ${todayIso()} cash ${JSON.stringify(cash)} upi ${JSON.stringify(upi)} ` +
        `total ${await reportsPage.totalCollected.getText()} count ${await reportsPage.totalCount.getText()} outstanding ${await reportsPage.outstanding.getText()}`,
    );
  });

  it('Export CSV writes the daily table with title, header, mode rows, TOTAL and outstanding', async () => {
    const before = exportedFiles('.csv');
    const status = await reportsPage.export('csv');
    const today = todayIso();
    const name = `collection-daily-${today}.csv`;
    expect(status).toContain(name);
    const files = exportedFiles('.csv');
    expect(files.length).toBe(before.length + 1);
    const file = path.join(exportDir, name);
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split('\r\n').filter((l) => l !== '');
    expect(lines[0]).toBe(`Daily collection ${dash(today)}`);
    expect(lines[1]).toBe('Mode,Payments,Amount (Rs)');
    expect(lines).toContain('Cash,1,500.00');
    expect(lines).toContain('UPI,1,300.00');
    expect(lines).toContain('TOTAL,2,800.00');
    expect(lines).toContain('Outstanding on bills issued this day,,0.00');
    evidence(`[r5demo] D: export CSV "${status}" -> ${name} ${text.length} chars: ${JSON.stringify(lines)}`);
  });

  it('Export Excel writes an xlsx whose sheet holds the same table', async () => {
    const status = await reportsPage.export('xlsx');
    const today = todayIso();
    const name = `collection-daily-${today}.xlsx`;
    expect(status).toContain(name);
    const file = path.join(exportDir, name);
    expect(existsSync(file)).toBe(true);
    const parts = readZipEntries(file);
    const sheetName = [...parts.keys()].find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
    expect(sheetName).toBeDefined();
    const sheet = parts.get(sheetName as string)?.toString('utf8') ?? '';
    const shared = parts.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
    const strings = shared + sheet; // inline or shared strings, either layout
    for (const s of [`Daily collection ${dash(today)}`, 'Mode', 'Payments', 'Amount (Rs)', 'Cash', 'UPI', 'TOTAL', 'Outstanding on bills issued this day']) {
      expect(strings).toContain(s);
    }
    const values = [...sheet.matchAll(/<v>([^<]*)<\/v>/g)].map((m) => m[1]);
    for (const v of ['500', '300', '800']) expect(values).toContain(v);
    evidence(`[r5demo] D: export xlsx "${status}" -> ${name}; parts ${[...parts.keys()].length}; sheet ${sheetName}; numeric cells ${JSON.stringify(values)}`);
  });
});

describe('R5 demo PHASE E: FY boundary with a test clock - 31 March bills into 2026-27, 1 April starts 2027-28 at 0001 (BILL-003)', () => {
  it('on 31-03-2027 22:30 IST a fresh install bills a visit as 2026-27/0001', async function () {
    const lib = faketimeLibrary();
    if (lib === null) {
      evidence(`[r5demo] E: SKIPPED (infra) - libfaketime not found on ${process.platform}; FY boundary not exercised`);
      this.skip();
      return;
    }
    clock = makeClockWrapper(dataDir('clock'), lib);
    clock.setClock('2027-03-31 22:30:00');
    await relaunchIntoWithBinary('fy', clock.wrapper);
    expect(await bootPage.waitForDecidedScreen()).toBe('#/setup');
    expect(await webviewToday()).toBe('2027-03-31');
    await provisionAndEnterApp('fy', PIN);

    ({ patientId: fyPatientId, visitId: fyFirstVisitId } = await registerTakeCaseAndBill(FY_PATIENT));
    await billingPage.waitForLineAmount(1, '500.00');
    await billingPage.typePaid('500');
    await billingPage.chooseMode('cash');
    const number = await billingPage.saveAndWaitForNumber();
    expect(number).toContain('2026-27/0001');
    evidence(`[r5demo] E: test clock 2027-03-31 22:30 IST (webview ${await webviewToday()}); bill saved "${number}"`);
  });

  it('after a relaunch on 01-04-2027 09:00 IST a follow-up bills as 2027-28/0001 and the March bill keeps 2026-27/0001', async function () {
    if (clock === null) {
      this.skip();
      return;
    }
    clock.setClock('2027-04-01 09:00:00');
    await relaunchIntoWithBinary('fy', clock.wrapper);
    await unlockAfterRelaunch();
    expect(await webviewToday()).toBe('2027-04-01');

    await patientsPage.openDashboard(fyPatientId);
    await patientsPage.dashFollowup();
    await caseRichPage.waitForForm();
    const fu = await caseRichPage.routeIds();
    expect(fu.visitId).not.toBe(fyFirstVisitId);
    await caseRichPage.typeProse('Follow-up: soreness much better.');
    await caseRichPage.save();
    await caseRichPage.waitForSaved();
    await billingPage.billFromCaseForm();
    await billingPage.waitForLineAmount(1, '300.00');
    await billingPage.typePaid('300');
    await billingPage.chooseMode('cash');
    const number = await billingPage.saveAndWaitForNumber();
    expect(number).toContain('2027-28/0001');

    await patientsPage.openDashboard(fyPatientId);
    await billingPage.openFromDashboardChip(fyFirstVisitId);
    const march = await billingPage.number.getText();
    expect(march).toContain('2026-27/0001');
    evidence(`[r5demo] E: test clock 2027-04-01 09:00 IST (webview ${await webviewToday()}); follow-up bill "${number}"; March bill still "${march}"`);
  });
});
