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
 * - resolved envelope `{ status: 'ok', data }` -> `data`
 * - resolved envelope `{ status: 'error', error }` -> throws `error`
 * - resolved bare value (unit-test fake) -> the value as-is
 * - rejected promise (unit-test fake) -> the rejection propagates
 */
export async function run<T>(call: Promise<T | ResultEnvelope<T>>): Promise<T> {
  const resolved = await call;
  if (isEnvelope<T>(resolved)) {
    if (resolved.status === 'ok') {
      return resolved.data;
    }
    throw resolved.error;
  }
  return resolved;
}
