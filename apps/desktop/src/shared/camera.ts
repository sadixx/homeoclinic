// Camera enumeration for S18 + S06 (MS, SET-007; design §7).
//
// Frontend-only: only the webview can enumerate its own `videoinput` devices
// with usable `deviceId`s. The backend stores only the chosen camera.
//
// No network: enumeration and the optional label grant stay inside the
// webview; nothing about a device is logged.
import type { CameraChoice } from '@/bindings';
import { t } from '@/shared/strings';

/** Bound on the label-unlock camera grant (ms). */
const UNLOCK_TIMEOUT_MS = 5000;

/** One camera the webview exposes. */
export interface CameraDevice {
  readonly deviceId: string;
  readonly label: string;
}

/** Result of {@link listCameras}. Never throws. */
export type CameraList =
  | { readonly status: 'ok'; readonly cameras: readonly CameraDevice[] }
  | { readonly status: 'none' };

declare global {
  interface Window {
    /** E2E-only fake camera list (unset in production; no PII). */
    __HC_E2E_CAMERAS__?: readonly CameraDevice[];
  }
}

/** The `videoinput` devices, with numbered names for unlabelled ones. */
async function enumerateVideoInputs(
  media: MediaDevices,
): Promise<CameraDevice[]> {
  const devices = await media.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label.trim() || `${t('settings.camera.unnamed')} ${i + 1}`,
    }));
}

/** True when the webview hid at least one label or id (no grant yet). */
async function hasHiddenLabels(media: MediaDevices): Promise<boolean> {
  const devices = await media.enumerateDevices();
  return devices.some(
    (d) =>
      d.kind === 'videoinput' && (d.label.trim() === '' || d.deviceId === ''),
  );
}

/** A short camera grant so the webview reveals labels; tracks stopped at once. */
async function unlockCameraLabels(media: MediaDevices): Promise<void> {
  if (typeof media.getUserMedia !== 'function') return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), UNLOCK_TIMEOUT_MS);
  });
  const grant = media
    .getUserMedia({ video: true, audio: false })
    .catch(() => null);
  const stream = await Promise.race([grant, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  } else {
    // A late grant after the timeout must still release the camera.
    void grant.then((late) =>
      late?.getTracks().forEach((track) => track.stop()),
    );
  }
}

/**
 * `enumerateDevices()` filtered to videoinput; empty labels get a numbered
 * "Camera n" name. `unlockLabels` first runs a bounded getUserMedia (only when
 * a label is hidden) so the webview reveals labels. Never throws.
 */
export async function listCameras(opts?: {
  readonly unlockLabels?: boolean;
}): Promise<CameraList> {
  const fake = window.__HC_E2E_CAMERAS__;
  if (fake) {
    return fake.length > 0
      ? { status: 'ok', cameras: fake.map((c) => ({ ...c })) }
      : { status: 'none' };
  }
  const media =
    typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  if (!media || typeof media.enumerateDevices !== 'function') {
    return { status: 'none' };
  }
  try {
    if (opts?.unlockLabels && (await hasHiddenLabels(media))) {
      await unlockCameraLabels(media);
    }
    const cameras = await enumerateVideoInputs(media);
    return cameras.length > 0 ? { status: 'ok', cameras } : { status: 'none' };
  } catch {
    return { status: 'none' };
  }
}

/**
 * Saved choice -> deviceId to request: exact id match, else same label, else
 * undefined (system default).
 */
export function resolvePreferredCamera(
  saved: CameraChoice | null,
  cameras: readonly CameraDevice[],
): string | undefined {
  if (!saved) return undefined;
  const byId = cameras.find((c) => c.deviceId === saved.deviceId);
  if (byId) return byId.deviceId;
  if (saved.label.trim() === '') return undefined;
  return cameras.find((c) => c.label === saved.label)?.deviceId;
}
