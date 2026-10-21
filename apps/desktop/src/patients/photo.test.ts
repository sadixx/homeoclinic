// Unit tests for the photo helpers' camera determinism seam (HC-MVP1-038).
// CUT: the real `simulateCameraAccess()`; there is no faked dependency — the
// only inputs are `window.__HC_E2E_CAMERA__` (the E2E override) and
// `Math.random` (the production random path).
//
// The seam lets an E2E (headless, no camera) force a deterministic grant/deny
// while production keeps the random simulation. These assert both branches of
// the override and that the random path is still reachable when it is unset.

import { describe, it, expect, afterEach, vi } from 'vitest';

import { simulateCameraAccess, captureWebcamPhoto } from './photo';

afterEach(() => {
  // Never leak the override between tests (an E2E would set it on window).
  delete window.__HC_E2E_CAMERA__;
  vi.restoreAllMocks();
});

describe('simulateCameraAccess — E2E determinism seam', () => {
  it("returns true for every call when the override is 'grant'", () => {
    window.__HC_E2E_CAMERA__ = 'grant';
    // Even if the random source would say "deny", the override wins.
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    expect(simulateCameraAccess()).toBe(true);
    expect(simulateCameraAccess()).toBe(true);
  });

  it("returns false for every call when the override is 'deny'", () => {
    window.__HC_E2E_CAMERA__ = 'deny';
    // Even if the random source would say "grant", the override wins.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    expect(simulateCameraAccess()).toBe(false);
    expect(simulateCameraAccess()).toBe(false);
  });

  it('falls back to the random simulation when no override is set (production)', () => {
    expect(window.__HC_E2E_CAMERA__).toBeUndefined();
    // >= 0.5 grants, < 0.5 denies — the production behaviour is preserved.
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    expect(simulateCameraAccess()).toBe(true);
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    expect(simulateCameraAccess()).toBe(false);
  });
});

describe('captureWebcamPhoto — real default-camera capture (HC-MVP1-038)', () => {
  it('falls back to the simulated frame when getUserMedia is unavailable', async () => {
    // Headless/CI: no mediaDevices. With the E2E override granting, the
    // simulated fallback returns a frame so the app never throws.
    window.__HC_E2E_CAMERA__ = 'grant';
    const result = await captureWebcamPhoto();
    expect(result.ok).toBe(true);
    expect(result.previewUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('reports not-ok when the camera is denied (no frame)', async () => {
    window.__HC_E2E_CAMERA__ = 'deny';
    const result = await captureWebcamPhoto();
    expect(result.ok).toBe(false);
    expect(result.previewUrl).toBeUndefined();
  });

  it('captures a frame from the real default camera and stops the stream', async () => {
    // Simulate a browser with a camera: getUserMedia yields a stream and the
    // video/canvas pipeline produces a data URL. The stream tracks must be
    // stopped afterwards (no dangling camera light).
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,REALFRAME',
    );
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    // Report a decoded frame (readyState HAVE_CURRENT_DATA) with known
    // dimensions so capture takes the fast path (no wait for loadeddata).
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

    const result = await captureWebcamPhoto();

    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(result.ok).toBe(true);
    expect(result.previewUrl).toBe('data:image/png;base64,REALFRAME');
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('returns not-ok (never hangs) when the camera pipeline wedges', async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    // getUserMedia resolves but play()/frame never arrive (readyState stays 0,
    // no loadeddata) — the hard timeout must win and yield {ok:false}.
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
      () => new Promise<void>(() => undefined),
    );
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(0);

    const p = captureWebcamPhoto();
    await vi.advanceTimersByTimeAsync(8000);
    const result = await p;

    expect(result.ok).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
