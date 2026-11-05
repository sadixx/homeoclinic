// S18 General tab form (MS: SET-002/003/004/005/007, PAT-002, LIC-006;
// design §8). One admin form with ONE Save / Cancel (00-conventions §4): Save
// sends the whole form through `settings_save_general` (one transaction, one
// audit row in the backend); Cancel puts back the last loaded values. Inline
// validation under each field, all errors at once, focus on the first.
//
// Reuses the setup widgets: the registration-council dropdown with "Other"
// (CouncilSelect), the Morning/Evening timings (ClinicTimingsInput with its own
// id base), and the phone asked once (saved as doctor + clinic phone by the
// backend). Money is integer paise on the wire; the boxes show rupees.
import { useCallback, useMemo, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';

import { useAppPrefs } from '@/app/useAppPrefs';
import { commands } from '@/bindings';
import type {
  CameraChoice,
  FontSize,
  SaveGeneralSettingsRequest,
  SettingsView,
} from '@/bindings';
import {
  CouncilSelect,
  councilStateFor,
  councilValueOf,
} from '@/setup/CouncilSelect';
import type { CouncilState } from '@/setup/CouncilSelect';
import {
  ClinicTimingsInput,
  timingsBoxesFor,
  validateTimings,
} from '@/setup/ClinicTimingsInput';
import type { TimingsBoxes } from '@/setup/ClinicTimingsInput';
import type { ClinicSession } from '@/setup/clinicTimings';
import { AUTOLOCK_OPTIONS } from '@/shared/autolock';
import { run } from '@/shared/command';
import { formatPaise, parseRupeesToPaise } from '@/shared/money';
import { t } from '@/shared/strings';
import type { StringKey } from '@/shared/strings';

import { CameraCard } from './CameraCard';
import { errorCodeOf, saveErrorMessage } from './settingsErrors';

/** testid / error-key base of the reused timings widget. */
const TIMINGS_ID = 'settings-clinic-timings';
/** Fee cap: Rs 10,00,000 in paise (backend cap, catches a typo). */
const MAX_FEE_PAISE = 100_000_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** PAT-002 / A9: 1-6 of [A-Z0-9-], not ending in a digit (after uppercasing). */
const PREFIX_RE = /^[A-Z0-9-]{0,5}[A-Z-]$/;

const FONT_SIZES: ReadonlyArray<{ size: FontSize; key: StringKey }> = [
  { size: 'normal', key: 'setup.fontSize.normal' },
  { size: 'large', key: 'setup.fontSize.large' },
  { size: 'xlarge', key: 'setup.fontSize.xlarge' },
];

const INPUT =
  'h-10 w-full min-w-0 rounded border border-slate-300 px-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-600 read-only:bg-slate-100 read-only:text-slate-600';

/** The editable form state (raw text as typed). */
interface FormState {
  readonly name: string;
  readonly qualification: string;
  readonly regNo: string;
  readonly council: CouncilState;
  readonly phone: string;
  readonly email: string;
  readonly clinicName: string;
  readonly address: string;
  readonly gstin: string;
  readonly timings: TimingsBoxes;
  readonly feeFirst: string;
  readonly feeFollowup: string;
  readonly idPrefix: string;
  readonly autolockMinutes: number;
  readonly fontSize: FontSize;
  readonly camera: CameraChoice | null;
}

function formFrom(view: SettingsView): FormState {
  return {
    name: view.doctor.name,
    qualification: view.doctor.qualification,
    regNo: view.doctor.regNo,
    council: councilStateFor(view.doctor.regCouncil),
    phone: view.doctor.phone ?? '',
    email: view.doctor.email ?? '',
    clinicName: view.clinic.name,
    address: view.clinic.address,
    gstin: view.clinic.gstin ?? '',
    timings: timingsBoxesFor(view.clinic.timings ?? ''),
    feeFirst: formatPaise(view.clinic.feeFirstPaise),
    feeFollowup: formatPaise(view.clinic.feeFollowupPaise),
    idPrefix: view.app.idPrefix,
    autolockMinutes: view.app.autolockMinutes,
    fontSize: view.app.fontSize,
    camera: view.app.defaultCamera ?? null,
  };
}

const optional = (text: string): string | null =>
  text.trim() === '' ? null : text.trim();

type Errors = Record<string, string>;

/** Validate the form; returns the request to send, or the inline errors (and
 * the timings session holding the first timings error, to bring forward). */
function validate(form: FormState):
  | { readonly ok: true; readonly req: SaveGeneralSettingsRequest }
  | {
      readonly ok: false;
      readonly errors: Errors;
      readonly timingsSession: ClinicSession | null;
    } {
  const errors: Errors = {};
  const required = (id: string, value: string): void => {
    if (value.trim() === '') errors[id] = t('setup.error.required');
  };
  required('settings-doctor-name', form.name);
  required('settings-doctor-qual', form.qualification);
  required('settings-doctor-regno', form.regNo);
  if (form.council.choice === '') {
    errors['settings-doctor-council'] = t('setup.error.required');
  }
  const council = councilValueOf(form.council);
  if (form.council.choice !== '' && council === '') {
    errors['settings-doctor-council-other'] = t('setup.error.required');
  }
  if (form.email.trim() !== '' && !EMAIL_RE.test(form.email.trim())) {
    errors['settings-doctor-email'] = t('setup.error.email');
  }
  required('settings-clinic-name', form.clinicName);
  required('settings-clinic-address', form.address);

  const fee = (id: string, text: string): number => {
    const paise = parseRupeesToPaise(text);
    if (paise === null) {
      errors[id] = t('setup.error.fee');
      return 0;
    }
    if (paise > MAX_FEE_PAISE) {
      errors[id] = t('settings.error.feeCap');
      return 0;
    }
    return paise;
  };
  const feeFirstPaise = fee('settings-fee-consult', form.feeFirst);
  const feeFollowupPaise = fee('settings-fee-followup', form.feeFollowup);

  const idPrefix = form.idPrefix.trim().toUpperCase();
  if (!PREFIX_RE.test(idPrefix)) {
    errors['settings-id-prefix'] = t('settings.error.prefix');
  }

  const timings = validateTimings(form.timings, TIMINGS_ID);
  Object.assign(errors, timings.errors);

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, timingsSession: timings.firstErrorSession };
  }
  return {
    ok: true,
    req: {
      doctor: {
        name: form.name.trim(),
        qualification: form.qualification.trim(),
        regNo: form.regNo.trim(),
        regCouncil: council,
        phone: optional(form.phone),
        email: optional(form.email),
      },
      clinic: {
        name: form.clinicName.trim(),
        address: form.address.trim(),
        timings: timings.value,
        gstin: optional(form.gstin),
        feeFirstPaise,
        feeFollowupPaise,
      },
      app: {
        idPrefix,
        autolockMinutes: form.autolockMinutes,
        fontSize: form.fontSize,
        defaultCamera: form.camera,
      },
    },
  };
}

const FOCUSABLE = 'input, select, textarea, button';

/** Focus the control of the first error key (DOM order of the testids). A
 * key on a group (e.g. the timings session `settings-clinic-timings-evening`)
 * focuses the group's first box. */
function focusFirstError(errors: Errors): void {
  const keys = new Set(Object.keys(errors));
  const first = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid^="settings-"]'),
  ).find((el) => keys.has(el.dataset['testid'] ?? ''));
  if (first === undefined) return;
  const target = first.matches(FOCUSABLE)
    ? first
    : first.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus();
}

/** Props of {@link GeneralSettings}. */
export interface GeneralSettingsProps {
  /** The values loaded from `settings_get` (the Cancel baseline). */
  readonly initial: SettingsView;
  /** Called with the fresh values after a successful Save. */
  readonly onSaved: (view: SettingsView) => void;
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved'; readonly changed: boolean }
  | { readonly kind: 'error'; readonly message: string };

/** The General tab: doctor, clinic, app prefs and camera, one Save. */
export function GeneralSettings({
  initial,
  onSaved,
}: GeneralSettingsProps): JSX.Element {
  const { applySaved } = useAppPrefs();
  const [baseline, setBaseline] = useState<SettingsView>(initial);
  const [form, setForm] = useState<FormState>(() => formFrom(initial));
  const [errors, setErrors] = useState<Errors>({});
  const [session, setSession] = useState<ClinicSession>('morning');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const locked = baseline.identityLocked;

  const set = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]): void => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setStatus((prev) => (prev.kind === 'saved' ? { kind: 'idle' } : prev));
    },
    [],
  );

  const nextId = useMemo(
    () => `${form.idPrefix.trim().toUpperCase()}${baseline.nextNumber}`,
    [form.idPrefix, baseline.nextNumber],
  );

  const autolockOptions = useMemo(() => {
    const opts: number[] = [...AUTOLOCK_OPTIONS];
    if (!opts.includes(form.autolockMinutes)) {
      opts.push(form.autolockMinutes);
      opts.sort((a, b) => a - b);
    }
    return opts;
  }, [form.autolockMinutes]);

  const onCancel = useCallback((): void => {
    setForm(formFrom(baseline));
    setErrors({});
    setStatus({ kind: 'idle' });
  }, [baseline]);

  const onSave = useCallback(async (): Promise<void> => {
    const checked = validate(form);
    if (!checked.ok) {
      setErrors(checked.errors);
      // Bring the timings tab holding the first timings error forward, as the
      // setup wizard does, so its inline error is not in a hidden panel.
      if (checked.timingsSession !== null) setSession(checked.timingsSession);
      setStatus({ kind: 'error', message: t('settings.error.fixFields') });
      // Let the inline errors render, then focus the first one.
      window.setTimeout(() => focusFirstError(checked.errors), 0);
      return;
    }
    setErrors({});
    setStatus({ kind: 'saving' });
    try {
      const resp = await run(commands.settingsSaveGeneral(checked.req));
      setBaseline(resp.settings);
      setForm(formFrom(resp.settings));
      applySaved(resp.settings.app);
      onSaved(resp.settings);
      setStatus({ kind: 'saved', changed: resp.changed });
    } catch (err: unknown) {
      if (errorCodeOf(err) === 'identity_locked') {
        setErrors({ 'settings-doctor-name': saveErrorMessage(err) });
      }
      setStatus({ kind: 'error', message: saveErrorMessage(err) });
    }
  }, [form, applySaved, onSaved]);

  const errorLine = (id: string): JSX.Element | null => {
    const message = errors[id];
    if (message === undefined) return null;
    return (
      <p
        id={`${id}-error`}
        data-testid={`${id}-error`}
        role="alert"
        className="mt-1 text-base text-red-700"
      >
        {message}
      </p>
    );
  };

  const textField = (
    id: string,
    labelKey: StringKey,
    key: keyof Pick<
      FormState,
      | 'name'
      | 'qualification'
      | 'regNo'
      | 'phone'
      | 'email'
      | 'clinicName'
      | 'gstin'
      | 'feeFirst'
      | 'feeFollowup'
      | 'idPrefix'
    >,
    opts: {
      readonly required?: boolean;
      readonly readOnly?: boolean;
      readonly type?: 'text' | 'email';
      readonly inputMode?: 'numeric' | 'decimal';
      readonly hint?: ReactNode;
      readonly prefix?: string;
      readonly className?: string;
    } = {},
  ): JSX.Element => {
    const hintId = opts.hint !== undefined ? `${id}-hint` : undefined;
    const describedBy =
      [errors[id] !== undefined ? `${id}-error` : undefined, hintId]
        .filter(Boolean)
        .join(' ') || undefined;
    return (
      <div className={`flex min-w-0 flex-col ${opts.className ?? ''}`}>
        <label htmlFor={`${id}-input`} className="text-base text-slate-700">
          {t(labelKey)}
          {opts.required ? (
            <span aria-hidden="true">{t('setup.requiredMark')}</span>
          ) : null}
        </label>
        <div className="flex items-center gap-1">
          {opts.prefix !== undefined ? (
            <span aria-hidden="true" className="text-base text-slate-700">
              {opts.prefix}
            </span>
          ) : null}
          <input
            id={`${id}-input`}
            data-testid={id}
            type={opts.type ?? 'text'}
            inputMode={opts.inputMode}
            aria-required={opts.required}
            aria-invalid={errors[id] !== undefined}
            aria-describedby={describedBy}
            readOnly={opts.readOnly}
            value={form[key]}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              set(key, e.target.value)
            }
            className={INPUT}
          />
        </div>
        {opts.hint !== undefined ? (
          <p id={hintId} className="mt-1 text-base text-slate-500">
            {opts.hint}
          </p>
        ) : null}
        {errorLine(id)}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="settings-general">
      {/* Doctor profile */}
      <fieldset className="flex flex-col gap-3 rounded border border-slate-200 p-4">
        <legend className="px-1 text-base font-semibold text-slate-900">
          {t('settings.section.doctor')}
        </legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {textField('settings-doctor-name', 'setup.doctor.name', 'name', {
            required: true,
            readOnly: locked,
          })}
          {textField(
            'settings-doctor-qual',
            'setup.doctor.qualification',
            'qualification',
            { required: true },
          )}
          {textField('settings-doctor-regno', 'setup.doctor.regno', 'regNo', {
            required: true,
            readOnly: locked,
          })}
          <div className="flex min-w-0 flex-col">
            <CouncilSelect
              idBase="settings-doctor-council"
              value={form.council}
              onChange={(next) => set('council', next)}
              errors={errors}
              disabled={locked}
              textSize="text-base"
              controlClassName={INPUT}
            />
          </div>
          {textField('settings-doctor-phone', 'setup.doctor.phone', 'phone', {
            inputMode: 'numeric',
            hint: t('settings.doctor.phoneHint'),
          })}
          {textField('settings-doctor-email', 'setup.doctor.email', 'email', {
            type: 'email',
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span
            id="settings-doctor-signature-label"
            className="text-base text-slate-700"
          >
            {t('settings.doctor.signature')}
          </span>
          <button
            type="button"
            data-testid="settings-doctor-signature"
            disabled
            aria-labelledby="settings-doctor-signature-label settings-doctor-signature"
            aria-describedby="settings-doctor-signature-hint"
            title={t('settings.comingLater')}
            className="h-10 cursor-not-allowed rounded border border-slate-300 px-3 text-base text-slate-500"
          >
            {t('settings.doctor.signatureChoose')}
          </button>
          <span
            id="settings-doctor-signature-hint"
            className="text-base text-slate-500"
          >
            {t('settings.comingLater')}
          </span>
        </div>
        {locked ? (
          <div className="flex flex-col gap-1">
            <span
              data-testid="settings-doctor-identity-locked"
              className="w-fit rounded border border-amber-400 bg-amber-50 px-2 py-0.5 text-base font-medium text-amber-900"
            >
              {t('settings.doctor.lockedBadge')}
            </span>
            <p
              data-testid="settings-doctor-identity-note"
              className="text-base text-slate-600"
            >
              {t('settings.doctor.lockedNote')}
            </p>
          </div>
        ) : (
          <p
            data-testid="settings-doctor-identity-note"
            className="text-base text-slate-600"
          >
            {t('setup.doctor.identityNote')}
          </p>
        )}
      </fieldset>

      {/* Clinic profile */}
      <fieldset className="flex flex-col gap-3 rounded border border-slate-200 p-4">
        <legend className="px-1 text-base font-semibold text-slate-900">
          {t('settings.section.clinic')}
        </legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {textField(
            'settings-clinic-name',
            'setup.clinic.name',
            'clinicName',
            { required: true },
          )}
          {textField('settings-clinic-gstin', 'setup.clinic.gstin', 'gstin')}
          <div className="flex min-w-0 flex-col md:col-span-2">
            <label
              htmlFor="settings-clinic-address-input"
              className="text-base text-slate-700"
            >
              {t('setup.clinic.address')}
              <span aria-hidden="true">{t('setup.requiredMark')}</span>
            </label>
            <textarea
              id="settings-clinic-address-input"
              data-testid="settings-clinic-address"
              aria-required
              aria-invalid={errors['settings-clinic-address'] !== undefined}
              aria-describedby={
                errors['settings-clinic-address'] !== undefined
                  ? 'settings-clinic-address-error'
                  : undefined
              }
              rows={2}
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              className="w-full min-w-0 rounded border border-slate-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            {errorLine('settings-clinic-address')}
          </div>
          <div className="md:col-span-2">
            <ClinicTimingsInput
              idBase={TIMINGS_ID}
              value={form.timings}
              onChange={(next) => set('timings', next)}
              activeSession={session}
              onActiveSessionChange={setSession}
              errors={errors}
            />
          </div>
          {textField(
            'settings-fee-consult',
            'setup.clinic.feeFirst',
            'feeFirst',
            {
              required: true,
              inputMode: 'decimal',
              prefix: t('settings.clinic.feeCurrency'),
            },
          )}
          {textField(
            'settings-fee-followup',
            'setup.clinic.feeFollowup',
            'feeFollowup',
            {
              required: true,
              inputMode: 'decimal',
              prefix: t('settings.clinic.feeCurrency'),
            },
          )}
        </div>
      </fieldset>

      {/* App preferences */}
      <fieldset className="flex flex-col gap-3 rounded border border-slate-200 p-4">
        <legend className="px-1 text-base font-semibold text-slate-900">
          {t('settings.section.app')}
        </legend>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex min-w-0 flex-col">
            {textField(
              'settings-id-prefix',
              'settings.app.idPrefix',
              'idPrefix',
              {
                required: true,
                hint: t('settings.app.idPrefixHint'),
              },
            )}
            <p className="mt-1 text-base text-slate-700">
              {t('settings.app.nextId')}{' '}
              <span
                data-testid="settings-next-id"
                aria-live="polite"
                className="font-mono font-semibold text-slate-900"
              >
                {nextId}
              </span>
            </p>
          </div>
          <div className="flex min-w-0 flex-col">
            <label
              htmlFor="settings-autolock-input"
              className="text-base text-slate-700"
            >
              {t('setup.autolock')}
            </label>
            <select
              id="settings-autolock-input"
              data-testid="settings-autolock"
              value={form.autolockMinutes}
              onChange={(e) => set('autolockMinutes', Number(e.target.value))}
              className="h-10 w-32 rounded border border-slate-300 px-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {autolockOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="flex min-w-0 flex-col md:col-span-2">
            <legend className="text-base text-slate-700">
              {t('setup.fontSize')}
            </legend>
            <div
              role="radiogroup"
              aria-label={t('setup.fontSize')}
              data-testid="settings-fontsize"
              className="mt-1 flex flex-wrap gap-4"
            >
              {FONT_SIZES.map(({ size, key }) => (
                <label
                  key={size}
                  className="flex items-center gap-2 text-base text-slate-800"
                >
                  <input
                    type="radio"
                    name="settings-fontsize"
                    data-testid={`settings-fontsize-${size}`}
                    value={size}
                    checked={form.fontSize === size}
                    onChange={() => set('fontSize', size)}
                    className="h-4 w-4 focus:ring-2 focus:ring-blue-600"
                  />
                  {t(key)}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </fieldset>

      <CameraCard
        value={form.camera}
        onChange={(next) => set('camera', next)}
      />

      {/* Save / Cancel (00-conventions §4). */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {status.kind === 'saved' ? (
          <p
            data-testid="settings-saved"
            role="status"
            className="text-base text-green-800"
          >
            {status.changed ? t('settings.saved') : t('settings.noChange')}
          </p>
        ) : null}
        {status.kind === 'error' ? (
          <p
            data-testid="settings-form-error"
            role="alert"
            className="text-base text-red-700"
          >
            {status.message}
          </p>
        ) : null}
        <button
          type="button"
          data-testid="settings-cancel"
          onClick={onCancel}
          disabled={status.kind === 'saving'}
          className="h-10 rounded border border-slate-300 px-4 text-base text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          data-testid="settings-save"
          onClick={() => void onSave()}
          disabled={status.kind === 'saving'}
          aria-busy={status.kind === 'saving'}
          className="h-10 rounded border border-blue-700 bg-blue-700 px-4 text-base font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
        >
          {status.kind === 'saving' ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </div>
  );
}
