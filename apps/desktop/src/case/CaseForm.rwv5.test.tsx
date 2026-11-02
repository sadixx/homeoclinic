// RED component tests for the M3-RWv5 case-form batch, using the REAL
// <CaseForm /> wired through the real caseRich.ts / caseRichEditor.ts / TipTap:
//
//  (A) ONE TABLE PER TYPE PER ENTRY, for ALL six Record buttons. Two Records
//      of the same type in the same entry leave ONE table of that type with
//      both rows. After "Add follow-up entry", a Record creates a NEW table
//      inside the follow-up entry and later Records append there. The prior
//      entry's table is untouched. "Add follow-up entry" must therefore leave
//      the caret in the new entry, so the next Record targets it.
//  (C) No numeric section prefixes: vitals + modalities never both show "2".
//      A bullet marker is shown instead. A fresh case shows no
//      "Untitled complaint" section.
//
// Assertions read the autosaved v3 payload (`caseVisitAutosave.dataJson`),
// which the CaseForm flushes immediately after every Record. The only fake is
// the typed bindings dependency (`vi.mock('@/bindings')`). Real timers are
// used, and no clinical/PII values are logged. New en.json keys are not
// referenced via `t()`, so a missing key fails an assertion and does not break
// type-checking.
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const {
  openOrCreate,
  autosave,
  pickReportFile,
  attachReport,
  listAttachments,
  openAttachment,
  deleteAttachment,
  setNextFollowup,
  patientListAttachments,
} = vi.hoisted(() => ({
  openOrCreate: vi.fn(),
  autosave: vi.fn(),
  pickReportFile: vi.fn(),
  attachReport: vi.fn(),
  listAttachments: vi.fn(),
  openAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  setNextFollowup: vi.fn(),
  patientListAttachments: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    caseVisitOpenOrCreate: openOrCreate,
    caseVisitAutosave: autosave,
    visitPickReportFile: pickReportFile,
    visitAttachReport: attachReport,
    visitListAttachments: listAttachments,
    visitOpenAttachment: openAttachment,
    visitDeleteAttachment: deleteAttachment,
    visitSetNextFollowup: setNextFollowup,
    patientListAttachments,
  },
}));

import { CaseForm } from './CaseForm';

function oneComplaintRichDoc(): unknown {
  return {
    schema: 'case-rich',
    version: 3,
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
                hcEntryKind: 'first',
                hcComplaintName: 'Headache',
                hcDate: '2026-10-24',
                hcVisitId: 'v-1',
              },
              content: [{ type: 'text', text: 'Headache — 24-10-2026' }],
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
}

function openResp(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    visitId: 'v-1',
    templateId: 'journal_default',
    dataJson: JSON.stringify(oneComplaintRichDoc()),
    vitalsJson: '{}',
    visitAt: '2026-10-24T09:00:00Z',
    nextFollowupOn: null,
    ...overrides,
  };
}

beforeEach(() => {
  openOrCreate.mockReset();
  openOrCreate.mockResolvedValue(openResp());
  autosave.mockReset();
  autosave.mockResolvedValue({ savedAt: '2026-10-24T09:00:30Z' });
  listAttachments.mockReset();
  listAttachments.mockResolvedValue({ attachments: [] });
  patientListAttachments.mockReset();
  patientListAttachments.mockResolvedValue({ attachments: [] });
  pickReportFile.mockReset();
  pickReportFile.mockResolvedValue({ sourcePath: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderForm(): void {
  render(<CaseForm patientId="p-123" visitId="v-1" sex="male" ageYears={34} />);
}

async function waitForEditor(): Promise<HTMLElement> {
  return screen.findByTestId('case-form-editor-cc1', undefined, {
    timeout: 1500,
  });
}

// ---- saved-payload helpers ---------------------------------------------------

type Json = Record<string, unknown>;

function lastSavedContent(): Json[] {
  const last = autosave.mock.calls.at(-1);
  if (last === undefined) throw new Error('caseVisitAutosave was never called');
  const saved = JSON.parse((last[0] as { dataJson: string }).dataJson) as Json;
  const complaints = (saved['complaints'] as Json[] | undefined) ?? [];
  const out: Json[] = [];
  for (const c of complaints) {
    const doc = c['doc'] as Json | undefined;
    for (const n of (doc?.['content'] as Json[] | undefined) ?? []) out.push(n);
  }
  return out;
}

function attrs(n: Json): Json {
  return (n['attrs'] as Json | undefined) ?? {};
}

function flatText(node: unknown): string {
  if (node === null || typeof node !== 'object') return '';
  const n = node as Json;
  let s =
    n['type'] === 'text' && typeof n['text'] === 'string'
      ? (n['text'] as string)
      : '';
  const content = n['content'];
  if (Array.isArray(content)) for (const c of content) s += ` ${flatText(c)}`;
  return s;
}

function isEntry(n: Json): boolean {
  return n['type'] === 'heading' && attrs(n)['hcKind'] === 'entry';
}

/** Tables of `kind` per entry (index = doc-order entry number). */
function tablesPerEntry(content: Json[], kind: string): Json[][] {
  const per: Json[][] = [];
  for (const n of content) {
    if (isEntry(n)) {
      per.push([]);
      continue;
    }
    if (n['type'] === 'table' && attrs(n)['hcTableType'] === kind) {
      if (per.length === 0) per.push([]);
      per[per.length - 1]!.push(n);
    }
  }
  return per;
}

function sectionHeadingTexts(content: Json[]): string[] {
  return content
    .filter((n) => n['type'] === 'heading' && attrs(n)['hcKind'] === 'section')
    .map((n) => flatText(n).trim());
}

// ---- the six Record flows (popup open -> type a marker -> confirm) ----------

interface RecordFlow {
  readonly kind: string;
  readonly open: string;
  readonly input: string;
  readonly confirm: string;
}

const FLOWS: readonly RecordFlow[] = [
  {
    kind: 'vitals',
    open: 'case-form-record-vitals',
    input: 'case-vitals-bp-sys',
    confirm: 'case-form-record-vitals-confirm',
  },
  {
    kind: 'modalities',
    open: 'case-form-modalities',
    input: 'case-modalities-factor',
    confirm: 'case-form-modalities-confirm',
  },
  {
    kind: 'family_history',
    open: 'case-form-record-family',
    input: 'case-form-family-maternal-input',
    confirm: 'case-form-record-family-confirm',
  },
  {
    kind: 'physical_generals',
    open: 'case-form-record-generals',
    input: 'case-generals-appetite',
    confirm: 'case-form-record-generals-confirm',
  },
  {
    kind: 'investigations',
    open: 'case-form-record-investigations',
    input: 'case-investigations-name',
    confirm: 'case-form-record-investigations-confirm',
  },
  {
    kind: 'prescription',
    open: 'case-form-add-prescription',
    input: 'case-rx-medicine',
    confirm: 'case-form-add-prescription-confirm',
  },
];

function record(flow: RecordFlow, marker: string): void {
  fireEvent.click(screen.getByTestId(flow.open));
  fireEvent.change(screen.getByTestId(flow.input), {
    target: { value: marker },
  });
  fireEvent.click(screen.getByTestId(flow.confirm));
}

// Numeric-looking markers so the vitals BP field (numeric) accepts them too.
const M1 = '111';
const M2 = '122';
const F1 = '133';
const F2 = '144';

// ===========================================================================
// (A) one table per type per entry — all six Record buttons
// ===========================================================================

describe.each(FLOWS)('CaseForm RWv5 A — one $kind table per entry', (flow) => {
  it('two Records in the same entry leave ONE table of that type carrying both rows', async () => {
    renderForm();
    await waitForEditor();

    record(flow, M1);
    record(flow, M2);

    await waitFor(() => {
      const per = tablesPerEntry(lastSavedContent(), flow.kind);
      const all = per.flat();
      expect(all, `exactly one ${flow.kind} table in the entry`).toHaveLength(
        1,
      );
      const txt = flatText(all[0]);
      expect(txt).toContain(M1);
      expect(txt).toContain(M2);
    });
  });

  it('after "Add follow-up entry", Records create a NEW table in the follow-up (prior table untouched) and then append there', async () => {
    renderForm();
    await waitForEditor();

    record(flow, M1);
    fireEvent.click(screen.getByTestId('case-form-add-followup-entry'));
    record(flow, F1);
    record(flow, F2);

    await waitFor(() => {
      const per = tablesPerEntry(lastSavedContent(), flow.kind);
      expect(
        per.length,
        'first entry + follow-up entry',
      ).toBeGreaterThanOrEqual(2);
      const first = per[0]!;
      const follow = per[per.length - 1]!;
      expect(first, 'one table in the first entry').toHaveLength(1);
      expect(follow, 'one NEW table in the follow-up entry').toHaveLength(1);
      expect(flatText(first[0])).toContain(M1);
      expect(flatText(first[0]), 'prior entry table untouched').not.toContain(
        F1,
      );
      expect(flatText(first[0])).not.toContain(F2);
      expect(flatText(follow[0])).toContain(F1);
      expect(flatText(follow[0])).toContain(F2);
    });
  });
});

describe('CaseForm RWv5 A — prescription append keeps the Rx placeholder marker', () => {
  it('an appended prescription table is still flagged hcRxPlaceholder=true', async () => {
    renderForm();
    await waitForEditor();
    const rx = FLOWS.find((f) => f.kind === 'prescription')!;
    record(rx, 'Arnica');
    record(rx, 'Bryonia');

    await waitFor(() => {
      const tables = tablesPerEntry(lastSavedContent(), 'prescription').flat();
      expect(tables).toHaveLength(1);
      expect(attrs(tables[0]!)['hcRxPlaceholder']).toBe(true);
    });
  });
});

// ===========================================================================
// (C) no numeric section prefixes; bullets; vitals + modalities never both "2"
// ===========================================================================

describe('CaseForm RWv5 C — record section headings carry a bullet, not a number', () => {
  it('recording vitals then modalities: neither heading has "<n>. " and they never both show "2"', async () => {
    renderForm();
    await waitForEditor();
    record(FLOWS[0]!, '120');
    record(FLOWS[1]!, 'Cold');

    await waitFor(() => {
      const texts = sectionHeadingTexts(lastSavedContent());
      expect(texts).toHaveLength(2);
      for (const text of texts) {
        expect(text, `"${text}" must not have a numeric prefix`).not.toMatch(
          /^\s*\d+\.\s/,
        );
        expect(text, `"${text}" must start with a bullet marker`).toMatch(
          /^\s*[•●▪◦‣]/,
        );
      }
      expect(texts.filter((s) => /\b2\b/.test(s))).toHaveLength(0);
    });
  });

  it('the rendered editor shows no "<n>. Vitals" / "<n>. Modalities" text', async () => {
    renderForm();
    const region = await waitForEditor();
    record(FLOWS[0]!, '120');
    record(FLOWS[1]!, 'Cold');
    await waitFor(() => {
      const headings = Array.from(
        region.querySelectorAll('[data-hc-kind="section"]'),
      );
      expect(headings.length).toBe(2);
      for (const h of headings)
        expect(h.textContent ?? '').not.toMatch(/^\s*\d+\.\s/);
    });
  });
});

// ===========================================================================
// (C) a fresh case shows NO "Untitled complaint" section
// ===========================================================================

describe('CaseForm RWv5 C — a fresh case has no "Untitled complaint" sample', () => {
  it.each([
    ['empty data_json', ''],
    ['an empty object', '{}'],
  ])(
    'opening a fresh case (%s) renders no "Untitled complaint" text',
    async (_label, dataJson) => {
      openOrCreate.mockResolvedValue(openResp({ dataJson }));
      renderForm();
      const region = await waitForEditor();
      // let TipTap render the initial content
      await waitFor(() =>
        expect(region.querySelector('.ProseMirror')).not.toBeNull(),
      );
      expect(region.textContent ?? '').not.toMatch(/untitled complaint/i);
      expect(screen.getByTestId('case-form').textContent ?? '').not.toMatch(
        /untitled complaint/i,
      );
    },
  );
});
