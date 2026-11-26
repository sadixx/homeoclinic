// MS (SET-007) camera enumeration tests. CUT: the REAL `listCameras()` and
// `resolvePreferredCamera()` in shared/camera.ts. The only fakes are the
// webview dependency `navigator.mediaDevices` (vi.stubGlobal) and the E2E
// hook `window.__HC_E2E_CAMERAS__`. Synthetic device names only.

import { describe, it, expect, vi, afterEach } from 'vitest';

import { listCameras, resolvePreferredCamera } from './camera';
import type { CameraDevice } from './camera';

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

describe('listCameras (SET-007, PAT-001, HC-MVP1-038)', () => {
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
        {
          deviceId: 'cam-1',
          label: 'Test Camera 1',
          rawLabel: 'Test Camera 1',
        },
        {
          deviceId: 'cam-2',
          label: 'Test Camera 2',
          rawLabel: 'Test Camera 2',
        },
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
      cameras: [
        {
          deviceId: 'cam-1',
          label: 'Test Camera 1',
          rawLabel: 'Test Camera 1',
        },
      ],
    });
  });
});

describe('resolvePreferredCamera (SET-007, PAT-001, HC-MVP1-038)', () => {
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

describe('duplicate camera names (SET-007, PAT-001, HC-MVP1-038, R5)', () => {
  it('gives duplicate labels a stable numeric suffix, first keeps the plain name', async () => {
    stubDevices([
      { kind: 'videoinput', deviceId: 'cam-a', label: 'HP 5MP Camera (V4L2)' },
      { kind: 'videoinput', deviceId: 'cam-b', label: 'HP 5MP Camera (V4L2)' },
      { kind: 'videoinput', deviceId: 'cam-c', label: 'USB Cam' },
      { kind: 'videoinput', deviceId: 'cam-d', label: 'HP 5MP Camera (V4L2)' },
    ]);
    const list = await listCameras();
    expect(list).toEqual({
      status: 'ok',
      cameras: [
        {
          deviceId: 'cam-a',
          label: 'HP 5MP Camera (V4L2)',
          rawLabel: 'HP 5MP Camera (V4L2)',
        },
        {
          deviceId: 'cam-b',
          label: 'HP 5MP Camera (V4L2) (2)',
          rawLabel: 'HP 5MP Camera (V4L2)',
        },
        { deviceId: 'cam-c', label: 'USB Cam', rawLabel: 'USB Cam' },
        {
          deviceId: 'cam-d',
          label: 'HP 5MP Camera (V4L2) (3)',
          rawLabel: 'HP 5MP Camera (V4L2)',
        },
      ],
    });
  });

  it('lists a camera named as infrared after the colour ones, keeping the order otherwise', async () => {
    stubDevices([
      { kind: 'videoinput', deviceId: 'cam-ir', label: 'Integrated IR Camera' },
      { kind: 'videoinput', deviceId: 'cam-1', label: 'Integrated Camera' },
      { kind: 'videoinput', deviceId: 'cam-2', label: 'USB Cam' },
    ]);
    const list = await listCameras();
    expect(list.status === 'ok' && list.cameras.map((c) => c.deviceId)).toEqual(
      ['cam-1', 'cam-2', 'cam-ir'],
    );
  });

  it('does not re-order identically named cameras (colour stays first as enumerated)', async () => {
    stubDevices([
      { kind: 'videoinput', deviceId: 'colour', label: 'HP 5MP Camera' },
      { kind: 'videoinput', deviceId: 'grey', label: 'HP 5MP Camera' },
    ]);
    const list = await listCameras();
    expect(list.status === 'ok' && list.cameras.map((c) => c.deviceId)).toEqual(
      ['colour', 'grey'],
    );
  });

  it('never matches a saved label by guesswork when several cameras share it', () => {
    const cams = [
      { deviceId: 'x1', label: 'Cam' },
      { deviceId: 'x2', label: 'Cam' },
    ];
    // Stale id, ambiguous raw label: use the system default, not the first.
    expect(
      resolvePreferredCamera({ deviceId: 'old', label: 'Cam' }, cams),
    ).toBeUndefined();
    // A unique label still re-finds the camera.
    expect(
      resolvePreferredCamera({ deviceId: 'old', label: 'Solo' }, [
        ...cams,
        { deviceId: 'x3', label: 'Solo' },
      ]),
    ).toBe('x3');
  });
});

// D1: the guard must work on what listCameras really returns (display labels
// are numbered, the raw name is kept in `rawLabel`).
describe('saved camera resolved through the real listCameras pipeline (SET-007, PAT-001, HC-MVP1-038)', () => {
  const HP = 'HP 5MP Camera (V4L2)';
  const twoHp: FakeDevice[] = [
    { kind: 'videoinput', deviceId: 'cam-a', label: HP },
    { kind: 'videoinput', deviceId: 'cam-b', label: HP },
  ];

  async function camerasOf(): Promise<readonly CameraDevice[]> {
    const list = await listCameras();
    if (list.status !== 'ok') throw new Error('expected cameras');
    return list.cameras;
  }

  it('keeps the raw name on every entry next to the numbered display name', async () => {
    stubDevices(twoHp);
    expect(await camerasOf()).toEqual([
      { deviceId: 'cam-a', label: HP, rawLabel: HP },
      { deviceId: 'cam-b', label: `${HP} (2)`, rawLabel: HP },
    ]);
  });

  it('does NOT guess when a stale id is saved under a name that several cameras share', async () => {
    stubDevices(twoHp);
    const cams = await camerasOf();
    expect(
      resolvePreferredCamera({ deviceId: 'gone', label: HP }, cams),
    ).toBeUndefined();
  });

  it('still resolves exactly by a saved id that is present, whatever the names', async () => {
    stubDevices(twoHp);
    const cams = await camerasOf();
    expect(resolvePreferredCamera({ deviceId: 'cam-b', label: HP }, cams)).toBe(
      'cam-b',
    );
    expect(
      resolvePreferredCamera({ deviceId: 'cam-b', label: `${HP} (2)` }, cams),
    ).toBe('cam-b');
  });

  it('resolves a saved numbered display label to that node when its id is stale', async () => {
    stubDevices(twoHp);
    const cams = await camerasOf();
    // CameraCard saves the display label of the entry the doctor picked.
    const second = cams[1];
    expect(second).toBeDefined();
    const saved = { deviceId: 'gone', label: second?.label ?? '' };
    expect(saved.label).toBe(`${HP} (2)`);
    expect(resolvePreferredCamera(saved, cams)).toBe('cam-b');
  });

  it('re-finds a camera by a raw name that only one camera has', async () => {
    stubDevices([
      ...twoHp,
      { kind: 'videoinput', deviceId: 'cam-c', label: 'USB Cam' },
    ]);
    const cams = await camerasOf();
    expect(
      resolvePreferredCamera({ deviceId: 'gone', label: 'USB Cam' }, cams),
    ).toBe('cam-c');
  });

  it('numbers duplicates without ever producing two equal display names', async () => {
    stubDevices([
      { kind: 'videoinput', deviceId: 'x1', label: 'Cam' },
      { kind: 'videoinput', deviceId: 'x2', label: 'Cam' },
      { kind: 'videoinput', deviceId: 'x3', label: 'Cam (2)' },
    ]);
    const cams = await camerasOf();
    const labels = cams.map((c) => c.label);
    expect(new Set(labels).size).toBe(3);
    // The first keeps its plain name; a camera really named "Cam (2)" keeps it.
    expect(cams.find((c) => c.deviceId === 'x1')?.label).toBe('Cam');
    expect(cams.find((c) => c.deviceId === 'x3')?.label).toBe('Cam (2)');
    // The saved display name of every entry resolves to that very camera.
    for (const c of cams) {
      expect(
        resolvePreferredCamera({ deviceId: 'gone', label: c.label }, cams),
      ).toBe(c.label === 'Cam' ? undefined : c.deviceId);
    }
  });

  it('keeps display names unique for several triples and mixed duplicates', async () => {
    stubDevices([
      { kind: 'videoinput', deviceId: 'a', label: 'Cam' },
      { kind: 'videoinput', deviceId: 'b', label: 'Cam' },
      { kind: 'videoinput', deviceId: 'c', label: 'Cam' },
      { kind: 'videoinput', deviceId: 'd', label: 'Cam (2)' },
      { kind: 'videoinput', deviceId: 'e', label: 'Cam (2)' },
    ]);
    const labels = (await camerasOf()).map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
