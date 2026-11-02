// RED unit tests for the M3-RWv3 COMPLAINT-SECTION restructure of the v3
// `case-rich` editor — the PURE builders/serialisation (ADR 0019 "Increment
// M3-RWv3"; .worklog/HC-MVP1-M3/handoffs/M3-RWv3-complaint-sections.md).
//
// CUT: the existing pure module `apps/desktop/src/case/caseRich.ts`, EXTENDED
// per the spec with:
//   - `buildComplaintHeaderNode` (NEW)       — the numbered complaint header.
//   - `buildDatedEntryNodes({complaintName,kind})` (EXTENDED) — name/kind headers.
//   - `buildNewComplaintNodes` (NEW)         — header + its first dated entry.
//   - `entryHeadingText` (NEW)               — localisable "<name>[-follow-up] — date".
//   - `splitSpineToComplaints` / `joinComplaintsToSpine` (NEW, rep a).
//   - `currentComplaintId` (NEW)             — resolve caret → complaint id.
//   - extended `extractCaseText` + upcast normalisation.
//
// These named exports do not exist yet, so vitest (esbuild) transpiles the file
// but the calls resolve to `undefined` and throw / assert false — the RED comes
// from the real CUT being incomplete, never from a stand-in. The only values
// imported from production are the REAL `caseRich.ts` and the REAL typed `t`
// (a dependency, R-TEST-002); nothing is faked.
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect } from 'vitest';

import { t as tr } from '@/shared/strings';
import { formatDate, todayIsoDate } from '@/shared/datetime';

import {
  // already-landed v3 surface
  serializeRich,
  parseCaseDoc,
  extractCaseText,
  upcastJournalToRich,
  CASE_RICH_SCHEMA,
  CASE_RICH_VERSION,
  type V3Doc,
  type RichComplaint,
  type ProseMirrorNode,
  type RichVisitContext,
  // NEW / EXTENDED RWv3 builders (absent at red)
  buildComplaintHeaderNode,
  buildDatedEntryNodes,
  buildNewComplaintNodes,
  entryHeadingText,
  splitSpineToComplaints,
  joinComplaintsToSpine,
  currentComplaintId,
} from './caseRich';

const ctx: RichVisitContext = {
  visitId: '0192aa00-0000-7000-8000-000000000001',
  visitAt: '2026-10-02T09:00:00Z',
};

// ---- structural helpers over the opaque ProseMirror doc --------------------

/** Flatten every text leaf under a node into one space-joined string. */
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

/** Heading nodes carrying a given `hcKind`. */
function headingsOfKind(
  root: ProseMirrorNode,
  kind: string,
): ProseMirrorNode[] {
  return nodesOfType(root, 'heading').filter(
    (h) => h.attrs?.['hcKind'] === kind,
  );
}

/** The today date as the editor would render it (DD-MM-YYYY). */
function todayDisplay(): string {
  const iso = todayIsoDate();
  return formatDate(`${iso}T00:00:00`) ?? iso;
}

/** An entry heading node (level 2, hcKind=entry) carrying name + kind + date. */
function entryHeading(
  name: string,
  kind: 'first' | 'follow_up',
  date: string,
): ProseMirrorNode {
  return {
    type: 'heading',
    attrs: {
      level: 2,
      hcKind: 'entry',
      hcEntryKind: kind,
      hcComplaintName: name,
      hcDate: date,
      hcVisitId: ctx.visitId,
    },
    content: [{ type: 'text', text: entryHeadingText(name, kind, date, tr) }],
  };
}

/** A two-complaint v3 document (each complaint has a first entry + prose). */
function twoComplaintDoc(): V3Doc {
  const headache: RichComplaint = {
    id: 'cc1',
    title: 'Headache',
    next_section_no: 1,
    doc: {
      type: 'doc',
      content: [
        entryHeading('Headache', 'first', '2026-10-02'),
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Throbbing right temple.' }],
        },
        entryHeading('Headache', 'follow_up', '2026-10-16'),
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Improved after Sulphur.' }],
        },
      ],
    },
  };
  const acidity: RichComplaint = {
    id: 'cc2',
    title: 'Acidity',
    next_section_no: 1,
    doc: {
      type: 'doc',
      content: [
        entryHeading('Acidity', 'first', '2026-10-20'),
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Burning after meals.' }],
        },
      ],
    },
  };
  return {
    schema: CASE_RICH_SCHEMA,
    version: CASE_RICH_VERSION,
    complaints: [headache, acidity],
    next_section_no: 1,
    sections: null,
  };
}

// ---------------------------------------------------------------------------
// P1. multi-complaint round-trip
// ---------------------------------------------------------------------------

describe('RWv3 multi-complaint serialize / parse round-trip', () => {
  it('round-trips TWO complaint sections (each with entries) equal through serialize -> parse', () => {
    const doc = twoComplaintDoc();

    const json = serializeRich(doc);
    const back = parseCaseDoc(json, ctx, tr);

    expect(back.schema).toBe(CASE_RICH_SCHEMA);
    expect(back.version).toBe(CASE_RICH_VERSION);
    // both complaints survive, in order, with no loss
    expect(back.complaints).toHaveLength(2);
    expect(back.complaints[0]!.title).toBe('Headache');
    expect(back.complaints[1]!.title).toBe('Acidity');
    expect(back.complaints[0]!.doc).toEqual(doc.complaints[0]!.doc);
    expect(back.complaints[1]!.doc).toEqual(doc.complaints[1]!.doc);
  });
});

// ---------------------------------------------------------------------------
// P2 + P11. spine split/join inverse; 1-based document-order numbering
// ---------------------------------------------------------------------------

describe('RWv3 spine <-> complaints[] (representation a)', () => {
  it('joinComplaintsToSpine then splitSpineToComplaints is identity over two complaints', () => {
    const doc = twoComplaintDoc();

    const spine = joinComplaintsToSpine(doc.complaints);
    const split = splitSpineToComplaints(spine);

    expect(split).toHaveLength(2);
    expect(split[0]!.id).toBe('cc1');
    expect(split[0]!.title).toBe('Headache');
    expect(split[1]!.id).toBe('cc2');
    expect(split[1]!.title).toBe('Acidity');
    // the entries stay attached to the right complaint (no cross-attribution)
    expect(allText(split[0]!.doc)).toContain('Throbbing right temple');
    expect(allText(split[0]!.doc)).toContain('Improved after Sulphur');
    expect(allText(split[1]!.doc)).toContain('Burning after meals');
    expect(allText(split[0]!.doc)).not.toContain('Burning after meals');
  });

  it('the spine numbers complaint headers 1,2 in document order (h1, hcKind=complaint)', () => {
    const spine = joinComplaintsToSpine(twoComplaintDoc().complaints);
    const headers = headingsOfKind(spine, 'complaint');
    expect(headers).toHaveLength(2);
    expect(headers[0]!.attrs?.['hcComplaintNo']).toBe(1);
    expect(headers[1]!.attrs?.['hcComplaintNo']).toBe(2);
    expect(headers[0]!.attrs?.['level']).toBe(1);
    expect(headers[0]!.attrs?.['hcComplaintId']).toBe('cc1');
    expect(headers[1]!.attrs?.['hcComplaintId']).toBe('cc2');
    // rendered text is "N. name"
    expect(allText(headers[0]).trim()).toBe('1. Headache');
    expect(allText(headers[1]).trim()).toBe('2. Acidity');
  });
});

// ---------------------------------------------------------------------------
// P3. buildComplaintHeaderNode
// ---------------------------------------------------------------------------

describe('buildComplaintHeaderNode', () => {
  it('builds an h1 complaint header with the number, id and "N. name" text', () => {
    const node = buildComplaintHeaderNode({
      complaintNo: 2,
      complaintId: 'cc2',
      name: 'Acidity',
    });
    expect(node.type).toBe('heading');
    expect(node.attrs?.['hcKind']).toBe('complaint');
    expect(node.attrs?.['level']).toBe(1);
    expect(node.attrs?.['hcComplaintNo']).toBe(2);
    expect(node.attrs?.['hcComplaintId']).toBe('cc2');
    expect(allText(node).trim()).toBe('2. Acidity');
  });
});

// ---------------------------------------------------------------------------
// P4. buildNewComplaintNodes (the "Add new complaint" kernel)
// ---------------------------------------------------------------------------

describe('buildNewComplaintNodes ("Add new complaint" kernel)', () => {
  it('emits a complaint header + a FIRST dated entry headed "<name> — <today>" + a caret paragraph', () => {
    const today = todayIsoDate();
    const nodes = buildNewComplaintNodes({
      complaintNo: 1,
      complaintId: 'cc1',
      name: 'Migraine',
      date: today,
      visitId: ctx.visitId,
    });

    const header = nodes.find((n) => n.attrs?.['hcKind'] === 'complaint');
    expect(header, 'a complaint header must be emitted').toBeDefined();
    expect(header!.attrs?.['hcComplaintNo']).toBe(1);
    expect(allText(header).trim()).toBe('1. Migraine');

    const entry = nodes.find((n) => n.attrs?.['hcKind'] === 'entry');
    expect(entry, 'the complaint must start with a dated entry').toBeDefined();
    // the first entry is a "first" entry, NOT a follow-up
    expect(entry!.attrs?.['hcEntryKind']).toBe('first');
    expect(entry!.attrs?.['hcComplaintName']).toBe('Migraine');
    expect(allText(entry).trim()).toBe(`Migraine — ${todayDisplay()}`);

    // a caret paragraph follows so the doctor lands with somewhere to type
    expect(nodes.some((n) => n.type === 'paragraph')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P5 + P6. extended buildDatedEntryNodes (first vs follow-up)
// ---------------------------------------------------------------------------

describe('buildDatedEntryNodes with complaintName + kind', () => {
  it('a FIRST entry header is "<name> — <date>" (no -follow-up suffix)', () => {
    const nodes = buildDatedEntryNodes({
      date: '2026-10-16',
      visitId: ctx.visitId,
      complaintName: 'Headache',
      kind: 'first',
    });
    const heading = nodes.find((n) => n.type === 'heading');
    expect(heading?.attrs?.['hcKind']).toBe('entry');
    expect(heading?.attrs?.['hcEntryKind']).toBe('first');
    expect(heading?.attrs?.['hcComplaintName']).toBe('Headache');
    const text = allText(heading).trim();
    expect(text).toContain('Headache');
    expect(text).not.toContain('-follow-up');
    expect(text).toContain('16-10-2026');
  });

  it('a FOLLOW-UP entry header is "<name>-follow-up — <date>" and carries hcEntryKind=follow_up', () => {
    const nodes = buildDatedEntryNodes({
      date: '2026-10-16',
      visitId: ctx.visitId,
      complaintName: 'Headache',
      kind: 'follow_up',
    });
    const heading = nodes.find((n) => n.type === 'heading');
    expect(heading?.attrs?.['hcKind']).toBe('entry');
    expect(heading?.attrs?.['hcEntryKind']).toBe('follow_up');
    expect(heading?.attrs?.['hcComplaintName']).toBe('Headache');
    expect(allText(heading).trim()).toBe('Headache-follow-up — 16-10-2026');
    expect(nodes.some((n) => n.type === 'paragraph')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P7. entryHeadingText composes via localisable en.json keys (R-UI-007)
// ---------------------------------------------------------------------------

describe('entryHeadingText (localisable composition)', () => {
  it('first entry = name + dateSeparator + date; follow-up appends followupSuffix before the separator', () => {
    const date = '2026-10-16';
    const sep = tr('case.form.entry.dateSeparator');
    const suffix = tr('case.form.entry.followupSuffix');

    expect(entryHeadingText('Headache', 'first', date, tr)).toBe(
      `Headache${sep}16-10-2026`,
    );
    expect(entryHeadingText('Headache', 'follow_up', date, tr)).toBe(
      `Headache${suffix}${sep}16-10-2026`,
    );

    // the suffix/separator come from en.json, not hardcoded English literals
    expect(suffix).toBe('-follow-up');
    expect(sep).toBe(' — ');
  });
});

// ---------------------------------------------------------------------------
// P8. upcast: single-complaint v3 -> complaint #1, entries normalised, no loss
// ---------------------------------------------------------------------------

describe('RWv3 upcast of an existing single-complaint v3 doc', () => {
  // An existing v3 doc: one complaint, a legacy entry heading with NO
  // hcEntryKind / hcComplaintName (as shipped before RWv3), plus prose.
  const legacyV3 = {
    schema: CASE_RICH_SCHEMA,
    version: CASE_RICH_VERSION,
    next_section_no: 1,
    sections: null,
    complaints: [
      {
        id: 'cc1',
        title: 'Headache',
        next_section_no: 1,
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

  it('opens the single complaint as section #1 with no content lost', () => {
    const v3 = parseCaseDoc(JSON.stringify(legacyV3), ctx, tr);
    expect(v3.schema).toBe(CASE_RICH_SCHEMA);
    expect(v3.complaints).toHaveLength(1);
    expect(v3.complaints[0]!.title).toBe('Headache');
    // the prose is preserved
    expect(allText(v3.complaints[0]!.doc)).toContain('Throbbing right temple');
    // the single complaint is complaint number 1 in the spine
    const spine = joinComplaintsToSpine(v3.complaints);
    const headers = headingsOfKind(spine, 'complaint');
    expect(headers).toHaveLength(1);
    expect(headers[0]!.attrs?.['hcComplaintNo']).toBe(1);
  });

  it('normalises the legacy entry to hcEntryKind=first + hcComplaintName=title', () => {
    const v3 = parseCaseDoc(JSON.stringify(legacyV3), ctx, tr);
    const entries = headingsOfKind(v3.complaints[0]!.doc, 'entry');
    expect(entries).toHaveLength(1);
    // a missing hcEntryKind must be back-filled to "first"
    expect(entries[0]!.attrs?.['hcEntryKind']).toBe('first');
    expect(entries[0]!.attrs?.['hcComplaintName']).toBe('Headache');
  });
});

// ---------------------------------------------------------------------------
// P9. upcast: v2 case-journal still opens, each entry stamped first + name
// ---------------------------------------------------------------------------

describe('RWv3 upcast of a legacy v2 case-journal', () => {
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
            blocks: [{ kind: 'text', id: 'b1', text: 'Throbbing temple.' }],
          },
        ],
      },
    ],
    sections: {},
  };

  it('still opens and stamps each entry hcEntryKind=first + hcComplaintName', () => {
    const v3 = upcastJournalToRich(v2, ctx, tr);
    expect(v3.schema).toBe(CASE_RICH_SCHEMA);
    expect(allText(v3.complaints[0]!.doc)).toContain('Throbbing temple');
    const entries = headingsOfKind(v3.complaints[0]!.doc, 'entry');
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]!.attrs?.['hcEntryKind']).toBe('first');
    expect(entries[0]!.attrs?.['hcComplaintName']).toBe('Headache');
  });
});

// ---------------------------------------------------------------------------
// P10. fts mirror covers BOTH complaint names and both entry headers
// ---------------------------------------------------------------------------

describe('extractCaseText covers complaint + entry headers (visit_fts)', () => {
  it('contains both complaint names and the first + follow-up entry headers', () => {
    const text = extractCaseText(twoComplaintDoc());
    // both complaint names searchable
    expect(text).toContain('Headache');
    expect(text).toContain('Acidity');
    // the follow-up header (incl the suffix) is searchable
    expect(text).toContain('Headache-follow-up');
    // the entry dates survive into the mirror
    expect(text).toContain('16-10-2026');
    expect(text).toContain('20-10-2026');
    // prose from the SECOND complaint is not dropped
    expect(text).toContain('Burning after meals');
  });
});

// ---------------------------------------------------------------------------
// P12. currentComplaintId resolves the nearest preceding complaint header,
//      measured in REAL ProseMirror positions (the scale the live editor
//      actually passes: `editor.state.selection.head`). A prior version of this
//      test fed `JSON.stringify(spine).length`-scaled carets the editor never
//      produces, which MASKED a resolver that walked serialised-string lengths
//      and collapsed every real caret onto complaint #1 (E2E build-10).
// ---------------------------------------------------------------------------

/**
 * The ProseMirror `nodeSize` of a JSON node — the SAME model `Node.nodeSize`
 * uses on a live doc: a text leaf spans its string length; any other leaf spans
 * 1; a block spans `2 + Σ child sizes`. Mirrors the production helper so the
 * test computes carets in the position scale the editor emits.
 */
function pmNodeSize(node: ProseMirrorNode): number {
  if (node.type === 'text') return node.text?.length ?? 0;
  const children = node.content ?? [];
  if (children.length === 0) return 1;
  let inner = 0;
  for (const child of children) inner += pmNodeSize(child);
  return inner + 2;
}

/**
 * Start position of the top-level complaint header whose `hcComplaintId` is
 * `id`, in real ProseMirror positions (first top-level child starts at pos 0;
 * each child advances the cursor by its `nodeSize`).
 */
function complaintHeaderStart(spine: ProseMirrorNode, id: string): number {
  let pos = 0;
  for (const node of spine.content ?? []) {
    if (
      node.type === 'heading' &&
      node.attrs?.['hcKind'] === 'complaint' &&
      node.attrs?.['hcComplaintId'] === id
    ) {
      return pos;
    }
    pos += pmNodeSize(node);
  }
  throw new Error(`complaint header ${id} not found in spine`);
}

describe('currentComplaintId (caret -> owning complaint)', () => {
  it('resolves a caret INSIDE the second complaint (real PM position) to cc2', () => {
    const spine = joinComplaintsToSpine(twoComplaintDoc().complaints);
    // A real ProseMirror caret a few positions past the start of complaint #2's
    // header — i.e. inside the Acidity section. This is a SMALL integer on the
    // nodeSize scale the live editor uses, NOT a JSON-string length. Against the
    // old JSON.stringify-length resolver `cursor` jumps into the thousands after
    // node 0 so `cursor <= caret` is only ever true for cc1 -> this FAILS; the
    // nodeSize resolver returns cc2 -> this PASSES.
    const cc2Start = complaintHeaderStart(spine, 'cc2');
    expect(currentComplaintId(spine, cc2Start + 3)).toBe('cc2');
    // the exact start of the cc2 header also belongs to cc2
    expect(currentComplaintId(spine, cc2Start)).toBe('cc2');
  });

  it('resolves a caret inside the FIRST complaint (real PM position) to cc1', () => {
    const spine = joinComplaintsToSpine(twoComplaintDoc().complaints);
    const cc1Start = complaintHeaderStart(spine, 'cc1');
    const cc2Start = complaintHeaderStart(spine, 'cc2');
    // any caret at/after cc1 but strictly before cc2 is owned by cc1
    expect(currentComplaintId(spine, cc1Start + 2)).toBe('cc1');
    expect(currentComplaintId(spine, cc2Start - 1)).toBe('cc1');
  });

  it('resolves a caret near the start to the first complaint cc1', () => {
    const spine = joinComplaintsToSpine(twoComplaintDoc().complaints);
    expect(currentComplaintId(spine, 1)).toBe('cc1');
  });
});
