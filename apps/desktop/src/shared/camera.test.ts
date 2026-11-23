// MS (SET-007) camera enumeration tests. CUT: the REAL `listCameras()` and
// `resolvePreferredCamera()` in shared/camera.ts. The only fakes are the
// webview dependency `navigator.mediaDevices` (vi.stubGlobal) and the E2E
// hook `window.__HC_E2E_CAMERAS__`. Synthetic device names only.

import { describe, it, expect, vi, afterEach } from 'vitest';

import { listCameras, resolvePreferredCamera } from './camera';

type FakeDevice = { kind: MediaDeviceKind; deviceId: string; label: string };

function stubDevices(
  devices: FakeDevice[] | (() => Promise<FakeDevice[]>),
  getUserMedia?: () => Promise<MediaStream>,
): { enumerateDevices: ReturnType<typeof vi.fn> } {
  const enumerateDevices = vi.fn(
    typeof devices === 'function' ? devices : async () => devices,
  );
  vi.stubGlobal('navigator', {
    mediaDevices: { enumerateDevices, getUserMedia },
  });
  return { enumerateDevices };
}

afterEach(() => {
  delete window.__HC_E2E_CAMERAS__;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('listCameras (SET-007)', () => {
  it('returns the E2E camera list verbatim without enumerating', async () => {
    const { enumerateDevices } = stubDevices([]);
    window.__HC_E2E_CAMERAS__ = [
      { deviceId: 'e2e-1', label: 'E2E Camera 1' },
      { deviceId: 'e2e-2', label: 'E2E Camera 2' },
    ];
    expect(await listCameras()).toEqual({
      status: 'ok',
      cameras: [
        { deviceId: 'e2e-1', label: 'E2E Camera 1' },
        { deviceId: 'e2e-2', label: 'E2E Camera 2' },
      ],
    });
    expect(enumerateDevices).not.toHaveBeenCalled();
  });

  it("lists only video inputs, and reports 'none' when there are none or the API is missing or fails", async () => {
    stubDevices([
      { kind: 'audioinput', deviceId: 'mic-1', label: 'Test Mic' },
      { kind: 'videoinput', deviceId: 'cam-1', label: 'Test Camera 1' },
      { kind: 'audiooutput', deviceId: 'spk-1', label: 'Test Speaker' },
      { kind: 'videoinput', deviceId: 'cam-2', label: 'Test Camera 2' },
    ]);
    expect(await listCameras()).toEqual({
      status: 'ok',
      cameras: [
        { deviceId: 'cam-1', label: 'Test Camera 1' },
        { deviceId: 'cam-2', label: 'Test Camera 2' },
      ],
    });

    // Headless / no webcam: microphones only.
    stubDevices([{ kind: 'audioinput', deviceId: 'mic-1', label: 'Test Mic' }]);
    expect(await listCameras()).toEqual({ status: 'none' });
    // No media API at all.
    vi.stubGlobal('navigator', {});
    expect(await listCameras()).toEqual({ status: 'none' });
    // Enumeration fails: never throws.
    stubDevices(async () => {
      throw new Error('NotAllowedError');
    });
    expect(await listCameras()).toEqual({ status: 'none' });
  });

  it('gives unnamed cameras a distinct numbered name', async () => {
    stubDevices([
      { kind: 'videoinput', deviceId: 'cam-1', label: '' },
      { kind: 'videoinput', deviceId: 'cam-2', label: '' },
    ]);
    const list = await listCameras();
    expect(list.status).toBe('ok');
    if (list.status !== 'ok') return;
    const [a, b] = list.cameras;
    expect(a?.label).toMatch(/1/);
    expect(b?.label).toMatch(/2/);
    expect(a?.label).not.toBe(b?.label);
  });

  it('unlocks labels with a short camera grant and stops it afterwards', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(
      async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream,
    );
    let granted = false;
    stubDevices(
      async () => {
        return [
          {
            kind: 'videoinput',
            deviceId: 'cam-1',
            label: granted ? 'Test Camera 1' : '',
          },
        ];
      },
      async () => {
        granted = true;
        return getUserMedia();
      },
    );
    const list = await listCameras({ unlockLabels: true });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(list).toEqual({
      status: 'ok',
      cameras: [{ deviceId: 'cam-1', label: 'Test Camera 1' }],
    });
  });
});

describe('resolvePreferredCamera (SET-007)', () => {
  const cams = [
    { deviceId: 'cam-1', label: 'Test Camera 1' },
    { deviceId: 'cam-9', label: 'Test Camera 2' },
  ];

  it('uses the saved device when its id is present', () => {
    expect(
      resolvePreferredCamera(
        { deviceId: 'cam-1', label: 'Test Camera 1' },
        cams,
      ),
    ).toBe('cam-1');
  });

  it('re-finds the saved camera by name when its id changed, else uses the system default', () => {
    expect(
      resolvePreferredCamera(
        { deviceId: 'cam-2-old', label: 'Test Camera 2' },
        cams,
      ),
    ).toBe('cam-9');
    expect(
      resolvePreferredCamera({ deviceId: 'x', label: 'Unplugged' }, cams),
    ).toBeUndefined();
    expect(resolvePreferredCamera(null, cams)).toBeUndefined();
  });
});
