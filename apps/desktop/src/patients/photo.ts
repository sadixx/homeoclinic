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
}

/**
 * Capture a photo from the DEFAULT camera using the real WebRTC API
 * (`navigator.mediaDevices.getUserMedia`), draw one frame to a canvas and
 * return it as a PNG data URL. This is the production path for patient photo
 * capture (HC-MVP1-038); on a laptop it uses the built-in webcam.
 *
 * Camera *switching* (choosing among multiple devices) is deferred to the
 * Settings milestone (MS / SET-007); here we always use the browser's default
 * video input.
 *
 * Determinism / headless fallback: when `window.__HC_E2E_CAMERA__` is set, or
 * when `navigator.mediaDevices.getUserMedia` is unavailable (headless/CI, no
 * camera), fall back to the simulated grant decision + a generated frame so
 * E2E stays reproducible and the app never throws. No patient data, path or
 * stack leaves this helper (R-PRIV-001).
 */
export async function captureWebcamPhoto(): Promise<WebcamCaptureResult> {
  const override =
    typeof window !== 'undefined' ? window.__HC_E2E_CAMERA__ : undefined;
  const mediaDevices =
    typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;

  // E2E override or no real camera API -> deterministic simulated path.
  if (override !== undefined || mediaDevices?.getUserMedia === undefined) {
    return simulateCameraAccess()
      ? { ok: true, previewUrl: captureSimulatedFrame() }
      : { ok: false };
  }

  // Real capture, hard-bounded: getUserMedia + play + first frame are raced
  // against an overall timeout. On WebKitGTK a wedged media pipeline can make
  // getUserMedia resolve but play()/frame delivery never complete, which would
  // otherwise hang the UI. On timeout (or any error) we stop the stream and
  // return {ok:false} so the form shows "couldn't capture, try again or choose
  // a file" instead of freezing.
  const CAPTURE_TIMEOUT_MS = 8000;
  let stream: MediaStream | undefined;

  const capture = async (): Promise<WebcamCaptureResult> => {
    stream = await mediaDevices.getUserMedia({ video: true, audio: false });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    // Start playback but do NOT await it (play() can hang on WebKitGTK); wait
    // for the first decoded frame instead.
    void video.play().catch(() => undefined);
    if (video.readyState < 2 /* HAVE_CURRENT_DATA */ || video.videoWidth === 0) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = (): void => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        video.onloadeddata = done;
        video.onloadedmetadata = done;
      });
    }
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      return { ok: false };
    }
    ctx.drawImage(video, 0, 0, width, height);
    return { ok: true, previewUrl: canvas.toDataURL('image/png') };
  };

  const timeout = new Promise<WebcamCaptureResult>((resolve) => {
    setTimeout(() => resolve({ ok: false }), CAPTURE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([capture(), timeout]);
  } catch {
    // Permission denied, no device, or capture error -> treated as "no camera".
    return { ok: false };
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}
