// Clinic timings control for S01 Step 2 (M3-RWv6 item 3): Morning and Evening
// tabs, each with From and To typed as hour (1-12) and minute (00-59) boxes
// like a clock face. AM/PM is shown automatically per the clinicTimings rule.
// The boxes are plain strings in the wizard's state so Back keeps what the
// doctor typed; validation and serialisation live in clinicTimings.ts.
//
// A11y: WAI-ARIA tabs (role tablist/tab/tabpanel, aria-selected,
// aria-controls, Left/Right/Home/End move between tabs). Every box has an
// accessible name; errors are inline role="alert" (00-conventions §4).
import { useCallback, useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { t } from '@/shared/strings';
import type { StringKey } from '@/shared/strings';

import {
  formatClinicTimings,
  isToAfterFrom,
  isValidHour,
  isValidMinute,
  meridiemFor,
  parseClinicTimings,
} from './clinicTimings';
import type {
  ClinicSession,
  ClockTime,
  SessionEdge,
  SessionTimes,
} from './clinicTimings';

/** The four typed boxes of one session (raw text, as typed). */
export interface SessionBoxes {
  readonly fromHour: string;
  readonly fromMinute: string;
  readonly toHour: string;
  readonly toMinute: string;
}

/** Wizard state of the timings control. */
export interface TimingsBoxes {
  readonly morning: SessionBoxes;
  readonly evening: SessionBoxes;
  /**
   * A stored value that is not in the clinic-timings format, kept readable
   * as text and saved unchanged while every box stays empty.
   */
  readonly legacy: string;
}

const EMPTY_SESSION: SessionBoxes = {
  fromHour: '',
  fromMinute: '',
  toHour: '',
  toMinute: '',
};

const SESSIONS: readonly ClinicSession[] = ['morning', 'evening'];

const SESSION_LABEL: Readonly<Record<ClinicSession, StringKey>> = {
  morning: 'setup.clinic.timings.morning',
  evening: 'setup.clinic.timings.evening',
};

/** testid / error-key prefix shared with the wizard's inline errors. */
export const TIMINGS_ID = 'setup-clinic-timings';

function sessionToBoxes(times: SessionTimes | null): SessionBoxes {
  if (times === null) return EMPTY_SESSION;
  return {
    fromHour: String(times.from.hour),
    fromMinute: String(times.from.minute).padStart(2, '0'),
    toHour: String(times.to.hour),
    toMinute: String(times.to.minute).padStart(2, '0'),
  };
}

/** Boxes that re-open a stored timings string (legacy text kept as text). */
export function timingsBoxesFor(stored: string): TimingsBoxes {
  const parsed = parseClinicTimings(stored);
  if (parsed === null) {
    return {
      morning: EMPTY_SESSION,
      evening: EMPTY_SESSION,
      legacy: stored.trim(),
    };
  }
  return {
    morning: sessionToBoxes(parsed.morning),
    evening: sessionToBoxes(parsed.evening),
    legacy: '',
  };
}

const DIGITS_RE = /^\d{1,2}$/;

function readHour(raw: string): number | null {
  const s = raw.trim();
  if (!DIGITS_RE.test(s)) return null;
  const n = Number(s);
  return isValidHour(n) ? n : null;
}

function readMinute(raw: string): number | null {
  const s = raw.trim();
  if (!DIGITS_RE.test(s)) return null;
  const n = Number(s);
  return isValidMinute(n) ? n : null;
}

function isSessionEmpty(s: SessionBoxes): boolean {
  return (
    s.fromHour.trim() === '' &&
    s.fromMinute.trim() === '' &&
    s.toHour.trim() === '' &&
    s.toMinute.trim() === ''
  );
}

/** Result of validating the boxes: inline errors, or the value to save. */
export interface TimingsValidation {
  /** Error key (`setup-clinic-timings-...`) to message. Empty when valid. */
  readonly errors: Readonly<Record<string, string>>;
  /** Session holding the first error, to bring its tab forward. */
  readonly firstErrorSession: ClinicSession | null;
  /** The timings String to save (null when nothing is set). */
  readonly value: string | null;
}

/** Validate every box and build the stored timings string. */
export function validateTimings(
  boxes: TimingsBoxes,
  idBase: string = TIMINGS_ID,
): TimingsValidation {
  const errors: Record<string, string> = {};
  let firstErrorSession: ClinicSession | null = null;
  const sessions: Partial<Record<ClinicSession, SessionTimes>> = {};
  const fail = (session: ClinicSession, key: string, message: string) => {
    errors[key] = message;
    firstErrorSession ??= session;
  };
  for (const session of SESSIONS) {
    const s = boxes[session];
    if (isSessionEmpty(s)) continue;
    const id = `${idBase}-${session}`;
    const read = (
      edge: SessionEdge,
      hourRaw: string,
      minuteRaw: string,
    ): ClockTime | null => {
      const hour = readHour(hourRaw);
      const minute = readMinute(minuteRaw);
      if (hour === null)
        fail(
          session,
          `${id}-${edge}-hour`,
          t('setup.clinic.timings.errorHour'),
        );
      if (minute === null)
        fail(
          session,
          `${id}-${edge}-minute`,
          t('setup.clinic.timings.errorMinute'),
        );
      return hour === null || minute === null ? null : { hour, minute };
    };
    const from = read('from', s.fromHour, s.fromMinute);
    const to = read('to', s.toHour, s.toMinute);
    if (from === null || to === null) continue;
    const times: SessionTimes = { from, to };
    if (!isToAfterFrom(session, times)) {
      fail(session, id, t('setup.clinic.timings.errorOrder'));
      continue;
    }
    sessions[session] = times;
  }
  if (Object.keys(errors).length > 0) {
    return { errors, firstErrorSession, value: null };
  }
  const text = formatClinicTimings({
    morning: sessions.morning ?? null,
    evening: sessions.evening ?? null,
  });
  if (text !== '') return { errors, firstErrorSession, value: text };
  // Nothing typed: keep a legacy free-text value as it was.
  return {
    errors,
    firstErrorSession,
    value: boxes.legacy === '' ? null : boxes.legacy,
  };
}

/** Props of {@link ClinicTimingsInput}. */
export interface ClinicTimingsInputProps {
  readonly value: TimingsBoxes;
  readonly onChange: (next: TimingsBoxes) => void;
  readonly activeSession: ClinicSession;
  readonly onActiveSessionChange: (session: ClinicSession) => void;
  /** Inline errors keyed as {@link validateTimings} produces them. */
  readonly errors: Readonly<Record<string, string>>;
  /**
   * testid / id / error-key base (default {@link TIMINGS_ID}); S18 passes
   * `settings-clinic-timings`.
   */
  readonly idBase?: string;
}

const BOX_CLASS =
  'h-10 w-14 rounded border border-slate-300 px-2 text-center text-base focus:outline-none focus:ring-2 focus:ring-blue-600';

/** Morning / Evening tabs with clock-face hour and minute boxes. */
export function ClinicTimingsInput({
  value,
  onChange,
  activeSession,
  onActiveSessionChange,
  errors,
  idBase = TIMINGS_ID,
}: ClinicTimingsInputProps): JSX.Element {
  const tabRefs = useRef<Partial<Record<ClinicSession, HTMLButtonElement>>>({});

  const setBox = useCallback(
    (session: ClinicSession, key: keyof SessionBoxes, text: string) => {
      onChange({ ...value, [session]: { ...value[session], [key]: text } });
    },
    [value, onChange],
  );

  const onTabKey = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const i = SESSIONS.indexOf(activeSession);
      let next: ClinicSession | null = null;
      if (e.key === 'ArrowRight') next = SESSIONS[(i + 1) % SESSIONS.length]!;
      else if (e.key === 'ArrowLeft')
        next = SESSIONS[(i + SESSIONS.length - 1) % SESSIONS.length]!;
      else if (e.key === 'Home') next = SESSIONS[0]!;
      else if (e.key === 'End') next = SESSIONS[SESSIONS.length - 1]!;
      if (next === null) return;
      e.preventDefault();
      onActiveSessionChange(next);
      tabRefs.current[next]?.focus();
    },
    [activeSession, onActiveSessionChange],
  );

  const errorLine = (key: string): JSX.Element | null => {
    const message = errors[key];
    if (message === undefined) return null;
    return (
      <p
        data-testid={`${key}-error`}
        role="alert"
        className="mt-1 text-sm text-red-700"
      >
        {message}
      </p>
    );
  };

  const edgeRow = (session: ClinicSession, edge: SessionEdge): JSX.Element => {
    const s = value[session];
    const hourKey = edge === 'from' ? 'fromHour' : 'toHour';
    const minuteKey = edge === 'from' ? 'fromMinute' : 'toMinute';
    const hour = readHour(s[hourKey]);
    const fromHour = readHour(s.fromHour);
    const meridiem =
      hour === null ? '' : meridiemFor(session, edge, hour, fromHour);
    const edgeLabel = t(
      edge === 'from' ? 'setup.clinic.timings.from' : 'setup.clinic.timings.to',
    );
    const sessionLabel = t(SESSION_LABEL[session]);
    const id = `${idBase}-${session}-${edge}`;
    const hourId = `${id}-hour`;
    const minuteId = `${id}-minute`;
    return (
      <div className="flex flex-col" data-testid={`${id}-row`}>
        <div className="flex items-center gap-2">
          <span className="w-12 text-sm text-slate-700">{edgeLabel}</span>
          <input
            data-testid={hourId}
            type="text"
            inputMode="numeric"
            maxLength={2}
            aria-label={`${sessionLabel} ${edgeLabel} ${t('setup.clinic.timings.hour')}`}
            aria-invalid={errors[hourId] !== undefined}
            placeholder={t('setup.clinic.timings.hourPlaceholder')}
            value={s[hourKey]}
            onChange={(e) => setBox(session, hourKey, e.target.value)}
            className={BOX_CLASS}
          />
          <span aria-hidden="true" className="text-base text-slate-700">
            :
          </span>
          <input
            data-testid={minuteId}
            type="text"
            inputMode="numeric"
            maxLength={2}
            aria-label={`${sessionLabel} ${edgeLabel} ${t('setup.clinic.timings.minute')}`}
            aria-invalid={errors[minuteId] !== undefined}
            placeholder={t('setup.clinic.timings.minutePlaceholder')}
            value={s[minuteKey]}
            onChange={(e) => setBox(session, minuteKey, e.target.value)}
            className={BOX_CLASS}
          />
          <span
            data-testid={`${id}-ampm`}
            className="w-10 text-base font-medium text-slate-800"
          >
            {meridiem}
          </span>
        </div>
        {errorLine(hourId)}
        {errorLine(minuteId)}
      </div>
    );
  };

  return (
    <div className="flex flex-col" data-testid={`${idBase}-group`}>
      <span id={`${idBase}-label`} className="text-sm text-slate-700">
        {t('setup.clinic.timings')}
      </span>
      <div
        role="tablist"
        aria-labelledby={`${idBase}-label`}
        className="mt-1 flex gap-2"
      >
        {SESSIONS.map((session) => {
          const selected = session === activeSession;
          return (
            <button
              key={session}
              ref={(el) => {
                if (el !== null) tabRefs.current[session] = el;
              }}
              type="button"
              role="tab"
              id={`${idBase}-tab-${session}-btn`}
              data-testid={`${idBase}-tab-${session}`}
              aria-selected={selected}
              aria-controls={`${idBase}-panel-${session}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onActiveSessionChange(session)}
              onKeyDown={onTabKey}
              className={
                selected
                  ? 'h-9 rounded border border-blue-600 bg-blue-50 px-3 text-sm font-semibold text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600'
                  : 'h-9 rounded border border-slate-300 px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600'
              }
            >
              {t(SESSION_LABEL[session])}
            </button>
          );
        })}
      </div>
      {SESSIONS.map((session) => (
        <div
          key={session}
          role="tabpanel"
          id={`${idBase}-panel-${session}`}
          data-testid={`${idBase}-panel-${session}`}
          aria-labelledby={`${idBase}-tab-${session}-btn`}
          hidden={session !== activeSession}
          className="mt-2 flex flex-col gap-2 rounded border border-slate-200 p-3"
        >
          {/* The session group carries the session-level error key
              (`<idBase>-<session>`) so Save can focus it. */}
          <div
            role="group"
            aria-labelledby={`${idBase}-tab-${session}-btn`}
            data-testid={`${idBase}-${session}`}
            className="flex flex-col gap-2"
          >
            {edgeRow(session, 'from')}
            {edgeRow(session, 'to')}
          </div>
          {errorLine(`${idBase}-${session}`)}
        </div>
      ))}
      <p className="mt-1 text-sm text-slate-500">
        {t('setup.clinic.timings.hint')}
      </p>
      {value.legacy !== '' ? (
        <p
          data-testid={`${idBase}-legacy`}
          className="mt-1 text-sm text-slate-700"
        >
          {t('setup.clinic.timings.legacy')} {value.legacy}
        </p>
      ) : null}
    </div>
  );
}
