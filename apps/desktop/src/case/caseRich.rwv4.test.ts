// RED unit tests for the M3-RWv4 refinement batch — the PURE helpers of the v3
// `case-rich` module (ADR 0019 "Increment M3-RWv4";
// .worklog/HC-MVP1-M3/handoffs/M3-RWv4-design.md).
//
// CUT: the existing pure module `apps/desktop/src/case/caseRich.ts`, EXTENDED
// per the RWv4 spec with NEW exports that do NOT exist yet:
//   - `appendRowsToTable(table, rows)`        (B4, §4) — append body rows to a table.
//   - `buildModalityRows(values)`             (B4, §4) — row-shaping helper.
//   - `removeComplaint(spine, complaintId)`   (C6, §6) — drop + renumber.
//   - `removeEntry(spine, complaintId, idx)`  (C6, §6) — drop one entry.
//   - `sanitizeDisplayLabel(name, patient, date)` (D5, §5.5) — display label.
//   - `buildInvestigationLinkRow({attachmentId, cells})` (D5, §5.3) — link row.
//
// esbuild/vitest transpiles the file even though these named exports are absent;
// the missing exports resolve to `undefined` at runtime so the calls throw /
// assert false — the RED comes from the real CUT being incomplete, never from a
// stand-in. The only values imported from production are the REAL `caseRich.ts`
// and the REAL typed `t` (a dependency, R-TEST-002); nothing is faked.
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect } from 'vitest';

import { t as tr } from '@/shared/strings';

import {
  // already-landed v3 surface
  serializeRich,
  parseCaseDoc,
  extractCaseText,
  joinComplaintsToSpine,
  splitSpineToComplaints,
  CASE_RICH_SCHEMA,
  CASE_RICH_VERSION,
  type V3Doc,
  type RichComplaint,
  type ProseMirrorNode,
  type RichVisitContext,
  // NEW / EXTENDED RWv4 helpers (absent at red)
  appendRowsToTable,
  buildModalityRows,
  removeComplaint,
  removeEntry,
  sanitizeDisplayLabel,
  buildInvestigationLinkRow,
} from './caseRich';

const ctx: RichVisitContext = {
  visitId: '0192aa00-0000-7000-8000-000000000001',
  visitAt: '2026-10-02T09:00:00Z',
};

// ---- structural helpers over the opaque ProseMirror doc --------------------

function allText(node: ProseMirrorNode | undefined): string {
  if (node === undefined) return '';
  let out =
    node.type === 'text' && typeof node.text === 'string' ? node.text : '';
  for (const child of node.content ?? []) out += ` ${allText(child)}`;
  return out;
}

function nodesOfType(root: ProseMirrorNode, type: string): ProseMirrorNode[] {
  const found: ProseMirrorNode[] = [];
  const walk = (n: ProseMirrorNode): void => {
    if (n.type === type) found.push(n);
    for (const c of n.content ?? []) walk(c);
  };
  walk(root);
  return found;
}

function headingsOfKind(
  root: ProseMirrorNode,
  kind: string,
): ProseMirrorNode[] {
  return nodesOfType(root, 'heading').filter(
    (h) => h.attrs?.['hcKind'] === kind,
  );
}

/** An entry heading node carrying the RWv4 attrs. */
function entryHeading(
  name: string,
  kind: 'first' | 'follow_up',
  date: string,
  display: string,
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
    content: [{ type: 'text', text: display }],
  };
}

/** A modalities table seeded with one body row (factor/agg/amel). */
function modalitiesTable(rows: string[][]): ProseMirrorNode {
  const cell = (v: string): ProseMirrorNode => ({
    type: 'tableCell',
    content: [
      v === ''
        ? { type: 'paragraph' }
        : { type: 'paragraph', content: [{ type: 'text', text: v }] },
    ],
  });
  const header: ProseMirrorNode = {
    type: 'tableRow',
    content: ['Factor', 'Aggravation', 'Amelioration'].map((h) => ({
      type: 'tableHeader',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: h }] }],
    })),
  };
  const body: ProseMirrorNode[] = rows.map((r) => ({
    type: 'tableRow',
    content: r.map(cell),
  }));
  return {
    type: 'table',
    attrs: { hcTableType: 'modalities' },
    content: [header, ...body],
  };
}

/** A two-complaint v3 doc used by the C6 removal tests. */
function threeComplaintDoc(): V3Doc {
  const mk = (
    id: string,
    title: string,
    date: string,
    prose: string,
  ): RichComplaint => ({
    id,
    title,
    next_section_no: 1,
    doc: {
      type: 'doc',
      content: [
        entryHeading(title, 'first', date, `${title} — ${date}`),
        { type: 'paragraph', content: [{ type: 'text', text: prose }] },
      ],
    },
  });
  return {
    schema: CASE_RICH_SCHEMA,
    version: CASE_RICH_VERSION,
    complaints: [
      mk('cc1', 'Headache', '2026-10-02', 'Throbbing right temple.'),
      mk('cc2', 'Acidity', '2026-10-10', 'Burning after meals.'),
      mk('cc3', 'Insomnia', '2026-10-18', 'Wakes at 3am.'),
    ],
    next_section_no: 1,
    sections: null,
  };
}

// ===========================================================================
// A3 — list nodes round-trip + fts
// ===========================================================================

describe('RWv4 A3 — bullet / ordered list nodes round-trip and reach the fts mirror', () => {
  function docWithLists(): V3Doc {
    const bullet: ProseMirrorNode = {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Aching joints' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Stiff neck' }],
            },
          ],
        },
      ],
    };
    const ordered: ProseMirrorNode = {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Morning dose' }],
            },
          ],
        },
      ],
    };
    const complaint: RichComplaint = {
      id: 'cc1',
      title: 'Arthritis',
      next_section_no: 1,
      doc: {
        type: 'doc',
        content: [
          entryHeading(
            'Arthritis',
            'first',
            '2026-10-02',
            'Arthritis — 02-10-2026',
          ),
          bullet,
          ordered,
        ],
      },
    };
    return {
      schema: CASE_RICH_SCHEMA,
      version: CASE_RICH_VERSION,
      complaints: [complaint],
      next_section_no: 1,
      sections: null,
    };
  }

  it('serialize -> parse preserves bulletList / orderedList / listItem nodes byte-identically (version stays 3)', () => {
    const doc = docWithLists();
    const back = parseCaseDoc(serializeRich(doc), ctx, tr);
    expect(back.version).toBe(CASE_RICH_VERSION); // 3, no bump
    const restored = back.complaints[0]!.doc;
    expect(nodesOfType(restored, 'bulletList')).toHaveLength(1);
    expect(nodesOfType(restored, 'orderedList')).toHaveLength(1);
    expect(nodesOfType(restored, 'listItem')).toHaveLength(3);
    expect(restored).toEqual(doc.complaints[0]!.doc);
  });

  it('list item text appears in extractCaseText (searchable via visit_fts)', () => {
    const text = extractCaseText(docWithLists());
    expect(text).toContain('Aching joints');
    expect(text).toContain('Stiff neck');
    expect(text).toContain('Morning dose');
  });
});

// ===========================================================================
// B4 — appendRowsToTable / buildModalityRows (pure)
// ===========================================================================

describe('RWv4 B4 — appendRowsToTable appends body rows to the SAME table', () => {
  it('returns a table with the header kept and the new body rows added (count grows, type unchanged)', () => {
    const table = modalitiesTable([['Cold', 'Worse', 'Better in warmth']]);
    const before = nodesOfType(table, 'tableRow').length; // header + 1 body = 2

    const grown = appendRowsToTable(table, [
      ['Motion', 'Worse', ''],
      ['Rest', '', 'Better'],
    ]);

    expect(grown.type).toBe('table');
    expect(grown.attrs?.['hcTableType']).toBe('modalities');
    const after = nodesOfType(grown, 'tableRow').length;
    expect(after).toBe(before + 2); // two rows appended
    // header row stays first and intact
    const rows = ((grown.content ?? []) as ProseMirrorNode[]).filter(
      (n: ProseMirrorNode) => n.type === 'tableRow',
    );
    expect(allText(rows[0]!)).toContain('Factor');
    // the appended cells are present
    expect(allText(grown)).toContain('Motion');
    expect(allText(grown)).toContain('Rest');
    // the original row survives (append, not replace)
    expect(allText(grown)).toContain('Cold');
  });

  it('buildModalityRows shapes popup values into tableRow nodes carrying the cell text', () => {
    const rows = buildModalityRows({
      factor: 'Thunderstorm',
      agg: 'Worse before',
      amel: 'Better after rain',
    });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect(r.type).toBe('tableRow');
    const joined = rows.map(allText).join(' ');
    expect(joined).toContain('Thunderstorm');
    expect(joined).toContain('Worse before');
    expect(joined).toContain('Better after rain');
  });
});

// ===========================================================================
// C6 — removeComplaint / removeEntry (pure doc transforms over the spine)
// ===========================================================================

describe('RWv4 C6 — removeComplaint drops the complaint and renumbers the rest', () => {
  it('removing the middle complaint leaves the other two, renumbered 1 and 2 in doc order', () => {
    const spine = joinComplaintsToSpine(threeComplaintDoc().complaints);
    const next = removeComplaint(spine, 'cc2');

    const headers = headingsOfKind(next, 'complaint');
    expect(headers).toHaveLength(2);
    // Acidity (cc2) gone; its prose gone too
    expect(allText(next)).not.toContain('Burning after meals');
    expect(allText(next)).toContain('Throbbing right temple');
    expect(allText(next)).toContain('Wakes at 3am');
    // the remaining two are renumbered 1,2 in document order
    expect(headers[0]!.attrs?.['hcComplaintNo']).toBe(1);
    expect(headers[1]!.attrs?.['hcComplaintNo']).toBe(2);
    expect(allText(headers[0]).trim()).toBe('1. Headache');
    expect(allText(headers[1]).trim()).toBe('2. Insomnia');
  });

  it('removing the LAST remaining complaint never drops below one complaint (leaves one empty complaint)', () => {
    const single: V3Doc = {
      schema: CASE_RICH_SCHEMA,
      version: CASE_RICH_VERSION,
      complaints: [threeComplaintDoc().complaints[0]!],
      next_section_no: 1,
      sections: null,
    };
    const spine = joinComplaintsToSpine(single.complaints);
    const next = removeComplaint(spine, 'cc1');
    const complaints = splitSpineToComplaints(next);
    expect(complaints.length).toBeGreaterThanOrEqual(1);
    // the fallback complaint carries at least one (first) entry so the editor
    // is never empty
    expect(headingsOfKind(next, 'entry').length).toBeGreaterThanOrEqual(1);
  });
});

describe('RWv4 C6 — removeEntry drops one entry and keeps its siblings', () => {
  it('removes a single entry heading + its following nodes, leaving the other entries intact', () => {
    // A complaint with two entries (first + follow-up).
    const complaint: RichComplaint = {
      id: 'cc1',
      title: 'Headache',
      next_section_no: 1,
      doc: {
        type: 'doc',
        content: [
          entryHeading(
            'Headache',
            'first',
            '2026-10-02',
            'Headache — 02-10-2026',
          ),
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'First note.' }],
          },
          entryHeading(
            'Headache',
            'follow_up',
            '2026-10-16',
            'Headache-follow-up — 16-10-2026',
          ),
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Follow-up note.' }],
          },
        ],
      },
    };
    const doc: V3Doc = {
      schema: CASE_RICH_SCHEMA,
      version: CASE_RICH_VERSION,
      complaints: [complaint],
      next_section_no: 1,
      sections: null,
    };
    const spine = joinComplaintsToSpine(doc.complaints);
    // remove the SECOND entry (index 1 within the complaint, the follow-up)
    const next = removeEntry(spine, 'cc1', 1);

    const entries = headingsOfKind(next, 'entry');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.attrs?.['hcEntryKind']).toBe('first');
    expect(allText(next)).toContain('First note.');
    expect(allText(next)).not.toContain('Follow-up note.');
  });
});

// ===========================================================================
// D5 — sanitizeDisplayLabel + hcInvestigationLink row round-trip + fts
// ===========================================================================

describe('RWv4 D5 — sanitizeDisplayLabel composes a safe display-only label', () => {
  it('composes <investigation>-<patient>-<date> with path separators / control chars stripped and whitespace collapsed', () => {
    const label = sanitizeDisplayLabel(
      'CBC / Blood\tcount',
      '../Test Patient 001',
      '24-10-2026',
    );
    // the compose order is investigation, patient, date
    expect(label).toContain('CBC');
    expect(label).toContain('Test Patient 001'.replace(/\s+/g, '-'));
    expect(label).toContain('24-10-2026');
    // NO path separators survive (not a filename, not a path — R-PRIV-007)
    expect(label).not.toContain('/');
    expect(label).not.toContain('\\');
    // no raw control characters survive (asserted WITHOUT a control-char regex
    // literal — iterate code points so `no-control-regex` never fires)
    expect(
      [...label].every((c) => {
        const cp = c.codePointAt(0)!;
        return cp >= 0x20 && cp !== 0x7f;
      }),
    ).toBe(true);
    // no leading dot (prevents a hidden-file-looking label)
    expect(label.startsWith('.')).toBe(false);
  });

  it('caps the label length (a pathologically long name cannot produce an unbounded label)', () => {
    const label = sanitizeDisplayLabel(
      'x'.repeat(5000),
      'y'.repeat(5000),
      '24-10-2026',
    );
    expect(label.length).toBeLessThanOrEqual(255);
  });
});

describe('RWv4 D5 — hcInvestigationLink table row is additive and round-trips (version stays 3)', () => {
  function docWithLinkRow(): V3Doc {
    const linkRow = buildInvestigationLinkRow({
      attachmentId: '0192bb00-0000-7000-8000-000000000009',
      cells: ['CBC-Test Patient 001-24-10-2026', 'Submitted'],
    });
    const invTable: ProseMirrorNode = {
      type: 'table',
      attrs: { hcTableType: 'investigations' },
      content: [
        {
          type: 'tableRow',
          content: ['Investigation', 'Status'].map((h) => ({
            type: 'tableHeader',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: h }] },
            ],
          })),
        },
        linkRow,
      ],
    };
    const complaint: RichComplaint = {
      id: 'cc1',
      title: 'Fever',
      next_section_no: 2,
      doc: {
        type: 'doc',
        content: [
          entryHeading('Fever', 'first', '2026-10-24', 'Fever — 24-10-2026'),
          invTable,
        ],
      },
    };
    return {
      schema: CASE_RICH_SCHEMA,
      version: CASE_RICH_VERSION,
      complaints: [complaint],
      next_section_no: 2,
      sections: null,
    };
  }

  it('buildInvestigationLinkRow carries attrs.hcInvestigationLink = { attachmentId } and the display-label cells', () => {
    const row = buildInvestigationLinkRow({
      attachmentId: 'att-1',
      cells: ['CBC-Test Patient 001-24-10-2026', 'Submitted'],
    });
    expect(row.type).toBe('tableRow');
    const link = row.attrs?.['hcInvestigationLink'] as
      | { attachmentId?: string }
      | undefined;
    expect(link?.attachmentId).toBe('att-1');
    expect(allText(row)).toContain('CBC-Test Patient 001-24-10-2026');
  });

  it('a link row round-trips through serialize -> parse with the link attr intact and version still 3', () => {
    const doc = docWithLinkRow();
    const back = parseCaseDoc(serializeRich(doc), ctx, tr);
    expect(back.version).toBe(CASE_RICH_VERSION); // 3 — additive, no bump
    const rows = nodesOfType(back.complaints[0]!.doc, 'tableRow');
    const linked = rows.find((r) => r.attrs?.['hcInvestigationLink'] != null);
    expect(linked, 'the link row must survive the round-trip').toBeDefined();
    const link = linked!.attrs?.['hcInvestigationLink'] as {
      attachmentId?: string;
    };
    expect(link.attachmentId).toBe('0192bb00-0000-7000-8000-000000000009');
  });

  it('the link-row display label reaches the fts mirror (searchable)', () => {
    const text = extractCaseText(docWithLinkRow());
    expect(text).toContain('CBC-Test Patient 001-24-10-2026');
  });

  it('a row WITHOUT hcInvestigationLink is not treated as a link row (absence => null, backward tolerant)', () => {
    const plainRow: ProseMirrorNode = {
      type: 'tableRow',
      content: [
        {
          type: 'tableCell',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'X-ray' }] },
          ],
        },
      ],
    };
    // round-tripping a doc whose only table row has no link attr must keep it
    // null/absent (no accidental default link)
    const complaint: RichComplaint = {
      id: 'cc1',
      title: 'Cough',
      next_section_no: 1,
      doc: {
        type: 'doc',
        content: [
          entryHeading('Cough', 'first', '2026-10-24', 'Cough — 24-10-2026'),
          {
            type: 'table',
            attrs: { hcTableType: 'investigations' },
            content: [plainRow],
          },
        ],
      },
    };
    const doc: V3Doc = {
      schema: CASE_RICH_SCHEMA,
      version: CASE_RICH_VERSION,
      complaints: [complaint],
      next_section_no: 1,
      sections: null,
    };
    const back = parseCaseDoc(serializeRich(doc), ctx, tr);
    const row = nodesOfType(back.complaints[0]!.doc, 'tableRow')[0]!;
    const link = row.attrs?.['hcInvestigationLink'];
    expect(link == null).toBe(true);
  });
});
