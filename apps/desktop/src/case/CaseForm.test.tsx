// Component tests for the S08 first (detailed) case form + schema-driven form
// engine (HC-MVP1-058..064; docs/ui/S08-case-form.md). CUT: the real
// <CaseForm /> component in this module.
//
// The ONLY fake is the dependency: the typed Tauri bindings
// (`vi.mock('@/bindings')`, R-TEST-002) — never the component. Mock fns are
// created with `vi.hoisted` so they are reachable inside the hoisted
// `vi.mock` factory (the established Slice-C pattern, see
// patients/PatientForm.test.tsx and app/SearchOverlay.test.tsx). Every control
// is found by its S08 spec data-testid (R-UI-003).
//
// Schema source of truth: crates/hc-storage/src/migrations/templates/
// chronic_detailed.json (section order, field types, showIf, allowFreeText).
// The default template is returned verbatim by case_template_get_default; the
// form must render FROM that schema, not from a hard-coded layout.
//
// Vitals JSON uses camelCase keys weightKg / heightCm / bmi to match the M3-A
// case_visit_autosave contract (hc-app visit::recompute_bmi). BMI = wt/(ht_m^2)
// rounded to 1dp (hc-domain::vitals::bmi): wt 68 / ht 172 => 22.9, matching the
// S08 wireframe "BMI {22.9}". The form shows BMI live, client-side.

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
  summaryRender,
  templateSetVisibility,
  rubricSearchPrefill,
  // PAT-009 Investigations lab-report attachments (HC-MVP1-M3ux3). The five
  // typed bindings the Investigations upload UI calls; faked so the upload →
  // list → open → remove lifecycle is observable at unit level (dependencies,
  // not the CUT). The UI never constructs a filesystem path — it asks
  // `visit_pick_report_file` for the chosen path and hands it to
  // `visit_attach_report` (architecture rule).
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
  summaryRender: vi.fn(),
  // Per-doctor hide/show persistence (CASE-002). The exact command name is the
  // UI dev's to finalise; the test fakes the binding it will call so "hidden
  // state persists" is observable at unit level (a dependency, not the CUT).
  templateSetVisibility: vi.fn(),
  rubricSearchPrefill: vi.fn(),
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
    caseSummaryRender: summaryRender,
    caseTemplateSetVisibility: templateSetVisibility,
    rubricSearchPrefill,
    visitPickReportFile: pickReportFile,
    visitAttachReport: attachReport,
    visitListAttachments: listAttachments,
    visitOpenAttachment: openAttachment,
    visitDeleteAttachment: deleteAttachment,
  },
}));

import { CaseForm } from './CaseForm';

// The chronic_detailed schema, trimmed to the shape the engine reads. Mirrors
// crates/hc-storage/src/migrations/templates/chronic_detailed.json verbatim in
// section order and in the conditional + free-text markers the engine honours.
const CHRONIC_DETAILED_SCHEMA = {
  version: 1,
  sections: [
    {
      key: 'chief_complaints',
      title: 'Chief complaints',
      collapsible: true,
      hideable: true,
      repeatable: true,
      fields: [
        { key: 'location', label: 'Location', type: 'text' },
        { key: 'sensation', label: 'Sensation', type: 'long-text' },
        { key: 'agg', label: 'Aggravation', type: 'long-text' },
        { key: 'amel', label: 'Amelioration', type: 'long-text' },
        { key: 'concomitants', label: 'Concomitants', type: 'long-text' },
        { key: 'duration', label: 'Duration', type: 'text' },
        { key: 'onset', label: 'Onset', type: 'text' },
      ],
    },
    {
      key: 'hpi',
      title: 'History of present illness',
      collapsible: true,
      hideable: true,
      fields: [
        {
          key: 'narrative',
          label: 'History of present illness',
          type: 'long-text',
        },
      ],
    },
    {
      key: 'past_history',
      title: 'Past history',
      collapsible: true,
      hideable: true,
      fields: [{ key: 'narrative', label: 'Past history', type: 'long-text' }],
    },
    {
      key: 'family_history',
      title: 'Family history',
      collapsible: true,
      hideable: true,
      fields: [
        { key: 'narrative', label: 'Family history', type: 'long-text' },
      ],
    },
    {
      key: 'personal_history',
      title: 'Personal history',
      collapsible: true,
      hideable: true,
      fields: [
        { key: 'narrative', label: 'Personal history', type: 'long-text' },
      ],
    },
    {
      key: 'physical_generals',
      title: 'Physical generals',
      collapsible: true,
      hideable: true,
      fields: [
        { key: 'appetite', label: 'Appetite', type: 'text' },
        {
          key: 'thirst',
          label: 'Thirst',
          type: 'single-choice',
          allowFreeText: true,
          options: ['Thirstless', 'Small sips', 'Large quantities'],
        },
        { key: 'cravings', label: 'Cravings', type: 'long-text' },
        { key: 'aversions', label: 'Aversions', type: 'long-text' },
        { key: 'stool', label: 'Stool', type: 'text' },
        { key: 'urine', label: 'Urine', type: 'text' },
        { key: 'sweat', label: 'Sweat', type: 'text' },
        { key: 'sleep', label: 'Sleep', type: 'text' },
        { key: 'dreams', label: 'Dreams', type: 'long-text' },
        {
          key: 'thermal',
          label: 'Thermal state',
          type: 'single-choice',
          allowFreeText: true,
          options: ['Chilly', 'Hot', 'Ambithermal'],
        },
      ],
    },
    {
      key: 'mental_generals',
      title: 'Mental generals',
      collapsible: true,
      hideable: true,
      fields: [
        { key: 'narrative', label: 'Mental generals', type: 'long-text' },
      ],
    },
    {
      key: 'menstrual_obstetric',
      title: 'Menstrual / obstetric history',
      collapsible: true,
      hideable: true,
      showIf: { sex: 'female' },
      fields: [
        { key: 'menses', label: 'Menses', type: 'long-text' },
        { key: 'obstetric', label: 'Obstetric history', type: 'long-text' },
        { key: 'leucorrhoea', label: 'Leucorrhoea', type: 'text' },
      ],
    },
    {
      key: 'child_development',
      title: 'Child development',
      collapsible: true,
      hideable: true,
      showIf: { ageYearsLt: 14 },
      fields: [
        {
          key: 'milestones',
          label: 'Developmental milestones',
          type: 'long-text',
        },
        { key: 'birth_history', label: 'Birth history', type: 'long-text' },
        { key: 'vaccination', label: 'Vaccination', type: 'text' },
        { key: 'schooling', label: 'Schooling / behaviour', type: 'long-text' },
      ],
    },
    {
      key: 'examination',
      title: 'Examination findings',
      collapsible: true,
      hideable: true,
      fields: [
        { key: 'bp', label: 'BP', type: 'text' },
        { key: 'pulse', label: 'Pulse', type: 'number' },
        { key: 'weight_kg', label: 'Weight (kg)', type: 'number' },
        { key: 'height_cm', label: 'Height (cm)', type: 'number' },
        {
          key: 'bmi',
          label: 'BMI',
          type: 'number',
          computed: 'bmi(weight_kg,height_cm)',
        },
        { key: 'temp', label: 'Temperature', type: 'number' },
        { key: 'spo2', label: 'SpO2', type: 'number' },
        { key: 'pain_scale', label: 'Pain scale', type: 'scale0-10' },
      ],
    },
    {
      key: 'investigations',
      title: 'Investigations',
      collapsible: true,
      hideable: true,
      fields: [
        { key: 'narrative', label: 'Investigations', type: 'long-text' },
      ],
    },
    {
      key: 'provisional_diagnosis',
      title: 'Provisional diagnosis',
      collapsible: true,
      hideable: true,
      fields: [
        { key: 'dx', label: 'Provisional diagnosis', type: 'long-text' },
      ],
    },
    {
      key: 'analysis',
      title: "Doctor's analysis / notes",
      collapsible: true,
      hideable: true,
      fields: [{ key: 'notes', label: 'Analysis / notes', type: 'long-text' }],
    },
  ],
};

// Section keys in template order — the engine must preserve this order.
const SECTION_KEYS_IN_ORDER = CHRONIC_DETAILED_SCHEMA.sections.map(
  (s) => s.key,
);

const DEFAULT_TEMPLATE = {
  templateId: 'chronic_detailed',
  name: 'Chronic detailed',
  schemaJson: JSON.stringify(CHRONIC_DETAILED_SCHEMA),
};

function openResp(overrides: Record<string, unknown> = {}) {
  return {
    visitId: 'v-1',
    templateId: 'chronic_detailed',
    dataJson: '{}',
    vitalsJson: '{}',
    visitAt: '2026-10-16T10:42:00Z',
    ...overrides,
  };
}

// A 34y male patient by default (no menstrual, no child section).
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
    templates: [
      { id: 'chronic_detailed', name: 'Chronic detailed', isDefault: true },
      { id: 'acute_quick', name: 'Acute quick', isDefault: false },
      { id: 'child', name: 'Child', isDefault: false },
    ],
  });
  openOrCreate.mockReset();
  openOrCreate.mockResolvedValue(openResp());
  autosave.mockReset();
  autosave.mockResolvedValue({ savedAt: '2026-10-16T10:42:30Z' });
  summaryRender.mockReset();
  summaryRender.mockResolvedValue({
    html: '<section class="case-summary"><h1>Case summary</h1><p>Headache</p></section>',
  });
  templateSetVisibility.mockReset();
  templateSetVisibility.mockResolvedValue({ ok: true });
  rubricSearchPrefill.mockReset();
  rubricSearchPrefill.mockResolvedValue({ available: false });
  // PAT-009 attachment command defaults: an empty Investigations list, a
  // picker that returns a PDF path, and a successful attach that the list
  // reload then surfaces. Individual tests override these as needed.
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

describe('CaseForm (S08) — form engine renders the default template (058/CASE-001/004)', () => {
  it('renders every CASE-001 section from schema_json in template order', async () => {
    renderForm();

    // Wait for the schema-driven rail to appear.
    await screen.findByTestId(`case-form-section-${SECTION_KEYS_IN_ORDER[0]}`);

    // The sex=male, age=34 patient hides menstrual + child; every other
    // section must be present in the schema's order.
    const visibleKeys = SECTION_KEYS_IN_ORDER.filter(
      (k) => k !== 'menstrual_obstetric' && k !== 'child_development',
    );
    for (const key of visibleKeys) {
      expect(
        screen.getByTestId(`case-form-section-${key}`),
      ).toBeInTheDocument();
    }

    // Order is preserved: the rail items appear in the same relative order as
    // the schema sections.
    const railItems = screen.getAllByTestId(/^case-form-section-/);
    const renderedKeys = railItems.map((el) =>
      el.getAttribute('data-testid')!.replace('case-form-section-', ''),
    );
    const expectedOrder = visibleKeys;
    const filtered = renderedKeys.filter((k) => expectedOrder.includes(k));
    expect(filtered).toEqual(expectedOrder);
  });

  it('reads the schema from case_template_get_default, not a hard-coded layout', async () => {
    renderForm();
    await screen.findByTestId('case-form-section-chief_complaints');
    expect(templateGetDefault).toHaveBeenCalled();
  });
});

describe('CaseForm (S08) — collapsible + hideable sections (059/CASE-002)', () => {
  it('collapses a section so its fields are no longer shown', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-section-physical_generals');

    // Physical generals is open: the thirst pick list is reachable.
    await user.click(screen.getByTestId('case-form-section-physical_generals'));
    expect(screen.getByTestId('case-form-generals-thirst')).toBeInTheDocument();

    // Collapsing the section hides its fields (CASE-002).
    await user.click(
      screen.getByTestId('case-form-collapse-physical_generals'),
    );
    expect(
      screen.queryByTestId('case-form-generals-thirst'),
    ).not.toBeInTheDocument();
  });

  it('hides a section via the persistence command and stops rendering it', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-hide-sections');

    // Open the hide-sections dialog and hide "Investigations".
    await user.click(screen.getByTestId('case-form-hide-sections'));
    await user.click(
      await screen.findByTestId('case-form-hide-toggle-investigations'),
    );

    // The per-doctor template visibility is persisted through the typed
    // command (CASE-002: the choice persists as their template).
    await waitFor(() => expect(templateSetVisibility).toHaveBeenCalled());
    const arg = templateSetVisibility.mock.calls[0]![0];
    expect(arg.sectionKey).toBe('investigations');
    expect(arg.hidden).toBe(true);

    // And the hidden section is no longer rendered in the rail.
    await waitFor(() =>
      expect(
        screen.queryByTestId('case-form-section-investigations'),
      ).not.toBeInTheDocument(),
    );
  });
});

describe('CaseForm (S08) — pick lists accept free text (060/CASE-003)', () => {
  it('accepts a thermal value that is not one of the options', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-section-physical_generals');
    await user.click(screen.getByTestId('case-form-section-physical_generals'));

    const thermal = screen.getByTestId(
      'case-form-generals-thermal',
    ) as HTMLInputElement;
    // A value outside the pick list (Chilly / Hot / Ambithermal) must be kept.
    await user.type(thermal, 'Chilly but sweaty');
    expect(thermal.value).toBe('Chilly but sweaty');
  });
});

describe('CaseForm (S08) — chief complaints (058/CASE-001)', () => {
  it('appends a new complaint block when Add complaint is clicked', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-add-complaint');

    // Starts with the first complaint block (empty-state readiness).
    expect(screen.getByTestId('case-form-complaint-1')).toBeInTheDocument();

    await user.click(screen.getByTestId('case-form-add-complaint'));
    expect(screen.getByTestId('case-form-complaint-2')).toBeInTheDocument();
  });

  it('requires complaint text and shows an inline error on blur when empty', async () => {
    const user = userEvent.setup();
    renderForm();
    const complaint = await screen.findByTestId('case-form-complaint-1');

    // Focus then blur the required complaint with no text.
    await user.click(complaint);
    await user.tab();

    expect(
      screen.getByTestId('case-form-complaint-1-error'),
    ).toBeInTheDocument();
  });
});

describe('CaseForm (S08) — vitals + live BMI (062/CASE-001)', () => {
  it('computes BMI live from weight and height (read-only)', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-section-examination');
    await user.click(screen.getByTestId('case-form-section-examination'));

    await user.type(screen.getByTestId('case-form-vital-weight_kg'), '68');
    await user.type(screen.getByTestId('case-form-vital-height_cm'), '172');

    // 68 / (1.72^2) = 22.985 -> 22.9 (1dp), matching the S08 wireframe.
    const bmi = await screen.findByTestId('case-form-bmi');
    expect(bmi).toHaveTextContent('22.9');

    // BMI is read-only (not an editable input the doctor can override).
    expect(bmi).toHaveAttribute('readonly');
  });
});

describe('CaseForm (S08) — conditional sections (059/CASE-001)', () => {
  it('shows the menstrual/obstetric section only for a female patient', async () => {
    renderForm({ sex: 'female', ageYears: 34 });
    await screen.findByTestId('case-form-section-menstrual_obstetric');
    expect(
      screen.getByTestId('case-form-section-menstrual_obstetric'),
    ).toBeInTheDocument();
  });

  it('hides the menstrual/obstetric section for a male patient', async () => {
    renderForm({ sex: 'male', ageYears: 34 });
    await screen.findByTestId('case-form-section-chief_complaints');
    expect(
      screen.queryByTestId('case-form-section-menstrual_obstetric'),
    ).not.toBeInTheDocument();
  });

  it('shows the child-development section only when age < 14', async () => {
    renderForm({ sex: 'male', ageYears: 8 });
    await screen.findByTestId('case-form-section-child_development');
    expect(
      screen.getByTestId('case-form-section-child_development'),
    ).toBeInTheDocument();
  });

  it('hides the child-development section for an adult (age >= 14)', async () => {
    renderForm({ sex: 'male', ageYears: 34 });
    await screen.findByTestId('case-form-section-chief_complaints');
    expect(
      screen.queryByTestId('case-form-section-child_development'),
    ).not.toBeInTheDocument();
  });
});

describe('CaseForm (S08) — autosave 2s + blur with Saved indicator (061/CASE-005)', () => {
  it('autosaves within the 2s debounce with the updated data_json and shows Saving then Saved', async () => {
    // Fake timers drive the 2 s debounce deterministically. The field change is
    // delivered with fireEvent.change (a synchronous native-event dispatch)
    // rather than user.type: userEvent v14 schedules its keystrokes on the
    // event loop, which deadlocks under vi.useFakeTimers + React 18 and makes
    // this test time out. fireEvent.change exercises the SAME onChange ->
    // setComplaintField -> scheduleSave path the real textarea fires, so the
    // behaviour under test (debounced autosave + Saving/Saved status) is
    // unchanged — only the input delivery mechanism differs.
    vi.useFakeTimers();
    renderForm();

    // Let the initial open/template loads settle.
    await vi.waitFor(() =>
      expect(screen.getByTestId('case-form-complaint-1')).toBeInTheDocument(),
    );

    // The primary complaint control is the textarea wrapped by the
    // complaint-1 label (bound to `sensation`).
    const complaint = screen.getByTestId('case-form-complaint-1');
    const textarea = within(complaint).getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Headache' } });

    // The change is reflected in the field and the status immediately shows the
    // in-progress ("Saving…") state the debounce opens with.
    expect((textarea as HTMLTextAreaElement).value).toBe('Headache');
    expect(screen.getByTestId('case-form-save-status')).toHaveTextContent(
      /saving/i,
    );

    // No autosave before the debounce elapses.
    expect(autosave).not.toHaveBeenCalled();

    // The debounce then fires exactly one autosave carrying the typed value.
    await vi.advanceTimersByTimeAsync(2000);

    await vi.waitFor(() => expect(autosave).toHaveBeenCalledTimes(1));
    const arg = autosave.mock.calls[0]![0];
    expect(arg.visitId).toBe('v-1');
    expect(arg.dataJson).toContain('Headache');

    // The status bar reports the saved state once the ack resolves.
    await vi.waitFor(() =>
      expect(screen.getByTestId('case-form-save-status')).toHaveTextContent(
        /saved/i,
      ),
    );
  });

  it('flushes an autosave on blur before the 2s debounce elapses (crash-loss bound, CASE-OQ-1)', async () => {
    const user = userEvent.setup();
    renderForm();
    const location = await screen.findByTestId('case-form-complaint-1');

    await user.type(location, 'Headache');
    // Blur immediately — well inside the 2s window.
    await user.tab();

    await waitFor(() => expect(autosave).toHaveBeenCalled());
    const arg = autosave.mock.calls[0]![0];
    expect(arg.dataJson).toContain('Headache');
  });
});

describe('CaseForm (S08) — restore from autosaved state (CASE-005 headline, acceptance flow 3)', () => {
  it('renders the existing data_json / vitals_json returned by open_or_create', async () => {
    // Simulate a reopen after a kill: the service returns the last autosaved
    // content. The form must restore it — nothing lost.
    openOrCreate.mockResolvedValue(
      openResp({
        dataJson: JSON.stringify({
          chief_complaints: [{ sensation: 'Throbbing headache' }],
          physical_generals: { thermal: 'Chilly but sweaty' },
        }),
        vitalsJson: JSON.stringify({ weightKg: 68, heightCm: 172, bmi: 22.9 }),
      }),
    );
    const user = userEvent.setup();
    renderForm();

    // The restored chief-complaint sensation is present.
    await waitFor(() =>
      expect(
        screen.getByTestId('case-form-section-chief_complaints'),
      ).toBeInTheDocument(),
    );
    const cc = screen.getByTestId('case-form-complaint-1');
    expect(
      within(cc).getByDisplayValue('Throbbing headache'),
    ).toBeInTheDocument();

    // The restored free-text general is present.
    await user.click(screen.getByTestId('case-form-section-physical_generals'));
    expect(
      (screen.getByTestId('case-form-generals-thermal') as HTMLInputElement)
        .value,
    ).toBe('Chilly but sweaty');

    // The restored vitals drive the live BMI.
    await user.click(screen.getByTestId('case-form-section-examination'));
    expect(screen.getByTestId('case-form-bmi')).toHaveTextContent('22.9');
  });
});

describe('CaseForm (S08) — read-only case summary (063/CASE-009)', () => {
  it('renders the returned summary HTML read-only when Case summary is clicked', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-case-summary');

    await user.click(screen.getByTestId('case-form-case-summary'));

    await waitFor(() =>
      expect(summaryRender).toHaveBeenCalledWith({ visitId: 'v-1' }),
    );
    const summary = await screen.findByTestId('case-form-summary-view');
    expect(summary).toHaveTextContent('Case summary');
    expect(summary).toHaveTextContent('Headache');
    // No editable inputs inside the read-only summary view.
    expect(within(summary).queryByRole('textbox')).not.toBeInTheDocument();
  });
});

describe('CaseForm (S08) — send-to-repertory flagged off pre-R7 (064/CASE-006)', () => {
  it('does not render the send-to-repertory control (no dead end, ADR-0002)', async () => {
    renderForm();
    await screen.findByTestId('case-form-section-chief_complaints');

    expect(
      screen.queryByTestId('case-form-send-to-repertory'),
    ).not.toBeInTheDocument();
    // The R7-only stub command is never wired this slice.
    expect(rubricSearchPrefill).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HC-MVP1-M3ux — UX1 back navigation + UX2 side-rail section toggle (RED).
//
// UX1: CaseForm (S08) must render a first-class Back control
// (`case-form-back`) that calls an `onBack` prop so the shell can route the
// doctor back to the patient dashboard (00-conventions §3; "Back must never
// discard data" — the clinical form already autosaves). Current code neither
// accepts `onBack` nor renders the control, so these FAIL.
//
// UX2: clicking a side-rail section item (`case-form-section-<key>`) must
// TOGGLE the section's visibility — a shown section is HIDDEN on click (and
// re-shown on the next click) through the existing toggleHidden +
// case_template_set_visibility persistence (one-txn-one-audit). Current code
// only calls toggleExpanded(…, true) on a rail click, so the hide-on-click
// behaviour is absent and these FAIL. The existing minus/Hide-sections dialog
// path and the conditional female/child + persisted-hidden behaviour are
// unchanged (covered above).
// ---------------------------------------------------------------------------

describe('CaseForm (S08) — UX1 back navigation (HC-MVP1-M3ux)', () => {
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
    await screen.findByTestId('case-form-section-chief_complaints');

    // Without a destination there must be no dead-end Back button (ADR-0002).
    expect(screen.queryByTestId('case-form-back')).not.toBeInTheDocument();
  });
});

describe('CaseForm (S08) — UX2 side-rail section toggle (HC-MVP1-M3ux)', () => {
  it('clicking a shown section in the rail hides it (toggles visibility off)', async () => {
    const user = userEvent.setup();
    renderForm();
    // `hpi` is a plain, non-conditional, hideable section shown in the rail.
    await screen.findByTestId('case-form-section-hpi');

    // It is a visible section panel to begin with (open it so the panel shows).
    await user.click(screen.getByTestId('case-form-section-hpi'));
    expect(screen.getByTestId('case-form-field-narrative')).toBeInTheDocument();

    // Clicking the rail item again TOGGLES the section OFF: it persists the
    // hidden state through the existing typed command (one-txn-one-audit)...
    await user.click(screen.getByTestId('case-form-section-hpi'));
    await waitFor(() =>
      expect(templateSetVisibility).toHaveBeenCalledWith(
        expect.objectContaining({ sectionKey: 'hpi', hidden: true }),
      ),
    );

    // ...and the section panel is removed from the rendered form.
    await waitFor(() =>
      expect(
        screen.queryByTestId('case-form-field-narrative'),
      ).not.toBeInTheDocument(),
    );
  });

  it("a hidden section's rail item indicates hidden state and clicking it shows the section again", async () => {
    const user = userEvent.setup();
    renderForm();
    const railHpi = await screen.findByTestId('case-form-section-hpi');

    // Open then toggle the section off via the rail.
    await user.click(railHpi);
    await user.click(screen.getByTestId('case-form-section-hpi'));
    await waitFor(() =>
      expect(templateSetVisibility).toHaveBeenCalledWith(
        expect.objectContaining({ sectionKey: 'hpi', hidden: true }),
      ),
    );

    // A hidden section must stay DISCOVERABLE in the rail so the doctor can
    // click it back on — its rail item indicates the hidden state (aria /
    // data attribute), not disappear.
    const hiddenRail = await screen.findByTestId('case-form-section-hpi');
    const indicatesHidden =
      hiddenRail.getAttribute('aria-pressed') === 'false' ||
      hiddenRail.getAttribute('aria-expanded') === 'false' ||
      hiddenRail.getAttribute('data-hidden') === 'true';
    expect(indicatesHidden).toBe(true);

    // Clicking the hidden section's rail item TOGGLES it back on (visibility
    // persisted as hidden:false), and its panel returns.
    templateSetVisibility.mockClear();
    await user.click(hiddenRail);
    await waitFor(() =>
      expect(templateSetVisibility).toHaveBeenCalledWith(
        expect.objectContaining({ sectionKey: 'hpi', hidden: false }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('case-form-section-hpi')).toBeInTheDocument(),
    );
  });

  it('the Hide-sections dialog path still hides a section (UX2 coexists with the minus dialog)', async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByTestId('case-form-hide-sections');

    // The existing minus/Hide-sections dialog persistence path is unchanged.
    await user.click(screen.getByTestId('case-form-hide-sections'));
    await user.click(
      await screen.findByTestId('case-form-hide-toggle-investigations'),
    );

    await waitFor(() =>
      expect(templateSetVisibility).toHaveBeenCalledWith(
        expect.objectContaining({ sectionKey: 'investigations', hidden: true }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId('case-form-section-investigations'),
      ).not.toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// HC-MVP1-M3ux3 — Investigations lab-report attachments (PAT-009) (RED).
//
// The Investigations section of the case form gains a lab-report upload UI so
// a doctor can attach the PDFs / ultrasound / CT / lab images a patient brings.
// It consumes ONLY the generated typed bindings (UI → typed commands only; the
// UI never constructs a filesystem path — it asks `visit_pick_report_file` for
// the chosen path and hands it to `visit_attach_report`, architecture rule):
//   - Upload: `visit_pick_report_file` → `visit_attach_report` → reload list.
//   - List:   `visit_list_attachments`, newest/oldest order from the backend.
//   - Open:   `visit_open_attachment` (decrypted base64 for in-app preview).
//   - Remove: `visit_delete_attachment`, behind a confirm (NFR-035).
// Empty state shows "No reports attached" + the upload action; errors
// (unsupported type / too large) show inline, no stack traces (NFR-033).
//
// The backend validates PDF/image by extension+magic and reuses the encrypted
// AttachmentStore (opaque <uuid>.bin, R-PRIV-007); the UI asserts only its own
// behaviour against the faked bindings.
// ---------------------------------------------------------------------------

/** Open the Investigations section panel (collapsed by default). */
async function openInvestigations(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await screen.findByTestId('case-form-section-investigations');
  await user.click(screen.getByTestId('case-form-section-investigations'));
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

describe('CaseForm (S08) — Investigations lab-report upload (PAT-009, HC-MVP1-M3ux3)', () => {
  it('shows an empty state with "No reports attached" and the upload action', async () => {
    const user = userEvent.setup();
    listAttachments.mockResolvedValue({ attachments: [] });
    renderForm();
    await openInvestigations(user);

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
    await openInvestigations(user);

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
    await openInvestigations(user);
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
    await openInvestigations(user);
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
    await openInvestigations(user);
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
    await openInvestigations(user);
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
    await openInvestigations(user);
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
    await openInvestigations(user);
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
    await openInvestigations(user);

    await screen.findByTestId('case-form-investigations-item-1');
    expect(
      screen.getByTestId('case-form-investigations-item-2'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('case-form-investigations-item-3'),
    ).toHaveTextContent('lab.pdf');
  });
});
