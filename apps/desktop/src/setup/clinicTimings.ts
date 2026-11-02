// Clinic timings kernel for the S01 setup wizard (M3-RWv6 item 3). Pure, no
// React: the wizard's Morning / Evening clock boxes are validated, labelled
// AM/PM and serialised here into the clinic profile's existing `timings`
// String (no schema or binding change), and parsed back on pre-fill.
//
// Stored format: 'Morning 9:30 AM-1:00 PM; Evening 5:00 PM-8:30 PM'. Either
// session may be absent. A value that does not match this format exactly
// (a legacy free-text value) parses to null and is kept readable as text.
//
// AM/PM rule: Morning hours are AM, except 12 and any To hour earlier than the
// From hour, which are PM (9:30 to 1:00 reads 9:30 AM to 1:00 PM). Evening
// hours are always PM.

/** A clock-face time: hour 1-12, minute 0-59. */
export interface ClockTime {
  readonly hour: number;
  readonly minute: number;
}

/** One session's opening and closing time. */
export interface SessionTimes {
  readonly from: ClockTime;
  readonly to: ClockTime;
}

/** Both sessions; null means the session is not held. */
export interface ClinicTimings {
  readonly morning: SessionTimes | null;
  readonly evening: SessionTimes | null;
}

/** The two clinic sessions, in display and storage order. */
export type ClinicSession = 'morning' | 'evening';

/** One end of a session. */
export type SessionEdge = 'from' | 'to';

/** Ante / post meridiem marker. */
export type Meridiem = 'AM' | 'PM';

/** Display / storage names of the sessions (data tokens, not UI copy). */
const SESSION_WORD: Readonly<Record<ClinicSession, string>> = {
  morning: 'Morning',
  evening: 'Evening',
};

/** True when `hour` is a whole clock-face hour (1-12). */
export function isValidHour(hour: number): boolean {
  return Number.isInteger(hour) && hour >= 1 && hour <= 12;
}

/** True when `minute` is a whole minute (0-59). */
export function isValidMinute(minute: number): boolean {
  return Number.isInteger(minute) && minute >= 0 && minute <= 59;
}

/**
 * AM/PM for one end of a session, set automatically (the doctor never picks
 * it). `fromHour` is the session's From hour, used only for a morning To
 * hour; pass null when it is unknown.
 */
export function meridiemFor(
  session: ClinicSession,
  edge: SessionEdge,
  hour: number,
  fromHour: number | null,
): Meridiem {
  if (session === 'evening') return 'PM';
  if (hour === 12) return 'PM';
  if (edge === 'to' && fromHour !== null && hour < fromHour) return 'PM';
  return 'AM';
}

/** Minutes since midnight for a clock time with its meridiem. */
function minutesOfDay(time: ClockTime, meridiem: Meridiem): number {
  const base = time.hour % 12;
  const hour24 = meridiem === 'PM' ? base + 12 : base;
  return hour24 * 60 + time.minute;
}

/** The meridiems of a session's From and To, per {@link meridiemFor}. */
function sessionMeridiems(
  session: ClinicSession,
  times: SessionTimes,
): readonly [Meridiem, Meridiem] {
  return [
    meridiemFor(session, 'from', times.from.hour, null),
    meridiemFor(session, 'to', times.to.hour, times.from.hour),
  ];
}

/** True when the session's To is strictly after its From. */
export function isToAfterFrom(
  session: ClinicSession,
  times: SessionTimes,
): boolean {
  const [fromM, toM] = sessionMeridiems(session, times);
  return minutesOfDay(times.to, toM) > minutesOfDay(times.from, fromM);
}

/** `H:MM AM` for one end. */
function formatClock(time: ClockTime, meridiem: Meridiem): string {
  return `${time.hour}:${String(time.minute).padStart(2, '0')} ${meridiem}`;
}

/** Serialise into the stored timings string ('' when both sessions empty). */
export function formatClinicTimings(value: ClinicTimings): string {
  const parts: string[] = [];
  for (const session of ['morning', 'evening'] as const) {
    const times = value[session];
    if (times === null) continue;
    const [fromM, toM] = sessionMeridiems(session, times);
    parts.push(
      `${SESSION_WORD[session]} ${formatClock(times.from, fromM)}-${formatClock(times.to, toM)}`,
    );
  }
  return parts.join('; ');
}

const SEGMENT_RE =
  /^(Morning|Evening) (\d{1,2}):(\d{2}) (AM|PM)-(\d{1,2}):(\d{2}) (AM|PM)$/;

/**
 * Parse a stored timings string back into both sessions. Returns null for any
 * value that is not exactly in the stored format (legacy free text, an
 * out-of-range hour or minute, an AM/PM that disagrees with the rule, a
 * repeated or out-of-order session), so the caller keeps it as text.
 */
export function parseClinicTimings(stored: string): ClinicTimings | null {
  const text = stored.trim();
  if (text === '') return null;
  let morning: SessionTimes | null = null;
  let evening: SessionTimes | null = null;
  let lastIndex = -1;
  for (const segment of text.split('; ')) {
    const m = SEGMENT_RE.exec(segment);
    if (m === null) return null;
    const session: ClinicSession = m[1] === 'Morning' ? 'morning' : 'evening';
    const index = session === 'morning' ? 0 : 1;
    if (index <= lastIndex) return null;
    lastIndex = index;
    const from = { hour: Number(m[2]), minute: Number(m[3]) };
    const to = { hour: Number(m[5]), minute: Number(m[6]) };
    if (
      !isValidHour(from.hour) ||
      !isValidMinute(from.minute) ||
      !isValidHour(to.hour) ||
      !isValidMinute(to.minute)
    ) {
      return null;
    }
    const times: SessionTimes = { from, to };
    const [fromM, toM] = sessionMeridiems(session, times);
    if (fromM !== m[4] || toM !== m[7]) return null;
    if (session === 'morning') morning = times;
    else evening = times;
  }
  return { morning, evening };
}
