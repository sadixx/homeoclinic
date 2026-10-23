// RED component + unit tests for the M3-RW doctor-journal case form
// (ADR 0018 / docs/ui/S08-case-form.md revised / M3-RW-data-json-schema.md v2
// `case-journal`). CUT: the REAL <CaseForm /> journal component in this module
// and the REAL exported pure function `upcastLegacyCaseData` it uses on open.
//
// The ONLY fake is the dependency: the typed Tauri bindings
// (`vi.mock('@/bindings')`, R-TEST-002) — never the component. Mock fns are
// created with `vi.hoisted` so they are reachable inside the hoisted
// `vi.mock` factory (the established pattern, see CaseForm.test.tsx). Every
// control / asserted value carries its revised-S08 spec data-testid
// (R-UI-003).
//
// Red-first state: the current CaseForm is the OLD structured template engine
// (no journal box, no dated entries, no inserted tables, Case summary still
// present) and `upcastLegacyCaseData` is not exported, so these tests compile
// (vitest transpiles; a missing named export resolves to `undefined` at
// runtime) and FAIL on assertions — not at import. After hc-ui-dev implements
// the journal they must pass.
//
// v2 case-journal shape under visit.data_json (opaque to the backend):
//   { schema:"case-journal", version:2,
//     complaints:[ { id, title, entries:[ { entry_date, visit_id,
//       blocks:[ {kind:"text",id,text} | {kind:"table",id,table_type,
//                 rx_placeholder?,columns[],rows[][]} ] } ] } ],
//     sections:{ physical_generals, family_history:{maternal,paternal},
//                investigations:{suggested,submitted}, ... } }
//
// Autosave uses fireEvent.change + vi.useFakeTimers where the 2 s debounce is
// asserted (NOT user.type): userEvent v14 schedules keystrokes on the event
// loop, which deadlocks under fake timers + React 18 (the known deadlock, see
// CaseForm.test.tsx). fireEvent.change exercises the same onChange ->
// scheduleSave path the real control fires.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const {
  openOrCreate,
  templateGetDefault,
  templateList,
  autosave,
  pickReportFile,
  attachReport,
  listAttachments,
  openAttachment,
  deleteAttachment,
} = vi.hoisted(() => ({
  openOrCreate: vi.fn(),
  templateGetDefault: vi.fn(),
  templateList: vi.fn(),
  autosave: vi.fn(),
  pickReportFile: vi.fn(),
  attachReport: vi.fn(),
  listAttachments: vi.fn(),
  openAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    caseVisitOpenOrCreate: openOrCreate,
    caseTemplateGetDefault: templateGetDefault,
    caseTemplateList: templateList,
    caseVisitAutosave: autosave,
    visitPickReportFile: pickReportFile,
    visitAttachReport: attachReport,
    visitListAttachments: listAttachments,
    visitOpenAttachment: openAttachment,
    visitDeleteAttachment: deleteAttachment,
  },
}));

import { CaseForm, upcastLegacyCaseData } from './CaseForm';
import type { Complaint, Entry, JournalDoc } from './caseJournal';

// The revised side-sections-only template schema the journal form renders
// (ADR 0018 #6): the body is NOT schema-driven any more; the template only
// describes the structured side sections.
const SIDE_SECTIONS_SCHEMA = {
  version: 2,
  sections: [
    {
      key: 'physical_generals',
      title: 'Physical generals',
      fields: [
        { key: 'appetite', label: 'Appetite', type: 'text' },
        { key: 'thermal', label: 'Thermal state', type: 'text' },
        { key: 'constitution', label: 'Constitution', type: 'text' },
        { key: 'diet', label: 'Diet', type: 'text' },
        { key: 'sun_aggravation', label: 'Sun aggravation', type: 'text' },
        { key: 'notes', label: 'Notes', type: 'long-text' },
      ],
    },
    { key: 'family_history', title: 'Family history', fields: [] },
    { key: 'investigations', title: 'Investigations', fields: [] },
    {
      key: 'provisional_diagnosis',
      title: 'Provisional diagnosis',
      fields: [
        { key: 'dx', label: 'Provisional diagnosis', type: 'long-text' },
      ],
    },
  ],
};

const DEFAULT_TEMPLATE = {
  templateId: 'journal_default',
  name: 'Journal',
  schemaJson: JSON.stringify(SIDE_SECTIONS_SCHEMA),
};

/** Empty v2 journal document (one empty complaint, one dated entry). */
function emptyJournalDoc() {
  return {
    schema: 'case-journal',
    version: 2,
    complaints: [
      {
        id: 'cc1',
        title: '',
        entries: [{ entry_date: '2026-10-16', visit_id: 'v-1', blocks: [] }],
      },
    ],
    sections: {},
  };
}

/** A populated v2 doc used for the round-trip and editability tests. */
function populatedJournalDoc() {
  return {
    schema: 'case-journal',
    version: 2,
    complaints: [
      {
        id: 'cc1',
        title: 'Headache',
        entries: [
          {
            entry_date: '2026-10-02',
            visit_id: 'v-1',
            blocks: [
              {
                kind: 'text',
                id: 'b1',
                text: 'Throbbing right temple, 3 yrs, gradual onset.',
              },
              {
                kind: 'table',
                id: 'b2',
                table_type: 'vitals',
                columns: [
                  'BP (sys)',
                  'BP (dia)',
                  'Pulse',
                  'Weight (kg)',
                  'Height (cm)',
                  'BMI',
                  'Temp',
                  'SpO2',
                ],
                rows: [['120', '80', '72', '68', '172', '22.9', '98.6', '98']],
              },
              {
                kind: 'table',
                id: 'b3',
                table_type: 'prescription',
                rx_placeholder: true,
                columns: ['Medicine', 'Potency', 'Dosage', 'Instructions'],
                rows: [['Belladonna', '200C', 'single dose', 'SOS']],
              },
            ],
          },
        ],
      },
    ],
    sections: {
      physical_generals: { thermal: 'Chilly' },
      family_history: { maternal: 'Diabetes', paternal: 'Hypertension' },
      investigations: { suggested: '1. CBC', submitted: '1. CBC (attached)' },
    },
  };
}

/** A legacy R3 structured data_json (schema !== "case-journal"). */
function legacyR3Doc() {
  return {
    // No `schema`/`version:2` and a `chief_complaints` array => legacy R3.
    chief_complaints: [
      {
        location: 'right temple',
        sensation: 'Throbbing',
        agg: '11am-3pm sun',
        amel: 'cool room',
        concomitants: 'nausea',
        duration: '3 yrs',
        onset: 'gradual',
      },
    ],
    hpi: { narrative: 'Started after exam stress.' },
    physical_generals: { appetite: 'good', thermal: 'Chilly' },
    family_history: { narrative: 'Diabetes in mother' },
    investigations: { narrative: '1. CBC' },
    personal_history: { narrative: 'smoker' },
  };
}

function openResp(overrides: Record<string, unknown> = {}) {
  return {
    visitId: 'v-1',
    templateId: 'journal_default',
    dataJson: JSON.stringify(emptyJournalDoc()),
    vitalsJson: '{}',
    visitAt: '2026-10-16T10:42:00Z',
    nextFollowupOn: '2026-11-16',
    ...overrides,
  };
}

/** Render the journal form as a FIRST case by default (34y male). */
function renderForm(props: Record<string, unknown> = {}) {
  return render(
    <CaseForm
      patientId="p-123"
      visitId="v-1"
      sex="male"
      ageYears={34}
      {...props}
    />,
  );
}

beforeEach(() => {
  templateGetDefault.mockReset();
  templateGetDefault.mockResolvedValue(DEFAULT_TEMPLATE);
  templateList.mockReset();
  templateList.mockResolvedValue({
    templates: [{ id: 'journal_default', name: 'Journal', isDefault: true }],
  });
  openOrCreate.mockReset();
  openOrCreate.mockResolvedValue(openResp());
  autosave.mockReset();
  autosave.mockResolvedValue({ savedAt: '2026-10-16T10:42:30Z' });
  pickReportFile.mockReset();
  pickReportFile.mockResolvedValue({ sourcePath: '/tmp/lab-report.pdf' });
  attachReport.mockReset();
  attachReport.mockResolvedValue({
    attachmentId: 'att-1',
    mime: 'application/pdf',
    sha256: 'a'.repeat(64),
    originalName: 'lab-report.pdf',
    byteSize: 12_345,
  });
  listAttachments.mockReset();
  listAttachments.mockResolvedValue({ attachments: [] });
  openAttachment.mockReset();
  openAttachment.mockResolvedValue({
    mime: 'application/pdf',
    originalName: 'lab-report.pdf',
    dataBase64: 'JVBERi0=',
  });
  deleteAttachment.mockReset();
  deleteAttachment.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Parse the data_json of the most recent autosave call. */
function lastSavedDoc(): JournalDoc {
  const calls = autosave.mock.calls;
  const last = calls.at(-1);
  if (last === undefined) throw new Error('autosave was never called');
  return JSON.parse(last[0].dataJson) as JournalDoc;
}

/** The first complaint of a saved/parsed doc (throws if the fixture has none). */
function firstComplaint(doc: JournalDoc): Complaint {
  const c = doc.complaints[0];
  if (c === undefined) throw new Error('document has no complaints');
  return c;
}

/** The first dated entry of a complaint (throws if the fixture has none). */
function firstEntry(complaint: Complaint): Entry {
  const e = complaint.entries[0];
  if (e === undefined) throw new Error('complaint has no entries');
  return e;
}

/** Find a table block in a complaint by its table_type across all entries. */
function findTable(
  complaint: Complaint,
  tableType: string,
): Extract<Entry['blocks'][number], { kind: 'table' }> | undefined {
  for (const entry of complaint.entries) {
    for (const block of entry.blocks) {
      if (block.kind === 'table' && block.table_type === tableType) {
        return block;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// (1) data_json round-trip v2 — serialise the whole doc; reload equals.
// ---------------------------------------------------------------------------
describe('CaseForm (journal) — v2 data_json round-trips (schema §1/§8)', () => {
  it('reloads a populated v2 document and re-serialises it losslessly on save', async () => {
    const doc = populatedJournalDoc();
    openOrCreate.mockResolvedValue(openResp({ dataJson: JSON.stringify(doc) }));
    vi.useFakeTimers();
    renderForm();

    // The restored complaint box renders its prior text + tables.
    await vi.waitFor(() =>
      expect(screen.getByTestId('case-block-cc1-b1')).toBeInTheDocument(),
    );

    // Force a save by editing a text block to a DIFFERENT value than the one
    // the restored block already holds (R-TEST-003): a no-op change would not
    // fire onChange on a controlled textarea, so the autosave — and therefore
    // the data effect this test exists to detect — would never happen. The new
    // text must survive the parse -> edit -> serialise cycle verbatim, and no
    // complaint, entry, block, table or section may be lost around it.
    const editedText = 'Throbbing right temple, now 4 yrs, worse since March.';
    const textBlock = screen.getByTestId('case-block-cc1-b1');
    fireEvent.change(textBlock, { target: { value: editedText } });
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedDoc();
    expect(saved.schema).toBe('case-journal');
    expect(saved.version).toBe(2);
    expect(saved.complaints).toHaveLength(1);
    const savedComplaint = firstComplaint(saved);
    expect(savedComplaint.id).toBe('cc1');
    expect(savedComplaint.title).toBe('Headache');
    expect(savedComplaint.entries).toHaveLength(1);

    const blocks = firstEntry(savedComplaint).blocks;
    expect(blocks).toHaveLength(3);

    // The edited text block carries the NEW value (a real data effect, not the
    // value the block already held).
    const edited = blocks.find((b) => b.id === 'b1');
    expect(edited?.kind).toBe('text');
    expect(edited?.kind === 'text' ? edited.text : '').toBe(editedText);

    const vitals = blocks.find((b) => b.id === 'b2');
    expect(vitals?.kind).toBe('table');
    const vitalsRow0 = vitals?.kind === 'table' ? (vitals.rows[0] ?? []) : [];
    expect(vitals?.kind === 'table' ? vitals.table_type : '').toBe('vitals');
    expect(vitalsRow0).toEqual([
      '120',
      '80',
      '72',
      '68',
      '172',
      '22.9',
      '98.6',
      '98',
    ]);
    const rx = blocks.find((b) => b.id === 'b3');
    expect(rx?.kind === 'table' ? rx.rx_placeholder : undefined).toBe(true);

    // Side sections survive the round-trip too.
    expect(saved.sections.family_history).toEqual({
      maternal: 'Diabetes',
      paternal: 'Hypertension',
    });
  });
});

// ---------------------------------------------------------------------------
// (2) upcastLegacyCaseData — an old R3 structured doc opens as one dated entry.
// ---------------------------------------------------------------------------
describe('upcastLegacyCaseData (schema §7, ADR 0018 #8)', () => {
  it('maps an R3 chief_complaint into one dated text entry so an old visit opens', () => {
    const out = upcastLegacyCaseData(legacyR3Doc(), {
      visitId: 'v-old',
      visitAt: '2026-05-01T09:00:00Z',
    });

    expect(out.schema).toBe('case-journal');
    expect(out.version).toBe(2);
    expect(out.complaints).toHaveLength(1);

    const complaint = firstComplaint(out);
    expect(complaint.id).toBe('cc1');
    // Title derives from the first non-empty of sensation/location.
    expect(complaint.title.length).toBeGreaterThan(0);
    expect(complaint.entries).toHaveLength(1);

    const entry = firstEntry(complaint);
    // The entry is dated from the visit's visit_at (2026-05-01), not today.
    expect(entry.entry_date).toContain('2026-05-01');
    expect(entry.visit_id).toBe('v-old');

    // Exactly one text block carrying the old structured fields as labelled
    // lines; the doctor's prior content is preserved and readable.
    const text = entry.blocks.find((b) => b.kind === 'text');
    expect(text).toBeDefined();
    const textValue = text?.kind === 'text' ? text.text : '';
    expect(textValue).toContain('Throbbing');
    expect(textValue).toContain('right temple');
    expect(textValue).toContain('11am-3pm sun');

    // Surviving structured sections fold into `sections`; family_history
    // narrative becomes the maternal tab with an empty paternal.
    expect(out.sections.family_history.maternal).toContain('Diabetes');
    expect(out.sections.family_history.paternal).toBe('');
    // Investigations narrative becomes the suggested tab.
    expect(out.sections.investigations.suggested).toContain('CBC');
  });

  it('produces one empty complaint + dated entry when chief_complaints is absent', () => {
    const out = upcastLegacyCaseData(
      { physical_generals: { appetite: 'good' } },
      { visitId: 'v-old', visitAt: '2026-05-01T09:00:00Z' },
    );
    expect(out.complaints).toHaveLength(1);
    const complaint = firstComplaint(out);
    expect(complaint.entries).toHaveLength(1);
    expect(firstEntry(complaint).blocks).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// (3) 'Add entry' inserts a new dated header + focuses new content.
// ---------------------------------------------------------------------------
describe('CaseForm (journal) — dated entries / running log (ADR 0018 #2)', () => {
  it("'Add entry' appends a dated header with today's date and a fresh text block", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T09:00:00.000Z'));
    renderForm();

    await vi.waitFor(() =>
      expect(screen.getByTestId('case-form-add-entry')).toBeInTheDocument(),
    );

    // One dated entry to begin with.
    const before = screen.getAllByTestId(/^case-form-entry-cc1-/);
    expect(before).toHaveLength(1);

    fireEvent.click(screen.getByTestId('case-form-add-entry'));

    // A new dated entry header is appended (today, 23-10-2026).
    await vi.waitFor(() => {
      const after = screen.getAllByTestId(/^case-form-entry-cc1-/);
      expect(after.length).toBe(2);
    });
    const headers = screen.getAllByTestId(/^case-form-entry-cc1-/);
    expect(headers.at(-1)!).toHaveTextContent('23-10-2026');
  });

  it("focuses the new entry's text block so the doctor can type immediately", async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-add-entry');

    await user.click(screen.getByTestId('case-form-add-entry'));

    // The newly inserted text block (last text block in cc1) receives focus.
    await waitFor(() => {
      const textBlocks = screen.getAllByTestId(/^case-block-cc1-/);
      expect(textBlocks.at(-1)!).toHaveFocus();
    });
  });
});

// ---------------------------------------------------------------------------
// (4) 'Record vitals' popup (sys+dia two fields) inserts an EDITABLE vitals
//     table; a cell edit flows to autosave.
// ---------------------------------------------------------------------------
describe('CaseForm (journal) — Record vitals popup + editable table (ADR 0018 #3)', () => {
  it('collects systolic and diastolic as TWO fields and inserts an editable vitals table', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-record-vitals');

    await user.click(screen.getByTestId('case-form-record-vitals'));

    // The popup exposes systolic + diastolic as two SEPARATE fields.
    const sys = await screen.findByTestId('case-vitals-bp-sys');
    const dia = screen.getByTestId('case-vitals-bp-dia');
    expect(sys).toBeInTheDocument();
    expect(dia).toBeInTheDocument();

    await user.type(sys, '120');
    await user.type(dia, '80');
    await user.type(screen.getByTestId('case-vitals-weight'), '68');
    await user.type(screen.getByTestId('case-vitals-height'), '172');

    // Record inserts a vitals table block into the current entry.
    await user.click(screen.getByTestId('case-form-record-vitals-confirm'));

    // The inserted vitals table has sys and dia in two distinct cells.
    const bpSysCell = (await screen.findByTestId(
      /^case-cell-cc1-.*-0-0$/,
    )) as HTMLInputElement;
    const bpDiaCell = screen.getByTestId(
      /^case-cell-cc1-.*-0-1$/,
    ) as unknown as HTMLInputElement;
    expect(bpSysCell.value).toBe('120');
    expect(bpDiaCell.value).toBe('80');
  });

  it('computes live BMI from weight + height into a seeded cell (CASE-001)', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-record-vitals');
    await user.click(screen.getByTestId('case-form-record-vitals'));

    await user.type(screen.getByTestId('case-vitals-weight'), '68');
    await user.type(screen.getByTestId('case-vitals-height'), '172');

    // 68 / (1.72^2) = 22.98 -> 22.9 (truncated 1dp), matching the S08 popup.
    expect(screen.getByTestId('case-vitals-bmi')).toHaveTextContent('22.9');
  });

  it('a vitals table cell is editable and the edit flows to the autosave payload', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-record-vitals');
    await user.click(screen.getByTestId('case-form-record-vitals'));
    await user.type(screen.getByTestId('case-vitals-bp-sys'), '120');
    await user.type(screen.getByTestId('case-vitals-bp-dia'), '80');
    await user.click(screen.getByTestId('case-form-record-vitals-confirm'));

    // Edit the systolic cell after insertion — every cell stays editable.
    const sysCell = (await screen.findByTestId(
      /^case-cell-cc1-.*-0-0$/,
    )) as HTMLInputElement;
    await user.clear(sysCell);
    await user.type(sysCell, '130');
    await user.tab(); // blur flushes the autosave

    await waitFor(() => expect(autosave).toHaveBeenCalled());
    const saved = lastSavedDoc();
    const vitalsBlock = findTable(firstComplaint(saved), 'vitals');
    expect(vitalsBlock).toBeDefined();
    expect(vitalsBlock?.rows[0]?.[0]).toBe('130');
  });
});

// ---------------------------------------------------------------------------
// (5) modalities insert -> editable table.
// ---------------------------------------------------------------------------
describe('CaseForm (journal) — modalities table (ADR 0018 #3, schema §4b)', () => {
  it('inserts an editable modalities table (Factor / Aggravation / Amelioration)', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-modalities');

    await user.click(screen.getByTestId('case-form-modalities'));

    // The modalities table's header cells are themselves editable inputs.
    const factorHeader = (await screen.findByTestId(
      /^case-cell-cc1-.*-h-0$/,
    )) as HTMLInputElement;
    expect(factorHeader).toBeInTheDocument();
    await user.clear(factorHeader);
    await user.type(factorHeader, 'Trigger');
    await user.tab();

    await waitFor(() => expect(autosave).toHaveBeenCalled());
    const saved = lastSavedDoc();
    const modalities = findTable(firstComplaint(saved), 'modalities');
    expect(modalities).toBeDefined();
    expect(modalities?.columns[0]).toBe('Trigger');
  });
});

// ---------------------------------------------------------------------------
// (6) 'Add prescription' inserts an editable medicine table marked
//     rx_placeholder:true and visibly labelled a placeholder.
// ---------------------------------------------------------------------------
describe('CaseForm (journal) — prescription placeholder table (ADR 0018 #4)', () => {
  it('inserts an editable Medicine/Potency/Dosage/Instructions table marked rx_placeholder true', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-add-prescription');

    await user.click(screen.getByTestId('case-form-add-prescription'));
    await user.tab(); // flush an autosave so the payload is observable

    await waitFor(() => expect(autosave).toHaveBeenCalled());
    const saved = lastSavedDoc();
    const rx = findTable(firstComplaint(saved), 'prescription');
    expect(rx).toBeDefined();
    // The machine-readable "this is NOT a prescription record" marker.
    expect(rx?.rx_placeholder).toBe(true);
    expect(rx?.columns).toEqual([
      'Medicine',
      'Potency',
      'Dosage',
      'Instructions',
    ]);
  });

  it('visibly labels the prescription table a placeholder (not yet a prescription)', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-add-prescription');

    await user.click(screen.getByTestId('case-form-add-prescription'));

    const hint = await screen.findByTestId('case-form-rx-placeholder-hint');
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent(
      /not yet a prescription|placeholder|preview/i,
    );
  });
});

// ---------------------------------------------------------------------------
// (7) ALL text + table cells editable — edit a cell, assert state/autosave.
// ---------------------------------------------------------------------------
describe('CaseForm (journal) — every block + cell is editable (ADR 0018 #1/#3)', () => {
  it('a restored text block is editable and the edit flows to autosave', async () => {
    openOrCreate.mockResolvedValue(
      openResp({ dataJson: JSON.stringify(populatedJournalDoc()) }),
    );
    const user = userEvent.setup();
    renderForm();
    const textBlock = (await screen.findByTestId(
      'case-block-cc1-b1',
    )) as HTMLTextAreaElement;

    await user.clear(textBlock);
    await user.type(textBlock, 'Updated complaint prose.');
    await user.tab();

    await waitFor(() => expect(autosave).toHaveBeenCalled());
    const saved = lastSavedDoc();
    const text = firstEntry(firstComplaint(saved)).blocks.find(
      (b) => b.id === 'b1',
    );
    expect(text?.kind === 'text' ? text.text : '').toBe(
      'Updated complaint prose.',
    );
  });

  it('a restored table body cell is editable and the edit flows to autosave', async () => {
    openOrCreate.mockResolvedValue(
      openResp({ dataJson: JSON.stringify(populatedJournalDoc()) }),
    );
    const user = userEvent.setup();
    renderForm();
    // The vitals table block b2, row 0, column 0 (BP sys) is an editable cell.
    const cell = (await screen.findByTestId(
      'case-cell-cc1-b2-0-0',
    )) as HTMLInputElement;

    await user.clear(cell);
    await user.type(cell, '125');
    await user.tab();

    await waitFor(() => expect(autosave).toHaveBeenCalled());
    const saved = lastSavedDoc();
    const vitals = firstEntry(firstComplaint(saved)).blocks.find(
      (b) => b.id === 'b2',
    );
    expect(vitals?.kind === 'table' ? vitals.rows[0]?.[0] : undefined).toBe(
      '125',
    );
  });
});

// ---------------------------------------------------------------------------
// (8) explicit Save button force-saves and shows 'Saved'.
// ---------------------------------------------------------------------------
describe('CaseForm (journal) — explicit Save button (ADR 0018 cross-cutting)', () => {
  it('force-saves on Save and shows a Saved indication, alongside autosave', async () => {
    const user = userEvent.setup();
    renderForm();
    const save = await screen.findByTestId('case-form-save');

    await user.click(save);

    // The explicit Save force-flushes through the same autosave command.
    await waitFor(() => expect(autosave).toHaveBeenCalled());
    // The status surfaces "Saved" (the explicit Save shows Saved hh:mm).
    await waitFor(() =>
      expect(screen.getByTestId('case-form-save-status')).toHaveTextContent(
        /saved/i,
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// (9) Case summary button is ABSENT.
// ---------------------------------------------------------------------------
describe('CaseForm (journal) — removals (ADR 0018 #5)', () => {
  it('does not render the Case summary button', async () => {
    renderForm();
    await screen.findByTestId('case-form-add-entry');

    expect(
      screen.queryByTestId('case-form-case-summary'),
    ).not.toBeInTheDocument();
  });

  it('does not render a Personal history section', async () => {
    renderForm();
    await screen.findByTestId('case-form-add-entry');

    expect(
      screen.queryByTestId('case-form-section-personal_history'),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (10) Family history Maternal/Paternal tabs switch INDEPENDENT data.
// ---------------------------------------------------------------------------
describe('CaseForm (journal) — Family history Maternal/Paternal tabs (ADR 0018 #6)', () => {
  it('keeps Maternal and Paternal as two independent fields across tab switches', async () => {
    const user = userEvent.setup();
    renderForm();

    // Open the Family history side section.
    await user.click(
      await screen.findByTestId('case-form-section-family_history'),
    );

    // Maternal tab: type maternal-only text.
    await user.click(
      await screen.findByTestId('case-form-family-maternal-tab'),
    );
    const maternal = (await screen.findByTestId(
      'case-form-family-maternal',
    )) as HTMLTextAreaElement;
    await user.type(maternal, 'Diabetes (mother)');

    // Switch to Paternal tab: a separate field with its own value.
    await user.click(screen.getByTestId('case-form-family-paternal-tab'));
    const paternal = (await screen.findByTestId(
      'case-form-family-paternal',
    )) as HTMLTextAreaElement;
    expect(paternal.value).toBe(''); // independent — not the maternal text
    await user.type(paternal, 'Hypertension (father)');

    // Switch back: the maternal text is unchanged (data did not bleed).
    await user.click(screen.getByTestId('case-form-family-maternal-tab'));
    expect(
      (screen.getByTestId('case-form-family-maternal') as HTMLTextAreaElement)
        .value,
    ).toBe('Diabetes (mother)');
  });
});

// ---------------------------------------------------------------------------
// (11) Investigations Suggested/Submitted tabs; Submitted hosts the PAT-009
//      upload UI.
// ---------------------------------------------------------------------------
describe('CaseForm (journal) — Investigations Suggested/Submitted tabs (ADR 0018 #6)', () => {
  it('shows Suggested and Submitted tabs and hosts the PAT-009 uploader under Submitted', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(
      await screen.findByTestId('case-form-section-investigations'),
    );

    // Suggested tab is a plain text field.
    await user.click(
      await screen.findByTestId('case-form-invest-suggested-tab'),
    );
    expect(
      screen.getByTestId('case-form-invest-suggested'),
    ).toBeInTheDocument();
    // The uploader is NOT under Suggested.
    expect(
      screen.queryByTestId('case-form-investigations-upload'),
    ).not.toBeInTheDocument();

    // Submitted tab hosts the existing PAT-009 upload UI.
    await user.click(screen.getByTestId('case-form-invest-submitted-tab'));
    expect(
      await screen.findByTestId('case-form-investigations-upload'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (11b) Investigations lab-report attachments (PAT-009, HC-MVP1-M3ux3),
// re-homed from the retired structured-form CaseForm.test.tsx onto the journal
// UI. The upload/list/open/remove/error/multiple lifecycle is UNCHANGED; only
// its HOST moved — the uploader now lives UNDER the Investigations 'Submitted'
// tab (ADR 0018 #6 / S08 revised), so every test opens that tab first and then
// drives the SAME `case-form-investigations-*` testids. The only fake is the
// typed bindings (dependencies, not the CUT): visit_pick_report_file ->
// visit_attach_report -> visit_list_attachments, visit_open_attachment,
// visit_delete_attachment. These catch the real bugs a doctor would notice:
// a lost upload, a missing/duplicated report row, a report that won't open, a
// deletion with no confirm, a raw path/stack leaking into an error (R-PRIV-001
// / NFR-033/035).
// ---------------------------------------------------------------------------

/** Open the Investigations side section and switch to the Submitted tab where
 *  the PAT-009 uploader is hosted (S08 revised / ADR 0018 #6). */
async function openSubmittedTab(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(
    await screen.findByTestId('case-form-section-investigations'),
  );
  await user.click(await screen.findByTestId('case-form-invest-submitted-tab'));
  // The uploader is mounted once the Submitted tab is active.
  await screen.findByTestId('case-form-investigations-upload');
}

/** One attachment summary row as the backend returns it. */
function att(overrides: Record<string, unknown> = {}) {
  return {
    attachmentId: 'att-1',
    mime: 'application/pdf',
    caption: null,
    originalName: 'lab-report.pdf',
    byteSize: 12_345,
    createdAt: '2026-10-16T10:42:00Z',
    ...overrides,
  };
}

describe('CaseForm (journal) — Investigations lab-report upload under Submitted (PAT-009)', () => {
  it('shows an empty state with "No reports attached" and the upload action', async () => {
    const user = userEvent.setup();
    listAttachments.mockResolvedValue({ attachments: [] });
    renderForm();
    await openSubmittedTab(user);

    expect(
      await screen.findByTestId('case-form-investigations-empty'),
    ).toHaveTextContent(/no reports attached/i);
    expect(
      screen.getByTestId('case-form-investigations-upload'),
    ).toBeInTheDocument();
  });

  it('lists the visit attachments with original name, a type badge and the caption', async () => {
    const user = userEvent.setup();
    listAttachments.mockResolvedValue({
      attachments: [
        att({
          attachmentId: 'att-pdf',
          mime: 'application/pdf',
          originalName: 'cbc-report.pdf',
          caption: 'CBC 16 Oct',
        }),
        att({
          attachmentId: 'att-img',
          mime: 'image/png',
          originalName: 'ultrasound.png',
          caption: 'USG abdomen',
        }),
      ],
    });
    renderForm();
    await openSubmittedTab(user);

    const list = await screen.findByTestId('case-form-investigations-list');
    expect(list).toBeInTheDocument();

    const item1 = screen.getByTestId('case-form-investigations-item-1');
    expect(item1).toHaveTextContent('cbc-report.pdf');
    expect(item1).toHaveTextContent('CBC 16 Oct');
    expect(
      within(item1).getByTestId('case-form-investigations-badge-1'),
    ).toHaveTextContent(/pdf/i);

    const item2 = screen.getByTestId('case-form-investigations-item-2');
    expect(item2).toHaveTextContent('ultrasound.png');
    expect(item2).toHaveTextContent('USG abdomen');
    expect(
      within(item2).getByTestId('case-form-investigations-badge-2'),
    ).toHaveTextContent(/image/i);

    // The empty state is gone once there are attachments.
    expect(
      screen.queryByTestId('case-form-investigations-empty'),
    ).not.toBeInTheDocument();
  });

  it('uploads a report: picks a file, attaches it, then reloads the list', async () => {
    const user = userEvent.setup();
    pickReportFile.mockResolvedValue({ sourcePath: '/tmp/cbc-report.pdf' });
    attachReport.mockResolvedValue({
      attachmentId: 'att-pdf',
      mime: 'application/pdf',
      sha256: 'b'.repeat(64),
      originalName: 'cbc-report.pdf',
      byteSize: 2_048,
    });
    // First load empty; after the attach the reload returns the new row.
    listAttachments
      .mockResolvedValueOnce({ attachments: [] })
      .mockResolvedValue({
        attachments: [
          att({ attachmentId: 'att-pdf', originalName: 'cbc-report.pdf' }),
        ],
      });
    renderForm();
    await openSubmittedTab(user);
    await screen.findByTestId('case-form-investigations-empty');

    await user.click(screen.getByTestId('case-form-investigations-upload'));

    // The picker is asked for the path; the UI never builds one itself.
    await waitFor(() => expect(pickReportFile).toHaveBeenCalled());
    // The chosen path is handed to the typed attach command for this visit.
    await waitFor(() => expect(attachReport).toHaveBeenCalled());
    const arg = attachReport.mock.calls[0]![0];
    expect(arg.visitId).toBe('v-1');
    expect(arg.sourcePath).toBe('/tmp/cbc-report.pdf');

    // After the attach the list reloads and the new report appears.
    const item = await screen.findByTestId('case-form-investigations-item-1');
    expect(item).toHaveTextContent('cbc-report.pdf');
  });

  it('does not attach when the file picker is cancelled', async () => {
    const user = userEvent.setup();
    pickReportFile.mockResolvedValue({ sourcePath: null });
    renderForm();
    await openSubmittedTab(user);
    await screen.findByTestId('case-form-investigations-empty');

    await user.click(screen.getByTestId('case-form-investigations-upload'));

    await waitFor(() => expect(pickReportFile).toHaveBeenCalled());
    expect(attachReport).not.toHaveBeenCalled();
    // Still the empty state, no error.
    expect(
      screen.getByTestId('case-form-investigations-empty'),
    ).toBeInTheDocument();
  });

  it('opens an attachment through visit_open_attachment', async () => {
    const user = userEvent.setup();
    listAttachments.mockResolvedValue({
      attachments: [att({ attachmentId: 'att-img', mime: 'image/png' })],
    });
    openAttachment.mockResolvedValue({
      mime: 'image/png',
      originalName: 'ultrasound.png',
      dataBase64: 'iVBORw0KGgo=',
    });
    renderForm();
    await openSubmittedTab(user);
    await screen.findByTestId('case-form-investigations-item-1');

    await user.click(screen.getByTestId('case-form-investigations-open-1'));

    await waitFor(() =>
      expect(openAttachment).toHaveBeenCalledWith({ attachmentId: 'att-img' }),
    );
  });

  it('removes an attachment after a confirm, then reloads the list', async () => {
    const user = userEvent.setup();
    listAttachments
      .mockResolvedValueOnce({
        attachments: [att({ attachmentId: 'att-pdf' })],
      })
      .mockResolvedValue({ attachments: [] });
    renderForm();
    await openSubmittedTab(user);
    await screen.findByTestId('case-form-investigations-item-1');

    // Remove asks for confirmation first (NFR-035).
    await user.click(screen.getByTestId('case-form-investigations-remove-1'));
    const confirm = await screen.findByTestId(
      'case-form-investigations-remove-confirm',
    );
    await user.click(confirm);

    await waitFor(() =>
      expect(deleteAttachment).toHaveBeenCalledWith({
        attachmentId: 'att-pdf',
      }),
    );
    // The list reloads to the now-empty state.
    await screen.findByTestId('case-form-investigations-empty');
  });

  it('does not delete when the remove confirm is cancelled', async () => {
    const user = userEvent.setup();
    listAttachments.mockResolvedValue({
      attachments: [att({ attachmentId: 'att-pdf' })],
    });
    renderForm();
    await openSubmittedTab(user);
    await screen.findByTestId('case-form-investigations-item-1');

    await user.click(screen.getByTestId('case-form-investigations-remove-1'));
    await screen.findByTestId('case-form-investigations-remove-confirm');
    await user.click(
      screen.getByTestId('case-form-investigations-remove-cancel'),
    );

    expect(deleteAttachment).not.toHaveBeenCalled();
    // The attachment is still listed.
    expect(
      screen.getByTestId('case-form-investigations-item-1'),
    ).toBeInTheDocument();
  });

  it('shows an inline error (no stack trace) when attach fails with a typed error', async () => {
    const user = userEvent.setup();
    pickReportFile.mockResolvedValue({ sourcePath: '/tmp/notes.txt' });
    // The backend rejects an unsupported type with a UserFacingError.
    attachReport.mockRejectedValue({
      code: 'validation',
      message: 'That file type is not supported.',
      suggestedAction: 'Attach a PDF or image (PNG/JPEG/WebP).',
    });
    renderForm();
    await openSubmittedTab(user);
    await screen.findByTestId('case-form-investigations-empty');

    await user.click(screen.getByTestId('case-form-investigations-upload'));

    const err = await screen.findByTestId('case-form-investigations-error');
    expect(err).toHaveTextContent(/not supported/i);
    // The message is the typed, safe message — never a raw stack trace / path.
    expect(err).not.toHaveTextContent('/tmp/notes.txt');
  });

  it('supports multiple reports (ultrasound, CT, lab PDF) in the list', async () => {
    const user = userEvent.setup();
    listAttachments.mockResolvedValue({
      attachments: [
        att({
          attachmentId: 'a1',
          mime: 'image/jpeg',
          originalName: 'usg.jpg',
        }),
        att({ attachmentId: 'a2', mime: 'image/png', originalName: 'ct.png' }),
        att({
          attachmentId: 'a3',
          mime: 'application/pdf',
          originalName: 'lab.pdf',
        }),
      ],
    });
    renderForm();
    await openSubmittedTab(user);

    await screen.findByTestId('case-form-investigations-item-1');
    expect(
      screen.getByTestId('case-form-investigations-item-2'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('case-form-investigations-item-3'),
    ).toHaveTextContent('lab.pdf');
  });
});

// ---------------------------------------------------------------------------
// (11c) Back navigation (HC-MVP1-M3ux UX1), re-homed from the retired
// CaseForm.test.tsx. Production still renders a first-class Back control that
// calls `onBack`, and renders NO Back control when no destination is given
// (00-conventions §3 / ADR-0002 no-dead-end). Still-valid behaviour on the
// journal form, so preserved verbatim against the journal surface.
// ---------------------------------------------------------------------------
describe('CaseForm (journal) — Back navigation (HC-MVP1-M3ux UX1)', () => {
  it('renders a Back control that calls the onBack prop', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    renderForm({ onBack });
    const back = await screen.findByTestId('case-form-back');

    await user.click(back);

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does not render a Back control when no onBack is given (no dead end)', async () => {
    renderForm();
    await screen.findByTestId('case-form-add-entry');

    // Without a destination there must be no dead-end Back button (ADR-0002).
    expect(screen.queryByTestId('case-form-back')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// (12) Follow-up: box pre-opens, buttons read 'Update ...', a follow-up
//      appends a NEW dated entry (never replaces).
// ---------------------------------------------------------------------------
describe('CaseForm (journal) — follow-up delta (S09 / ADR 0018 #2/#3/#4)', () => {
  it("pre-opens the box, buttons read 'Update vitals'/'Update prescription' on a follow-up", async () => {
    // A follow-up opens the SAME journal document (populated from the first
    // case) and the insert buttons switch to Update wording.
    openOrCreate.mockResolvedValue(
      openResp({ dataJson: JSON.stringify(populatedJournalDoc()) }),
    );
    renderForm({ visitType: 'follow_up' });

    // Prior content is visible (the box pre-opens, not a blank form).
    expect(await screen.findByTestId('case-block-cc1-b1')).toBeInTheDocument();

    // The vitals / prescription buttons read "Update ..." in follow-up.
    expect(screen.getByTestId('case-form-record-vitals')).toHaveTextContent(
      /update vitals/i,
    );
    expect(screen.getByTestId('case-form-add-prescription')).toHaveTextContent(
      /update prescription/i,
    );
  });

  it('a follow-up appends a NEW dated entry to the complaint box rather than replacing it', async () => {
    openOrCreate.mockResolvedValue(
      openResp({
        dataJson: JSON.stringify(populatedJournalDoc()),
        visitId: 'v-f1',
      }),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T09:00:00.000Z'));
    renderForm({ visitId: 'v-f1', visitType: 'follow_up' });

    // The prior (first-case) dated entry is still present.
    await vi.waitFor(() =>
      expect(screen.getByTestId('case-block-cc1-b1')).toBeInTheDocument(),
    );

    // Appending a dated entry adds a SECOND entry dated today (16-11-2026);
    // the original entry/blocks remain (history preserved).
    fireEvent.click(screen.getByTestId('case-form-add-entry'));
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(autosave).toHaveBeenCalled());

    const saved = lastSavedDoc();
    const savedComplaint = firstComplaint(saved);
    expect(savedComplaint.entries.length).toBe(2);
    // The original first-case entry is untouched (its text block survives).
    const firstEntryBlocks = firstEntry(savedComplaint).blocks;
    expect(firstEntryBlocks.some((b) => b.id === 'b1')).toBe(true);
    // The new entry is dated today and carries this follow-up's visit id.
    const newEntry = savedComplaint.entries[1];
    expect(newEntry?.entry_date).toContain('2026-11-16');
    expect(newEntry?.visit_id).toBe('v-f1');
  });
});

// ---------------------------------------------------------------------------
// (13) Next-follow-up schedule shown in the header (ADR 0018 cross-cutting).
// ---------------------------------------------------------------------------
describe('CaseForm (journal) — next follow-up shown in header (VIS-004)', () => {
  it('displays the scheduled next follow-up date from open_or_create', async () => {
    openOrCreate.mockResolvedValue(openResp({ nextFollowupOn: '2026-11-16' }));
    renderForm();

    const nextFu = await screen.findByTestId('case-form-next-followup');
    // Shown in the Indian DD-MM-YYYY display format (R-UI-006).
    expect(nextFu).toHaveTextContent('16-11-2026');
  });
});
