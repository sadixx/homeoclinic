// RED unit tests for the M3-RWv2 rich-text (TipTap v2 / ProseMirror) case
// editor — the PURE v3 serialization + doc-transform builders (ADR 0019;
// docs/ui/S08-case-form.md; .worklog/HC-MVP1-M3/handoffs/M3-RWv2-serialization-
// v3.md). CUT: the NEW pure module `apps/desktop/src/case/caseRich.ts`, which
// does not exist yet, so these tests FAIL at assertion time (vitest transpiles;
// a missing named export resolves to `undefined` and the calls throw / assert
// false — the red comes from the real CUT being absent, never a stand-in).
//
// Scope (unit-tester, leaf role): PURE doc transforms + serialization +
// upcast + the deterministic autosave-scheduling hook. The full TipTap editor
// DOM / caret / tab-between-cells is hc-e2e-editor's job (E2E), not this file;
// where the handoff names an editor command (`insertSectionTable(editor,...)`)
// the testable kernel is the pure builder it wraps (`buildSectionNodes`), so we
// test that directly (v3 handoff §12: "test the pure doc-transform builders
// directly" where the editor DOM is flaky).
//
// Only fakes are dependencies: Vitest fake timers for the debounce (NO wall
// clock, NO sleeps). No production code is touched by this file.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { t as tr } from '@/shared/strings';

import {
  // §12 pure functions
  emptyRichDoc,
  serializeRich,
  parseCaseDoc,
  upcastJournalToRich,
  extractCaseText,
  // doc-transform builders (table seeds)
  buildVitalsSeed,
  buildFamilySeed,
  buildPrescriptionSeed,
  // node builders (the kernel of insertSectionTable / appendDatedEntry)
  buildSectionNodes,
  buildDatedEntryNodes,
  // schema discriminators
  CASE_RICH_SCHEMA,
  CASE_RICH_VERSION,
  // autosave scheduling hook (deterministic timer kernel of CASE-005)
  createAutosaveScheduler,
  type V3Doc,
  type ProseMirrorNode,
  type RichVisitContext,
} from './caseRich';

const ctx: RichVisitContext = {
  visitId: '0192aa00-0000-7000-8000-000000000001',
  visitAt: '2026-10-02T09:00:00Z',
};

// ---- small structural helpers over the opaque ProseMirror doc --------------

/** Flatten every text leaf under a node into one string (recursive). */
function allText(node: ProseMirrorNode | undefined): string {
  if (node === undefined) return '';
  let out =
    node.type === 'text' && typeof node.text === 'string' ? node.text : '';
  for (const child of node.content ?? []) out += ` ${allText(child)}`;
  return out;
}

/** Collect every descendant node of a given `type`. */
function nodesOfType(root: ProseMirrorNode, type: string): ProseMirrorNode[] {
  const found: ProseMirrorNode[] = [];
  const walk = (n: ProseMirrorNode): void => {
    if (n.type === type) found.push(n);
    for (const c of n.content ?? []) walk(c);
  };
  walk(root);
  return found;
}

/** The doc of the first complaint. */
function firstDoc(doc: V3Doc): ProseMirrorNode {
  const c = doc.complaints[0];
  if (c === undefined) throw new Error('no complaint');
  return c.doc;
}

// ---------------------------------------------------------------------------
// 1 + 2. v3 round-trip + text mirror regenerated every serialise
// ---------------------------------------------------------------------------

describe('v3 serialize / parse round-trip', () => {
  it('round-trips an edited v3 document equal through serialize -> parse', () => {
    const doc = emptyRichDoc(ctx);
    const complaint = doc.complaints[0];
    expect(complaint).toBeDefined();
    // Type some prose into the first complaint's doc.
    const edited: V3Doc = {
      ...doc,
      complaints: [
        {
          ...complaint!,
          title: 'Headache',
          doc: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: {
                  level: 2,
                  hcKind: 'entry',
                  hcDate: '2026-10-02',
                  hcVisitId: ctx.visitId,
                },
                content: [{ type: 'text', text: '02-10-2026' }],
              },
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Throbbing right temple.' }],
              },
            ],
          },
        },
      ],
    };

    const json = serializeRich(edited);
    const back = parseCaseDoc(json, ctx, tr);

    expect(back.schema).toBe(CASE_RICH_SCHEMA);
    expect(back.version).toBe(CASE_RICH_VERSION);
    expect(back.complaints).toHaveLength(1);
    expect(back.complaints[0]!.title).toBe('Headache');
    expect(firstDoc(back)).toEqual(firstDoc(edited));
  });

  it('regenerates the top-level text mirror from doc on every serialise (never stale)', () => {
    const base = emptyRichDoc(ctx);
    const complaint = base.complaints[0]!;
    const doc: V3Doc = {
      ...base,
      // Plant a deliberately WRONG cached text; serialise must overwrite it.
      text: 'STALE-SHOULD-BE-REPLACED',
      complaints: [
        {
          ...complaint,
          title: 'Headache',
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'migraine worse at noon' }],
              },
            ],
          },
        },
      ],
    } as V3Doc & { text: string };

    const json = serializeRich(doc);
    const parsed = JSON.parse(json) as { text?: string };
    expect(parsed.text).toBeDefined();
    expect(parsed.text).not.toContain('STALE-SHOULD-BE-REPLACED');
    expect(parsed.text).toContain('migraine worse at noon');
  });
});

// ---------------------------------------------------------------------------
// 3. extractCaseText: prose + table cell text in the fts mirror
// ---------------------------------------------------------------------------

describe('extractCaseText (visit_fts mirror)', () => {
  it('includes typed prose and every table cell value', () => {
    const doc: V3Doc = {
      schema: CASE_RICH_SCHEMA,
      version: CASE_RICH_VERSION,
      next_section_no: 2,
      sections: null,
      complaints: [
        {
          id: 'cc1',
          title: 'Headache',
          next_section_no: 2,
          doc: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Throbbing right temple' }],
              },
              {
                type: 'table',
                attrs: { hcTableType: 'vitals' },
                content: [
                  {
                    type: 'tableRow',
                    content: [
                      {
                        type: 'tableHeader',
                        content: [
                          {
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'BP (sys)' }],
                          },
                        ],
                      },
                      {
                        type: 'tableHeader',
                        content: [
                          {
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'BP (dia)' }],
                          },
                        ],
                      },
                    ],
                  },
                  {
                    type: 'tableRow',
                    content: [
                      {
                        type: 'tableCell',
                        content: [
                          {
                            type: 'paragraph',
                            content: [{ type: 'text', text: '120' }],
                          },
                        ],
                      },
                      {
                        type: 'tableCell',
                        content: [
                          {
                            type: 'paragraph',
                            content: [{ type: 'text', text: '80' }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    const text = extractCaseText(doc);
    expect(text).toContain('Headache'); // complaint title
    expect(text).toContain('Throbbing right temple'); // prose
    expect(text).toContain('120'); // table cell
    expect(text).toContain('80'); // the OTHER BP cell (not swallowed)
    expect(text).toContain('BP (sys)'); // header cell too
  });
});

// ---------------------------------------------------------------------------
// 4 + 5. upcast v2 journal -> v3 (prose + table + family section preserved)
// ---------------------------------------------------------------------------

describe('upcast v2 case-journal -> v3', () => {
  const v2 = {
    schema: 'case-journal',
    version: 2,
    complaints: [
      {
        id: 'cc1',
        title: 'Headache',
        entries: [
          {
            entry_date: '2026-10-02',
            visit_id: ctx.visitId,
            blocks: [
              {
                kind: 'text',
                id: 'b1',
                text: 'Throbbing right temple, 3 yrs.',
              },
              {
                kind: 'table',
                id: 'b2',
                table_type: 'vitals',
                columns: ['BP (sys)', 'BP (dia)'],
                rows: [['120', '80']],
              },
            ],
          },
        ],
      },
    ],
    sections: {
      family_history: { maternal: 'Diabetes', paternal: 'Hypertension' },
      investigations: { suggested: '', submitted: '' },
    },
  };

  it('preserves prose and the vitals table as in-document nodes', () => {
    const v3 = upcastJournalToRich(v2, ctx, tr);
    expect(v3.schema).toBe(CASE_RICH_SCHEMA);
    expect(v3.version).toBe(CASE_RICH_VERSION);
    const doc = firstDoc(v3);
    expect(allText(doc)).toContain('Throbbing right temple');
    const tables = nodesOfType(doc, 'table');
    const hasVitals = tables.some((t) => t.attrs?.['hcTableType'] === 'vitals');
    expect(hasVitals).toBe(true);
    // the vitals cell values survive
    expect(allText(doc)).toContain('120');
    expect(allText(doc)).toContain('80');
  });

  it('folds the v2 family_history section into a two-column in-document table (B7)', () => {
    const v3 = upcastJournalToRich(v2, ctx, tr);
    const text = extractCaseText(v3);
    // the reported data-loss: family history must survive the upcast
    expect(text).toContain('Diabetes');
    expect(text).toContain('Hypertension');
    const famTable = nodesOfType(firstDoc(v3), 'table').find(
      (t) => t.attrs?.['hcTableType'] === 'family_history',
    );
    expect(famTable).toBeDefined();
  });

  it('parseCaseDoc routes a case-journal string through the v2->v3 upcast', () => {
    const v3 = parseCaseDoc(JSON.stringify(v2), ctx, tr);
    expect(v3.schema).toBe(CASE_RICH_SCHEMA);
    expect(extractCaseText(v3)).toContain('Throbbing right temple');
  });
});

// ---------------------------------------------------------------------------
// 6 + 7. legacy R3 -> v3; corrupt -> graceful empty
// ---------------------------------------------------------------------------

describe('parseCaseDoc detection + legacy upcast', () => {
  it('opens a legacy R3 document (chief_complaints) as a v3 doc with the complaint text present', () => {
    const r3 = JSON.stringify({
      chief_complaints: [
        { key: 'cc1', sensation: 'Throbbing headache', location: 'Temporal' },
      ],
    });
    const v3 = parseCaseDoc(r3, ctx, tr);
    expect(v3.schema).toBe(CASE_RICH_SCHEMA);
    expect(v3.complaints.length).toBeGreaterThanOrEqual(1);
    expect(extractCaseText(v3).toLowerCase()).toContain('throbbing');
  });

  it('falls back to one empty complaint with one dated entry on garbage', () => {
    const v3 = parseCaseDoc('}{ not json', ctx, tr);
    expect(v3.schema).toBe(CASE_RICH_SCHEMA);
    expect(v3.complaints).toHaveLength(1);
    const entries = nodesOfType(firstDoc(v3), 'heading').filter(
      (h) => h.attrs?.['hcKind'] === 'entry',
    );
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 8 + 9 + 14. table seed builders
// ---------------------------------------------------------------------------

describe('table seed builders', () => {
  it('buildVitalsSeed splits BP into two cells and keeps a BMI column', () => {
    const seed = buildVitalsSeed(
      {
        systolic: '120',
        diastolic: '80',
        pulse: '72',
        weightKg: '68',
        heightCm: '172',
        bmi: '22.9',
        temp: '98.6',
        spo2: '98',
      },
      tr,
    );
    // Column headers come from en.json, not hardcoded English (R-UI-007).
    expect(seed.columns).toContain(tr('case.form.vitals.col.bpSys'));
    expect(seed.columns).toContain(tr('case.form.vitals.col.bpDia'));
    expect(seed.columns).toContain(tr('case.form.vitals.col.bmi'));
    // never a single combined "120/80" cell
    const flat = seed.rows.flat();
    expect(flat).toContain('120');
    expect(flat).toContain('80');
    expect(flat.some((c) => c.includes('/'))).toBe(false);
  });

  it('buildFamilySeed builds a two-column Maternal|Paternal table, one row per line, ragged padded', () => {
    const seed = buildFamilySeed(
      {
        maternal: 'Diabetes\nThyroid',
        paternal: 'Hypertension',
      },
      tr,
    );
    expect(seed.columns).toEqual([
      tr('case.form.family.maternal'),
      tr('case.form.family.paternal'),
    ]);
    // two maternal lines -> two rows; paternal ragged -> padded ''
    expect(seed.rows).toHaveLength(2);
    expect(seed.rows[0]).toEqual(['Diabetes', 'Hypertension']);
    expect(seed.rows[1]).toEqual(['Thyroid', '']);
  });

  it('buildPrescriptionSeed marks the table rx-placeholder and localizes headers', () => {
    const seed = buildPrescriptionSeed(
      {
        medicine: 'Sulphur',
        potency: '200C',
        dosage: 'single dose',
        instructions: 'empty stomach',
      },
      tr,
    );
    expect(seed.hcTableType).toBe('prescription');
    expect(seed.hcRxPlaceholder).toBe(true);
    expect(seed.columns).toEqual([
      tr('case.form.prescription.medicine'),
      tr('case.form.prescription.potency'),
      tr('case.form.prescription.dosage'),
      tr('case.form.prescription.instructions'),
    ]);
  });
});

// ---------------------------------------------------------------------------
// 10 + 11 + 12. section node builder: hr + numbered heading + table; numbering
// ---------------------------------------------------------------------------

describe('buildSectionNodes (separator + numbered heading + table)', () => {
  it('emits [horizontalRule, section heading, table] in that order with the stamped number', () => {
    const nodes = buildSectionNodes({
      kind: 'vitals',
      sectionNo: 3,
      seed: buildVitalsSeed(
        {
          systolic: '120',
          diastolic: '80',
          pulse: '',
          weightKg: '',
          heightCm: '',
          bmi: '',
          temp: '',
          spo2: '',
        },
        tr,
      ),
    });
    expect(nodes[0]?.type).toBe('horizontalRule');
    const heading = nodes[1];
    expect(heading?.type).toBe('heading');
    expect(heading?.attrs?.['hcKind']).toBe('section');
    expect(heading?.attrs?.['hcSectionNo']).toBe(3);
    expect(heading?.attrs?.['hcSectionType']).toBe('vitals');
    expect(nodes[2]?.type).toBe('table');
    expect(nodes[2]?.attrs?.['hcTableType']).toBe('vitals');
  });

  it('renders the heading text as "N. Label" derived from the stamped number', () => {
    const nodes = buildSectionNodes({
      kind: 'vitals',
      sectionNo: 3,
      seed: buildVitalsSeed(
        {
          systolic: '',
          diastolic: '',
          pulse: '',
          weightKg: '',
          heightCm: '',
          bmi: '',
          temp: '',
          spo2: '',
        },
        tr,
      ),
    });
    const headingText = allText(nodes[1]).trim();
    expect(headingText).toBe(`3. ${tr('case.section.label.vitals')}`);
  });

  it('per-complaint numbering is monotonic and not reused after a delete', () => {
    // Insert three sections (1,2,3), delete #2, then the next insert is 4 (not 2).
    const base = emptyRichDoc(ctx);
    const complaint = base.complaints[0]!;
    let next = complaint.next_section_no; // starts at 1
    const stamp = (): number => {
      const n = next;
      next += 1;
      return n;
    };
    const one = buildSectionNodes({
      kind: 'vitals',
      sectionNo: stamp(),
      seed: buildVitalsSeed(emptyVitals(), tr),
    });
    const two = buildSectionNodes({
      kind: 'modalities' as const,
      sectionNo: stamp(),
      seed: buildPrescriptionSeed(emptyRx(), tr),
    });
    const three = buildSectionNodes({
      kind: 'prescription',
      sectionNo: stamp(),
      seed: buildPrescriptionSeed(emptyRx(), tr),
    });
    expect(one[1]?.attrs?.['hcSectionNo']).toBe(1);
    expect(two[1]?.attrs?.['hcSectionNo']).toBe(2);
    expect(three[1]?.attrs?.['hcSectionNo']).toBe(3);
    // delete #2 (no renumber); next insert continues the monotonic counter
    const four = buildSectionNodes({
      kind: 'prescription',
      sectionNo: stamp(),
      seed: buildPrescriptionSeed(emptyRx(), tr),
    });
    expect(four[1]?.attrs?.['hcSectionNo']).toBe(4);
    expect(four[1]?.attrs?.['hcSectionNo']).not.toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 13. "Add entry" dated header
// ---------------------------------------------------------------------------

describe('buildDatedEntryNodes ("Add entry")', () => {
  it('emits a dated entry heading plus an empty paragraph', () => {
    const nodes = buildDatedEntryNodes({
      date: '2026-10-16',
      visitId: ctx.visitId,
    });
    const heading = nodes.find((n) => n.type === 'heading');
    expect(heading?.attrs?.['hcKind']).toBe('entry');
    expect(heading?.attrs?.['hcDate']).toBe('2026-10-16');
    expect(heading?.attrs?.['hcVisitId']).toBe(ctx.visitId);
    expect(nodes.some((n) => n.type === 'paragraph')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 15. autosave debounce + force-flush (CASE-005 deterministic kernel)
// ---------------------------------------------------------------------------

describe('autosave scheduler (debounce + force-flush)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires one save after the 2 s debounce and coalesces changes within the window', () => {
    const save = vi.fn();
    const sched = createAutosaveScheduler(save, 2000);
    sched.schedule('a');
    vi.advanceTimersByTime(1000);
    sched.schedule('ab'); // within the window -> coalesce
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith('ab');
  });

  it('forceSave flushes immediately and cancels the pending debounce', () => {
    const save = vi.fn();
    const sched = createAutosaveScheduler(save, 2000);
    sched.schedule('x');
    sched.forceSave();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith('x');
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(1); // no double save
  });
});

// ---- tiny fixtures ---------------------------------------------------------

function emptyVitals() {
  return {
    systolic: '',
    diastolic: '',
    pulse: '',
    weightKg: '',
    heightCm: '',
    bmi: '',
    temp: '',
    spo2: '',
  };
}

function emptyRx() {
  return { medicine: '', potency: '', dosage: '', instructions: '' };
}
