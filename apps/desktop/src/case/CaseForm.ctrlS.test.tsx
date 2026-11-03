// RED component tests for HC-MVP1-M3vis (3): Ctrl+S / Cmd+S force-saves the
// case exactly like the header Save button (CASE-005).
//
// The Save button's accessible name is "Save (Ctrl+S)" but no shortcut is
// wired, so the doctor's habitual Ctrl+S does nothing (and in a webview may
// trigger the default "save page" action). Wanted, inside the case form:
//  - Ctrl+S and Cmd+S call caseVisitAutosave IMMEDIATELY (no 2 s debounce),
//    with the newest in-editor content, status goes Saving… -> Saved;
//  - the keydown's default is prevented;
//  - it works with focus in the rich editor prose AND in a table cell;
//  - it does not open the row-delete confirm (Ctrl+Shift+Backspace's) nor
//    change the document;
//  - after the form unmounts, Ctrl+S no longer saves (no leaked listener
//    saving into a closed visit).
//
// Real timers (the immediacy check is "called well before the 2 s debounce").
// The only fake is the typed bindings dependency. Synthetic data only.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

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
import { tableRowPos } from './caseRichEditor';
import en from '@/locales/en.json';

type Json = Record<string, unknown>;

const txt = (s: string) => (s === '' ? [] : [{ type: 'text', text: s }]);
const para = (s: string) =>
  s === '' ? { type: 'paragraph' } : { type: 'paragraph', content: txt(s) };

/** A v3 case with one entry, prose, and a 2-row Vitals table. */
const DOC: Json = {
  schema: 'case-rich',
  version: 3,
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
            type: 'heading',
            attrs: {
              level: 2,
              hcKind: 'entry',
              hcEntryKind: 'first',
              hcComplaintName: 'Headache',
              hcDate: '2026-11-04',
              hcVisitId: 'v-1',
            },
            content: txt('Headache \u2014 04-11-2026'),
          },
          para('Throbbing right temple.'),
          { type: 'horizontalRule' },
          {
            type: 'heading',
            attrs: {
              level: 3,
              hcKind: 'section',
              hcSectionNo: 1,
              hcSectionType: 'vitals',
            },
            content: txt('\u2022 Vitals'),
          },
          {
            type: 'table',
            attrs: { hcTableType: 'vitals' },
            content: [
              {
                type: 'tableRow',
                content: ['BP sys', 'BP dia'].map((h) => ({
                  type: 'tableHeader',
                  content: [para(h)],
                })),
              },
              ...[
                ['120', '80'],
                ['130', '85'],
              ].map((r) => ({
                type: 'tableRow',
                content: r.map((v) => ({
                  type: 'tableCell',
                  content: [para(v)],
                })),
              })),
            ],
          },
        ],
      },
    },
  ],
};

beforeEach(() => {
  openOrCreate.mockReset();
  openOrCreate.mockResolvedValue({
    visitId: 'v-1',
    templateId: 'journal_default',
    dataJson: JSON.stringify(DOC),
    vitalsJson: '{}',
    visitAt: '2026-11-04T09:00:00Z',
    nextFollowupOn: null,
  });
  autosave.mockReset();
  autosave.mockResolvedValue({ savedAt: '2026-11-04T09:00:30Z' });
  listAttachments.mockReset();
  listAttachments.mockResolvedValue({ attachments: [] });
  patientListAttachments.mockReset();
  patientListAttachments.mockResolvedValue({ attachments: [] });
  pickReportFile.mockReset();
  pickReportFile.mockResolvedValue({ sourcePath: null });
  setNextFollowup.mockReset();
  setNextFollowup.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// The production autosave debounce is 2000 ms; "immediate" must beat it
// comfortably, so every wait in this file is capped well below it.
const IMMEDIATE = { timeout: 800 };

async function renderForm(): Promise<{
  region: HTMLElement;
  unmount: () => void;
}> {
  const r = render(
    <CaseForm patientId="p-123" visitId="v-1" sex="male" ageYears={34} />,
  );
  const region = await screen.findByTestId('case-form-editor-cc1', undefined, {
    timeout: 1500,
  });
  await waitFor(() =>
    expect(region.querySelector('.ProseMirror')).not.toBeNull(),
  );
  return { region, unmount: r.unmount };
}

function pmRoot(region: HTMLElement): HTMLElement {
  const pm = region.querySelector<HTMLElement>('.ProseMirror');
  if (pm === null) throw new Error('no ProseMirror view');
  return pm;
}

function liveEditor(region: HTMLElement): Editor {
  const dom = pmRoot(region) as unknown as { editor?: Editor };
  if (dom.editor === undefined) throw new Error('no live editor on the view');
  return dom.editor;
}

function placeCaret(region: HTMLElement, pos: number): void {
  const ed = liveEditor(region);
  pmRoot(region).focus();
  ed.view.dispatch(
    ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(pos), 1)),
  );
  expect(document.activeElement).toBe(pmRoot(region));
}

function caretInTableCell(region: HTMLElement): void {
  const pos = tableRowPos(liveEditor(region), 1, 2);
  if (pos === null) throw new Error('no vitals data row 2');
  placeCaret(region, pos + 1);
  const $h = liveEditor(region).state.selection.$head;
  expect(
    [...Array($h.depth + 1).keys()].some(
      (d) => $h.node(d).type.name === 'tableCell',
    ),
    'caret is inside a table cell',
  ).toBe(true);
}

function statusText(): string {
  return screen.getByTestId('case-form-save-status').textContent ?? '';
}

/** Fire the chord on the focused element; true when default was prevented. */
function pressSave(
  target: Element,
  mod: 'ctrl' | 'meta',
  key = 's',
  extra: { code?: string; repeat?: boolean } = {},
): boolean {
  const notCancelled = fireEvent.keyDown(target, {
    key,
    code: extra.code ?? 'KeyS',
    ctrlKey: mod === 'ctrl',
    metaKey: mod === 'meta',
    repeat: extra.repeat ?? false,
  });
  return !notCancelled;
}

describe('M3vis Ctrl+S / Cmd+S force-save in the case form', () => {
  it('Ctrl+S in the editor saves immediately, prevents the default, and shows Saving then Saved', async () => {
    let resolveSave: (v: { savedAt: string }) => void = () => undefined;
    autosave.mockImplementation(
      () =>
        new Promise<{ savedAt: string }>((r) => {
          resolveSave = r;
        }),
    );
    const { region } = await renderForm();
    placeCaret(region, 3);

    const prevented = pressSave(pmRoot(region), 'ctrl');

    expect(prevented, 'webview default (save page) suppressed').toBe(true);
    await waitFor(() => expect(autosave).toHaveBeenCalledTimes(1), IMMEDIATE);
    expect(autosave.mock.calls[0]![0]).toMatchObject({ visitId: 'v-1' });
    expect(statusText()).toBe(en['case.form.save.saving']);

    resolveSave({ savedAt: '2026-11-04T09:00:30Z' });
    await waitFor(() =>
      expect(statusText()).toContain(en['case.form.save.savedPrefix']),
    );
  });

  it('Ctrl+S while typing flushes the newest text at once (not after the debounce)', async () => {
    const { region } = await renderForm();
    const ed = liveEditor(region);
    // Put the caret at the end of the prose paragraph and type there.
    let end = 0;
    ed.state.doc.descendants((n, pos) => {
      if (
        n.type.name === 'paragraph' &&
        n.textContent === 'Throbbing right temple.'
      ) {
        end = pos + 1 + n.content.size;
      }
      return true;
    });
    placeCaret(region, end);
    ed.commands.insertContent(' Worse at night.');

    pressSave(pmRoot(region), 'ctrl');

    await waitFor(() => expect(autosave).toHaveBeenCalled(), IMMEDIATE);
    const payload = (autosave.mock.calls.at(-1)![0] as { dataJson: string })
      .dataJson;
    expect(payload).toContain('Worse at night.');
  });

  it('Cmd+S in a table cell saves, prevents the default, opens no row-delete confirm and edits nothing', async () => {
    const { region } = await renderForm();
    caretInTableCell(region);
    const before = JSON.stringify(liveEditor(region).getJSON());

    const prevented = pressSave(pmRoot(region), 'meta');

    expect(prevented).toBe(true);
    await waitFor(() => expect(autosave).toHaveBeenCalledTimes(1), IMMEDIATE);
    expect(
      screen.queryByTestId('case-form-table-row-delete-dialog'),
    ).toBeNull();
    expect(JSON.stringify(liveEditor(region).getJSON())).toBe(before);
  });

  it('Ctrl+S with Caps Lock on (key "S") in a table cell also force-saves', async () => {
    const { region } = await renderForm();
    caretInTableCell(region);
    pressSave(pmRoot(region), 'ctrl', 'S');
    await waitFor(() => expect(autosave).toHaveBeenCalledTimes(1), IMMEDIATE);
  });

  // kbd-1: on a non-Latin layout (Hindi InScript / Marathi) the physical S
  // key yields a Devanagari `key`; the physical key (`code`) decides.
  it('Ctrl+S on a Hindi InScript layout (key "े", code KeyS) force-saves and prevents the default', async () => {
    const { region } = await renderForm();
    placeCaret(region, 3);
    const prevented = pressSave(pmRoot(region), 'ctrl', 'े');
    expect(prevented).toBe(true);
    await waitFor(() => expect(autosave).toHaveBeenCalledTimes(1), IMMEDIATE);
  });

  it('a Latin letter on the physical S key (Dvorak "o") is not Save', async () => {
    const { region } = await renderForm();
    placeCaret(region, 3);
    const prevented = pressSave(pmRoot(region), 'ctrl', 'o');
    expect(prevented).toBe(false);
    // The shortcut handler is synchronous (it calls the command inside the
    // keydown), so "not saved" is exact right after the event.
    expect(autosave).not.toHaveBeenCalled();
    // Sentinel: a real Ctrl+S right after is the ONLY save, so Ctrl+O did
    // not queue one either (no sleep needed).
    pressSave(pmRoot(region), 'ctrl');
    await waitFor(() => expect(autosave).toHaveBeenCalledTimes(1), IMMEDIATE);
    await waitFor(() =>
      expect(statusText()).toContain(en['case.form.save.savedPrefix']),
    );
    expect(autosave).toHaveBeenCalledTimes(1);
  });

  it('holding Ctrl+S (auto-repeat) saves once; repeats are swallowed but not re-sent', async () => {
    const { region } = await renderForm();
    placeCaret(region, 3);
    pressSave(pmRoot(region), 'ctrl');
    await waitFor(() => expect(autosave).toHaveBeenCalledTimes(1), IMMEDIATE);
    for (let i = 0; i < 5; i += 1) {
      expect(
        pressSave(pmRoot(region), 'ctrl', 's', { repeat: true }),
        'repeat default suppressed',
      ).toBe(true);
    }
    // Repeats are handled synchronously in the keydown: exact right away.
    expect(autosave).toHaveBeenCalledTimes(1);
    // The one save settles (visible marker) and still nothing was re-sent.
    await waitFor(() =>
      expect(statusText()).toContain(en['case.form.save.savedPrefix']),
    );
    expect(autosave).toHaveBeenCalledTimes(1);
  });

  it('after the case form unmounts Ctrl+S no longer saves', async () => {
    const { unmount } = await renderForm();
    unmount();
    autosave.mockClear();
    pressSave(document.body, 'ctrl');
    // A leaked window listener would save synchronously inside the keydown.
    expect(autosave).not.toHaveBeenCalled();
    // Sentinel: a fresh form's Ctrl+S saves exactly once, then settles; a
    // leaked listener of the unmounted form that could still save would add
    // a second call here.
    const { region } = await renderForm();
    pressSave(pmRoot(region), 'ctrl');
    await waitFor(() => expect(autosave).toHaveBeenCalledTimes(1), IMMEDIATE);
    await waitFor(() =>
      expect(statusText()).toContain(en['case.form.save.savedPrefix']),
    );
    expect(autosave).toHaveBeenCalledTimes(1);
  });
});
