// MS (SET-007) S06 form passes the chosen camera to the capture call, and the
// file fallback stays. CUT: the REAL <PatientForm />. Fakes are dependencies
// only: `@/bindings`, the shell prefs hook `@/app/useAppPrefs` (a saved camera)
// and the capture helper `captureWebcamPhoto` (its own behaviour is covered by
// photo.camera.test.ts). Synthetic data only.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { captureWebcamPhoto } = vi.hoisted(() => ({
  captureWebcamPhoto: vi.fn(),
}));

vi.mock('@/bindings', () => ({
  commands: {
    patientNextCode: vi.fn(async () => ({ code: 'HC-000312' })),
    patientCheckDuplicate: vi.fn(async () => ({ matches: [] })),
    patientCreate: vi.fn(),
    patientUpdate: vi.fn(),
    patientGetDashboard: vi.fn(),
  },
}));

vi.mock('@/app/useAppPrefs', () => ({
  useAppPrefs: () => ({
    fontSize: 'normal',
    autolockMinutes: 15,
    defaultCamera: { deviceId: 'cam-2', label: 'Test Camera 2' },
    applySaved: () => undefined,
  }),
  AppPrefsProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('./photo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./photo')>()),
  captureWebcamPhoto,
}));

import { PatientForm } from './PatientForm';

beforeEach(() => {
  captureWebcamPhoto.mockReset();
  (
    globalThis as unknown as { URL: { createObjectURL: unknown } }
  ).URL.createObjectURL = vi.fn(() => 'blob:photo');
  (
    globalThis as unknown as { URL: { revokeObjectURL: unknown } }
  ).URL.revokeObjectURL = vi.fn();
});

describe('PatientForm (S06) — chosen camera (SET-007)', () => {
  it('captures with the camera chosen in Settings and keeps the file fallback', async () => {
    const user = userEvent.setup();
    captureWebcamPhoto.mockResolvedValue({ ok: false });
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');

    await user.click(screen.getByTestId('patient-form-photo-webcam'));

    await waitFor(() => expect(captureWebcamPhoto).toHaveBeenCalledTimes(1));
    expect(captureWebcamPhoto).toHaveBeenCalledWith({
      deviceId: 'cam-2',
      label: 'Test Camera 2',
    });
    // No camera / refused -> the file path still attaches a photo.
    expect(
      await screen.findByTestId('patient-form-photo-denied'),
    ).toBeInTheDocument();
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    await user.upload(
      screen.getByTestId('patient-form-photo-file-input') as HTMLInputElement,
      file,
    );
    expect(await screen.findByTestId('patient-form-photo-img')).toHaveAttribute(
      'src',
      'blob:photo',
    );
  });
});
