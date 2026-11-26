// Patient photo helpers (HC-MVP1-038, PAT-001).
//
// Two photo sources exist on the register/edit form:
//   - "Choose file": fully REAL. An `<input type="file" accept="image/*">`
//     yields a `File`; the UI shows an object-URL preview and stores an opaque
//     photo ref (the file name) in `photo_path`. The UI never builds a raw
//     filesystem path (UI -> typed commands only); the backend owns the copy
//     into the encrypted data folder at a later P1 slice (PAT-009).
//   - "Use webcam": SIMULATED. There is no real camera in the sandbox, so the
//     human asked the webcam device to be granted/denied at RANDOM. The grant
//     decision is isolated behind `simulateCameraAccess()` so it is the single
//     seam a test drives, and a captured frame is a small generated data URL —
//     no `navigator.mediaDevices`, no permission prompt, no network. The grant
//     is random in production, but an E2E (which has no camera and must be
//     deterministic) can force the outcome through the `window.__HC_E2E_CAMERA__`
//     hook — see `simulateCameraAccess()` below.
//
// No patient data, path or stack ever leaves through these helpers
// (R-PRIV-001, R-UI-008).

import type { CameraChoice } from '@/bindings';
import { listCameras, resolvePreferredCamera } from '@/shared/camera';
import type { StringKey } from '@/shared/strings';

/** A photo attached to the form, with a preview URL and an opaque stored ref. */
export interface AttachedPhoto {
  /** Object URL / data URL used only for the on-screen <img> preview. */
  readonly previewUrl: string;
  /** Opaque ref persisted in `photo_path` (file name or a webcam marker). */
  readonly ref: string;
  /** Where the photo came from (drives the "Retake" affordance). */
  readonly source: 'file' | 'webcam';
}

/**
 * The E2E camera override hook. When present on `window`, it deterministically
 * forces the simulated grant decision instead of the production random path:
 *   - `'grant'` -> the camera is always granted,
 *   - `'deny'`  -> the camera is always denied.
 * Production never sets this, so the simulation stays random for real users; an
 * E2E (headless, no camera) sets it on `window` before driving the form so the
 * photo-lifecycle assertions are stable. It carries no patient data.
 */
export type E2ECameraOverride = 'grant' | 'deny';

declare global {
  interface Window {
    /** E2E-only deterministic camera override (unset in production). */
    __HC_E2E_CAMERA__?: E2ECameraOverride;
  }
}

/**
 * Simulate asking the OS for camera access. Returns `true` (a device was
 * granted) or `false` (no device / denied), standing in for a real
 * `getUserMedia` grant on a machine with no camera (the sandbox).
 *
 * Determinism seam: if an E2E has set `window.__HC_E2E_CAMERA__` to `'grant'`
 * or `'deny'`, that decision is honoured so the photo lifecycle is reproducible
 * end to end. Otherwise the decision is RANDOM, exactly as in production. This
 * is the ONLY randomness and the single seam a unit test overrides (via the
 * window hook, or `vi.spyOn(Math, 'random')` for the random branch).
 */
export function simulateCameraAccess(): boolean {
  const override =
    typeof window !== 'undefined' ? window.__HC_E2E_CAMERA__ : undefined;
  if (override === 'grant') {
    return true;
  }
  if (override === 'deny') {
    return false;
  }
  return Math.random() >= 0.5;
}

/**
 * Produce a simulated captured webcam frame as a tiny, self-contained data URL
 * (a 1x1 PNG). Real frame capture is wired to the Tauri camera path later;
 * here it only needs to be a non-empty, attachable image ref so the lifecycle
 * (attach / remove / retake / swap) is exercised end to end.
 */
export function captureSimulatedFrame(): string {
  // A valid 1x1 transparent PNG, base64-encoded — enough for an <img src>.
  return (
    'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  );
}

/** Build the opaque webcam ref stored in `photo_path` (timestamped marker). */
export function webcamRef(): string {
  return `webcam-capture-${Date.now()}.png`;
}

/** Outcome of a webcam capture attempt. */
export interface WebcamCaptureResult {
  /** `true` when a frame was captured; `false` when no camera / denied. */
  readonly ok: boolean;
  /** Data-URL preview of the captured frame (present when `ok`). */
  readonly previewUrl?: string;
  /**
   * Why a capture failed, as an internal code (for tests and diagnosis, NOT
   * for the screen: show {@link plainReasonKey} instead): a DOMException name
   * (`NotReadableError`, ...), `timeout` (the camera never opened),
   * `no-frame` (it opened but sent no picture), `no-device` (no capture API),
   * `aborted` (cancelled by the caller) or `error`. After a retry, the codes
   * of both attempts, comma separated. Never a message, path or free text.
   */
  readonly reason?: string;
}

/** Reason code of a capture the caller cancelled (not an error). */
const ABORTED = 'aborted';

/**
 * Plain-language reasons, most specific first. The doctor never sees a
 * DOMException name or any other code (R-UI-008).
 */
const PLAIN_REASONS: readonly {
  readonly key: StringKey;
  readonly codes: readonly string[];
}[] = [
  {
    key: 'patient.form.photo.reason.denied',
    codes: ['NotAllowedError', 'SecurityError'],
  },
  {
    key: 'patient.form.photo.reason.none',
    codes: ['NotFoundError', 'OverconstrainedError', 'no-device'],
  },
  {
    key: 'patient.form.photo.reason.busy',
    codes: ['NotReadableError', 'no-frame'],
  },
  { key: 'patient.form.photo.reason.slow', codes: ['timeout'] },
];

/**
 * The strings-file key of the one sentence that explains a failed capture,
 * from {@link WebcamCaptureResult.reason} (one code, or the two codes of a
 * retried capture). Equal attempts give one sentence; different attempts give
 * the more specific one (denied, then none, busy, slow, then the generic
 * "could not be opened"). Undefined when there is nothing to say (no reason,
 * or the caller cancelled).
 */
export function plainReasonKey(
  reason: string | undefined,
): StringKey | undefined {
  if (reason === undefined || reason.trim() === '') return undefined;
  const codes = reason.split(',').map((c) => c.trim());
  if (codes.every((c) => c === ABORTED)) return undefined;
  const rank = (code: string): number => {
    const i = PLAIN_REASONS.findIndex((r) => r.codes.includes(code));
    return i === -1 ? PLAIN_REASONS.length : i;
  };
  const best = Math.min(...codes.map(rank));
  return PLAIN_REASONS[best]?.key ?? 'patient.form.photo.reason.other';
}

/** Hard bound on one whole capture, including a retry (ms). */
const CAPTURE_TIMEOUT_MS = 8000;
/**
 * How long the saved camera gets (open + first frame) before the system
 * default is tried instead (ms). Leaves 5 s for the retry.
 */
const PREFERRED_BUDGET_MS = 3000;

/** Error names that may be shown; anything else is reported as `error`. */
const KNOWN_ERROR_NAMES = new Set([
  'AbortError',
  'InvalidStateError',
  'NotAllowedError',
  'NotFoundError',
  'NotReadableError',
  'OverconstrainedError',
  'SecurityError',
  'TypeError',
]);

/** A capture failure that already carries its reason code. */
class CaptureFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof CaptureFailure) return error.code;
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  return KNOWN_ERROR_NAMES.has(name) ? name : 'error';
}

function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach((track) => track.stop());
}

/**
 * Resolve the camera chosen in Settings (SET-007) to a device id, by id, else
 * by name. Before the first grant of a session WebKitGTK hides every deviceId
 * and label, so the saved camera cannot be matched: unlock first (a bounded
 * getUserMedia, only while labels are hidden), then enumerate (ms-review-2).
 * The unlock (which may wait for the doctor to click Allow) is NOT part of
 * the saved camera's own time budget. Undefined = use the system default.
 */
async function resolveSavedCamera(
  preferred: CameraChoice,
): Promise<string | undefined> {
  const list = await listCameras({ unlockLabels: true });
  return list.status === 'ok'
    ? resolvePreferredCamera(preferred, list.cameras)
    : undefined;
}

/**
 * A promise that resolves with the cancelled result when `signal` fires and
 * never otherwise. `onAbort` runs synchronously in the abort event, so a
 * camera can be freed in the same tick. Call `dispose` when done.
 */
function whenAborted(
  signal: AbortSignal | undefined,
  onAbort?: () => void,
): { promise: Promise<WebcamCaptureResult>; dispose: () => void } {
  if (signal === undefined) {
    return { promise: new Promise(() => undefined), dispose: () => undefined };
  }
  let listener: () => void = () => undefined;
  const promise = new Promise<WebcamCaptureResult>((resolve) => {
    listener = () => {
      onAbort?.();
      resolve({ ok: false, reason: ABORTED });
    };
    if (signal.aborted) listener();
    else signal.addEventListener('abort', listener, { once: true });
  });
  return {
    promise,
    dispose: () => signal.removeEventListener('abort', listener),
  };
}

/**
 * One capture attempt, hard-bounded by `budgetMs`: open a stream with `open`,
 * wait for the first frame, draw it, return a PNG data URL. Every stream it
 * ever receives is stopped on every exit, including one that only arrives
 * after the budget ran out (a slow grant must not leave the camera on).
 *
 * `signal` cancels the attempt at once: the held stream is stopped in the
 * same tick and a stream that arrives later is stopped on arrival.
 *
 * On WebKitGTK a wedged media pipeline can make getUserMedia resolve but
 * play()/frame delivery never complete, which would otherwise hang the UI.
 */
async function runAttempt(
  open: () => Promise<MediaStream>,
  budgetMs: number,
  signal?: AbortSignal,
): Promise<WebcamCaptureResult> {
  const held: MediaStream[] = [];
  let closed = false;
  let opened = false;
  let video: HTMLVideoElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const release = (): void => {
    closed = true;
    held.splice(0).forEach(stopStream);
    if (video !== undefined) video.srcObject = null;
  };

  const capture = async (): Promise<WebcamCaptureResult> => {
    const stream = await open();
    if (closed) {
      // The attempt already gave up: do not keep this camera on.
      stopStream(stream);
      throw new CaptureFailure('timeout');
    }
    held.push(stream);
    opened = true;
    const el = document.createElement('video');
    video = el;
    el.srcObject = stream;
    el.muted = true;
    el.playsInline = true;
    // Start playback but do NOT await it (play() can hang on WebKitGTK); wait
    // for the first decoded frame instead.
    void el.play().catch(() => undefined);
    if (el.readyState < 2 /* HAVE_CURRENT_DATA */ || el.videoWidth === 0) {
      await new Promise<void>((resolve) => {
        el.onloadeddata = () => resolve();
        el.onloadedmetadata = () => resolve();
      });
    }
    const width = el.videoWidth || 640;
    const height = el.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      return { ok: false, reason: 'error' };
    }
    ctx.drawImage(el, 0, 0, width, height);
    return { ok: true, previewUrl: canvas.toDataURL('image/png') };
  };

  const timeout = new Promise<WebcamCaptureResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, reason: opened ? 'no-frame' : 'timeout' }),
      budgetMs,
    );
  });

  // Cancel: free the camera in the same tick as the abort, not when the race
  // is next awaited.
  const abort = whenAborted(signal, release);

  try {
    return await Promise.race([capture(), timeout, abort.promise]);
  } catch (error: unknown) {
    // Permission denied, no device, busy camera or capture error.
    return { ok: false, reason: reasonOf(error) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    abort.dispose();
    release();
  }
}

/**
 * Capture a photo using the real WebRTC API
 * (`navigator.mediaDevices.getUserMedia`), draw one frame to a canvas and
 * return it as a PNG data URL. This is the production path for patient photo
 * capture (HC-MVP1-038); on a laptop it uses the built-in webcam.
 *
 * `preferred` is the camera chosen in Settings (SET-007): requested by exact
 * device id (re-found by name when the id changed). If that attempt fails
 * (busy, unplugged, or no first frame within about 3 s) the system default is
 * tried once, inside the same 8 s overall bound. A refusal (NotAllowedError:
 * the doctor pressed Deny; SecurityError) is returned as it is, with no retry,
 * so Deny is never followed by a second prompt. The saved camera's own 3 s
 * clock starts only after the
 * label-unlock grant, so a slow first "Allow" does not trigger a fallback and
 * a second prompt. No preference = the browser's default video input.
 * "Choose file" stays the fallback on the form.
 *
 * `signal` cancels the capture (unmount, Cancel, navigation): the camera is
 * released at once and the result is `{ ok: false, reason: 'aborted' }`.
 *
 * On failure `reason` carries an internal code; show {@link plainReasonKey}
 * to the doctor, never the code (see {@link WebcamCaptureResult.reason}).
 *
 * Determinism / headless fallback: when `window.__HC_E2E_CAMERA__` is set, or
 * when `navigator.mediaDevices.getUserMedia` is unavailable (headless/CI, no
 * camera), fall back to the simulated grant decision + a generated frame so
 * E2E stays reproducible and the app never throws. No patient data, path or
 * stack leaves this helper (R-PRIV-001).
 */
export async function captureWebcamPhoto(
  preferred?: CameraChoice | null,
  signal?: AbortSignal,
): Promise<WebcamCaptureResult> {
  const override =
    typeof window !== 'undefined' ? window.__HC_E2E_CAMERA__ : undefined;
  const mediaDevices =
    typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;

  // E2E override or no real camera API -> deterministic simulated path.
  if (override !== undefined || mediaDevices?.getUserMedia === undefined) {
    return simulateCameraAccess()
      ? { ok: true, previewUrl: captureSimulatedFrame() }
      : { ok: false, reason: 'no-device' };
  }

  const cancelled: WebcamCaptureResult = { ok: false, reason: ABORTED };
  if (signal?.aborted) return cancelled;

  const startedAt = Date.now();
  const remainingMs = (): number =>
    CAPTURE_TIMEOUT_MS - (Date.now() - startedAt);
  const reasons: string[] = [];

  if (preferred) {
    const abort = whenAborted(signal);
    let deviceId: string | undefined;
    try {
      const resolved = await Promise.race([
        resolveSavedCamera(preferred),
        abort.promise,
      ]);
      deviceId = typeof resolved === 'string' ? resolved : undefined;
    } finally {
      abort.dispose();
    }
    if (signal?.aborted) return cancelled;

    if (deviceId !== undefined && remainingMs() > 0) {
      const exact = deviceId;
      const first = await runAttempt(
        () =>
          mediaDevices.getUserMedia({
            video: { deviceId: { exact } },
            audio: false,
          }),
        Math.min(PREFERRED_BUDGET_MS, remainingMs()),
        signal,
      );
      if (first.ok) return first;
      if (first.reason === ABORTED) return first;
      // No retry after a refusal: NotAllowedError is the doctor pressing Deny
      // (a retry would raise a second prompt at once); SecurityError is about
      // this page, not this camera, so a retry is futile.
      if (first.reason === 'NotAllowedError') return first;
      if (first.reason === 'SecurityError') return first;
      if (first.reason !== undefined) reasons.push(first.reason);
    }
  }

  if (signal?.aborted) return cancelled;
  if (remainingMs() <= 0) {
    return { ok: false, reason: [...reasons, 'timeout'].join(', ') };
  }
  const second = await runAttempt(
    () => mediaDevices.getUserMedia({ video: true, audio: false }),
    remainingMs(),
    signal,
  );
  if (second.ok || second.reason === ABORTED) return second;
  reasons.push(second.reason ?? 'error');
  return { ok: false, reason: reasons.join(', ') };
}
