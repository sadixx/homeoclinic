// Command-result adapter (R-UI-002 / R-ARCH-006).
//
// The generated `commands.*` wrappers in `@/bindings` return a typed result
// envelope `{ status: "ok"; data } | { status: "error"; error }` for every
// fallible command (the infallible `appInfo` is the one exception and returns
// its value directly). The UI must unwrap that envelope into either the data
// or a thrown `UserFacingError`, so component code can use plain
// `try { const x = await run(commands.foo(req)); } catch (e) { ... }`.
//
// It also tolerates a bare resolved value (no envelope) and a rejected
// promise carrying a `UserFacingError`, which is how the typed-bindings fake
// models the same contract in unit tests (R-TEST-002). Keeping both shapes in
// one helper means the component is written once and behaves identically under
// Vitest and under the real Tauri runtime.
import type { UserFacingError } from '@/bindings';

/** The success/error envelope the generated fallible wrappers resolve to. */
type ResultEnvelope<T> =
  | { status: 'ok'; data: T }
  | { status: 'error'; error: UserFacingError };

/** True when `value` is the generated `{ status, ... }` result envelope. */
function isEnvelope<T>(value: unknown): value is ResultEnvelope<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    ((value as { status: unknown }).status === 'ok' ||
      (value as { status: unknown }).status === 'error')
  );
}

/** True when `value` has the {@link UserFacingError} shape. */
export function isUserFacingError(value: unknown): value is UserFacingError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value
  );
}

/**
 * Await a generated command call and return its data, throwing the mapped
 * {@link UserFacingError} on failure.
 *
 * Resolved shapes (the normal success/error contract):
 * - resolved envelope `{ status: 'ok', data }` -> `data`
 * - resolved envelope `{ status: 'error', error }` -> throws `error`
 * - resolved bare value (unit-test fake) -> the value as-is
 *
 * Rejected shapes (the IPC boundary; handoff 46). The generated
 * `typedError()` RE-THROWS a transport/serialisation IPC reject (an
 * `instanceof Error`) instead of returning the `{status:'error'}` envelope, and
 * the backend's own `Err(UserFacingError)` arrives as a rejection too. `run()`
 * normalises BOTH so a caller only ever catches a {@link UserFacingError}:
 * - rejected `UserFacingError` -> propagates unchanged (the mapped-domain-error
 *   path; never relabelled)
 * - any other rejection (a genuine transport `Error`, a string, etc.) -> mapped
 *   to a `boot_read_failed` {@link UserFacingError} so a transport failure is an
 *   explicit, code-bearing value the boot-gate can branch on, instead of a raw
 *   `Error` that gets silently routed to the lock screen (SET-001, SET-004).
 *
 * No patient data, SQL, file path or stack trace is read from the rejection
 * (R-PRIV-001, R-UI-008); only a fixed, safe code/message/action is produced.
 */
export async function run<T>(call: Promise<T | ResultEnvelope<T>>): Promise<T> {
  let resolved: T | ResultEnvelope<T>;
  try {
    resolved = await call;
  } catch (rejection: unknown) {
    // A mapped domain error flows through untouched.
    if (isUserFacingError(rejection)) {
      throw rejection;
    }
    // Anything else is a transport/serialisation failure at the IPC boundary:
    // surface it as an explicit, code-bearing typed error. The raw rejection
    // (which may carry a stack or internal text) is deliberately NOT read.
    throw transportError();
  }
  if (isEnvelope<T>(resolved)) {
    if (resolved.status === 'ok') {
      return resolved.data;
    }
    throw resolved.error;
  }
  return resolved;
}

/**
 * The fixed, patient-data-free {@link UserFacingError} used for a genuine IPC
 * transport/serialisation failure (handoff 46). `code` is `'boot_read_failed'`,
 * a real {@link ErrorCode} in the generated contract, so it resolves through
 * `t()` like any other code (R-UI-007) and the boot-gate can branch on it.
 */
function transportError(): UserFacingError {
  return {
    code: 'boot_read_failed',
    message: 'The app could not finish starting up.',
    suggestedAction:
      'Please try again. If it keeps happening, restart the app.',
  };
}
