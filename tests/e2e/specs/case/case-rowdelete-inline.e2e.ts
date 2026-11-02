// @req CASE-001, CASE-003, CASE-005, VIS-001
// @tier stable
// @area case
// @targets linux
//
// M3ux inline row delete in case tables, end to end on the built desktop app
// (WebKitGTK), fresh isolated data dir, synthetic patient only, no network.
//
//   PHASE A (window 1366x768, X11):
//     1. the old "✕ Row N" strip above the editor is gone; every DATA row of
//        every table has exactly ONE minus button inside its own row box
//        (glyph "−", name "Delete row <r> of <Table>", aria-keyshortcuts
//        Control+Shift+Backspace, tooltip with the shortcut); header rows none.
//     2. the 14-row physical generals table fits: no horizontal scroll on the
//        page, the table wrapper or the editor; every minus in the viewport.
//        Element screenshot of that table -> <HC_E2E_OUTDIR>/screenshots/.
//     3. minus + Cancel keeps the row; focus returns to the editor in that row.
//     4. minus + Confirm deletes exactly that row; caret on the row that moved up.
//     5. Ctrl+Shift+Backspace (real WebDriver key chord) on the HEADER row:
//        no confirm, doc unchanged.
//     6. the chord in a DATA row opens the confirm (doc unchanged until
//        confirm); Escape closes it with focus back in the row; the chord again
//        + Confirm deletes exactly that row.
//     7. deleting the ONLY vitals row removes the table, its heading and rule.
//     Save.
//   PHASE B (kill + relaunch the SAME data dir): the deletions persisted, the
//     restored tables equal the saved snapshot, and the saved case JSON (read
//     through the production case_visit_open_or_create IPC) holds no button
//     text / widget markup.
//
// Durable markers go to <HC_E2E_OUTDIR>/evidence.log. No sleeps: every wait is
// waitUntil / waitForDisplayed (the header-row negative check is a bounded
// waitUntil that must time out).
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { layoutPage } from '../../pages/layout.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { relaunchInto } from '../../helpers/launch.js';
import { evidence } from '../../helpers/evidence.js';

const PIN = '9753';
const PATIENT = 'Rowdel Testpatient';
const MINUS = '\u2212';
const SHORTCUT_ARIA = 'Control+Shift+Backspace';
const LABELS: Record<string, string> = {
  vitals: 'Vitals',
  family_history: 'Family history',
  physical_generals: 'Physical generals',
};

let patientId = '';
let visitId = '';
let savedTables = '';

async function waitTableRows(type: string, n: number, what: string): Promise<string[][]> {
  try {
    await browser.waitUntil(async () => (await caseRichPage.tableByType(type))?.rows.length === n, {
      timeout: 15000,
    });
  } catch {
    throw new Error(`${what}: ${type} did not reach ${n} data row(s); tables=${JSON.stringify(await caseRichPage.tables())}`);
  }
  return (await caseRichPage.tableByType(type))?.rows ?? [];
}

/** Every data row has exactly one correct minus in its own row; headers none. */
async function assertRowControls(what: string): Promise<number> {
  const lay = await caseRichPage.rowDeleteLayout();
  expect(lay.stripPresent).toBe(false);
  expect(lay.oldStyleButtons).toEqual([]);
  expect(lay.buttonsOutsideTables).toBe(0);
  const problems: string[] = [];
  let total = 0;
  let maxOverflow = 0;
  lay.tables.forEach((tbl, ti) => {
    const tNo = ti + 1;
    let dataNo = 0;
    let prevBottom = -Infinity;
    tbl.rows.forEach((row, ri) => {
      if (row.header) {
        if (row.buttons.length !== 0) problems.push(`table ${tNo} header has ${row.buttons.length} button(s)`);
        return;
      }
      dataNo += 1;
      total += row.buttons.length;
      const b = row.buttons[0];
      if (row.buttons.length !== 1 || b === undefined) {
        problems.push(`table ${tNo} row ${ri} has ${row.buttons.length} buttons`);
        return;
      }
      const label = `Delete row ${dataNo} of ${LABELS[tbl.tableType ?? ''] ?? 'Section'}`;
      if (b.id !== `case-form-table-row-delete-${tNo}-${dataNo}`) problems.push(`t${tNo} r${dataNo} id ${b.id}`);
      // Ownership, not pixel containment: the button is in this row's own
      // cell (rowDeleteLayout matches by closest('tr')), its centre is inside
      // the row, it does not overlap the previous row's button, and it pokes
      // out of the row box by at most 2px (measured overflow is recorded).
      const cy = (b.top + b.bottom) / 2;
      const over = Math.max(0, b.row.top - b.top, b.bottom - b.row.bottom, b.row.left - b.left, b.right - b.row.right);
      maxOverflow = Math.max(maxOverflow, over);
      if (cy < b.row.top || cy > b.row.bottom || over > 2 || b.top < prevBottom) {
        problems.push(
          `t${tNo} r${dataNo} button not owned by its row: btn[${b.left},${b.right}]x[${b.top},${b.bottom}] ` +
            `row ${JSON.stringify(b.row)} overflow=${over.toFixed(1)} prevBottom=${prevBottom}`,
        );
      }
      prevBottom = b.bottom;
      if (b.text !== MINUS) problems.push(`t${tNo} r${dataNo} text ${JSON.stringify(b.text)}`);
      if (b.label !== label) problems.push(`t${tNo} r${dataNo} label ${JSON.stringify(b.label)}`);
      if (b.keys !== SHORTCUT_ARIA) problems.push(`t${tNo} r${dataNo} keys ${JSON.stringify(b.keys)}`);
      if (b.title !== `${label} (Ctrl+Shift+Backspace in the row)`) problems.push(`t${tNo} r${dataNo} title ${JSON.stringify(b.title)}`);
    });
  });
  if (problems.length > 0) throw new Error(`${what}: row controls wrong: ${problems.join('; ')}`);
  const shape = lay.tables.map((t) => `${t.tableType}:${t.rows.filter((r) => !r.header).length}`).join(',');
  evidence(`[rowdel] ${what}: strip=absent oldStyle=0 outsideTables=0 controls=${total} tables=[${shape}] headers have none; each in its own row cell, centred in row, no overlap, max overflow past row box ${maxOverflow.toFixed(1)}px; glyph/name/keys/title ok`);
  return total;
}

/** The dialog must NOT appear within `ms` (bounded negative wait, no sleep). */
async function dialogStaysClosed(ms: number): Promise<boolean> {
  try {
    await browser.waitUntil(async () => caseRichPage.rowDeleteDialog.isExisting(), { timeout: ms, interval: 100 });
    return false;
  } catch {
    return true;
  }
}

describe('M3ux inline row delete PHASE A: per-row minus, shortcut, confirm/cancel/Escape, 1366x768 fit (CASE-001/003)', () => {
  before(async () => {
    process.env.GDK_BACKEND = 'x11';
    await relaunchInto('main');
  });

  it('M3ux inline row delete: minus per data row, header none, cancel keeps, confirm deletes that row, Ctrl+Shift+Backspace, last row removes table, fits 1366x768', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();
    const size = await layoutPage.setSize(1366, 768);
    evidence(`[rowdel] window inner ${size.w}x${size.h} after setWindowRect 1366x768`);

    await patientsPage.openRegister();
    await patientsPage.fillCore({ name: PATIENT, age: '37', city: 'Nashik' });
    await patientsPage.saveAndWaitForDashboard();
    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();
    ({ patientId, visitId } = await caseRichPage.routeIds());
    await caseRichPage.addComplaint('Headache');

    await caseRichPage.recordVitals({ sys: '120', dia: '80', pulse: '72' });
    await caseRichPage.recordVitals({ sys: '160', dia: '99', pulse: '99' });
    const vit2 = await waitTableRows('vitals', 2, 'two vitals');
    const nGen = await caseRichPage.recordAllGenerals();
    expect(nGen).toBe(14);
    await waitTableRows('physical_generals', 14, 'all 14 generals');
    await caseRichPage.recordFamilySide('maternal', ['Diabetes', 'Thyroid', 'Asthma']);
    const fam3 = await waitTableRows('family_history', 3, 'family x3');
    const mi = ((await caseRichPage.tableByType('family_history'))?.headers ?? []).indexOf('Maternal');
    expect(fam3.map((r) => r[mi])).toEqual(['Diabetes', 'Thyroid', 'Asthma']);

    // ---- 1. no strip; one minus per data row, inside it; headers none ----
    expect(await assertRowControls('initial')).toBe(2 + 14 + 3);

    // ---- 2. 1366x768: physical generals fits, no horizontal scroll -------
    const shots = path.join(process.env.HC_E2E_OUTDIR ?? '.', 'screenshots');
    mkdirSync(shots, { recursive: true });
    await caseRichPage.screenshotTable('physical_generals', path.join(shots, 'physical-generals-minus-1366x768.png'));
    await browser.saveScreenshot(path.join(shots, 'case-form-1366x768.png'));
    const fit = await caseRichPage.tableFit('physical_generals');
    const m = await layoutPage.measure();
    evidence(
      `[rowdel] 1366x768 physical_generals fit=${JSON.stringify(fit)} docOverflowX=${m.docOverflowX} inner=${m.innerWidth}x${m.innerHeight} ` +
        `screenshots=screenshots/physical-generals-minus-1366x768.png,screenshots/case-form-1366x768.png`,
    );
    expect(fit.found).toBe(true);
    expect(m.docOverflowX).toBeLessThanOrEqual(1);
    expect(fit.wrapperOverflowX).toBeLessThanOrEqual(1);
    expect(fit.editorOverflowX).toBeLessThanOrEqual(1);
    expect(fit.buttonsOutsideViewport).toBe(0);
    expect(fit.tableRight).toBeLessThanOrEqual(fit.viewport);

    // ---- 3. minus + Cancel keeps the row, focus back in that row ---------
    const famNo = await caseRichPage.tableNumber('family_history');
    const famBtn = await browser.$(`[data-testid="case-form-table-row-delete-${famNo}-2"]`);
    await famBtn.scrollIntoView({ block: 'center' });
    await famBtn.waitForClickable({ timeout: 15000 });
    await famBtn.click();
    await caseRichPage.rowDeleteDialog.waitForDisplayed({ timeout: 15000 });
    const inDialog = await caseRichPage.caretAndFocus();
    expect(inDialog.editorFocused).toBe(false);
    await caseRichPage.rowDeleteCancel.click();
    await caseRichPage.rowDeleteDialog.waitForDisplayed({ reverse: true, timeout: 15000 });
    await caseRichPage.waitCaretIn('family_history', 2, 'after Cancel');
    const famAfterCancel = await waitTableRows('family_history', 3, 'cancel keeps');
    expect(famAfterCancel.map((r) => r[mi])).toEqual(['Diabetes', 'Thyroid', 'Asthma']);
    evidence(`[rowdel] step3 minus family row 2 -> dialog (focus in dialog: activeTestId=${inDialog.activeTestId}) -> Cancel -> rows kept 3, editor focused, caret family_history row 2`);

    // ---- 4. minus + Confirm deletes exactly that row ---------------------
    await caseRichPage.deleteTableRow(famNo, 2, true);
    const fam2 = await waitTableRows('family_history', 2, 'confirm deletes row 2');
    expect(fam2.map((r) => r[mi])).toEqual(['Diabetes', 'Asthma']);
    await caseRichPage.waitCaretIn('family_history', 2, 'after Confirm (next row moved up)');
    evidence(`[rowdel] step4 minus family row 2 + Confirm -> maternal ${JSON.stringify(fam2.map((r) => r[mi]))} (Thyroid gone), caret family_history row 2 (Asthma)`);

    // ---- 5. chord on the HEADER row does nothing -------------------------
    await caseRichPage.clickTableCell('vitals', 0);
    await caseRichPage.waitCaretIn('vitals', 0, 'caret in vitals header');
    const beforeHeader = JSON.stringify(await caseRichPage.tables());
    await caseRichPage.pressRowDeleteShortcut();
    const headerQuiet = await dialogStaysClosed(2000);
    expect(headerQuiet).toBe(true);
    expect(JSON.stringify(await caseRichPage.tables())).toBe(beforeHeader);
    evidence(`[rowdel] step5 Ctrl+Shift+Backspace with caret in vitals HEADER -> no dialog within 2000 ms, tables byte-identical`);

    // ---- 6. chord in a DATA row: confirm opens; Escape; chord + Confirm --
    await caseRichPage.clickTableCell('vitals', 2);
    await caseRichPage.waitCaretIn('vitals', 2, 'caret in vitals row 2');
    await caseRichPage.pressRowDeleteShortcut();
    await caseRichPage.rowDeleteDialog.waitForDisplayed({ timeout: 15000 });
    expect((await caseRichPage.tableByType('vitals'))?.rows.length).toBe(2);
    await caseRichPage.pressEscape();
    await caseRichPage.rowDeleteDialog.waitForDisplayed({ reverse: true, timeout: 15000 });
    await caseRichPage.waitCaretIn('vitals', 2, 'after Escape');
    expect((await caseRichPage.tableByType('vitals'))?.rows.length).toBe(2);
    evidence(`[rowdel] step6a chord in vitals row 2 -> confirm dialog (rows still 2) -> Escape -> closed, editor focused, caret vitals row 2, rows 2`);
    await caseRichPage.pressRowDeleteShortcut();
    await caseRichPage.rowDeleteDialog.waitForDisplayed({ timeout: 15000 });
    await caseRichPage.rowDeleteConfirm.click();
    await caseRichPage.rowDeleteDialog.waitForDisplayed({ reverse: true, timeout: 15000 });
    const vit1 = await waitTableRows('vitals', 1, 'chord + confirm deletes row 2');
    expect(vit1[0]?.join(' ')).toBe(vit2[0]?.join(' '));
    expect(vit1[0]?.join(' ')).not.toContain('160');
    await caseRichPage.waitCaretIn('vitals', 1, 'after chord Confirm (previous row)');
    evidence(`[rowdel] step6b chord + Confirm -> vitals rows 1 kept "${vit1[0]?.join(' ')}" (160/99 row gone), caret vitals row 1`);
    await assertRowControls('after deletes');

    // ---- 7. delete the ONLY vitals row: table + heading + rule go --------
    const tablesBefore = (await caseRichPage.tables()).length;
    const hrBefore = await caseRichPage.separatorCount();
    const headsBefore = await caseRichPage.sectionHeadingTexts();
    expect(headsBefore.some((h) => /vitals/i.test(h))).toBe(true);
    await caseRichPage.deleteTableRow(await caseRichPage.tableNumber('vitals'), 1, true);
    await browser.waitUntil(async () => (await caseRichPage.tableByType('vitals')) === undefined, {
      timeout: 15000,
      timeoutMsg: 'deleting the only vitals row did not remove the table',
    });
    const headsAfter = await caseRichPage.sectionHeadingTexts();
    expect(headsAfter.some((h) => /vitals/i.test(h))).toBe(false);
    expect((await caseRichPage.tables()).length).toBe(tablesBefore - 1);
    expect(await caseRichPage.separatorCount()).toBe(hrBefore - 1);
    await browser.waitUntil(async () => (await caseRichPage.caretAndFocus()).editorFocused, {
      timeout: 10000,
      timeoutMsg: 'editor not focused after the table was removed',
    });
    evidence(
      `[rowdel] step7 only vitals row + Confirm -> vitals table removed (tables ${tablesBefore}->${tablesBefore - 1}, ` +
        `rules ${hrBefore}->${hrBefore - 1}), headings ${JSON.stringify(headsAfter)}, editor focused`,
    );
    expect(await assertRowControls('after table removal')).toBe(14 + 2);

    await caseRichPage.save();
    expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);
    savedTables = JSON.stringify(await caseRichPage.tables());
    evidence(`[rowdel] saved; tables snapshot ${savedTables.length} chars`);
  });
});

describe('M3ux inline row delete PHASE B: kill + relaunch keeps the deletions, no button text saved (CASE-005)', () => {
  before(async () => {
    await relaunchInto('main');
  });

  after(() => {
    delete process.env.GDK_BACKEND;
  });

  it('M3ux inline row delete: after kill/relaunch the deletions persist and saved content has no button text', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/lock');
    await lockPage.attempt(PIN);
    await shellPage.waitForShell();
    await caseRichPage.openVisit(patientId, visitId);
    await browser
      .waitUntil(async () => JSON.stringify(await caseRichPage.tables()) === savedTables, { timeout: 20000 })
      .catch(async () => {
        throw new Error(`restored tables differ: ${JSON.stringify(await caseRichPage.tables())} vs ${savedTables}`);
      });
    expect(await caseRichPage.tableByType('vitals')).toBeUndefined();
    const fam = (await caseRichPage.tableByType('family_history'))?.rows ?? [];
    expect(fam.length).toBe(2);
    expect((await caseRichPage.tableByType('physical_generals'))?.rows.length).toBe(14);
    await assertRowControls('after relaunch');

    const saved = await caseRichPage.savedCaseJson(patientId);
    expect(saved.visitId).toBe(visitId);
    const dj = saved.dataJson;
    const bad = [MINUS, 'hc-row-delete', 'Delete row', 'Ctrl+Shift', 'case-form-table-row-delete', 'Thyroid'].filter((s) =>
      dj.includes(s),
    );
    expect(bad).toEqual([]);
    for (const s of ['Diabetes', 'Asthma', 'Sleep position value']) expect(dj).toContain(s);
    evidence(
      `[rowdel] relaunch -> restored tables identical to saved (${savedTables.length} chars); vitals absent, family 2, generals 14; ` +
        `saved data_json ${dj.length} chars, same visit, contains none of [minus glyph, hc-row-delete, Delete row, Ctrl+Shift, testid, Thyroid]`,
    );
  });
});
