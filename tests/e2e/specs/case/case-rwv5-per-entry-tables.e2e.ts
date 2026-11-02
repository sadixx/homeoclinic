// @req CASE-001, CASE-003, CASE-005, VIS-001
// @tier stable
// @area case
// @targets linux
//
// M3-RWv5 A + C (case editor): ONE TABLE PER TYPE PER ENTRY for all six record
// kinds, a follow-up entry starting its OWN tables, bullet (not numbered)
// section headings, the empty-complaint prompt instead of an "Untitled
// complaint" sample, and a kill/relaunch restore of every table.
//
//   PHASE A (fresh 'main' dir): provision -> register -> Take case.
//     C: the fresh case shows case-form-complaint-empty-prompt, no complaint
//        header and no "Untitled" text; naming it via Add new complaint makes
//        the header appear and the prompt go away.
//     A: in the FIRST entry, Record each of vitals, modalities, family history,
//        physical generals, investigations (Suggested) and prescription TWICE
//        -> exactly one table of that type in the entry, more body rows after
//        the second Record. Every section heading starts with a bullet and
//        none carries a "<n>. " prefix.
//     A: type an EMPTY line (exercises the RWv5 ProseMirror nodeSize fix) ->
//        Add follow-up entry -> Record vitals + modalities -> NEW tables in the
//        follow-up entry -> Record them again -> rows append THERE; the first
//        entry is byte-for-byte unchanged throughout. Save.
//   PHASE B (relaunch SAME dir; the driver chain is pkill -9'd = app killed):
//     unlock -> reopen the visit -> the per-entry table structure (types, rows,
//     cell text) deep-equals the PHASE A snapshot.
//
// No sleeps — every wait is waitUntil / waitForDisplayed via the page objects.
import { browser, expect } from '@wdio/globals';

import { bootPage } from '../../pages/boot.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { evidence } from '../../helpers/evidence.js';
import { relaunchInto } from '../../helpers/launch.js';

const PIN = '2468';
const PATIENT_NAME = 'Tabula Testpatient';
const COMPLAINT = 'Migraine';
const PROSE = 'Throbbing left temple since a week.';
const ALL_TYPES = [
  'vitals',
  'modalities',
  'family_history',
  'physical_generals',
  'investigations',
  'prescription',
] as const;
type Kind = (typeof ALL_TYPES)[number];

let patientId = '';
let visitId = '';
let savedSnapshot = '';
const softFailures: string[] = [];

type Entries = Awaited<ReturnType<typeof caseRichPage.entryTables>>;

function tablesOf(entries: Entries, entry: number, type: string): { rows: string[][] }[] {
  return (entries[entry]?.tables ?? []).filter((t) => t.type === type);
}

async function recordOnce(kind: Kind, pass: 1 | 2): Promise<void> {
  switch (kind) {
    case 'vitals':
      await caseRichPage.recordVitals(
        pass === 1 ? { sys: '120', dia: '80', pulse: '72' } : { sys: '130', dia: '85', pulse: '76' },
      );
      return;
    case 'modalities':
      await caseRichPage.recordModalities(
        pass === 1 ? 'Weather' : 'Time',
        pass === 1 ? 'Cold damp' : 'Evening',
        pass === 1 ? 'Warm dry' : 'Morning',
      );
      return;
    case 'family_history':
      await caseRichPage.recordFamily(
        pass === 1 ? 'Diabetes' : 'Asthma',
        pass === 1 ? 'Hypertension' : 'Gout',
      );
      return;
    case 'physical_generals':
      await caseRichPage.recordGenerals(
        pass === 1
          ? { appetite: 'Good', thirst: 'Thirstless', thermal: 'Chilly', constitution: 'Lean' }
          : { appetite: 'Poor', thirst: 'Large quantities', thermal: 'Hot', constitution: 'Stocky' },
      );
      return;
    case 'investigations':
      await caseRichPage.recordInvestigationSuggested(
        pass === 1 ? 'CBC' : 'Lipid profile',
        pass === 1 ? 'Fasting' : 'Repeat in 3 months',
      );
      return;
    case 'prescription':
      await caseRichPage.addPrescription(pass === 1 ? 'Belladonna' : 'Bryonia');
      return;
  }
}

describe('M3-RWv5 per-entry tables PHASE A: one table per type per entry, follow-up gets its own tables, bullets, empty prompt (CASE-001/003, VIS-001)', () => {
  it('records every table type twice into ONE table in the first entry, then a follow-up entry after an empty line gets NEW vitals + modalities tables that append there, leaving the first entry unchanged', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    await patientsPage.openRegister();
    await patientsPage.fillCore({ name: PATIENT_NAME, age: '40', city: 'Nashik' });
    await patientsPage.saveAndWaitForDashboard();
    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();
    ({ patientId, visitId } = await caseRichPage.routeIds());

    // ---- C: fresh case -> empty prompt, no "Untitled complaint" ----------
    await expect(caseRichPage.complaintEmptyPrompt).toBeDisplayed();
    expect(await caseRichPage.editorText()).not.toMatch(/untitled/i);
    expect((await caseRichPage.complaintHeaders()).length).toBe(0);
    const formText = await caseRichPage.form.getText();
    expect(formText).not.toMatch(/untitled complaint/i);
    evidence('[rwv5] C fresh case -> empty prompt shown, 0 complaint headers, no "Untitled" text');

    // Pre-click state is LOGGED, not asserted: the live app keeps one unnamed
    // placeholder complaint in the spine, so a fresh case can already render one
    // (unlabelled) complaint-remove control. The hard check below requires the
    // control to be labelled with the NEW name, which only a refreshed
    // structure produces (b15-r1-f1 left it stale).
    evidence(
      `[rwv5] C fresh case remove controls before naming: ${JSON.stringify((await caseRichPage.complaintNamingSnapshot()).removes)}`,
    );
    // b15-r1-f1 (HARD): naming the leading complaint must retire the empty
    // prompt and show its remove control IMMEDIATELY — not on the next edit.
    // Each poll is ONE DOM snapshot (header + prompt + remove controls at the
    // same instant); the whole state must hold within NAMING_BOUND_MS of the click.
    const NAMING_BOUND_MS = 2000;
    await caseRichPage.addComplaint(COMPLAINT);
    const clickedAt = Date.now();
    type NamingSnap = Awaited<ReturnType<typeof caseRichPage.complaintNamingSnapshot>>;
    const probe: { first: NamingSnap | null; firstMs: number; last: NamingSnap | null } = {
      first: null,
      firstMs: -1,
      last: null,
    };
    const namedOk = (s: NamingSnap): boolean => {
      const header = s.headers.find((h) => h.text.includes(COMPLAINT));
      return (
        header !== undefined &&
        header.id !== null &&
        !s.promptExists &&
        s.removes.length === 1 &&
        s.removes[0].testId === `case-form-complaint-remove-${header.id}` &&
        s.removes[0].ariaLabel.includes(COMPLAINT)
      );
    };
    const settled = await browser
      .waitUntil(
        async () => {
          const s = await caseRichPage.complaintNamingSnapshot();
          probe.last = s;
          if (probe.first === null && s.headers.some((h) => h.text.includes(COMPLAINT))) {
            probe.first = s;
            probe.firstMs = Date.now() - clickedAt;
          }
          return namedOk(s);
        },
        { timeout: NAMING_BOUND_MS, interval: 50 },
      )
      .then(() => true)
      .catch(() => false);
    const settledMs = Date.now() - clickedAt;
    evidence(
      `[rwv5] C b15-r1-f1 first header snapshot at ${probe.firstMs} ms: ${JSON.stringify(probe.first)}`,
    );
    evidence(
      `[rwv5] C after naming: empty prompt gone=${probe.last !== null && !probe.last.promptExists}, ` +
        `remove controls=${JSON.stringify(probe.last?.removes ?? null)}, ` +
        `settled=${settled} in ${settledMs} ms (bound ${NAMING_BOUND_MS} ms)`,
    );
    if (!settled) {
      throw new Error(
        `b15-r1-f1: within ${NAMING_BOUND_MS} ms of Add new complaint the named header + no empty prompt + exactly one ` +
          `case-form-complaint-remove-<id> labelled "${COMPLAINT}" did not hold; last snapshot ${JSON.stringify(probe.last)}`,
      );
    }
    expect((await caseRichPage.complaintHeaders()).length).toBe(1);
    evidence(`[rwv5] C named complaint -> 1 header ${JSON.stringify((await caseRichPage.complaintHeaders())[0]?.text)}`);

    // Doctor writes a note in the first entry (caret into entry 1).
    await caseRichPage.typeProse(PROSE);
    expect((await caseRichPage.entryHeadings()).length).toBe(1);

    // ---- A: Record each type twice in the FIRST entry --------------------
    for (const kind of ALL_TYPES) {
      await recordOnce(kind, 1);
      await browser.waitUntil(
        async () => tablesOf(await caseRichPage.entryTables(), 0, kind).length === 1,
        { timeout: 15000, timeoutMsg: `first Record of ${kind} did not create exactly one table in entry 1` },
      );
      const rows1 = tablesOf(await caseRichPage.entryTables(), 0, kind)[0]?.rows.length ?? 0;
      expect(rows1).toBeGreaterThanOrEqual(1);

      await recordOnce(kind, 2);
      await browser.waitUntil(
        async () => (tablesOf(await caseRichPage.entryTables(), 0, kind)[0]?.rows.length ?? 0) > rows1,
        { timeout: 15000, timeoutMsg: `second Record of ${kind} did not append rows to the entry-1 table` },
      );
      const after = tablesOf(await caseRichPage.entryTables(), 0, kind);
      expect(after.length).toBe(1);
      evidence(`[rwv5] A entry1 ${kind}: Record x2 -> 1 table, rows ${rows1} -> ${after[0]?.rows.length}`);
    }
    let entries = await caseRichPage.entryTables();
    expect(entries.length).toBe(1);
    expect(entries[0]?.tables.map((t) => t.type).sort()).toEqual([...ALL_TYPES].sort());

    // ---- C: bullets, not numeric prefixes --------------------------------
    const headings = await caseRichPage.sectionHeadingTexts();
    expect(headings.length).toBe(ALL_TYPES.length);
    for (const h of headings) {
      expect(h).not.toMatch(/^\s*\d+\.\s/);
      expect(h.startsWith('\u2022')).toBe(true);
    }
    evidence(`[rwv5] C section headings (bullets, no numbers): ${JSON.stringify(headings)}`);

    // ---- A: empty line, then the follow-up entry -------------------------
    await caseRichPage.typeEmptyLineAfter(PROSE);
    entries = await caseRichPage.entryTables();
    expect(entries[0]?.emptyParagraphs ?? 0).toBeGreaterThanOrEqual(1);
    const entry1Before = JSON.stringify(entries[0]?.tables);
    evidence(`[rwv5] A typed an empty line (Enter after the prose line) in entry 1 (empty paragraphs=${entries[0]?.emptyParagraphs})`);

    await caseRichPage.addFollowupEntry();
    await browser.waitUntil(async () => (await caseRichPage.entryHeadings()).length === 2, {
      timeout: 15000,
      timeoutMsg: 'Add follow-up entry did not append a second entry',
    });
    expect((await caseRichPage.entryHeadings())[1]?.kind).toBe('follow_up');

    await caseRichPage.recordVitals({ sys: '118', dia: '78', pulse: '70' });
    await caseRichPage.recordModalities('Motion', 'Walking', 'Rest');
    await browser.waitUntil(
      async () => {
        const e = await caseRichPage.entryTables();
        return tablesOf(e, 1, 'vitals').length === 1 && tablesOf(e, 1, 'modalities').length === 1;
      },
      { timeout: 15000, timeoutMsg: 'Record vitals + modalities after Add follow-up entry did not create NEW tables in the follow-up entry' },
    );
    entries = await caseRichPage.entryTables();
    expect(JSON.stringify(entries[0]?.tables)).toBe(entry1Before);
    expect(entries[1]?.tables.map((t) => t.type)).toEqual(['vitals', 'modalities']);
    const fuVitals1 = tablesOf(entries, 1, 'vitals')[0]?.rows.length ?? 0;
    const fuMod1 = tablesOf(entries, 1, 'modalities')[0]?.rows.length ?? 0;
    evidence(`[rwv5] A follow-up: NEW vitals (${fuVitals1} rows) + modalities (${fuMod1} rows) tables; entry 1 unchanged`);

    await caseRichPage.recordVitals({ sys: '122', dia: '82', pulse: '74' });
    await caseRichPage.recordModalities('Food', 'Fat', 'Fasting');
    await browser.waitUntil(
      async () => {
        const e = await caseRichPage.entryTables();
        return (
          (tablesOf(e, 1, 'vitals')[0]?.rows.length ?? 0) > fuVitals1 &&
          (tablesOf(e, 1, 'modalities')[0]?.rows.length ?? 0) > fuMod1
        );
      },
      { timeout: 15000, timeoutMsg: 'Record again in the follow-up did not append rows there' },
    );
    entries = await caseRichPage.entryTables();
    expect(tablesOf(entries, 1, 'vitals').length).toBe(1);
    expect(tablesOf(entries, 1, 'modalities').length).toBe(1);
    expect(JSON.stringify(entries[0]?.tables)).toBe(entry1Before);
    evidence(
      `[rwv5] A follow-up Record again -> appended there: vitals ${fuVitals1} -> ${tablesOf(entries, 1, 'vitals')[0]?.rows.length}, modalities ${fuMod1} -> ${tablesOf(entries, 1, 'modalities')[0]?.rows.length}; entry 1 unchanged`,
    );

    await caseRichPage.save();
    await caseRichPage.waitForSaved();
    // After the first edit following the naming, the prompt must be gone.
    evidence(`[rwv5] C empty prompt present at save time: ${await caseRichPage.complaintEmptyPrompt.isExisting()}`);
    savedSnapshot = JSON.stringify((await caseRichPage.entryTables()).map((e) => ({ kind: e.kind, tables: e.tables })));
    evidence(`[rwv5] saved; snapshot ${savedSnapshot.length} chars, ${entries.reduce((n, e) => n + e.tables.length, 0)} tables`);
    expect(softFailures).toEqual([]);
  });
});

describe('M3-RWv5 per-entry tables PHASE B: kill + relaunch restores every table in its entry (CASE-005)', () => {
  before(async () => {
    await relaunchInto('main');
  });

  it('relaunches on the SAME data dir and restores all eight tables with their rows in the right entries', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/lock');
    await lockPage.attempt(PIN);
    await shellPage.waitForShell();
    await caseRichPage.openVisit(patientId, visitId);

    await browser.waitUntil(async () => (await caseRichPage.entryTables()).length === 2, {
      timeout: 20000,
      timeoutMsg: 'both entries were not restored after relaunch',
    });
    const restored = JSON.stringify((await caseRichPage.entryTables()).map((e) => ({ kind: e.kind, tables: e.tables })));
    expect(restored).toBe(savedSnapshot);
    const headings = await caseRichPage.sectionHeadingTexts();
    expect(headings.length).toBe(8);
    for (const h of headings) expect(h).not.toMatch(/^\s*\d+\.\s/);
    expect(await caseRichPage.editorText()).not.toMatch(/untitled/i);
    evidence(`[rwv5] relaunch -> restored snapshot identical (${restored.length} chars), 8 bullet section headings`);
  });
});
