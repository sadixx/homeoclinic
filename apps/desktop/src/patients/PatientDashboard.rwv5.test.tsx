// RED component tests for the M3-RWv5 default avatar on the S07 patient
// dashboard, using the REAL <PatientDashboard />. When the patient has a
// gender (M/F) and no photo, the photo slot shows an OFFLINE inline-SVG
// male/female silhouette instead of the "no photo" text. The two
// silhouettes differ, and a stored photo overrides the avatar.
//
// Proposed testid (contract for hc-ui-dev): `patient-dash-photo-avatar` with
// `data-avatar="male" | "female"`, an inline <svg>, role="img" and a
// non-empty aria-label. The patient list renders no photo/avatar today, so it
// is out of scope.
//
// The only fake is the typed bindings dependency. Synthetic data only.
//
// NO production code is written by this file (hc-unit-tester, leaf role).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const {
  getDashboard,
  softDelete,
  restore,
  exportPdf,
  exportJson,
  touchRecent,
  hasSavedFirstCase,
  patientListAttachments,
  visitDeleteAttachment,
  visitOpenAttachment,
} = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  softDelete: vi.fn(),
  restore: vi.fn(),
  exportPdf: vi.fn(),
  exportJson: vi.fn(),
  touchRecent: vi.fn(),
  hasSavedFirstCase: vi.fn(),
  patientListAttachments: vi.fn(),
  visitDeleteAttachment: vi.fn(),
  visitOpenAttachment: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    patientGetDashboard: getDashboard,
    patientSoftDelete: softDelete,
    patientRestore: restore,
    patientExportPdf: exportPdf,
    patientExportJson: exportJson,
    patientTouchRecent: touchRecent,
    visitHasSavedFirstCase: hasSavedFirstCase,
    patientListAttachments,
    visitDeleteAttachment,
    visitOpenAttachment,
  },
}));

vi.mock('@/shared/features', () => ({ features: { case: true } }));

import { PatientDashboard } from './PatientDashboard';

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
  getDashboard.mockReset();
  getDashboard.mockResolvedValue(dashboard());
  touchRecent.mockReset();
  touchRecent.mockResolvedValue(null);
  hasSavedFirstCase.mockReset();
  hasSavedFirstCase.mockResolvedValue({ hasSavedFirstCase: false });
  patientListAttachments.mockReset();
  patientListAttachments.mockResolvedValue({ attachments: [] });
});

async function renderDash(demo: Record<string, unknown>): Promise<HTMLElement> {
  getDashboard.mockResolvedValue(dashboard(demo));
  render(<PatientDashboard patientId="p-123" />);
  await screen.findByTestId('patient-dash-demographics');
  return screen.getByTestId('patient-dash-photo');
}

function avatarIn(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector('[data-testid="patient-dash-photo-avatar"]');
}

function svgMarkupOf(el: HTMLElement): string {
  const svg = el.matches('svg') ? el : el.querySelector('svg');
  expect(svg, 'the avatar is an inline <svg>').not.toBeNull();
  expect(el.outerHTML, 'no URL / network reference').not.toMatch(
    /https?:|\burl\(|xlink:href|\bhref=/i,
  );
  const labelled =
    el.getAttribute('role') === 'img'
      ? el
      : (el.querySelector('[role="img"]') as HTMLElement | null);
  expect(labelled, 'role="img"').not.toBeNull();
  expect(
    labelled!.getAttribute('aria-label') ?? '',
    'accessible name',
  ).not.toBe('');
  return svg!.outerHTML;
}

describe('PatientDashboard RWv5 C2 — default silhouette avatar', () => {
  it('a Male patient with no photo shows the male silhouette', async () => {
    const slot = await renderDash({ sex: 'M', photoPath: null });
    const el = avatarIn(slot);
    expect(el, 'male avatar in the photo slot').not.toBeNull();
    expect(el!.getAttribute('data-avatar')).toBe('male');
    svgMarkupOf(el!);
  });

  it('a Female patient with no photo shows a female silhouette that differs from the male one', async () => {
    const maleSlot = await renderDash({ sex: 'M', photoPath: null });
    const male = avatarIn(maleSlot);
    expect(male, 'male avatar').not.toBeNull();
    const maleSvg = svgMarkupOf(male!);

    cleanup();
    const femaleSlot = await renderDash({ sex: 'F', photoPath: null });
    const female = avatarIn(femaleSlot);
    expect(female, 'female avatar').not.toBeNull();
    expect(female!.getAttribute('data-avatar')).toBe('female');
    expect(svgMarkupOf(female!)).not.toBe(maleSvg);
  });

  it('a stored photo overrides the avatar', async () => {
    const slot = await renderDash({ sex: 'F', photoPath: 'photo-ref-1' });
    expect(slot.querySelector('img')).not.toBeNull();
    expect(avatarIn(slot)).toBeNull();
  });

  it('no gender and no photo keeps the "no photo" text, no avatar', async () => {
    const slot = await renderDash({ sex: null, photoPath: null });
    expect(avatarIn(slot)).toBeNull();
  });
});
