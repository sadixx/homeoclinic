// MS (SET-007, PAT-001, HC-MVP1-038) S06 capture honours the chosen camera. CUT: the REAL
// `captureWebcamPhoto(preferred)`. Fakes are the webview dependencies only:
// `navigator.mediaDevices` (enumerateDevices + getUserMedia) and the
// video/canvas frame pipeline (same stubs as photo.test.ts). The existing
// photo.test.ts keeps covering the no-preference, E2E-override and
// headless-fallback paths unchanged.

import { describe, it, expect, vi, afterEach } from 'vitest';

import { captureWebcamPhoto, plainReasonKey } from './photo';

const CAMS = [
  { kind: 'videoinput', deviceId: 'cam-1', label: 'Test Camera 1' },
  { kind: 'videoinput', deviceId: 'cam-9', label: 'Test Camera 2' },
];

/** A browser with cameras whose frame pipeline returns a fixed data URL. */
function fakeCamera(
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>,
): ReturnType<typeof vi.fn> {
  const gum = vi.fn(getUserMedia);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: gum, enumerateDevices: async () => CAMS },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    'data:image/png;base64,REALFRAME',
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(2);
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(
    640,
  );
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(
    480,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  return gum;
}

const stream = (): MediaStream =>
  ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream;

afterEach(() => {
  delete window.__HC_E2E_CAMERA__;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('captureWebcamPhoto(preferred) (SET-007, PAT-001, HC-MVP1-038)', () => {
  it('requests the chosen camera by exact deviceId', async () => {
    const gum = fakeCamera(async () => stream());
    const result = await captureWebcamPhoto({
      deviceId: 'cam-1',
      label: 'Test Camera 1',
    });
    expect(gum).toHaveBeenCalledWith({
      video: { deviceId: { exact: 'cam-1' } },
      audio: false,
    });
    expect(result).toEqual({
      ok: true,
      previewUrl: 'data:image/png;base64,REALFRAME',
    });
  });

  it('re-finds the chosen camera by name when its id changed', async () => {
    const gum = fakeCamera(async () => stream());
    await captureWebcamPhoto({ deviceId: 'cam-2-old', label: 'Test Camera 2' });
    expect(gum).toHaveBeenCalledWith({
      video: { deviceId: { exact: 'cam-9' } },
      audio: false,
    });
  });

  it('retries once with the system default when the chosen camera refuses', async () => {
    const gum = fakeCamera(async (c) => {
      if (typeof c.video === 'object') {
        throw Object.assign(new Error('gone'), {
          name: 'OverconstrainedError',
        });
      }
      return stream();
    });
    const result = await captureWebcamPhoto({
      deviceId: 'cam-1',
      label: 'Test Camera 1',
    });
    expect(gum).toHaveBeenCalledTimes(2);
    expect(gum).toHaveBeenLastCalledWith({ video: true, audio: false });
    expect(result.ok).toBe(true);
  });

  // ms-review-2: WebKitGTK grants only the user-media request, so before the
  // first getUserMedia of a session enumerateDevices hides every deviceId and
  // label. The saved camera must still be the one opened on the first capture.
  it('uses the saved camera on the first capture after launch (labels hidden until a grant)', async () => {
    let granted = false;
    const enumerateDevices = vi.fn(async () =>
      granted
        ? CAMS
        : CAMS.map((c) => ({ kind: c.kind, deviceId: '', label: '' })),
    );
    const gum = fakeCamera(async () => {
      granted = true;
      return stream();
    });
    const media = navigator.mediaDevices as unknown as {
      enumerateDevices: typeof enumerateDevices;
    };
    media.enumerateDevices = enumerateDevices;

    const result = await captureWebcamPhoto({
      deviceId: 'cam-9',
      label: 'Test Camera 2',
    });

    expect(result.ok).toBe(true);
    // The camera actually used for the photo is the saved one.
    expect(gum).toHaveBeenLastCalledWith({
      video: { deviceId: { exact: 'cam-9' } },
      audio: false,
    });
    // A grant happened before the enumeration that resolved the saved id.
    const firstGrant = gum.mock.invocationCallOrder[0] ?? Infinity;
    const lastEnumerate =
      enumerateDevices.mock.invocationCallOrder.at(-1) ?? -Infinity;
    expect(firstGrant).toBeLessThan(lastEnumerate);
  });
});

// ---------------------------------------------------------------------------
// Failure handling, release and reason codes (camera regression, R5).
// ---------------------------------------------------------------------------

/** A stream whose single track records its `stop` calls. */
function trackedStream(stop = vi.fn()): MediaStream {
  return { getTracks: () => [{ stop }] } as unknown as MediaStream;
}

/** Frames only arrive for streams in `live`; everything else never delivers. */
function framesOnlyFor(live: Set<unknown>): void {
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockImplementation(
    function (this: HTMLMediaElement) {
      return live.has(this.srcObject) ? 2 : 0;
    },
  );
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockImplementation(
    function (this: HTMLVideoElement) {
      return live.has(this.srcObject) ? 640 : 0;
    },
  );
}

const domError = (name: string): Error =>
  Object.assign(new Error(name), { name });

const PREFERRED = { deviceId: 'cam-1', label: 'Test Camera 1' };

describe('captureWebcamPhoto(preferred): a failure of the saved camera retries the default once, except a refusal (SET-007, PAT-001, HC-MVP1-038)', () => {
  it.each(['NotReadableError', 'AbortError', 'TypeError'])(
    'retries once with the system default after %s',
    async (name) => {
      const gum = fakeCamera(async (c) => {
        if (typeof c.video === 'object') throw domError(name);
        return stream();
      });
      const result = await captureWebcamPhoto(PREFERRED);
      expect(gum).toHaveBeenCalledTimes(2);
      expect(gum).toHaveBeenLastCalledWith({ video: true, audio: false });
      expect(result.ok).toBe(true);
    },
  );

  // A Deny is the doctor's answer: asking the default camera at once would
  // raise a second prompt right after it. A SecurityError is about the page.
  it.each(['SecurityError', 'NotAllowedError'])(
    'does not retry after a %s and reports it (no second prompt after Deny)',
    async (name) => {
      const gum = fakeCamera(async () => {
        throw domError(name);
      });
      const result = await captureWebcamPhoto(PREFERRED);
      expect(gum).toHaveBeenCalledTimes(1);
      expect(gum).toHaveBeenCalledWith({
        video: { deviceId: { exact: 'cam-1' } },
        audio: false,
      });
      expect(result).toEqual({ ok: false, reason: name });
    },
  );

  it('retries the default when the saved camera opens but delivers no first frame in about 3 s, within the overall bound', async () => {
    vi.useFakeTimers();
    try {
      const stopBad = vi.fn();
      const stopGood = vi.fn();
      const bad = trackedStream(stopBad);
      const good = trackedStream(stopGood);
      const gum = fakeCamera(async (c) =>
        typeof c.video === 'object' ? bad : good,
      );
      framesOnlyFor(new Set([good]));

      const started = Date.now();
      const p = captureWebcamPhoto(PREFERRED);
      await vi.advanceTimersByTimeAsync(3100);
      const result = await p;

      expect(gum).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      expect(stopBad).toHaveBeenCalledTimes(1);
      expect(stopGood).toHaveBeenCalledTimes(1);
      expect(Date.now() - started).toBeLessThan(8000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up by 8 s overall when the saved camera and the default both deliver nothing, releases both streams and names the reasons', async () => {
    vi.useFakeTimers();
    try {
      const stopA = vi.fn();
      const stopB = vi.fn();
      const a = trackedStream(stopA);
      const b = trackedStream(stopB);
      fakeCamera(async (c) => (typeof c.video === 'object' ? a : b));
      framesOnlyFor(new Set());

      const started = Date.now();
      const p = captureWebcamPhoto(PREFERRED);
      await vi.advanceTimersByTimeAsync(8000);
      const result = await p;

      expect(Date.now() - started).toBeLessThanOrEqual(8000);
      expect(result).toEqual({ ok: false, reason: 'no-frame, no-frame' });
      expect(stopA).toHaveBeenCalledTimes(1);
      expect(stopB).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('captureWebcamPhoto releases every stream on every exit (PAT-001, HC-MVP1-038)', () => {
  it('stops a stream that arrives after the capture already timed out', async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn();
      let release: (s: MediaStream) => void = () => undefined;
      fakeCamera(
        () =>
          new Promise<MediaStream>((resolve) => {
            release = resolve;
          }),
      );
      const p = captureWebcamPhoto();
      await vi.advanceTimersByTimeAsync(8000);
      expect(await p).toEqual({ ok: false, reason: 'timeout' });
      expect(stop).not.toHaveBeenCalled();

      // The slow grant finally resolves: the camera must not stay on.
      release(trackedStream(stop));
      await vi.advanceTimersByTimeAsync(0);
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops a late saved-camera stream too, and the default retry still runs', async () => {
    vi.useFakeTimers();
    try {
      const stopLate = vi.fn();
      const stopGood = vi.fn();
      let release: (s: MediaStream) => void = () => undefined;
      fakeCamera((c) =>
        typeof c.video === 'object'
          ? new Promise<MediaStream>((resolve) => {
              release = resolve;
            })
          : Promise.resolve(trackedStream(stopGood)),
      );
      const p = captureWebcamPhoto(PREFERRED);
      await vi.advanceTimersByTimeAsync(3100);
      expect((await p).ok).toBe(true);
      release(trackedStream(stopLate));
      await vi.advanceTimersByTimeAsync(0);
      expect(stopLate).toHaveBeenCalledTimes(1);
      expect(stopGood).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the stream when drawing the frame fails', async () => {
    const stop = vi.fn();
    fakeCamera(async () => trackedStream(stop));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const result = await captureWebcamPhoto();
    expect(result.ok).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe('captureWebcamPhoto failure reason codes (PAT-001, HC-MVP1-038, R-PRIV-001: no patient data)', () => {
  it('reports the DOMException name when getUserMedia rejects', async () => {
    fakeCamera(async () => {
      throw domError('NotReadableError');
    });
    expect(await captureWebcamPhoto()).toEqual({
      ok: false,
      reason: 'NotReadableError',
    });
  });

  it('collapses an unknown error to a generic code, never its message', async () => {
    fakeCamera(async () => {
      throw new Error('/home/someone/secret path');
    });
    const result = await captureWebcamPhoto();
    expect(result).toEqual({ ok: false, reason: 'error' });
  });

  it("reports 'no-device' when there is no capture API or the E2E override denies", async () => {
    window.__HC_E2E_CAMERA__ = 'deny';
    expect(await captureWebcamPhoto()).toEqual({
      ok: false,
      reason: 'no-device',
    });
  });

  it("reports 'timeout' when the camera never opens", async () => {
    vi.useFakeTimers();
    try {
      fakeCamera(() => new Promise<MediaStream>(() => undefined));
      const p = captureWebcamPhoto();
      await vi.advanceTimersByTimeAsync(8000);
      expect(await p).toEqual({ ok: false, reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('names both reasons when the saved camera and the retry fail differently', async () => {
    fakeCamera(async (c) => {
      throw domError(
        typeof c.video === 'object' ? 'NotReadableError' : 'NotFoundError',
      );
    });
    expect(await captureWebcamPhoto(PREFERRED)).toEqual({
      ok: false,
      reason: 'NotReadableError, NotFoundError',
    });
  });
});

// ---------------------------------------------------------------------------
// A5: the label-unlock / permission grant is not part of the saved camera's
// 3 s clock, and an abandoned attempt never opens the camera a second time.
// ---------------------------------------------------------------------------

describe('captureWebcamPhoto: slow first permission grant (SET-007, PAT-001, HC-MVP1-038)', () => {
  /** Labels stay hidden until the first (unlock) getUserMedia is granted. */
  function hiddenUntilGrant(
    unlockDelayMs: number,
    stop = vi.fn(),
  ): { gum: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } {
    let granted = false;
    const gum = fakeCamera(async (c) => {
      if (!granted) {
        await new Promise((r) => setTimeout(r, unlockDelayMs));
        granted = true;
        return trackedStream(stop);
      }
      void c;
      return trackedStream(stop);
    });
    (
      navigator.mediaDevices as unknown as {
        enumerateDevices: () => Promise<unknown[]>;
      }
    ).enumerateDevices = async () =>
      granted
        ? CAMS
        : CAMS.map((c) => ({ kind: c.kind, deviceId: '', label: '' }));
    return { gum, stop };
  }

  it('does not fall back to the default camera (no second prompt) when the first Allow takes 4 s', async () => {
    vi.useFakeTimers();
    try {
      const { gum } = hiddenUntilGrant(4000);
      const p = captureWebcamPhoto({
        deviceId: 'cam-9',
        label: 'Test Camera 2',
      });
      await vi.advanceTimersByTimeAsync(4100);
      const result = await p;

      expect(result.ok).toBe(true);
      // Exactly the unlock grant and the saved camera by exact id: no
      // system-default retry, so no second permission prompt.
      expect(gum).toHaveBeenCalledTimes(2);
      expect(gum).toHaveBeenLastCalledWith({
        video: { deviceId: { exact: 'cam-9' } },
        audio: false,
      });
      // The only `video: true` request is the label unlock itself.
      expect(gum.mock.calls.filter(([c]) => c.video === true)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays inside the overall 8 s bound when the grant never arrives', async () => {
    vi.useFakeTimers();
    try {
      fakeCamera(() => new Promise<MediaStream>(() => undefined));
      (
        navigator.mediaDevices as unknown as {
          enumerateDevices: () => Promise<unknown[]>;
        }
      ).enumerateDevices = async () =>
        CAMS.map((c) => ({ kind: c.kind, deviceId: '', label: '' }));
      const started = Date.now();
      const p = captureWebcamPhoto({
        deviceId: 'cam-9',
        label: 'Test Camera 2',
      });
      await vi.advanceTimersByTimeAsync(8000);
      const result = await p;
      expect(Date.now() - started).toBeLessThanOrEqual(8000);
      expect(result.ok).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// A4: a capture can be cancelled (unmount, Cancel, navigation).
// ---------------------------------------------------------------------------

describe('captureWebcamPhoto(preferred, signal) cancels at once (PAT-001, HC-MVP1-038)', () => {
  it('does not touch the camera when already aborted', async () => {
    const gum = fakeCamera(async () => stream());
    const ctl = new AbortController();
    ctl.abort();
    const result = await captureWebcamPhoto(PREFERRED, ctl.signal);
    expect(result).toEqual({ ok: false, reason: 'aborted' });
    expect(gum).not.toHaveBeenCalled();
  });

  it('while the camera is opening: returns at once and stops the stream that arrives later', async () => {
    const stop = vi.fn();
    let release: (s: MediaStream) => void = () => undefined;
    const gum = fakeCamera(
      () =>
        new Promise<MediaStream>((resolve) => {
          release = resolve;
        }),
    );
    const ctl = new AbortController();
    const p = captureWebcamPhoto(undefined, ctl.signal);
    await Promise.resolve();
    ctl.abort();
    expect(await p).toEqual({ ok: false, reason: 'aborted' });
    release(trackedStream(stop));
    await Promise.resolve();
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it('while waiting for the first frame: stops the stream immediately, clears the timer and does not retry', async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn();
      const s = trackedStream(stop);
      const gum = fakeCamera(async () => s);
      framesOnlyFor(new Set());
      const ctl = new AbortController();
      const p = captureWebcamPhoto(PREFERRED, ctl.signal);
      await vi.advanceTimersByTimeAsync(100);
      expect(stop).not.toHaveBeenCalled();
      ctl.abort();
      expect(await p).toEqual({ ok: false, reason: 'aborted' });
      expect(stop).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      // No default-camera retry after the abort.
      await vi.advanceTimersByTimeAsync(9000);
      expect(gum).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('during the label unlock: the saved camera is never opened afterwards', async () => {
    let release: (s: MediaStream) => void = () => undefined;
    const stop = vi.fn();
    const gum = fakeCamera(
      () =>
        new Promise<MediaStream>((resolve) => {
          release = resolve;
        }),
    );
    (
      navigator.mediaDevices as unknown as {
        enumerateDevices: () => Promise<unknown[]>;
      }
    ).enumerateDevices = async () =>
      CAMS.map((c) => ({ kind: c.kind, deviceId: '', label: '' }));
    const ctl = new AbortController();
    const p = captureWebcamPhoto(PREFERRED, ctl.signal);
    await new Promise((r) => setTimeout(r, 0));
    ctl.abort();
    expect(await p).toEqual({ ok: false, reason: 'aborted' });
    release(trackedStream(stop));
    await new Promise((r) => setTimeout(r, 0));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(gum).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// D2 (R-UI-008): plain-language reason, never a DOMException name.
// ---------------------------------------------------------------------------

describe('plainReasonKey (R-UI-008, PAT-001, HC-MVP1-038)', () => {
  it.each([
    ['NotReadableError', 'patient.form.photo.reason.busy'],
    ['no-frame', 'patient.form.photo.reason.busy'],
    ['timeout', 'patient.form.photo.reason.slow'],
    ['NotAllowedError', 'patient.form.photo.reason.denied'],
    ['SecurityError', 'patient.form.photo.reason.denied'],
    ['NotFoundError', 'patient.form.photo.reason.none'],
    ['OverconstrainedError', 'patient.form.photo.reason.none'],
    ['no-device', 'patient.form.photo.reason.none'],
    ['AbortError', 'patient.form.photo.reason.other'],
    ['TypeError', 'patient.form.photo.reason.other'],
    ['error', 'patient.form.photo.reason.other'],
    ['something-unknown', 'patient.form.photo.reason.other'],
  ])('maps %s to %s', (code, key) => {
    expect(plainReasonKey(code)).toBe(key);
  });

  it('gives one sentence for two equal attempts', () => {
    expect(plainReasonKey('no-frame, no-frame')).toBe(
      'patient.form.photo.reason.busy',
    );
  });

  it('shows the more specific of two different attempts', () => {
    expect(plainReasonKey('NotReadableError, timeout')).toBe(
      'patient.form.photo.reason.busy',
    );
    expect(plainReasonKey('timeout, NotAllowedError')).toBe(
      'patient.form.photo.reason.denied',
    );
    expect(plainReasonKey('AbortError, NotFoundError')).toBe(
      'patient.form.photo.reason.none',
    );
    expect(plainReasonKey('error, timeout')).toBe(
      'patient.form.photo.reason.slow',
    );
  });

  it('has nothing to say without a reason or after a cancel', () => {
    expect(plainReasonKey(undefined)).toBeUndefined();
    expect(plainReasonKey('')).toBeUndefined();
    expect(plainReasonKey('aborted')).toBeUndefined();
  });
});
