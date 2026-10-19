// Tests for the command-result adapter `run()` (R-UI-002 / R-ARCH-006) and the
// envelope-vs-throw contract that sits between the generated bindings and the
// boot-gate (handoff 46).
//
// CUT: the real `run` / `isUserFacingError` from `@/shared/command`. Nothing is
// faked here — the "dependency" is just the resolved/rejected promise handed to
// `run`, which each test constructs directly.
//
// Why this matters for the defect: the generated `typedError()` RE-THROWS a
// transport/serialization IPC reject (an `instanceof Error`) instead of
// returning the `{status:'error'}` envelope. `run()` must turn that genuine
// transport Error into an explicit, code-bearing typed error so the boot-gate
// can distinguish a transport failure from a locked state — instead of letting
// a raw Error propagate and be silently routed to /lock.

import { describe, it, expect } from 'vitest';

import type { UserFacingError } from '@/bindings';
import { isUserFacingError, run } from '@/shared/command';

describe('run() command-result adapter', () => {
  it('returns the data for a resolved ok envelope', async () => {
    const data = { completed: false, currentStep: 1 };
    await expect(
      run(Promise.resolve({ status: 'ok' as const, data })),
    ).resolves.toBe(data);
  });

  it('throws the mapped UserFacingError for a resolved error envelope', async () => {
    const error: UserFacingError = {
      code: 'validation',
      message: 'bad input',
      suggestedAction: 'Check the details',
    };
    await expect(
      run(Promise.resolve({ status: 'error' as const, error })),
    ).rejects.toBe(error);
  });

  it('rethrows a rejected UserFacingError unchanged', async () => {
    // A rejection carrying a UserFacingError (the typed-bindings fake path and
    // the backend Err(UserFacingError) path) must propagate as-is, never be
    // relabelled as a transport failure.
    const error: UserFacingError = {
      code: 'validation',
      message: 'bad input',
      suggestedAction: 'Check the details',
    };
    await expect(run(Promise.reject(error))).rejects.toBe(error);
  });

  it('surfaces a genuine transport Error as a code-bearing typed error, not the raw Error', async () => {
    // The real cold-launch IPC reject: typedError re-throws a plain Error.
    // Current run() has no rejection handling, so it propagates the raw Error
    // (NOT a UserFacingError) — which the boot-gate cannot distinguish from a
    // locked state. The fix must map it to an explicit, code-bearing typed
    // error so the boot-gate can treat transport failure separately.
    const transport = new Error('IPC transport closed');

    const caught = await run(Promise.reject(transport)).then(
      () => {
        throw new Error('run() should have rejected');
      },
      (e: unknown) => e,
    );

    // It must be a mapped UserFacingError (data-shaped), not the raw Error.
    expect(caught).not.toBe(transport);
    expect(isUserFacingError(caught)).toBe(true);
    // ...carrying a code the boot-gate can branch on (per the fix plan). Read
    // the code as a plain string so this compiles against the current
    // generated ErrorCode union (the fix adds `boot_read_failed` to it).
    const code: string = (caught as UserFacingError).code;
    expect(code).toBe('boot_read_failed');
  });
});
