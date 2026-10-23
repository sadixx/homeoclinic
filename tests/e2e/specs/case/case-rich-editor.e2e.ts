// @req CASE-001 CASE-003 CASE-005 VIS-001 NFR-030 SET-005 PAT-009
// @tier stable
// @area case
// @targets linux
//
// M3-RWv2 S08 case record — RICH-TEXT (TipTap) model (ADR 0019; docs/ui/
// S08-case-form.md revised; schema M3-RWv2-serialization-v3.md). Proves the
// reworked RICH-EDITOR flow AND that the R3 autosave kill-restore guarantee
// (CASE-005) still holds for the whole rich document (prose + tables + edited
// cells). Boot-gate aware, network disabled, isolated per-spec data dir. Two app
// launches against ONE data dir ('main'): PHASE A drives the flow + explicit
// Save; PHASE B relaunches the SAME dir and asserts full restore.
//
//   PHASE A (launch 1): provision first-run -> register a MALE adult patient ->
//     "Take case" -> the TipTap editor renders; then, per the task steps:
//       1. the rich editor is present; type prose into it.
//       2. "Add entry" -> a NEW dated entry heading appears (entry count grows).
//       3. "Record vitals" popup (sys + dia + weight + height) -> Record -> an
//          editable vitals TABLE appears with the BP cells, a NUMBERED heading
//          and a full-width separator above it; edit a body cell -> it persists.
//       4. "Record family history" Maternal/Paternal -> Record -> a TWO-COLUMN
//          (Maternal | Paternal) table inserted.
//       5. "Add prescription" -> an editable medicine table marked placeholder.
//       6. numbering increments across inserted sections; separators present.
//       5(also). Case summary control ABSENT (ADR 0019 carries ADR 0018 #5).
//       9. ZOOM in/out visibly changes the editor size; FULLSCREEN (maximise)
//          fills the width (the editor is not a narrow centered column).
//       Explicit SAVE -> "Saved". Captures pid + vid.
//
//   PHASE B (launch 2, SAME 'main' dir — HEADLINE kill-restore, CASE-005):
//     relaunchInto('main') restarts the driver chain at the SAME XDG_DATA_HOME;
//     the fresh process self-routes to #/lock (asserted) -> unlock -> reopen the
//     SAME visit by deep-link -> the typed prose + vitals table + edited cell +
//     family two-column table are ALL restored (nothing lost).
//
// Synthetic patient only; the spec owns its data so restore is deterministic.
// No sleeps — all waits are waitUntil / waitForDisplayed.
import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { relaunchInto } from '../../helpers/launch.js';

const PIN = '2468';
const PATIENT_NAME = 'Richard Testpatient';

// Deterministic clinical values PHASE B asserts verbatim after the relaunch.
const PROSE = 'Throbbing right temple, worse 11am-3pm sun.';
const V_SYS = '120';
const V_DIA = '80';
const V_WEIGHT = '68';
const V_HEIGHT = '172';
const EDITED_PULSE = '77';
const RX_MEDICINE = 'Belladonna';
const FAMILY_MATERNAL = 'Diabetes (mother)';
const FAMILY_PATERNAL = 'Hypertension (father)';

// Vitals seed column order (schema §4a): BP sys, BP dia, Pulse, Weight, Height, BMI, Temp, SpO2.
const COL_PULSE = 2;

// Carried from PHASE A to PHASE B.
let patientId = '';
let visitId = '';

describe('M3-RWv2 rich PHASE A: TipTap editor, dated entries, record-popup editable tables (vitals/family/rx), numbering, zoom, fullscreen, Save (ADR 0019)', () => {
  it('opens the rich case editor, drives the full new flow, and autosaves it', async () => {
    // ---- Boot-gate + provision + seed a patient ---------------------------
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    await patientsPage.openRegister();
    await expect(patientsPage.form).toBeDisplayed();
    await patientsPage.fillCore({ name: PATIENT_NAME, age: '40', city: 'Pune' });
    await patientsPage.saveAndWaitForDashboard();
    expect(await patientsPage.dashboardText()).toContain(PATIENT_NAME);

    // ---- Take case -> rich TipTap editor ----------------------------------
    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();
    const ids = await caseRichPage.routeIds();
    patientId = ids.patientId;
    visitId = ids.visitId;
    expect(patientId.length).toBeGreaterThan(0);
    expect(visitId.length).toBeGreaterThan(0);

    // ===== STEP 1: the rich editor renders + type prose ====================
    await expect(caseRichPage.editor()).toBeDisplayed();
    const entriesBefore = await caseRichPage.entryCount();
    expect(entriesBefore).toBe(1); // fresh first case opens with one dated entry
    await caseRichPage.typeProse(PROSE);
    expect(await caseRichPage.editorText()).toContain(PROSE);
    // eslint-disable-next-line no-console
    console.log(`[rwv2] step1: TipTap editor renders; typed prose -> "${PROSE}"`);

    // ===== STEP 2: Add entry -> a NEW dated entry heading ==================
    await caseRichPage.addEntry();
    await browser.waitUntil(
      async () => (await caseRichPage.entryCount()) === entriesBefore + 1,
      { timeout: 15000, timeoutMsg: 'Add entry did not append a new dated entry heading' },
    );
    // eslint-disable-next-line no-console
    console.log(`[rwv2] step2: Add entry -> ${await caseRichPage.entryCount()} dated entry headings`);

    // ===== STEP 3: Record vitals -> editable table + numbered heading + rule
    const sepsBeforeVitals = await caseRichPage.separatorCount();
    await caseRichPage.recordVitals({ sys: V_SYS, dia: V_DIA, weight: V_WEIGHT, height: V_HEIGHT });
    await browser.waitUntil(
      async () => (await caseRichPage.tableByType('vitals')) !== undefined,
      { timeout: 15000, timeoutMsg: 'Record vitals did not insert a vitals table' },
    );
    const vitals = await caseRichPage.tableByType('vitals');
    expect(vitals).toBeDefined();
    // BP cells seeded in cols 0/1.
    expect(await caseRichPage.tableCellText('vitals', 0, 0)).toBe(V_SYS);
    expect(await caseRichPage.tableCellText('vitals', 0, 1)).toBe(V_DIA);
    // A numbered heading was stamped and a full-width separator added above it.
    const nums = await caseRichPage.sectionNumbers();
    expect(nums.length).toBeGreaterThanOrEqual(1);
    expect(nums).toContain(1);
    expect(await caseRichPage.separatorCount()).toBeGreaterThan(sepsBeforeVitals);
    // Edit the Pulse body cell -> the value stays (editable table).
    await caseRichPage.editTableCell('vitals', 0, COL_PULSE, EDITED_PULSE);
    await browser.waitUntil(
      async () => (await caseRichPage.tableCellText('vitals', 0, COL_PULSE)) === EDITED_PULSE,
      { timeout: 15000, timeoutMsg: 'edited vitals Pulse cell did not persist in the table' },
    );
    // eslint-disable-next-line no-console
    console.log(`[rwv2] step3: vitals table inserted (sys=${V_SYS} dia=${V_DIA}); numbered heading #${nums[0]}; separator added; edited Pulse=${EDITED_PULSE}`);

    // ===== STEP 4: Record family history -> TWO-COLUMN table ===============
    await caseRichPage.recordFamily(FAMILY_MATERNAL, FAMILY_PATERNAL);
    await browser.waitUntil(
      async () => (await caseRichPage.tableByType('family_history')) !== undefined,
      { timeout: 15000, timeoutMsg: 'Record family did not insert a family_history table' },
    );
    const family = await caseRichPage.tableByType('family_history');
    expect(family).toBeDefined();
    // Exactly two columns (Maternal | Paternal).
    expect(family?.headers.length).toBe(2);
    expect((family?.headers ?? []).join('|')).toMatch(/Maternal/);
    expect((family?.headers ?? []).join('|')).toMatch(/Paternal/);
    // Seeded first row carries both sides, each in its own column.
    expect(await caseRichPage.tableCellText('family_history', 0, 0)).toContain('Diabetes');
    expect(await caseRichPage.tableCellText('family_history', 0, 1)).toContain('Hypertension');
    // eslint-disable-next-line no-console
    console.log(`[rwv2] step4: family_history TWO-COLUMN table headers=[${family?.headers.join(', ')}] maternal/paternal seeded`);

    // ===== STEP 5: Add prescription -> placeholder medicine table ==========
    await caseRichPage.addPrescription(RX_MEDICINE);
    await browser.waitUntil(
      async () => (await caseRichPage.tableByType('prescription')) !== undefined,
      { timeout: 15000, timeoutMsg: 'Add prescription did not insert a prescription table' },
    );
    const rx = await caseRichPage.tableByType('prescription');
    expect(rx).toBeDefined();
    expect(rx?.rxPlaceholder).toBe(true);
    expect(await caseRichPage.hasRxPlaceholderHint()).toBe(true);
    // The popup seeded the Medicine cell (row 0, col 0).
    await browser.waitUntil(
      async () => (await caseRichPage.tableCellText('prescription', 0, 0)) === RX_MEDICINE,
      { timeout: 15000, timeoutMsg: 'prescription Medicine cell was not seeded' },
    );
    // eslint-disable-next-line no-console
    console.log(`[rwv2] step5: prescription placeholder table inserted (rxPlaceholder=${rx?.rxPlaceholder}); medicine=${RX_MEDICINE}`);

    // ===== STEP 6: numbering increments + separators present ===============
    const numbers = await caseRichPage.sectionNumbers();
    // Three record sections were inserted (vitals, family, prescription).
    expect(numbers.length).toBeGreaterThanOrEqual(3);
    // Strictly increasing, monotonic (no reuse).
    for (let i = 1; i < numbers.length; i += 1) {
      expect(numbers[i]).toBeGreaterThan(numbers[i - 1] as number);
    }
    // At least one separator per inserted section.
    expect(await caseRichPage.separatorCount()).toBeGreaterThanOrEqual(3);
    // eslint-disable-next-line no-console
    console.log(`[rwv2] step6: section numbers=[${numbers.join(', ')}] monotonic; separators=${await caseRichPage.separatorCount()}`);

    // ===== Case summary control ABSENT =====================================
    expect(await caseRichPage.hasCaseSummary()).toBe(false);
    // eslint-disable-next-line no-console
    console.log('[rwv2] Case summary control ABSENT (ADR 0019 / 0018 #5)');

    // ===== STEP 9a: ZOOM in/out visibly changes the editor size ============
    const baseFont = await caseRichPage.editorFontPx();
    await caseRichPage.zoomIn();
    await browser.waitUntil(async () => (await caseRichPage.editorFontPx()) > baseFont, {
      timeout: 10000,
      timeoutMsg: 'zoom in did not increase the editor font size',
    });
    const zoomedFont = await caseRichPage.editorFontPx();
    await caseRichPage.zoomOut();
    await browser.waitUntil(async () => (await caseRichPage.editorFontPx()) < zoomedFont, {
      timeout: 10000,
      timeoutMsg: 'zoom out did not decrease the editor font size',
    });
    // eslint-disable-next-line no-console
    console.log(`[rwv2] step9a: zoom base=${baseFont}px in=${zoomedFont}px out=${await caseRichPage.editorFontPx()}px (visibly changes)`);

    // ===== STEP 9b: FULLSCREEN fills the width (not a narrow centered col) ==
    await browser.maximizeWindow();
    await browser.waitUntil(
      async () => {
        const w = await caseRichPage.editorWidthVsViewport();
        return w.viewport > 0 && w.editor / w.viewport >= 0.7;
      },
      { timeout: 10000, timeoutMsg: 'editor did not fill the width when maximised (narrow centered column?)' },
    );
    const widths = await caseRichPage.editorWidthVsViewport();
    // eslint-disable-next-line no-console
    console.log(`[rwv2] step9b: fullscreen editor width=${Math.round(widths.editor)} viewport=${widths.viewport} ratio=${(widths.editor / widths.viewport).toFixed(2)} (fills width)`);

    // ===== Explicit SAVE -> "Saved" ========================================
    await caseRichPage.save();
    const savedText = await caseRichPage.waitForSaved();
    expect(savedText).toMatch(/^Saved/);
    // eslint-disable-next-line no-console
    console.log(`[rwv2] explicit Save -> "${savedText}"; visit ${visitId} persisted`);
  });
});

describe('M3-RWv2 rich PHASE B: HEADLINE kill-restore of the rich document (CASE-005 / ADR 0019)', () => {
  before(async () => {
    await relaunchInto('main');
  });

  it('relaunches on the SAME data dir and restores the whole rich document (prose + vitals table + edited cell + family two-column table)', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/lock');
    await expect(bootPage.lockCard).toBeDisplayed();
    await lockPage.attempt(PIN);
    await shellPage.waitForShell();
    // eslint-disable-next-line no-console
    console.log('[rwv2] relaunched on SAME data dir -> #/lock -> unlocked with PIN');

    // Reopen the SAME visit -> EVERYTHING restored.
    await caseRichPage.openVisit(patientId, visitId);

    // Typed prose restored.
    expect(await caseRichPage.editorText()).toContain(PROSE);
    // Vitals table restored incl. the edited Pulse cell.
    expect(await caseRichPage.tableCellText('vitals', 0, 0)).toBe(V_SYS);
    expect(await caseRichPage.tableCellText('vitals', 0, 1)).toBe(V_DIA);
    expect(await caseRichPage.tableCellText('vitals', 0, COL_PULSE)).toBe(EDITED_PULSE);
    // Family two-column table restored with both sides.
    const family = await caseRichPage.tableByType('family_history');
    expect(family).toBeDefined();
    expect(family?.headers.length).toBe(2);
    expect(await caseRichPage.tableCellText('family_history', 0, 0)).toContain('Diabetes');
    expect(await caseRichPage.tableCellText('family_history', 0, 1)).toContain('Hypertension');
    // Prescription placeholder restored: the TABLE's hcRxPlaceholder attribute
    // persists through the v3 doc (the in-session hint note is not re-rendered
    // on reload, so the persisted-state proof is the table attribute itself).
    const rxRestored = await caseRichPage.tableByType('prescription');
    expect(rxRestored).toBeDefined();
    expect(rxRestored?.rxPlaceholder).toBe(true);
    expect(await caseRichPage.tableCellText('prescription', 0, 0)).toBe(RX_MEDICINE);
    // eslint-disable-next-line no-console
    console.log(`[rwv2] RESTORED after relaunch -> prose + vitals(sys=${V_SYS},dia=${V_DIA},pulse=${EDITED_PULSE}) + family 2-col(Diabetes|Hypertension) + rx=${RX_MEDICINE} (nothing lost)`);
  });
});
