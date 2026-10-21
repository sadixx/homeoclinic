// S06 Patient register / edit form (docs/ui/S06-patient-form.md;
// HC-MVP1-036/038/039). PAT-001/002/004/006/007/012.
//
// Calls ONLY the generated typed bindings (UI -> typed commands only; never
// SQL or raw filesystem paths). Inline validation per 00-conventions §4
// (message under the field, on blur and on submit); every control carries its
// spec data-testid (R-UI-003); all visible text comes from en.json (R-UI-007).
//
// Photo (HC-MVP1-038): file-based attach is real; webcam access is SIMULATED
// at random via `simulateCameraAccess()` (see ./photo). The attached photo is
// DELETABLE, RE-CAPTURABLE and UPDATABLE (file<->webcam swap, remove, retake)
// and its opaque ref is wired into `photo_path` on create/update.
//
// R2 slice: Tags (PAT-007), Attachments (PAT-009) and Consent (PAT-012) are P1
// and render DISABLED with a no-dead-end note; the form saves without them.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Upload, Trash2, RefreshCw } from 'lucide-react';

import { commands } from '@/bindings';
import { run } from '@/shared/command';
import { t } from '@/shared/strings';
import { type AttachedPhoto, captureWebcamPhoto, webcamRef } from './photo';

/** How the form is opened. */
export type PatientFormMode = 'new' | 'edit';

export interface PatientFormProps {
  /** `new` previews the next code; `edit` loads the patient first. */
  readonly mode: PatientFormMode;
  /** The patient to edit (required when `mode === 'edit'`). */
  readonly patientId?: string;
  /** Called with (patientId, code) after a successful save. */
  readonly onSaved?: (patientId: string, code: string) => void;
  /** Called with the matched patient id from the duplicate banner. */
  readonly onOpenExisting?: (patientId: string) => void;
  /** Called when the doctor cancels an unsaved new patient. */
  readonly onCancel?: () => void;
}

/** One duplicate candidate rendered in the banner. */
interface DuplicateMatch {
  patientId: string;
  code: string;
  name: string;
  mobile: string | null;
}

/** Local, controlled form state (strings; parsed only at submit). */
interface FormState {
  name: string;
  sex: string;
  dob: string;
  age: string;
  marital: string;
  mobile: string;
  mobileAlt: string;
  address: string;
  city: string;
  occupation: string;
  bloodGroup: string;
  referredBy: string;
}

const EMPTY: FormState = {
  name: '',
  sex: '',
  dob: '',
  age: '',
  marital: '',
  mobile: '',
  mobileAlt: '',
  address: '',
  city: '',
  occupation: '',
  bloodGroup: '',
  referredBy: '',
};

/** Field-level validation errors keyed by field name. */
type FieldErrors = Partial<Record<'name' | 'age' | 'mobile' | 'form', string>>;

/**
 * Extract the whole-year count from a human age label (e.g. `34y`, `2y 3m`,
 * `34`) as a string for the editable age field, or `''` when the label has no
 * leading year number (e.g. a months-only infant label). Display formatting
 * lives in the backend; this only recovers an editable integer so edit-mode
 * saves satisfy the DOB-or-age rule.
 */
function ageYearsFromLabel(ageLabel: string): string {
  const match =
    /^\s*(\d+)\s*y/i.exec(ageLabel) ?? /^\s*(\d+)\s*$/.exec(ageLabel);
  return match ? match[1]! : '';
}

/**
 * Whole-year age computed from a `YYYY-MM-DD` date of birth relative to today,
 * as a string for the age field; `''` when the DOB is empty or unparseable or
 * in the future. DOB is optional; when the doctor enters it the age field is
 * derived from it (age itself is the required value).
 */
function ageFromDob(dob: string): string {
  const d = dob.trim();
  if (d === '') return '';
  const born = new Date(`${d}T00:00:00`);
  if (Number.isNaN(born.getTime())) return '';
  const now = new Date();
  if (born.getTime() > now.getTime()) return '';
  let years = now.getFullYear() - born.getFullYear();
  const beforeBirthday =
    now.getMonth() < born.getMonth() ||
    (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) years -= 1;
  return years >= 0 && years <= 120 ? String(years) : '';
}

/** Register or edit a patient. */
export function PatientForm({
  mode,
  patientId,
  onSaved,
  onOpenExisting,
  onCancel,
}: PatientFormProps): JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [code, setCode] = useState<string>('');
  const [photo, setPhoto] = useState<AttachedPhoto | null>(null);
  const [cameraDenied, setCameraDenied] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [dismissedDuplicate, setDismissedDuplicate] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Preview the next code (new) or load the patient (edit).
  useEffect(() => {
    let cancelled = false;
    void (async (): Promise<void> => {
      if (mode === 'new') {
        try {
          const res = await run(commands.patientNextCode());
          if (!cancelled) setCode(res.code);
        } catch {
          /* code preview is best-effort; a save still assigns a real code */
        }
        return;
      }
      if (patientId === undefined) return;
      try {
        const d = await run(commands.patientGetDashboard({ patientId }));
        if (cancelled) return;
        const demo = d.demographics;
        setCode(demo.code);
        setForm({
          ...EMPTY,
          name: demo.name,
          sex: demo.sex ?? '',
          // The dashboard carries a human age label (e.g. `34y`, `2y 3m`), not
          // the raw stored age/DOB. Seed the editable age field from its leading
          // year count so the DOB-or-age rule is satisfied on save and the value
          // round-trips; the doctor can still overwrite it.
          age: ageYearsFromLabel(demo.ageLabel),
          mobile: demo.mobile ?? '',
          city: demo.city ?? '',
          referredBy: demo.referredBy ?? '',
        });
        if (demo.photoPath) {
          setPhoto({
            previewUrl: demo.photoPath,
            ref: demo.photoPath,
            source: 'file',
          });
        }
      } catch {
        if (!cancelled) setErrors({ form: t('patient.form.error.generic') });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, patientId]);

  const set = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]): void => {
      setForm((f) => ({ ...f, [key]: value }));
    },
    [],
  );

  // Duplicate detection on blur of name together with mobile or DOB (PAT-004).
  const runDuplicateCheck = useCallback(async (): Promise<void> => {
    const name = form.name.trim();
    if (name === '' || (form.mobile.trim() === '' && form.dob.trim() === '')) {
      return;
    }
    try {
      const res = await run(
        commands.patientCheckDuplicate({
          name,
          mobile: form.mobile.trim() === '' ? null : form.mobile.trim(),
          dob: form.dob.trim() === '' ? null : form.dob.trim(),
        }),
      );
      setDismissedDuplicate(false);
      setDuplicates(
        res.matches.map((m) => ({
          patientId: m.patientId,
          code: m.code,
          name: m.name,
          mobile: m.mobile,
        })),
      );
    } catch {
      /* a duplicate check never blocks the flow (PAT-004) */
    }
  }, [form.name, form.mobile, form.dob]);

  // ---- Photo (HC-MVP1-038) -------------------------------------------------
  const onChooseFile = useCallback((): void => {
    fileInputRef.current?.click();
  }, []);

  const onFileSelected = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const file = event.target.files?.[0];
      if (file === undefined) return;
      setCameraDenied(false);
      setPhoto((prev) => {
        if (prev && prev.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(prev.previewUrl);
        }
        return {
          previewUrl: URL.createObjectURL(file),
          ref: file.name,
          source: 'file',
        };
      });
      // Allow re-selecting the same file name later.
      event.target.value = '';
    },
    [],
  );

  const onUseWebcam = useCallback(async (): Promise<void> => {
    // Capture from the default camera (real getUserMedia; simulated fallback
    // in headless/E2E). Camera switching arrives with Settings (SET-007).
    const result = await captureWebcamPhoto();
    if (!result.ok || result.previewUrl === undefined) {
      setCameraDenied(true);
      return;
    }
    setCameraDenied(false);
    const previewUrl = result.previewUrl;
    setPhoto((prev) => {
      if (prev && prev.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return {
        previewUrl,
        ref: webcamRef(),
        source: 'webcam',
      };
    });
  }, []);

  const onRemovePhoto = useCallback((): void => {
    setPhoto((prev) => {
      if (prev && prev.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return null;
    });
    setCameraDenied(false);
  }, []);

  // ---- Submit --------------------------------------------------------------
  const validate = useCallback((): FieldErrors => {
    const next: FieldErrors = {};
    if (form.name.trim() === '') {
      next.name = t('patient.form.error.nameRequired');
    }
    const hasAge = form.age.trim() !== '';
    if (!hasAge) {
      next.age = t('patient.form.error.ageRequired');
    } else {
      const n = Number(form.age);
      if (!Number.isInteger(n) || n < 0 || n > 120) {
        next.age = t('patient.form.error.ageRange');
      }
    }
    if (form.mobile.trim() !== '' && !/^\d+$/.test(form.mobile.trim())) {
      next.mobile = t('patient.form.error.mobileDigits');
    }
    return next;
  }, [form]);

  const onSubmit = useCallback(async (): Promise<void> => {
    if (saving) return;
    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});
    setSaving(true);

    const ageYears = form.age.trim() === '' ? null : Number(form.age);
    const payload = {
      name: form.name.trim(),
      sex: form.sex === '' ? null : form.sex,
      dob: form.dob.trim() === '' ? null : form.dob.trim(),
      ageYears,
      dobIsEstimated: ageYears !== null && form.dob.trim() === '' ? true : null,
      mobile: form.mobile.trim() === '' ? null : form.mobile.trim(),
      mobileAlt: form.mobileAlt.trim() === '' ? null : form.mobileAlt.trim(),
      address: form.address.trim() === '' ? null : form.address.trim(),
      city: form.city.trim() === '' ? null : form.city.trim(),
      occupation: form.occupation.trim() === '' ? null : form.occupation.trim(),
      maritalStatus: form.marital === '' ? null : form.marital,
      bloodGroup: form.bloodGroup === '' ? null : form.bloodGroup,
      referredBy: form.referredBy.trim() === '' ? null : form.referredBy.trim(),
      photoPath: photo?.ref ?? null,
      allergies: null,
      alerts: null,
      tags: null,
      consentAt: null,
    };

    try {
      if (mode === 'new') {
        const res = await run(commands.patientCreate(payload));
        onSaved?.(res.patientId, res.code);
      } else if (patientId !== undefined) {
        await run(commands.patientUpdate({ patientId, ...payload }));
        onSaved?.(patientId, code);
      }
    } catch {
      setErrors({ form: t('patient.form.error.generic') });
    } finally {
      setSaving(false);
    }
  }, [saving, validate, form, photo, mode, patientId, code, onSaved]);

  const showDuplicate = duplicates.length > 0 && !dismissedDuplicate;
  // Pre-composed so the banner / note render identifiers, not JSX string
  // literals (R-UI-007 / jsx-no-literals).
  const duplicateLabel = duplicates[0]
    ? `${duplicates[0].name} (${duplicates[0].code})`
    : '';
  const consentDeferredLabel = `(${t('patient.form.consent.deferred')})`;
  const title =
    mode === 'new' ? t('patient.form.newTitle') : t('patient.form.editTitle');
  const nameValid = form.name.trim() !== '';

  return (
    <section
      data-testid="patient-form"
      aria-label={title}
      className="mx-auto flex max-w-4xl flex-col gap-4 p-6 text-[0.875rem] text-slate-900"
    >
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold" data-testid="patient-form-title">
          {title}
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">
            {t('patient.form.idLabel')}:{' '}
            <span data-testid="patient-form-code" className="font-mono">
              {code === '' ? t('patient.form.idAuto') : code}
            </span>
          </span>
          <button
            type="button"
            data-testid="patient-form-cancel"
            onClick={() => onCancel?.()}
            className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {t('patient.form.cancel')}
          </button>
          <button
            type="button"
            data-testid="patient-form-save"
            disabled={!nameValid || saving}
            onClick={() => void onSubmit()}
            className={[
              'rounded px-3 py-1.5 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-700',
              !nameValid || saving
                ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                : 'bg-blue-600 text-white',
            ].join(' ')}
          >
            {saving ? t('patient.form.saving') : t('patient.form.save')}
          </button>
        </div>
      </header>

      {errors.form ? (
        <p
          role="alert"
          data-testid="patient-form-error"
          className="text-red-700"
        >
          {errors.form}
        </p>
      ) : null}

      <div className="flex gap-6">
        {/* Photo column (HC-MVP1-038) */}
        <div className="flex w-40 flex-col items-center gap-2">
          <div
            data-testid="patient-form-photo"
            className="flex h-32 w-32 items-center justify-center overflow-hidden rounded border border-slate-300 bg-slate-50"
          >
            {photo ? (
              <img
                data-testid="patient-form-photo-img"
                src={photo.previewUrl}
                alt={t('patient.form.photo')}
                className="h-full w-full object-cover"
              />
            ) : (
              <span
                data-testid="patient-form-photo-none"
                className="px-2 text-center text-xs text-slate-500"
              >
                {t('patient.form.photo.none')}
              </span>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-1">
            <button
              type="button"
              data-testid="patient-form-photo-webcam"
              onClick={() => void onUseWebcam()}
              className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              {photo?.source === 'webcam'
                ? t('patient.form.photo.retake')
                : t('patient.form.photo.webcam')}
            </button>
            <button
              type="button"
              data-testid="patient-form-photo-file"
              onClick={onChooseFile}
              className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              {t('patient.form.photo.file')}
            </button>
            {photo ? (
              <>
                <button
                  type="button"
                  data-testid="patient-form-photo-retake"
                  onClick={
                    photo.source === 'webcam'
                      ? () => void onUseWebcam()
                      : onChooseFile
                  }
                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('patient.form.photo.retake')}
                </button>
                <button
                  type="button"
                  data-testid="patient-form-photo-remove"
                  onClick={onRemovePhoto}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('patient.form.photo.remove')}
                </button>
              </>
            ) : null}
          </div>
          <input
            ref={fileInputRef}
            data-testid="patient-form-photo-file-input"
            type="file"
            accept="image/*"
            onChange={onFileSelected}
            className="sr-only"
            aria-label={t('patient.form.photo.file')}
          />
          {cameraDenied ? (
            <p
              role="alert"
              data-testid="patient-form-photo-denied"
              className="text-center text-xs text-red-700"
            >
              {t('patient.form.photo.cameraDenied')}
            </p>
          ) : null}
        </div>

        {/* Fields column */}
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3">
          <Field
            label={t('patient.form.name')}
            required
            error={errors.name}
            errorTestId="patient-form-name-error"
          >
            <input
              data-testid="patient-form-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              onBlur={() => void runDuplicateCheck()}
              className="input"
            />
          </Field>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs font-medium text-slate-600">
              {t('patient.form.sex')}
            </legend>
            <div
              data-testid="patient-form-sex"
              role="radiogroup"
              aria-label={t('patient.form.sex')}
              className="flex gap-3 text-sm"
            >
              {(
                [
                  ['M', t('patient.form.sex.male')],
                  ['F', t('patient.form.sex.female')],
                  ['O', t('patient.form.sex.other')],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="patient-sex"
                    value={value}
                    checked={form.sex === value}
                    onChange={() => set('sex', value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <Field label={t('patient.form.dob')}>
            <input
              data-testid="patient-form-dob"
              type="date"
              value={form.dob}
              onChange={(e) => {
                const dob = e.target.value;
                // DOB is optional; entering it derives the (required) age.
                const derived = ageFromDob(dob);
                setForm((f) => ({
                  ...f,
                  dob,
                  age: derived !== '' ? derived : f.age,
                }));
              }}
              onBlur={() => void runDuplicateCheck()}
              className="input"
            />
          </Field>

          <Field
            label={t('patient.form.age')}
            error={errors.age}
            errorTestId="patient-form-age-error"
          >
            <input
              data-testid="patient-form-age"
              inputMode="numeric"
              value={form.age}
              onChange={(e) => set('age', e.target.value)}
              className="input"
            />
          </Field>

          <Field label={t('patient.form.marital')}>
            <select
              data-testid="patient-form-marital"
              value={form.marital}
              onChange={(e) => set('marital', e.target.value)}
              className="input"
            >
              <option value="">{t('common.none')}</option>
              <option value="single">{t('patient.form.marital.single')}</option>
              <option value="married">
                {t('patient.form.marital.married')}
              </option>
              <option value="other">{t('patient.form.marital.other')}</option>
            </select>
          </Field>

          <Field
            label={t('patient.form.mobile')}
            error={errors.mobile}
            errorTestId="patient-form-mobile-error"
          >
            <input
              data-testid="patient-form-mobile"
              inputMode="numeric"
              value={form.mobile}
              onChange={(e) => set('mobile', e.target.value)}
              onBlur={() => void runDuplicateCheck()}
              className="input"
            />
          </Field>

          <Field label={t('patient.form.mobileAlt')}>
            <input
              data-testid="patient-form-mobile-alt"
              inputMode="numeric"
              value={form.mobileAlt}
              onChange={(e) => set('mobileAlt', e.target.value)}
              className="input"
            />
          </Field>

          <Field label={t('patient.form.address')}>
            <textarea
              data-testid="patient-form-address"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              className="input"
              rows={2}
            />
          </Field>

          <Field label={t('patient.form.city')}>
            <input
              data-testid="patient-form-city"
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
              className="input"
            />
          </Field>

          <Field label={t('patient.form.occupation')}>
            <input
              data-testid="patient-form-occupation"
              value={form.occupation}
              onChange={(e) => set('occupation', e.target.value)}
              className="input"
            />
          </Field>

          <Field label={t('patient.form.bloodgroup')}>
            <select
              data-testid="patient-form-bloodgroup"
              value={form.bloodGroup}
              onChange={(e) => set('bloodGroup', e.target.value)}
              className="input"
            >
              <option value="">{t('common.none')}</option>
              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                <option key={bg} value={bg}>
                  {bg}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t('patient.form.referred')}>
            <input
              data-testid="patient-form-referred"
              value={form.referredBy}
              onChange={(e) => set('referredBy', e.target.value)}
              className="input"
            />
          </Field>
        </div>
      </div>

      {/* Duplicate warning (PAT-004) */}
      {showDuplicate && duplicates[0] ? (
        <div
          role="alert"
          data-testid="patient-form-duplicate"
          className="rounded border border-amber-400 bg-amber-50 p-3 text-sm"
        >
          <p className="mb-2">
            {t('patient.form.duplicate.title')}: {duplicateLabel}
            {duplicates[0].mobile
              ? ` — ${t('patient.form.duplicate.with')} ${duplicates[0].mobile}`
              : ''}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="patient-form-duplicate-open"
              onClick={() => onOpenExisting?.(duplicates[0]!.patientId)}
              className="rounded bg-blue-600 px-3 py-1.5 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-blue-700"
            >
              {t('patient.form.duplicate.open')}
            </button>
            <button
              type="button"
              data-testid="patient-form-duplicate-continue"
              onClick={() => setDismissedDuplicate(true)}
              className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {t('patient.form.duplicate.continue')}
            </button>
          </div>
        </div>
      ) : null}

      {/* P1 deferred sections (render disabled, no dead end) */}
      <div className="flex flex-col gap-2 border-t border-slate-200 pt-3 text-sm">
        <div className="flex items-center gap-2">
          <label htmlFor="patient-form-tags" className="text-slate-600">
            {t('patient.form.tags')}
          </label>
          <input
            id="patient-form-tags"
            data-testid="patient-form-tags"
            disabled
            aria-disabled="true"
            title={t('patient.form.tags.deferred')}
            placeholder={t('patient.form.tags.deferred')}
            className="input flex-1 cursor-not-allowed bg-slate-100 text-slate-400"
          />
        </div>
        <label className="flex items-center gap-2 text-slate-600">
          <input
            type="checkbox"
            data-testid="patient-form-consent"
            disabled
            aria-disabled="true"
            title={t('patient.form.consent.deferred')}
          />
          {t('patient.form.consent')}{' '}
          <span className="text-xs text-slate-400">{consentDeferredLabel}</span>
        </label>
      </div>
    </section>
  );
}

/** A labelled field wrapper with an inline error slot (conventions §4). */
function Field({
  label,
  required = false,
  error,
  errorTestId,
  children,
}: {
  readonly label: string;
  readonly required?: boolean;
  readonly error?: string | undefined;
  readonly errorTestId?: string | undefined;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">
        {label}
        {required ? ' *' : ''}
      </span>
      {children}
      {error !== undefined ? (
        <span
          role="alert"
          {...(errorTestId !== undefined ? { 'data-testid': errorTestId } : {})}
          className="text-xs text-red-700"
        >
          {error}
        </span>
      ) : null}
    </label>
  );
}
