// S01 First-run setup wizard (docs/ui/S01-first-run-setup.md, route /setup) —
// R1. Collects the minimum to make a fresh install usable: doctor profile
// (SET-002), clinic profile (SET-003), an app PIN with a one-time printable
// recovery code and idle auto-lock (SET-004), and a licence step that starts
// the built-in development trial (LIC-063). Four steps max (SET-001); language
// is an English-only header selector (i18n-ready).
//
// All backend access goes through the typed command bindings (R-UI-002); the
// UI never builds SQL or file paths (R-ARCH-003/009). Visible text comes from
// locales/en.json via t() (R-UI-007); every control carries its spec
// data-testid (R-UI-003); money is parsed to integer paise through the shared
// helper only (R-UI-006). Required fields block Next with an inline message,
// never only a toast (00-conventions §4). The PIN and recovery code are never
// logged (R-PRIV-001).
//
// Deferred this slice (R-DEL-002/006): the font-size control (SET-005 /
// HC-MVP1-028) and the data-folder chooser (SET-006 / HC-MVP1-029) render only
// when the compile-time flag `features.setupP1Controls` is on; otherwise they
// are omitted and the wizard still completes (no dead-end). The "I already have
// a licence" import path (S20) renders only when `features.licenceImport` is on
// (hidden until R8); the development trial is the only path this release.
import { useCallback, useMemo, useState } from 'react';

import { commands } from '@/bindings';
import { isUserFacingError, run } from '@/shared/command';
import { features } from '@/shared/features';
import { parseRupeesToPaise } from '@/shared/money';
import { t } from '@/shared/strings';

/** Called by the wizard once setup completes, to route to Today. */
export interface SetupWizardProps {
  readonly onComplete?: () => void;
  /**
   * @deprecated Accepted but intentionally IGNORED. The S01->S17 link belongs
   * on the completed app (Today / StatusBar), never mid-wizard: routing to
   * Backup before Finish would bypass setup_complete + setup_start_trial and
   * leave the licence inactive (SET-001; the user-reported defect). The
   * wizard's only forward exit is Finish (`onComplete`). The prop is retained
   * on the type so a host that still passes it type-checks; the wizard never
   * invokes it and renders no jump-to-Backup control.
   */
  readonly onGoToBackup?: () => void;
}

/** The four wizard steps (SET-001). */
type Step = 1 | 2 | 3 | 4;
const TOTAL_STEPS = 4;

/** Minimum/maximum PIN length (SET-004 policy: 4–6 numeric digits). */
const PIN_MIN = 4;
const PIN_MAX = 6;

function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Auto-lock options in minutes (SET-004; default 15). */
const AUTOLOCK_OPTIONS = [5, 10, 15, 30, 60] as const;

type FieldErrors = Record<string, string>;

/** First-run setup wizard (4 steps). */
export function SetupWizard({ onComplete }: SetupWizardProps): JSX.Element {
  const [step, setStep] = useState<Step>(1);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Step 1 — doctor.
  const [docName, setDocName] = useState('');
  const [docQual, setDocQual] = useState('');
  const [docRegNo, setDocRegNo] = useState('');
  const [docCouncil, setDocCouncil] = useState('');
  const [docPhone, setDocPhone] = useState('');
  const [docEmail, setDocEmail] = useState('');

  // Step 2 — clinic.
  const [clinicName, setClinicName] = useState('');
  const [clinicAddress, setClinicAddress] = useState('');
  const [clinicPhone, setClinicPhone] = useState('');
  const [clinicGstin, setClinicGstin] = useState('');
  const [clinicTimings, setClinicTimings] = useState('');
  const [feeFirst, setFeeFirst] = useState('');
  const [feeFollowup, setFeeFollowup] = useState('');

  // Step 3 — security.
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [autolock, setAutolock] = useState(15);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryAck, setRecoveryAck] = useState(false);

  const setFieldError = useCallback((field: string, message: string) => {
    setErrors((prev) => ({ ...prev, [field]: message }));
  }, []);

  const clearErrors = useCallback(() => {
    setErrors({});
    setFormError(null);
  }, []);

  // ---- Step validation + submit --------------------------------------------

  const submitDoctor = useCallback(async (): Promise<boolean> => {
    // Validate in visual order and surface the FIRST problem inline
    // (conventions §4): one message at a time keeps focus-and-fix unambiguous.
    const checks: ReadonlyArray<readonly [string, boolean, string]> = [
      ['setup-doctor-name', docName.trim() === '', t('setup.error.required')],
      [
        'setup-doctor-qualification',
        docQual.trim() === '',
        t('setup.error.required'),
      ],
      ['setup-doctor-regno', docRegNo.trim() === '', t('setup.error.required')],
      [
        'setup-doctor-council',
        docCouncil.trim() === '',
        t('setup.error.required'),
      ],
      [
        'setup-doctor-email',
        docEmail.trim() !== '' && !EMAIL_RE.test(docEmail.trim()),
        t('setup.error.email'),
      ],
    ];
    const firstBad = checks.find(([, failed]) => failed);
    if (firstBad) {
      setErrors({ [firstBad[0]]: firstBad[2] });
      return false;
    }
    await run(
      commands.setupSaveDoctorProfile({
        name: docName.trim(),
        qualification: docQual.trim(),
        regNo: docRegNo.trim(),
        regCouncil: docCouncil.trim(),
        phone: docPhone.trim() === '' ? null : docPhone.trim(),
        email: docEmail.trim() === '' ? null : docEmail.trim(),
        signatureImagePath: null,
        clinicLogoPath: null,
      }),
    );
    return true;
  }, [docName, docQual, docRegNo, docCouncil, docPhone, docEmail]);

  const submitClinic = useCallback(async (): Promise<boolean> => {
    const feeFirstPaise = parseRupeesToPaise(feeFirst);
    const feeFollowupPaise = parseRupeesToPaise(feeFollowup);
    const checks: ReadonlyArray<readonly [string, boolean, string]> = [
      [
        'setup-clinic-name',
        clinicName.trim() === '',
        t('setup.error.required'),
      ],
      [
        'setup-clinic-address',
        clinicAddress.trim() === '',
        t('setup.error.required'),
      ],
      ['setup-clinic-fee-first', feeFirstPaise === null, t('setup.error.fee')],
      [
        'setup-clinic-fee-followup',
        feeFollowupPaise === null,
        t('setup.error.fee'),
      ],
    ];
    const firstBad = checks.find(([, failed]) => failed);
    if (firstBad || feeFirstPaise === null || feeFollowupPaise === null) {
      if (firstBad) setErrors({ [firstBad[0]]: firstBad[2] });
      return false;
    }
    await run(
      commands.setupSaveClinicProfile({
        name: clinicName.trim(),
        address: clinicAddress.trim(),
        phone: clinicPhone.trim() === '' ? null : clinicPhone.trim(),
        timings: clinicTimings.trim() === '' ? null : clinicTimings.trim(),
        feeFirstPaise,
        feeFollowupPaise,
        gstin: clinicGstin.trim() === '' ? null : clinicGstin.trim(),
      }),
    );
    return true;
  }, [
    clinicName,
    clinicAddress,
    clinicPhone,
    clinicTimings,
    clinicGstin,
    feeFirst,
    feeFollowup,
  ]);

  // Step 3 is a two-phase step: first set the PIN (which reveals the recovery
  // code), then acknowledge the code before leaving.
  const submitPin = useCallback(async (): Promise<boolean> => {
    const next: FieldErrors = {};
    if (!isValidPin(pin)) next['setup-pin'] = t('setup.error.pinFormat');
    else if (pin !== pinConfirm)
      next['setup-pin-confirm'] = t('setup.error.pinMismatch');
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return false;
    }
    const res = await run(
      commands.setupSetPin({
        pin,
        confirmPin: pinConfirm,
        autolockMinutes: autolock,
      }),
    );
    setRecoveryCode(res.recoveryCode);
    return true;
  }, [pin, pinConfirm, autolock]);

  const leaveSecurity = useCallback((): boolean => {
    if (!recoveryAck) {
      setFieldError('setup-recovery-ack', t('setup.error.ackRequired'));
      return false;
    }
    return true;
  }, [recoveryAck, setFieldError]);

  const finish = useCallback(async (): Promise<void> => {
    await run(commands.setupStartTrial());
    await run(commands.setupComplete());
    onComplete?.();
  }, [onComplete]);

  const printRecovery = useCallback(() => {
    // Printing is an OS action with no patient data and no network; the window
    // print dialog is the portable path. The code is already on screen.
    window.print();
  }, []);

  // ---- Next / Back ----------------------------------------------------------

  const goNext = useCallback(async () => {
    if (busy) return;
    clearErrors();
    setBusy(true);
    try {
      if (step === 1) {
        if (await submitDoctor()) setStep(2);
      } else if (step === 2) {
        if (await submitClinic()) setStep(3);
      } else if (step === 3) {
        if (recoveryCode === null) {
          // Phase 1: set the PIN and reveal the recovery code; stay on step 3.
          await submitPin();
        } else if (leaveSecurity()) {
          // Phase 2: recovery acknowledged, advance to the licence step.
          setStep(4);
        }
      }
    } catch (err) {
      setFormError(
        isUserFacingError(err) ? err.message : t('setup.error.generic'),
      );
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    step,
    recoveryCode,
    submitDoctor,
    submitClinic,
    submitPin,
    leaveSecurity,
    clearErrors,
  ]);

  const goBack = useCallback(() => {
    clearErrors();
    setStep((s) => (s > 1 ? ((s - 1) as Step) : s));
  }, [clearErrors]);

  const onFinish = useCallback(async () => {
    if (busy) return;
    clearErrors();
    setBusy(true);
    try {
      await finish();
    } catch (err) {
      setFormError(
        isUserFacingError(err) ? err.message : t('setup.error.generic'),
      );
    } finally {
      setBusy(false);
    }
  }, [busy, finish, clearErrors]);

  // ---- Rendering helpers ----------------------------------------------------

  const inlineError = (field: string): JSX.Element | null => {
    const message = errors[field];
    if (message === undefined) return null;
    return (
      <p
        data-testid={`${field}-error`}
        role="alert"
        className="mt-1 text-sm text-red-700"
      >
        {message}
      </p>
    );
  };

  const steps = useMemo(
    () =>
      [
        { n: 1, label: t('setup.step.doctor') },
        { n: 2, label: t('setup.step.clinic') },
        { n: 3, label: t('setup.step.security') },
        { n: 4, label: t('setup.step.licence') },
      ] as const,
    [],
  );

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts?: { type?: string; required?: boolean; inputMode?: 'numeric' },
  ): JSX.Element => (
    <div className="flex flex-col">
      <label htmlFor={`${id}-input`} className="text-sm text-slate-700">
        {label}
        {opts?.required ? (
          <span aria-hidden="true">{t('setup.requiredMark')}</span>
        ) : null}
      </label>
      <input
        id={`${id}-input`}
        data-testid={id}
        type={opts?.type ?? 'text'}
        inputMode={opts?.inputMode}
        aria-required={opts?.required}
        aria-invalid={errors[id] !== undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded border border-slate-300 px-3 focus:outline-none focus:ring-2 focus:ring-blue-600"
      />
      {inlineError(id)}
    </div>
  );

  return (
    <div
      data-testid="setup-wizard"
      className="mx-auto flex min-h-screen max-w-[900px] flex-col gap-6 p-8"
    >
      {/* Header: title + English-only language selector (SET-001). */}
      <header className="flex items-center justify-between border-b border-slate-200 pb-3">
        <h1 className="text-xl font-semibold text-slate-900">
          {t('setup.title')}
        </h1>
        <div className="flex items-center gap-2">
          <label
            htmlFor="setup-language-select"
            className="text-sm text-slate-700"
          >
            {t('setup.language')}
          </label>
          <select
            id="setup-language-select"
            data-testid="setup-language"
            defaultValue="en"
            className="h-9 rounded border border-slate-300 px-2 text-sm"
          >
            <option value="en">{t('setup.language.english')}</option>
          </select>
        </div>
      </header>

      {/* Step rail. */}
      <nav
        aria-label={t('setup.title')}
        className="flex items-center justify-between"
      >
        <ol className="flex gap-6">
          {steps.map((s) => (
            <li
              key={s.n}
              data-testid={`setup-step-${s.n}`}
              aria-current={step === s.n ? 'step' : undefined}
              className={
                step === s.n ? 'font-semibold text-blue-700' : 'text-slate-500'
              }
            >
              {s.label}
            </li>
          ))}
        </ol>
        <span
          className="text-sm text-slate-500"
          data-testid="setup-step-indicator"
        >
          {t('setup.stepOf')} {step} {t('setup.stepOfConnector')} {TOTAL_STEPS}
        </span>
      </nav>

      <section className="flex flex-col gap-4">
        {step === 1 ? (
          <>
            <h2 className="text-lg font-medium text-slate-900">
              {t('setup.section.doctor')}
            </h2>
            {field(
              'setup-doctor-name',
              t('setup.doctor.name'),
              docName,
              setDocName,
              {
                required: true,
              },
            )}
            {field(
              'setup-doctor-qualification',
              t('setup.doctor.qualification'),
              docQual,
              setDocQual,
              { required: true },
            )}
            {field(
              'setup-doctor-regno',
              t('setup.doctor.regno'),
              docRegNo,
              setDocRegNo,
              {
                required: true,
              },
            )}
            {field(
              'setup-doctor-council',
              t('setup.doctor.council'),
              docCouncil,
              setDocCouncil,
              {
                required: true,
              },
            )}
            {field(
              'setup-doctor-phone',
              t('setup.doctor.phone'),
              docPhone,
              setDocPhone,
              {
                inputMode: 'numeric',
              },
            )}
            {field(
              'setup-doctor-email',
              t('setup.doctor.email'),
              docEmail,
              setDocEmail,
              {
                type: 'email',
              },
            )}
            <p className="text-sm text-slate-500">
              {t('setup.doctor.identityNote')}
            </p>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h2 className="text-lg font-medium text-slate-900">
              {t('setup.section.clinic')}
            </h2>
            {field(
              'setup-clinic-name',
              t('setup.clinic.name'),
              clinicName,
              setClinicName,
              {
                required: true,
              },
            )}
            <div className="flex flex-col">
              <label
                htmlFor="setup-clinic-address-input"
                className="text-sm text-slate-700"
              >
                {t('setup.clinic.address')}
                <span aria-hidden="true">{t('setup.requiredMark')}</span>
              </label>
              <textarea
                id="setup-clinic-address-input"
                data-testid="setup-clinic-address"
                aria-required
                aria-invalid={errors['setup-clinic-address'] !== undefined}
                value={clinicAddress}
                onChange={(e) => setClinicAddress(e.target.value)}
                rows={2}
                className="rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              {inlineError('setup-clinic-address')}
            </div>
            {field(
              'setup-clinic-fee-first',
              t('setup.clinic.feeFirst'),
              feeFirst,
              setFeeFirst,
              { required: true, inputMode: 'numeric' },
            )}
            {field(
              'setup-clinic-fee-followup',
              t('setup.clinic.feeFollowup'),
              feeFollowup,
              setFeeFollowup,
              { required: true, inputMode: 'numeric' },
            )}
            {field(
              'setup-clinic-phone',
              t('setup.clinic.phone'),
              clinicPhone,
              setClinicPhone,
              {
                inputMode: 'numeric',
              },
            )}
            {field(
              'setup-clinic-gstin',
              t('setup.clinic.gstin'),
              clinicGstin,
              setClinicGstin,
            )}
            {field(
              'setup-clinic-timings',
              t('setup.clinic.timings'),
              clinicTimings,
              setClinicTimings,
            )}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h2 className="text-lg font-medium text-slate-900">
              {t('setup.section.security')}
            </h2>
            {field('setup-pin', t('setup.pin'), pin, setPin, {
              type: 'password',
              required: true,
              inputMode: 'numeric',
            })}
            {field(
              'setup-pin-confirm',
              t('setup.pinConfirm'),
              pinConfirm,
              setPinConfirm,
              {
                type: 'password',
                required: true,
                inputMode: 'numeric',
              },
            )}
            <div className="flex flex-col">
              <label
                htmlFor="setup-autolock-select"
                className="text-sm text-slate-700"
              >
                {t('setup.autolock')}
              </label>
              <select
                id="setup-autolock-select"
                data-testid="setup-autolock"
                value={autolock}
                onChange={(e) => setAutolock(Number(e.target.value))}
                className="h-10 w-32 rounded border border-slate-300 px-2"
              >
                {AUTOLOCK_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* P1 DEFERRED controls (SET-005 / SET-006): render only behind the
                compile-time flag, disabled, and the wizard completes without
                them (R-DEL-002/006). */}
            {features.setupP1Controls ? (
              <div className="flex flex-col gap-3 rounded border border-dashed border-slate-300 p-3">
                <fieldset disabled>
                  <legend className="text-sm text-slate-700">
                    {t('setup.fontSize')}
                  </legend>
                  <div
                    data-testid="setup-font-size"
                    className="flex gap-4"
                    role="radiogroup"
                  >
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="radio"
                        name="setup-font-size"
                        value="normal"
                        defaultChecked
                      />
                      {t('setup.fontSize.normal')}
                    </label>
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="radio"
                        name="setup-font-size"
                        value="large"
                      />
                      {t('setup.fontSize.large')}
                    </label>
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="radio"
                        name="setup-font-size"
                        value="xlarge"
                      />
                      {t('setup.fontSize.xlarge')}
                    </label>
                  </div>
                </fieldset>
                <div className="flex flex-col">
                  <label
                    htmlFor="setup-data-dir-input"
                    className="text-sm text-slate-700"
                  >
                    {t('setup.dataDir')}
                  </label>
                  <input
                    id="setup-data-dir-input"
                    data-testid="setup-data-dir"
                    type="text"
                    disabled
                    readOnly
                    className="h-10 rounded border border-slate-300 px-3 text-slate-500"
                  />
                  <span className="text-xs text-slate-400">
                    {t('setup.deferredHint')}
                  </span>
                </div>
              </div>
            ) : null}

            {/* Recovery code: revealed once after the PIN is set (SET-004). */}
            {recoveryCode !== null ? (
              <div className="flex flex-col gap-2 rounded border border-slate-300 bg-slate-50 p-4">
                <span className="text-sm text-slate-700">
                  {t('setup.recovery.code')}
                </span>
                <div className="flex items-center justify-between gap-4">
                  <code
                    data-testid="setup-recovery-code"
                    className="select-all font-mono text-lg tracking-wider text-slate-900"
                  >
                    {recoveryCode}
                  </code>
                  <button
                    type="button"
                    data-testid="setup-recovery-print"
                    onClick={printRecovery}
                    className="h-9 rounded border border-slate-300 px-3 text-sm"
                  >
                    {t('setup.recovery.print')}
                  </button>
                </div>
                <span className="text-xs text-slate-500">
                  {t('setup.recovery.hint')}
                </span>
                <label className="mt-1 flex items-center gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    data-testid="setup-recovery-ack"
                    checked={recoveryAck}
                    onChange={(e) => {
                      setRecoveryAck(e.target.checked);
                      if (e.target.checked) {
                        setErrors((prev) => {
                          const copy = { ...prev };
                          delete copy['setup-recovery-ack'];
                          return copy;
                        });
                      }
                    }}
                  />
                  {t('setup.recovery.ack')}
                </label>
                {inlineError('setup-recovery-ack')}
              </div>
            ) : null}
          </>
        ) : null}

        {step === 4 ? (
          <>
            <h2 className="text-lg font-medium text-slate-900">
              {t('setup.section.licence')}
            </h2>
            <div
              role="radiogroup"
              aria-label={t('setup.section.licence')}
              className="flex flex-col gap-2"
            >
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name="setup-licence-choice"
                  data-testid="setup-licence-choice"
                  value="trial"
                  defaultChecked
                />
                {t('setup.licence.trial')}
              </label>
              <span className="pl-6 text-xs text-slate-500">
                {t('setup.licence.trialNote')}
              </span>

              {/* "I already have a licence" import path — hidden until R8
                  (R-DEL-002/006); only the development trial ships this
                  release. */}
              {features.licenceImport ? (
                <label className="flex items-center gap-2 text-sm text-slate-800">
                  <input
                    type="radio"
                    name="setup-licence-choice"
                    value="import"
                  />
                  {t('setup.licence.import')}
                </label>
              ) : null}
            </div>

            <div className="rounded border border-slate-300 bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-800">
                {t('setup.licence.devTrial')}
              </p>
              <p className="text-sm text-slate-600">
                {t('setup.licence.devTrialNote')}
              </p>
            </div>
          </>
        ) : null}

        {formError !== null ? (
          <p
            data-testid="setup-form-error"
            role="alert"
            className="text-sm text-red-700"
          >
            {formError}
          </p>
        ) : null}
      </section>

      {/* Footer navigation. */}
      <footer className="mt-auto flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
        <button
          type="button"
          data-testid="setup-back"
          onClick={goBack}
          disabled={step === 1 || busy}
          className="h-10 rounded border border-slate-300 px-4 text-sm disabled:opacity-50"
        >
          {t('setup.back')}
        </button>
        {step < TOTAL_STEPS ? (
          <button
            type="button"
            data-testid="setup-next"
            onClick={() => void goNext()}
            disabled={busy}
            className="h-10 rounded bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {t('setup.next')}
          </button>
        ) : (
          <button
            type="button"
            data-testid="setup-finish"
            onClick={() => void onFinish()}
            disabled={busy}
            className="h-10 rounded bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? t('setup.finishing') : t('setup.finish')}
          </button>
        )}
      </footer>
    </div>
  );
}
