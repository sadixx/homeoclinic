// MS (SET-007) S06 capture honours the chosen camera. CUT: the REAL
// `captureWebcamPhoto(preferred)`. Fakes are the webview dependencies only:
// `navigator.mediaDevices` (enumerateDevices + getUserMedia) and the
// video/canvas frame pipeline (same stubs as photo.test.ts). The existing
// photo.test.ts keeps covering the no-preference, E2E-override and
// headless-fallback paths unchanged.

import { describe, it, expect, vi, afterEach } from 'vitest';

import { captureWebcamPhoto } from './photo';

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

describe('captureWebcamPhoto(preferred) (SET-007)', () => {
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
