// Next follow-up scheduler for the S08 case header (VIS-004, HC-MVP1-M3vis).
//
// The quick buttons (7 days / 15 days / 1 month / 2 months), a custom date and
// Clear, for first AND follow-up visits. This is the same scheduling the
// retired S09 screen (visit/FollowupVisit.tsx) offered: the dates come from
// the same shared/datetime helpers (LOCAL calendar dates, 1 month = same day
// next month clamped to month end) and go through the same typed
// `visitSetNextFollowup` command, which updates `patient.next_followup_on` in
// one transaction with one audit row, so the Today Due / Overdue lists fill.
//
// A custom date before the local today is rejected inline and never sent;
// today itself is allowed (a patient can be due today). The buttons show their
// full names as visible text (WCAG 2.5.3 label-in-name) and the custom date
// has a visible label (00-conventions §5).
//
// Writes (each write is an audit row, so only committed choices are sent):
//  - The custom date is committed ONLY on blur / Enter of a complete, valid,
//    non-past date (or on unmount, so a picked date is never dropped). No
//    timer commits it: a native date input reports a valid value after every
//    segment edit once all segments are filled, so a pause-based commit wrote
//    intermediate dates (review data-2).
//  - A pointer press on a quick button / Clear keeps focus in the custom
//    field (mousedown preventDefault), so the field's blur does not first
//    write the uncommitted custom date; the button's click supersedes it.
//    Keyboard Tab out of the field still blurs and commits it.
//  - At most one command is in flight. A choice made while one is in flight
//    replaces any earlier queued choice and is sent when it completes, so
//    rapid clicks are applied in order and the LAST choice is what stays
//    (shown and saved).
//  - The parent keys this control by visitId, so a visit switch gets a fresh
//    instance and queue: a choice is always sent to the visit it was made on
//    (review data-3). A reply that lands after unmount is not shown.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { commands } from '@/bindings';
import { run } from '@/shared/command';
import {
  isIsoDateBeforeToday,
  isValidIsoDate,
  isoDatePlusDays,
  isoDatePlusMonths,
  todayIsoDate,
} from '@/shared/datetime';
import { t } from '@/shared/strings';
import type { StringKey } from '@/shared/strings';

/** One quick-schedule button: visible text (= accessible name), date. */
interface QuickOption {
  readonly id: '7d' | '15d' | '1m' | '2m';
  readonly text: StringKey;
  readonly date: () => string;
}

const QUICK_OPTIONS: readonly QuickOption[] = [
  {
    id: '7d',
    text: 'case.form.nextFollowup.7d',
    date: () => isoDatePlusDays(7),
  },
  {
    id: '15d',
    text: 'case.form.nextFollowup.15d',
    date: () => isoDatePlusDays(15),
  },
  {
    id: '1m',
    text: 'case.form.nextFollowup.1m',
    date: () => isoDatePlusMonths(1),
  },
  {
    id: '2m',
    text: 'case.form.nextFollowup.2m',
    date: () => isoDatePlusMonths(2),
  },
];

/** Inline error shown under the control, or none. */
type ControlError = null | 'past' | 'saveFailed';

const BUTTON_CLASS =
  'whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60';

export interface NextFollowupControlProps {
  /**
   * The open visit whose next follow-up is set. Render the control with
   * `key={visitId}` so a visit switch never reuses an in-flight queue.
   */
  readonly visitId: string;
  /** The saved next follow-up (`YYYY-MM-DD`) or `null` when none. */
  readonly value: string | null;
  /** Called with the new saved value once the command succeeds. */
  readonly onSaved: (next: string | null) => void;
}

/** Quick buttons + custom date + Clear for the next follow-up (VIS-004). */
export function NextFollowupControl({
  visitId,
  value,
  onSaved,
}: NextFollowupControlProps): JSX.Element {
  const [draft, setDraft] = useState<string>(value ?? '');
  const [error, setError] = useState<ControlError>(null);

  // Latest props for the async save loop (it outlives the render that began
  // it); refreshed after every render.
  const valueRef = useRef<string | null>(value);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    valueRef.current = value;
    onSavedRef.current = onSaved;
  });

  // False once unmounted: a late reply still completes its write (to this
  // instance's visit) but no longer touches the UI or the parent.
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  // In-flight guard: true while a command runs; `queuedRef` holds the newest
  // choice made meanwhile (`undefined` = nothing queued; `null` = Clear).
  const inFlightRef = useRef(false);
  const queuedRef = useRef<string | null | undefined>(undefined);

  // A complete, valid, non-past custom date waiting for blur / Enter.
  const pendingCustomRef = useRef<string | null>(null);
  const customInputRef = useRef<HTMLInputElement | null>(null);

  // Keep the custom input in step with the saved value (load / quick / clear).
  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const save = useCallback(
    async (next: string | null): Promise<void> => {
      if (inFlightRef.current) {
        // Last write wins: replace any earlier queued choice.
        queuedRef.current = next;
        return;
      }
      inFlightRef.current = true;
      // The last value the backend confirmed (what the header shows).
      let confirmed = valueRef.current;
      let target = next;
      for (;;) {
        try {
          await run(
            commands.visitSetNextFollowup({ visitId, nextFollowupOn: target }),
          );
          confirmed = target;
          if (liveRef.current) {
            setError(null);
            onSavedRef.current(target);
          }
        } catch {
          // Observable failure (R-UI-008); fixed log line, no patient data.
          console.error('[CaseForm] next follow-up save failed');
          if (liveRef.current) {
            setError('saveFailed');
            setDraft(confirmed ?? '');
          }
        }
        const queued = queuedRef.current;
        if (queued === undefined) break;
        queuedRef.current = undefined;
        target = queued;
      }
      inFlightRef.current = false;
    },
    [visitId],
  );

  const cancelPendingCustom = useCallback((): void => {
    pendingCustomRef.current = null;
  }, []);

  /** Commit the pending custom date now, if there is one and it changed. */
  const commitCustom = useCallback((): void => {
    const pending = pendingCustomRef.current;
    cancelPendingCustom();
    if (pending !== null && pending !== valueRef.current) void save(pending);
  }, [cancelPendingCustom, save]);

  // Unmount: a picked-but-uncommitted date is still saved (to this visit),
  // never silently dropped.
  useEffect(() => () => commitCustom(), [commitCustom]);

  const onCustomChange = useCallback(
    (iso: string): void => {
      setDraft(iso);
      cancelPendingCustom();
      // Empty or partial input: nothing to commit.
      if (!isValidIsoDate(iso)) return;
      if (isIsoDateBeforeToday(iso)) {
        setError('past');
        return;
      }
      setError((e) => (e === 'past' ? null : e));
      // Committed on blur / Enter only, never by a timer.
      pendingCustomRef.current = iso;
    },
    [cancelPendingCustom],
  );

  const onCustomKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>): void => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      commitCustom();
    },
    [commitCustom],
  );

  /**
   * Pointer press on a quick button / Clear while the custom field has focus:
   * keep focus there so its blur does not write the uncommitted custom date
   * first (the click supersedes it). Keyboard focus moves are unaffected.
   */
  const keepCustomFocus = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>): void => {
      if (
        customInputRef.current !== null &&
        document.activeElement === customInputRef.current
      ) {
        e.preventDefault();
      }
    },
    [],
  );

  /** A quick button / Clear: supersedes any uncommitted custom date. */
  const choose = useCallback(
    (next: string | null): void => {
      cancelPendingCustom();
      setDraft(next ?? '');
      setError((e) => (e === 'past' ? null : e));
      void save(next);
    },
    [cancelPendingCustom, save],
  );

  return (
    <div className="flex flex-col">
      <div
        role="group"
        aria-label={t('case.form.nextFollowup.group')}
        data-testid="case-form-next-group"
        className="flex flex-nowrap items-center gap-1"
      >
        {QUICK_OPTIONS.map((q) => (
          <button
            key={q.id}
            type="button"
            data-testid={`case-form-next-${q.id}`}
            onMouseDown={keepCustomFocus}
            onClick={() => choose(q.date())}
            className={BUTTON_CLASS}
          >
            {t(q.text)}
          </button>
        ))}
        <label className="ml-1 flex items-center gap-1 whitespace-nowrap text-sm text-slate-700">
          <span data-testid="case-form-next-custom-label">
            {t('case.form.nextFollowup.custom')}
          </span>
          <input
            ref={customInputRef}
            type="date"
            data-testid="case-form-next-custom"
            min={todayIsoDate()}
            value={draft}
            aria-invalid={error === 'past' ? true : undefined}
            aria-describedby={
              error !== null ? 'case-form-next-error' : undefined
            }
            onChange={(e) => onCustomChange(e.target.value)}
            onBlur={commitCustom}
            onKeyDown={onCustomKeyDown}
            className="input w-[9.5rem] px-1 py-1 text-sm"
          />
        </label>
        <button
          type="button"
          data-testid="case-form-next-clear"
          disabled={value === null}
          onMouseDown={keepCustomFocus}
          onClick={() => choose(null)}
          className={BUTTON_CLASS}
        >
          {t('case.form.nextFollowup.clear')}
        </button>
      </div>
      {error !== null ? (
        <p
          id="case-form-next-error"
          data-testid="case-form-next-error"
          role="alert"
          className="mt-0.5 text-sm text-red-700"
        >
          {error === 'past'
            ? t('case.form.nextFollowup.error.past')
            : t('case.form.nextFollowup.error.saveFailed')}
        </p>
      ) : null}
    </div>
  );
}
