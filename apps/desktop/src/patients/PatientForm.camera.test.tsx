// MS (SET-007, PAT-001, HC-MVP1-038) S06 form passes the chosen camera to the capture call, and the
// file fallback stays. CUT: the REAL <PatientForm />. Fakes are dependencies
// only: `@/bindings`, the shell prefs hook `@/app/useAppPrefs` (a saved camera)
// and the capture helper `captureWebcamPhoto` (its own behaviour is covered by
// photo.camera.test.ts). Synthetic data only.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type CaptureResult = { ok: boolean; previewUrl?: string; reason?: string };

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

import en from '@/locales/en.json';

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

describe('PatientForm (S06) — chosen camera (SET-007, PAT-001, HC-MVP1-038)', () => {
  it('captures with the camera chosen in Settings and keeps the file fallback', async () => {
    const user = userEvent.setup();
    captureWebcamPhoto.mockResolvedValue({ ok: false });
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');

    await user.click(screen.getByTestId('patient-form-photo-webcam'));

    await waitFor(() => expect(captureWebcamPhoto).toHaveBeenCalledTimes(1));
    expect(captureWebcamPhoto).toHaveBeenCalledWith(
      { deviceId: 'cam-2', label: 'Test Camera 2' },
      expect.any(AbortSignal),
    );
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

  it('shows a plain-language reason, never a DOMException name or code (R-UI-008)', async () => {
    const user = userEvent.setup();
    captureWebcamPhoto.mockResolvedValue({
      ok: false,
      reason: 'NotReadableError, timeout',
    });
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');

    await user.click(screen.getByTestId('patient-form-photo-webcam'));

    expect(
      await screen.findByTestId('patient-form-photo-denied'),
    ).toHaveTextContent(en['patient.form.photo.cameraDenied']);
    const reason = screen.getByTestId('patient-form-photo-denied-reason');
    // One sentence, the more specific of the two attempts.
    expect(reason).toHaveTextContent(en['patient.form.photo.reason.busy']);
    expect(document.body).not.toHaveTextContent(/NotReadableError|timeout/);
    // One announcement: the reason is INSIDE the single role=alert paragraph,
    // a distinct element, and the permanent role=status region stays empty.
    const alert = screen.getByTestId('patient-form-photo-denied');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toContainElement(reason);
    expect(screen.getAllByRole('alert')).toContain(alert);
    const status = screen.getByTestId('patient-form-photo-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).not.toContainElement(reason);
    expect(status).toBeEmptyDOMElement();
  });

  it.each([
    ['no-frame, no-frame', 'busy'],
    ['timeout', 'slow'],
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError, OverconstrainedError', 'none'],
    ['no-device', 'none'],
    ['AbortError', 'other'],
    ['error', 'other'],
  ] as const)('maps the reason "%s" to the %s sentence', async (code, kind) => {
    const user = userEvent.setup();
    captureWebcamPhoto.mockResolvedValue({ ok: false, reason: code });
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    expect(
      await screen.findByTestId('patient-form-photo-denied-reason'),
    ).toHaveTextContent(en[`patient.form.photo.reason.${kind}`]);
  });

  it('guards the text-base class on the photo messages and buttons (jsdom does not apply Tailwind, so this checks the class, not the rendered size; R-UI-005)', async () => {
    const user = userEvent.setup();
    captureWebcamPhoto.mockResolvedValue({ ok: false, reason: 'timeout' });
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    const denied = await screen.findByTestId('patient-form-photo-denied');
    // Attach a file so the Remove photo button is present too.
    await user.upload(
      screen.getByTestId('patient-form-photo-file-input') as HTMLInputElement,
      new File(['x'], 'photo.png', { type: 'image/png' }),
    );
    await screen.findByTestId('patient-form-photo-img');
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    const reason = await screen.findByTestId(
      'patient-form-photo-denied-reason',
    );
    for (const el of [
      denied,
      screen.getByTestId('patient-form-photo-status'),
      reason,
      screen.getByTestId('patient-form-photo-webcam'),
      screen.getByTestId('patient-form-photo-file'),
      screen.getByTestId('patient-form-photo-remove'),
    ]) {
      // The app root is 14 px, so text-base (1rem) is the 14 px body size;
      // text-sm and text-xs would render below it.
      expect(el.className).toContain('text-base');
      expect(el.className).not.toMatch(/text-(xs|sm)|text-\[\d+px\]/);
    }
  });

  it('shows no reason line when the capture gave none', async () => {
    const user = userEvent.setup();
    captureWebcamPhoto.mockResolvedValue({ ok: false });
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    await screen.findByTestId('patient-form-photo-denied');
    expect(
      screen.queryByTestId('patient-form-photo-denied-reason'),
    ).not.toBeInTheDocument();
  });

  it('has a permanently mounted, empty live region that announces opening, then the result (a11y)', async () => {
    const user = userEvent.setup();
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    const status = screen.getByTestId('patient-form-photo-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toBeEmptyDOMElement();
    // The button no longer uses aria-busy as the announcement.
    expect(screen.getByTestId('patient-form-photo-webcam')).not.toHaveAttribute(
      'aria-busy',
    );

    let finish: (r: CaptureResult) => void = () => undefined;
    captureWebcamPhoto.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    // The same element stays mounted and is filled.
    expect(screen.getByTestId('patient-form-photo-status')).toBe(status);
    expect(status).toHaveTextContent(en['patient.form.photo.capturing']);
    expect(status.className).toContain('text-base');

    finish({ ok: true, previewUrl: 'data:image/png;base64,AAAA' });
    await screen.findByTestId('patient-form-photo-img');
    expect(screen.getByTestId('patient-form-photo-status')).toBe(status);
    expect(status).toHaveTextContent(en['patient.form.photo.captured']);
    expect(status).not.toHaveTextContent(en['patient.form.photo.capturing']);
  });

  it('clears "Photo captured." when the photo is removed', async () => {
    const user = userEvent.setup();
    captureWebcamPhoto.mockResolvedValue({
      ok: true,
      previewUrl: 'data:image/png;base64,AAAA',
    });
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    await screen.findByTestId('patient-form-photo-img');
    await user.click(screen.getByTestId('patient-form-photo-remove'));
    expect(
      screen.getByTestId('patient-form-photo-status'),
    ).toBeEmptyDOMElement();
  });

  it('moves keyboard focus to the webcam button when the photo is removed (it stays mounted)', async () => {
    const user = userEvent.setup();
    captureWebcamPhoto.mockResolvedValue({
      ok: true,
      previewUrl: 'data:image/png;base64,AAAA',
    });
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    await screen.findByTestId('patient-form-photo-img');

    // Keyboard path: focus Remove photo and press Enter.
    const remove = screen.getByTestId('patient-form-photo-remove');
    remove.focus();
    expect(remove).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(
      screen.queryByTestId('patient-form-photo-remove'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('patient-form-photo-webcam')).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it('clears the old failure message while a new attempt runs and ignores a second click meanwhile', async () => {
    const user = userEvent.setup();
    captureWebcamPhoto.mockResolvedValueOnce({ ok: false, reason: 'timeout' });
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    await screen.findByTestId('patient-form-photo-denied');

    let finish: (r: CaptureResult) => void = () => undefined;
    captureWebcamPhoto.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    await user.click(screen.getByTestId('patient-form-photo-webcam'));

    expect(captureWebcamPhoto).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByTestId('patient-form-photo-denied'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('patient-form-photo-capturing'),
    ).toHaveTextContent(en['patient.form.photo.capturing']);

    finish({ ok: true, previewUrl: 'data:image/png;base64,AAAA' });
    expect(await screen.findByTestId('patient-form-photo-img')).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA',
    );
    expect(
      screen.queryByTestId('patient-form-photo-capturing'),
    ).not.toBeInTheDocument();
  });

  it('offers exactly one Retake button after a webcam capture, and it retakes (twice in a row)', async () => {
    const user = userEvent.setup();
    captureWebcamPhoto.mockResolvedValue({
      ok: true,
      previewUrl: 'data:image/png;base64,AAAA',
    });
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    await screen.findByTestId('patient-form-photo-img');

    const retakes = screen.getAllByRole('button', {
      name: en['patient.form.photo.retake'],
    });
    expect(retakes).toHaveLength(1);
    expect(screen.getByTestId('patient-form-photo-webcam')).toBe(retakes[0]);
    expect(
      screen.queryByTestId('patient-form-photo-retake'),
    ).not.toBeInTheDocument();

    await user.click(retakes[0]!);
    await waitFor(() => expect(captureWebcamPhoto).toHaveBeenCalledTimes(2));
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    await waitFor(() => expect(captureWebcamPhoto).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId('patient-form-photo-img')).toBeInTheDocument();
  });

  it('shows no Retake button for a file photo; Choose file stays the way to swap it', async () => {
    const user = userEvent.setup();
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    await user.upload(
      screen.getByTestId('patient-form-photo-file-input') as HTMLInputElement,
      new File(['x'], 'photo.png', { type: 'image/png' }),
    );
    await screen.findByTestId('patient-form-photo-img');
    expect(
      screen.queryByRole('button', { name: en['patient.form.photo.retake'] }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('patient-form-photo-file')).toBeEnabled();
    expect(screen.getByTestId('patient-form-photo-remove')).toBeInTheDocument();
  });
});

// A4: a capture is cancelled when the doctor leaves; nothing updates after.
describe('PatientForm (S06) — capture is cancelled on unmount, Cancel and file choice (PAT-001, HC-MVP1-038)', () => {
  /** A capture that stays pending; exposes the signal it was given. */
  function pendingCapture(): {
    signal: () => AbortSignal | undefined;
    finish: (r: CaptureResult) => void;
  } {
    let sig: AbortSignal | undefined;
    let finish: (r: CaptureResult) => void = () => undefined;
    captureWebcamPhoto.mockImplementationOnce(
      (_camera: unknown, signal?: AbortSignal) => {
        sig = signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    );
    return { signal: () => sig, finish: (r) => finish(r) };
  }

  it('aborts the capture on unmount and updates nothing afterwards (no act or state warnings)', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cap = pendingCapture();
    const { unmount } = render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    expect(cap.signal()?.aborted).toBe(false);

    unmount();
    expect(cap.signal()?.aborted).toBe(true);

    // The camera layer answers late; the unmounted form must stay silent.
    await act(async () => {
      cap.finish({ ok: true, previewUrl: 'data:image/png;base64,AAAA' });
      await Promise.resolve();
    });
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
    errors.mockRestore();
    warns.mockRestore();
  });

  it('aborts the capture when Cancel is clicked and does not flash a failure', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const cap = pendingCapture();
    render(<PatientForm mode="new" onCancel={onCancel} />);
    await screen.findByTestId('patient-form-code');
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    await user.click(screen.getByTestId('patient-form-cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(cap.signal()?.aborted).toBe(true);
    await act(async () => {
      cap.finish({ ok: false, reason: 'aborted' });
      await Promise.resolve();
    });
    expect(
      screen.getByTestId('patient-form-photo-status'),
    ).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('patient-form-photo-denied'),
    ).not.toBeInTheDocument();
  });

  it('a cancelled capture never attaches a photo that arrives late', async () => {
    const user = userEvent.setup();
    const cap = pendingCapture();
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    await user.upload(
      screen.getByTestId('patient-form-photo-file-input') as HTMLInputElement,
      new File(['x'], 'photo.png', { type: 'image/png' }),
    );
    expect(cap.signal()?.aborted).toBe(true);
    await act(async () => {
      cap.finish({ ok: true, previewUrl: 'data:image/png;base64,LATE' });
      await Promise.resolve();
    });
    expect(screen.getByTestId('patient-form-photo-img')).toHaveAttribute(
      'src',
      'blob:photo',
    );
    expect(
      screen.queryByTestId('patient-form-photo-capturing'),
    ).not.toBeInTheDocument();
  });
});
