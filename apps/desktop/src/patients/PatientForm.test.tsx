// Component tests for the S06 patient register / edit form (HC-MVP1-036, 038,
// 039; docs/ui/S06-patient-form.md). CUT: the real <PatientForm /> component.
//
// The ONLY fake is the dependency: the typed Tauri bindings
// (`vi.mock('@/bindings')`, R-TEST-002) — never the component. Asserts
// behaviour and visible en.json strings (R-UI-007); every control is found by
// its spec data-testid (R-UI-003). Mock fns are created with `vi.hoisted` so
// they are reachable inside the hoisted `vi.mock` factory (the M1 pattern).
//
// Photo (HC-MVP1-038): file-based attach is fully real (an <input type=file>
// with an object URL preview); webcam access is SIMULATED at random, so the
// webcam grant/deny is driven by a seam the test controls via Math.random,
// never a real device. The lifecycle attach -> remove -> retake -> swap is
// asserted here.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

import en from '@/locales/en.json';
import { PatientForm } from './PatientForm';

beforeEach(() => {
  nextCode.mockReset();
  nextCode.mockResolvedValue({ code: 'HC-000312' });
  checkDuplicate.mockReset();
  checkDuplicate.mockResolvedValue({ matches: [] });
  createPatient.mockReset();
  createPatient.mockResolvedValue({
    patientId: 'p-new',
    code: 'HC-000312',
  });
  updatePatient.mockReset();
  updatePatient.mockResolvedValue(null);
  getDashboard.mockReset();
  // URL.createObjectURL / revokeObjectURL are not in jsdom.
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

describe('PatientForm (S06) — new patient', () => {
  it('previews the next auto code read-only (PAT-002)', async () => {
    render(<PatientForm mode="new" />);
    const code = await screen.findByTestId('patient-form-code');
    expect(code).toHaveTextContent('HC-000312');
  });

  it('keeps Save disabled until a name is entered, then enables it', async () => {
    const user = userEvent.setup();
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');

    const save = screen.getByTestId('patient-form-save');
    expect(save).toBeDisabled();

    await user.type(screen.getByTestId('patient-form-name'), 'Ramesh Kumar');
    expect(save).toBeEnabled();
  });

  it('requires age when no DOB is given (PAT-001)', async () => {
    const user = userEvent.setup();
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');

    await user.type(screen.getByTestId('patient-form-name'), 'Ramesh Kumar');
    await user.click(screen.getByTestId('patient-form-save'));

    expect(screen.getByTestId('patient-form-age-error')).toHaveTextContent(
      en['patient.form.error.ageRequired'],
    );
    expect(createPatient).not.toHaveBeenCalled();
  });

  it('auto-fills age from a directly entered DOB (PAT-001)', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<PatientForm mode="new" onSaved={onSaved} />);
    await screen.findByTestId('patient-form-code');

    await user.type(screen.getByTestId('patient-form-name'), 'Sita Devi');
    // Enter DOB directly; the age field fills from it (DOB not mandatory,
    // age is the required value).
    const dob = screen.getByTestId('patient-form-dob') as HTMLInputElement;
    const year = new Date().getFullYear() - 40;
    // A birthday already passed this year => exactly 40.
    fireEvent.change(dob, { target: { value: `${year}-01-01` } });

    const age = screen.getByTestId('patient-form-age') as HTMLInputElement;
    expect(age.value).toBe('40');

    await user.click(screen.getByTestId('patient-form-save'));
    await waitFor(() => expect(createPatient).toHaveBeenCalledTimes(1));
    const arg = createPatient.mock.calls[0]![0];
    expect(arg.ageYears).toBe(40);
    expect(arg.dob).toBe(`${year}-01-01`);
  });

  it('creates a patient with the typed command and reports the new id', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<PatientForm mode="new" onSaved={onSaved} />);
    await screen.findByTestId('patient-form-code');

    await user.type(screen.getByTestId('patient-form-name'), 'Ramesh Kumar');
    await user.type(screen.getByTestId('patient-form-age'), '34');
    await user.click(screen.getByTestId('patient-form-save'));

    await waitFor(() => expect(createPatient).toHaveBeenCalledTimes(1));
    const arg = createPatient.mock.calls[0]![0];
    expect(arg.name).toBe('Ramesh Kumar');
    expect(arg.ageYears).toBe(34);
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith('p-new', 'HC-000312'),
    );
  });
});

describe('PatientForm (S06) — duplicate warning (PAT-004)', () => {
  it('shows the duplicate banner with Open / Continue when name+mobile match', async () => {
    checkDuplicate.mockResolvedValue({
      matches: [
        {
          patientId: 'p-123',
          code: 'HC-000123',
          name: 'Ramesh Kumar',
          mobile: '9876543210',
          dob: null,
        },
      ],
    });
    const user = userEvent.setup();
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');

    await user.type(screen.getByTestId('patient-form-name'), 'Ramesh Kumar');
    const mobile = screen.getByTestId('patient-form-mobile');
    await user.type(mobile, '9876543210');
    await user.tab(); // blur triggers the duplicate check

    const banner = await screen.findByTestId('patient-form-duplicate');
    expect(banner).toHaveTextContent('HC-000123');
    expect(
      screen.getByTestId('patient-form-duplicate-open'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('patient-form-duplicate-continue'),
    ).toBeInTheDocument();
  });

  it('dismisses the banner on Continue anyway and keeps entered data', async () => {
    checkDuplicate.mockResolvedValue({
      matches: [
        {
          patientId: 'p-123',
          code: 'HC-000123',
          name: 'Ramesh Kumar',
          mobile: '9876543210',
          dob: null,
        },
      ],
    });
    const user = userEvent.setup();
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');

    await user.type(screen.getByTestId('patient-form-name'), 'Ramesh Kumar');
    await user.type(screen.getByTestId('patient-form-mobile'), '9876543210');
    await user.tab();
    await screen.findByTestId('patient-form-duplicate');

    await user.click(screen.getByTestId('patient-form-duplicate-continue'));
    expect(
      screen.queryByTestId('patient-form-duplicate'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('patient-form-name')).toHaveValue('Ramesh Kumar');
  });

  it('opens the existing patient from the banner (PAT-004)', async () => {
    checkDuplicate.mockResolvedValue({
      matches: [
        {
          patientId: 'p-123',
          code: 'HC-000123',
          name: 'Ramesh Kumar',
          mobile: '9876543210',
          dob: null,
        },
      ],
    });
    const onOpenExisting = vi.fn();
    const user = userEvent.setup();
    render(<PatientForm mode="new" onOpenExisting={onOpenExisting} />);
    await screen.findByTestId('patient-form-code');

    await user.type(screen.getByTestId('patient-form-name'), 'Ramesh Kumar');
    await user.type(screen.getByTestId('patient-form-mobile'), '9876543210');
    await user.tab();
    await screen.findByTestId('patient-form-duplicate');
    await user.click(screen.getByTestId('patient-form-duplicate-open'));

    expect(onOpenExisting).toHaveBeenCalledWith('p-123');
  });
});

describe('PatientForm (S06) — photo lifecycle (HC-MVP1-038)', () => {
  it('attaches a file photo and shows the preview (file path is real)', async () => {
    const user = userEvent.setup();
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');

    const file = new File(['x'], 'ramesh.jpg', { type: 'image/jpeg' });
    const input = screen.getByTestId('patient-form-photo-file-input');
    await user.upload(input as HTMLInputElement, file);

    expect(await screen.findByTestId('patient-form-photo-img')).toHaveAttribute(
      'src',
      'blob:photo',
    );
  });

  it('removes an attached photo (DELETABLE)', async () => {
    const user = userEvent.setup();
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');

    const file = new File(['x'], 'ramesh.jpg', { type: 'image/jpeg' });
    await user.upload(
      screen.getByTestId('patient-form-photo-file-input') as HTMLInputElement,
      file,
    );
    await screen.findByTestId('patient-form-photo-img');

    await user.click(screen.getByTestId('patient-form-photo-remove'));
    expect(
      screen.queryByTestId('patient-form-photo-img'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('patient-form-photo-none')).toBeInTheDocument();
  });

  it('simulates a GRANTED webcam and attaches a captured frame (RE-CAPTURABLE)', async () => {
    // The simulated camera grants when the seam says so.
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // > 0.5 => granted
    const user = userEvent.setup();
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');

    await user.click(screen.getByTestId('patient-form-photo-webcam'));

    expect(
      await screen.findByTestId('patient-form-photo-img'),
    ).toBeInTheDocument();
    // A retake control is offered once a photo exists.
    expect(screen.getByTestId('patient-form-photo-retake')).toBeInTheDocument();
  });

  it('simulates a DENIED webcam and shows a no-camera message, no photo attached', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.5 => denied
    const user = userEvent.setup();
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');

    await user.click(screen.getByTestId('patient-form-photo-webcam'));

    expect(
      await screen.findByTestId('patient-form-photo-denied'),
    ).toHaveTextContent(en['patient.form.photo.cameraDenied']);
    expect(
      screen.queryByTestId('patient-form-photo-img'),
    ).not.toBeInTheDocument();
  });

  it('swaps a file photo for a webcam photo then saves the final photo ref (UPDATABLE)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // granted
    const user = userEvent.setup();
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');

    // 1) file first
    await user.upload(
      screen.getByTestId('patient-form-photo-file-input') as HTMLInputElement,
      new File(['x'], 'first.jpg', { type: 'image/jpeg' }),
    );
    await screen.findByTestId('patient-form-photo-img');

    // 2) swap to webcam
    await user.click(screen.getByTestId('patient-form-photo-webcam'));
    await screen.findByTestId('patient-form-photo-img');

    // Save: a non-null photoPath is sent (the final capture wins).
    await user.type(screen.getByTestId('patient-form-name'), 'Ramesh Kumar');
    await user.type(screen.getByTestId('patient-form-age'), '34');
    await user.click(screen.getByTestId('patient-form-save'));

    await waitFor(() => expect(createPatient).toHaveBeenCalledTimes(1));
    const arg = createPatient.mock.calls[0]![0];
    expect(arg.photoPath).toBeTruthy();
  });
});

describe('PatientForm (S06) — edit mode', () => {
  it('loads the patient and calls patient_update on save', async () => {
    getDashboard.mockResolvedValue({
      demographics: {
        code: 'HC-000123',
        name: 'Ramesh Kumar',
        ageLabel: '34y',
        sex: 'M',
        mobile: '9876543210',
        city: 'Pune',
        referredBy: 'Dr Rao',
        photoPath: null,
      },
      allergies: null,
      alerts: null,
      duesPaise: 0,
      visits: [],
      lastPrescription: null,
      family: [],
    });
    const user = userEvent.setup();
    render(<PatientForm mode="edit" patientId="p-123" />);

    const name = await screen.findByTestId('patient-form-name');
    expect(name).toHaveValue('Ramesh Kumar');
    expect(screen.getByTestId('patient-form-code')).toHaveTextContent(
      'HC-000123',
    );

    await user.clear(name);
    await user.type(name, 'Ramesh K Kumar');
    await user.click(screen.getByTestId('patient-form-save'));

    await waitFor(() => expect(updatePatient).toHaveBeenCalledTimes(1));
    expect(updatePatient.mock.calls[0]![0].patientId).toBe('p-123');
    expect(createPatient).not.toHaveBeenCalled();
  });

  it('renders the P1 deferred sections disabled with a no-dead-end note', async () => {
    render(<PatientForm mode="new" />);
    await screen.findByTestId('patient-form-code');
    expect(screen.getByTestId('patient-form-tags')).toBeDisabled();
    expect(screen.getByTestId('patient-form-consent')).toBeDisabled();
  });
});
