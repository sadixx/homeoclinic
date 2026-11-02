// RED component tests for the M3-RWv5 patient-form fixes (S06), using the
// REAL <PatientForm />:
//
//  (C1) Marital status options are exactly Single / Married / Divorced /
//       Widowed, plus the existing empty "none" choice. A LEGACY stored value
//       (e.g. `other`) stays readable on edit: it is shown, kept selected, and
//       sent back unchanged on save, not wiped to null.
//  (C2) Default silhouette avatar: when a gender is set and there is no
//       photo, an OFFLINE inline-SVG male or female silhouette is shown. The
//       two differ by gender. A photo overrides the avatar. With no gender,
//       the existing "no photo" placeholder stays.
//
// Proposed testids (contract for hc-ui-dev): `patient-form-photo-avatar` with
// `data-avatar="male" | "female"`. It wraps an inline <svg> (no <img>, no
// URL), is exposed as role="img" and has a non-empty accessible name.
//
// The only fake is the typed bindings dependency (`vi.mock('@/bindings')`).
// Synthetic data only. New en.json keys are matched by text regex, not t(),
// so a missing key fails an assertion and does not break type-checking.
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { nextCode, checkDuplicate, createPatient, updatePatient, getDashboard } =
  vi.hoisted(() => ({
    nextCode: vi.fn(),
    checkDuplicate: vi.fn(),
    createPatient: vi.fn(),
    updatePatient: vi.fn(),
    getDashboard: vi.fn(),
  }));

vi.mock('@/bindings', () => ({
  commands: {
    patientNextCode: nextCode,
    patientCheckDuplicate: checkDuplicate,
    patientCreate: createPatient,
    patientUpdate: updatePatient,
    patientGetDashboard: getDashboard,
  },
}));

import { PatientForm } from './PatientForm';

function dashboard(
  demo: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    demographics: {
      code: 'HC-000123',
      name: 'Test Patient 001',
      ageLabel: '34y',
      sex: 'M',
      mobile: '9876543210',
      city: 'Pune',
      referredBy: null,
      photoPath: null,
      ...demo,
    },
    allergies: null,
    alerts: null,
    duesPaise: 0,
    visits: [],
    lastPrescription: null,
    family: [],
  };
}

beforeEach(() => {
  nextCode.mockReset();
  nextCode.mockResolvedValue({ code: 'HC-000312' });
  checkDuplicate.mockReset();
  checkDuplicate.mockResolvedValue({ matches: [] });
  createPatient.mockReset();
  createPatient.mockResolvedValue({ patientId: 'p-new', code: 'HC-000312' });
  updatePatient.mockReset();
  updatePatient.mockResolvedValue(null);
  getDashboard.mockReset();
  getDashboard.mockResolvedValue(dashboard());
  (
    globalThis as unknown as { URL: { createObjectURL: unknown } }
  ).URL.createObjectURL = vi.fn(() => 'blob:photo');
  (
    globalThis as unknown as { URL: { revokeObjectURL: unknown } }
  ).URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function maritalSelect(): HTMLSelectElement {
  return screen.getByTestId('patient-form-marital') as HTMLSelectElement;
}

// ===========================================================================
// C1 — marital status options + legacy readability
// ===========================================================================

describe('PatientForm RWv5 C1 — marital status options', () => {
  it('offers exactly Single, Married, Divorced, Widowed (plus the empty none choice)', async () => {
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');

    const opts = Array.from(maritalSelect().options).filter(
      (o) => o.value !== '',
    );
    expect(opts.map((o) => o.textContent?.trim())).toEqual([
      'Single',
      'Married',
      'Divorced',
      'Widowed',
    ]);
    expect(opts.map((o) => o.value)).toEqual([
      'single',
      'married',
      'divorced',
      'widowed',
    ]);
  });

  it('a new patient saved as Widowed sends maritalStatus "widowed"', async () => {
    const user = userEvent.setup();
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    await user.type(
      screen.getByTestId('patient-form-name'),
      'Test Patient 002',
    );
    await user.type(screen.getByTestId('patient-form-age'), '70');
    expect(Array.from(maritalSelect().options).map((o) => o.value)).toContain(
      'widowed',
    );
    await user.selectOptions(maritalSelect(), 'widowed');
    await user.click(screen.getByTestId('patient-form-save'));

    await waitFor(() => expect(createPatient).toHaveBeenCalledTimes(1));
    expect(
      (createPatient.mock.calls[0]![0] as Record<string, unknown>)[
        'maritalStatus'
      ],
    ).toBe('widowed');
  });
});

describe('PatientForm RWv5 C1 — a legacy stored marital value stays readable on edit', () => {
  it('shows the legacy "other" value selected when editing', async () => {
    getDashboard.mockResolvedValue(dashboard({ maritalStatus: 'other' }));
    render(<PatientForm mode="edit" patientId="p-123" />);
    await screen.findByTestId('patient-form-name');

    await waitFor(() => expect(maritalSelect().value).toBe('other'));
    const selected = maritalSelect().selectedOptions[0];
    expect(
      selected?.textContent?.trim() ?? '',
      'the legacy value has a visible label',
    ).not.toBe('');
  });

  it('shows a NEW stored value (divorced) selected when editing', async () => {
    getDashboard.mockResolvedValue(dashboard({ maritalStatus: 'divorced' }));
    render(<PatientForm mode="edit" patientId="p-123" />);
    await screen.findByTestId('patient-form-name');
    await waitFor(() => expect(maritalSelect().value).toBe('divorced'));
  });

  it('saving an edit without touching marital status keeps the legacy value (not wiped to null)', async () => {
    getDashboard.mockResolvedValue(dashboard({ maritalStatus: 'other' }));
    const user = userEvent.setup();
    render(<PatientForm mode="edit" patientId="p-123" />);
    const name = await screen.findByTestId('patient-form-name');
    await waitFor(() => expect(name).toHaveValue('Test Patient 001'));

    await user.click(screen.getByTestId('patient-form-save'));
    await waitFor(() => expect(updatePatient).toHaveBeenCalledTimes(1));
    expect(
      (updatePatient.mock.calls[0]![0] as Record<string, unknown>)[
        'maritalStatus'
      ],
    ).toBe('other');
  });
});

// ===========================================================================
// C2 — default male / female silhouette avatar (offline inline SVG)
// ===========================================================================

function photoBox(): HTMLElement {
  return screen.getByTestId('patient-form-photo');
}

function avatar(): HTMLElement | null {
  return screen.queryByTestId('patient-form-photo-avatar');
}

/** Assert the avatar is an offline, accessible inline SVG; return its markup. */
function assertOfflineAccessibleAvatar(el: HTMLElement): string {
  const svg = el.matches('svg') ? el : el.querySelector('svg');
  expect(svg, 'the avatar is an inline <svg>').not.toBeNull();
  expect(el.querySelector('img'), 'no <img> for the default avatar').toBeNull();
  const markup = el.outerHTML;
  expect(markup, 'no URL / network reference in the inline avatar').not.toMatch(
    /https?:|\burl\(|xlink:href|\bhref=/i,
  );
  const labelled =
    el.getAttribute('role') === 'img'
      ? el
      : (el.querySelector('[role="img"]') as HTMLElement | null);
  expect(labelled, 'the avatar is exposed as role="img"').not.toBeNull();
  expect(
    labelled!.getAttribute('aria-label') ?? '',
    'the avatar has an accessible name',
  ).not.toBe('');
  return svg!.outerHTML;
}

describe('PatientForm RWv5 C2 — default silhouette avatar when gender is set and there is no photo', () => {
  it('no gender: keeps the "no photo" placeholder and shows no avatar', async () => {
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    expect(avatar()).toBeNull();
    expect(screen.getByTestId('patient-form-photo-none')).toBeInTheDocument();
  });

  it('Male selected: shows a male silhouette inline SVG (offline, accessible)', async () => {
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    fireEvent.click(
      within(screen.getByTestId('patient-form-sex')).getByDisplayValue('M'),
    );

    const el = avatar();
    expect(el, 'a default avatar renders once gender is set').not.toBeNull();
    expect(el!.getAttribute('data-avatar')).toBe('male');
    assertOfflineAccessibleAvatar(el!);
    expect(photoBox()).toContainElement(el);
  });

  it('Female selected: shows a female silhouette that DIFFERS from the male one', async () => {
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    const sex = within(screen.getByTestId('patient-form-sex'));

    fireEvent.click(sex.getByDisplayValue('M'));
    const male = avatar();
    expect(male, 'male avatar').not.toBeNull();
    const maleSvg = assertOfflineAccessibleAvatar(male!);

    fireEvent.click(sex.getByDisplayValue('F'));
    const female = avatar();
    expect(female, 'female avatar').not.toBeNull();
    expect(female!.getAttribute('data-avatar')).toBe('female');
    const femaleSvg = assertOfflineAccessibleAvatar(female!);
    expect(femaleSvg, 'male and female silhouettes differ').not.toBe(maleSvg);
  });

  it('a photo overrides the avatar', async () => {
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    fireEvent.click(
      within(screen.getByTestId('patient-form-sex')).getByDisplayValue('F'),
    );
    expect(avatar(), 'avatar before the photo').not.toBeNull();

    const file = new File(['x'], 'face.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('patient-form-photo-file-input'), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(screen.getByTestId('patient-form-photo-img')).toBeInTheDocument(),
    );
    expect(avatar(), 'no avatar once a photo is attached').toBeNull();
  });

  it('edit mode: a stored Male patient without a photo shows the male avatar', async () => {
    getDashboard.mockResolvedValue(dashboard({ sex: 'M', photoPath: null }));
    render(<PatientForm mode="edit" patientId="p-123" />);
    await screen.findByTestId('patient-form-name');
    await waitFor(() =>
      expect(avatar()?.getAttribute('data-avatar')).toBe('male'),
    );
  });
});
