// Leave guard (R5 design §7, r5-review-2/15/16): ONE mechanism that lets a
// screen with unsaved, non-autosaved work (S15 invoice) intercept EVERY way
// the app leaves it and ask Save / Discard first. Clinical forms autosave and
// never register a guard.
//
// The shell owns the host (`useLeaveGuardHost`) and sends every one of its own
// navigations through `guardLeave(leave)` (it has no unguarded navigate except
// the lock, see below). A screen calls `useLeaveGuard(active, onLeaveRequest)`;
// while `active`, the host hands the screen the pending `leave` instead of
// navigating, and the screen calls it after Save or Discard (or drops it on
// Stay). The hook also RETURNS the same `guardLeave`, which the screen uses for
// its own exits (its Back, in-screen links such as the UPI hint's "Open
// settings"), so the shell and the screen share one decision path.
//
// A granted leave passes straight through: while the granted `leave()` runs,
// a nested `guardLeave` (e.g. the screen's Back calling a shell callback that
// is itself guarded) navigates at once instead of prompting a second time.
//
// Lock (Ctrl+L, the lock button, idle auto-lock) is deliberately NOT guarded:
// a dialog must never hold the lock open (SET-004). The shell locks through
// `lockNow(lock)` instead, which first tells the active screen (`onLock`) so
// it can keep its unsaved work (the invoice parks its draft in memory,
// billing/invoiceDraft.ts), then locks at once.
//
// HashRouter is not a data router, so react-router's `useBlocker` is not
// available; this is the in-app equivalent.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

/** Called instead of navigating; run `leave()` to really go. */
export type LeaveRequestHandler = (leave: () => void) => void;

/** Run `leave` now, or hand it to the active guard to decide. */
export type GuardLeave = (leave: () => void) => void;

interface LeaveGuardRegistry {
  /** Install the active guard; returns its uninstall. At most one is live. */
  readonly register: (handler: LeaveRequestHandler) => () => void;
  /** The shell's one guarded-leave runner. */
  readonly guardLeave: GuardLeave;
  /** Install the active screen's lock hook; returns its uninstall. */
  readonly registerLock: (onLock: () => void) => () => void;
}

const LeaveGuardContext = createContext<LeaveGuardRegistry | null>(null);

/** The shell side: the registry to provide and the guarded-leave runner. */
export interface LeaveGuardHost {
  readonly registry: LeaveGuardRegistry;
  /** Run `leave` now, or hand it to the registered guard to decide. */
  readonly guardLeave: GuardLeave;
  /** Tell the active screen it is being locked, then run `lock` (never held). */
  readonly lockNow: (lock: () => void) => void;
}

/**
 * Build a guarded-leave runner over a handler source. While a granted leave
 * runs, nested calls pass through so one decision never prompts twice.
 */
function makeGuardLeave(
  current: () => LeaveRequestHandler | null,
  passing: { current: boolean },
): GuardLeave {
  return (leave) => {
    const active = current();
    if (active === null || passing.current) {
      leave();
      return;
    }
    active(() => {
      passing.current = true;
      try {
        leave();
      } finally {
        passing.current = false;
      }
    });
  };
}

/** Create the shell's leave-guard host (call once, in the shell frame). */
export function useLeaveGuardHost(): LeaveGuardHost {
  const handler = useRef<LeaveRequestHandler | null>(null);
  const lockHook = useRef<(() => void) | null>(null);
  const passing = useRef(false);
  const guardLeave = useMemo(
    () => makeGuardLeave(() => handler.current, passing),
    [],
  );
  const registry = useMemo<LeaveGuardRegistry>(
    () => ({
      register: (next) => {
        handler.current = next;
        return () => {
          if (handler.current === next) handler.current = null;
        };
      },
      guardLeave,
      registerLock: (next) => {
        lockHook.current = next;
        return () => {
          if (lockHook.current === next) lockHook.current = null;
        };
      },
    }),
    [guardLeave],
  );
  const lockNow = useCallback((lock: () => void): void => {
    try {
      lockHook.current?.();
    } finally {
      // The lock always happens, even if the screen's hook throws (SET-004).
      lock();
    }
  }, []);
  return useMemo(
    () => ({ registry, guardLeave, lockNow }),
    [registry, guardLeave, lockNow],
  );
}

/** Provide the shell's registry to the routed screens. */
export function LeaveGuardProvider({
  registry,
  children,
}: {
  readonly registry: LeaveGuardRegistry;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <LeaveGuardContext.Provider value={registry}>
      {children}
    </LeaveGuardContext.Provider>
  );
}

/**
 * The screen side: while `active`, every guarded navigation calls
 * `onLeaveRequest(leave)` instead of leaving, and a lock calls `onLock` just
 * before it happens. Returns the guarded-leave runner the screen must use for
 * its OWN exits (Back, in-screen links). Inside a shell this is the shell's
 * `guardLeave`; outside one (unit tests of the screen alone) it applies the
 * same rule locally.
 */
export function useLeaveGuard(
  active: boolean,
  onLeaveRequest: LeaveRequestHandler,
  onLock?: () => void,
): GuardLeave {
  const registry = useContext(LeaveGuardContext);
  const latest = useRef(onLeaveRequest);
  latest.current = onLeaveRequest;
  const latestLock = useRef(onLock);
  latestLock.current = onLock;
  const activeRef = useRef(active);
  activeRef.current = active;
  const passing = useRef(false);

  useEffect(() => {
    if (registry === null || !active) return undefined;
    const offLeave = registry.register((leave) => latest.current(leave));
    const offLock = registry.registerLock(() => latestLock.current?.());
    return () => {
      offLeave();
      offLock();
    };
  }, [registry, active]);

  const local = useMemo(
    () =>
      makeGuardLeave(
        () =>
          activeRef.current
            ? (leave: () => void) => latest.current(leave)
            : null,
        passing,
      ),
    [],
  );
  const shellGuard = registry?.guardLeave ?? null;
  return useCallback<GuardLeave>(
    (leave) => (shellGuard ?? local)(leave),
    [shellGuard, local],
  );
}
