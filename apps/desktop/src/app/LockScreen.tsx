// S02 Lock / unlock (docs/ui/S02-lock-unlock.md, route /lock) — R1.
//
// Protects patient data behind one PIN entry (SUX-003). Shown on launch, after
// idle auto-lock (SET-004) and on explicit lock (Ctrl+L). A wrong PIN shows an
// inline message and never restricts the app (SUX-005). Forgot-PIN uses the
// setup recovery code to set a new PIN, verified locally with no network
// (SUX-004 / NFR-022).
//
// All backend access goes through the typed command bindings (R-UI-002); the
// UI never sees SQL or file paths (R-ARCH-003). Visible text comes from
// locales/en.json via t() (R-UI-007); every control carries its spec
// data-testid (R-UI-003); errors are shown in plain language with no raw
// error, code or stack trace (R-UI-008). No PIN or recovery code is ever
// logged (R-PRIV-001).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { commands } from '@/bindings';
import { isUserFacingError, run } from '@/shared/command';
import { t } from '@/shared/strings';

/** Props: the shell is told when the PIN unlocks so it can leave /lock. */
export interface LockScreenProps {
  /** Called after a correct PIN (or recovery reset + unlock) unlocks the app. */
  readonly onUnlocked?: () => void;
}

/** Minimum/maximum PIN length (SET-004 policy: 4–6 numeric digits). */
const PIN_MIN = 4;
const PIN_MAX = 6;

function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

/** Full-window lock overlay with PIN unlock and a forgot-PIN recovery panel. */
export function LockScreen({ onUnlocked }: LockScreenProps): JSX.Element {
  const [mode, setMode] = useState<'unlock' | 'recovery'>('unlock');

  // Unlock state.
  const [pin, setPin] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  // Recovery state.
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoveryDone, setRecoveryDone] = useState(false);

  const pinRef = useRef<HTMLInputElement>(null);

  // Autofocus the PIN field whenever the unlock card is shown.
  useEffect(() => {
    if (mode === 'unlock') {
      pinRef.current?.focus();
    }
  }, [mode]);

  const doUnlock = useCallback(async () => {
    if (pin === '' || unlocking) {
      return;
    }
    setUnlocking(true);
    setUnlockError(null);
    try {
      const result = await run(commands.authUnlock({ pin }));
      if (result.ok) {
        setPin('');
        onUnlocked?.();
        return;
      }
      // ok:false is not expected (a wrong PIN throws), but never trap the user.
      setUnlockError(t('lock.error.generic'));
    } catch (err) {
      if (isUserFacingError(err)) {
        setUnlockError(err.message);
      } else {
        setUnlockError(t('lock.error.generic'));
      }
    } finally {
      setUnlocking(false);
    }
  }, [pin, unlocking, onUnlocked]);

  const doRecover = useCallback(async () => {
    if (recovering) {
      return;
    }
    if (!isValidPin(newPin)) {
      setRecoveryError(t('lock.recovery.error.pinFormat'));
      return;
    }
    if (newPin !== confirmPin) {
      setRecoveryError(t('lock.recovery.error.pinMismatch'));
      return;
    }
    setRecovering(true);
    setRecoveryError(null);
    try {
      const result = await run(
        commands.authRecoverWithCode({
          recoveryCode,
          newPin,
          confirmPin,
        }),
      );
      if (result.ok) {
        // Reset succeeds; the user then unlocks with the new PIN (backend
        // leaves the app locked).
        setRecoveryDone(true);
        setRecoveryCode('');
        setNewPin('');
        setConfirmPin('');
        setMode('unlock');
        return;
      }
      setRecoveryError(t('lock.recovery.error.generic'));
    } catch (err) {
      if (isUserFacingError(err)) {
        setRecoveryError(err.message);
      } else {
        setRecoveryError(t('lock.recovery.error.generic'));
      }
    } finally {
      setRecovering(false);
    }
  }, [recovering, newPin, confirmPin, recoveryCode]);

  const openRecovery = useCallback(() => {
    setMode('recovery');
    setUnlockError(null);
    setRecoveryError(null);
    setRecoveryDone(false);
  }, []);

  const backToUnlock = useCallback(() => {
    setMode('unlock');
    setRecoveryError(null);
  }, []);

  const unlockErrorId = 'lock-error';
  const recoveryErrorId = 'lock-recovery-error';

  const content = useMemo(() => {
    if (mode === 'recovery') {
      return (
        <div
          data-testid="lock-recovery-card"
          role="dialog"
          aria-label={t('lock.recovery.title')}
          className="flex w-[420px] flex-col gap-3 rounded-lg border border-slate-200 bg-white p-8 shadow"
        >
          <h2 className="text-lg font-semibold text-slate-900">
            {t('lock.recovery.title')}
          </h2>

          <label
            htmlFor="lock-recovery-code-input"
            className="text-sm text-slate-700"
          >
            {t('lock.recovery.code')}
          </label>
          <input
            id="lock-recovery-code-input"
            data-testid="lock-recovery-code"
            type="text"
            autoComplete="off"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            className="h-10 w-full rounded border border-slate-300 px-3 font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-blue-600"
          />

          <label
            htmlFor="lock-recovery-newpin-input"
            className="text-sm text-slate-700"
          >
            {t('lock.recovery.newPin')}
          </label>
          <input
            id="lock-recovery-newpin-input"
            data-testid="lock-recovery-newpin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            className="h-10 w-full rounded border border-slate-300 px-3 tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-600"
          />

          <label
            htmlFor="lock-recovery-confirm-input"
            className="text-sm text-slate-700"
          >
            {t('lock.recovery.confirm')}
          </label>
          <input
            id="lock-recovery-confirm-input"
            data-testid="lock-recovery-confirm"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            className="h-10 w-full rounded border border-slate-300 px-3 tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-600"
          />

          {recoveryError !== null ? (
            <p
              id={recoveryErrorId}
              data-testid="lock-recovery-error"
              role="alert"
              className="text-sm text-red-700"
            >
              {recoveryError}
            </p>
          ) : null}

          <button
            type="submit"
            data-testid="lock-recovery-submit"
            disabled={recovering}
            className="h-10 w-full rounded bg-blue-600 text-sm font-semibold text-white disabled:opacity-60"
          >
            {t('lock.recovery.submit')}
          </button>

          <button
            type="button"
            data-testid="lock-recovery-back"
            onClick={backToUnlock}
            className="text-sm text-blue-700"
          >
            {t('lock.recovery.back')}
          </button>
        </div>
      );
    }

    return (
      <div
        data-testid="lock-card"
        role="dialog"
        aria-label={t('lock.title')}
        className="flex w-[420px] flex-col items-center gap-4 rounded-lg border border-slate-200 bg-white p-8 shadow"
      >
        <span className="text-lg font-semibold text-slate-900">
          {t('app.name')}
        </span>

        <label
          htmlFor="lock-pin-input"
          className="w-full text-sm text-slate-700"
        >
          {t('lock.title')}
        </label>
        <input
          id="lock-pin-input"
          ref={pinRef}
          data-testid="lock-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          aria-invalid={unlockError !== null}
          aria-describedby={unlockError !== null ? unlockErrorId : undefined}
          onChange={(e) => {
            setPin(e.target.value);
            if (unlockError !== null) {
              setUnlockError(null);
            }
          }}
          className="h-10 w-full rounded border border-slate-300 px-3 text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-600"
        />

        {recoveryDone ? (
          <p
            data-testid="lock-recovery-done"
            role="status"
            className="w-full text-sm text-green-700"
          >
            {t('lock.recovery.done')}
          </p>
        ) : null}

        {unlockError !== null ? (
          <p
            id={unlockErrorId}
            data-testid="lock-error"
            role="alert"
            className="w-full text-sm text-red-700"
          >
            {unlockError}
          </p>
        ) : null}

        <button
          type="submit"
          data-testid="lock-unlock"
          disabled={pin === '' || unlocking}
          className="h-10 w-full rounded bg-blue-600 text-sm font-semibold text-white disabled:opacity-60"
        >
          {unlocking ? t('lock.unlocking') : t('lock.unlock')}
        </button>

        <button
          type="button"
          data-testid="lock-forgot"
          onClick={openRecovery}
          className="text-sm text-blue-700"
        >
          {t('lock.forgot')}
        </button>
      </div>
    );
  }, [
    mode,
    pin,
    unlockError,
    unlocking,
    recoveryDone,
    recoveryCode,
    newPin,
    confirmPin,
    recoveryError,
    recovering,
    openRecovery,
    backToUnlock,
  ]);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (mode === 'recovery') {
        void doRecover();
      } else {
        void doUnlock();
      }
    },
    [mode, doRecover, doUnlock],
  );

  return (
    <div
      data-testid="lock-screen"
      className="flex h-full min-h-screen items-center justify-center bg-slate-100 p-8"
    >
      <form onSubmit={onSubmit} noValidate>
        {content}
      </form>
    </div>
  );
}
