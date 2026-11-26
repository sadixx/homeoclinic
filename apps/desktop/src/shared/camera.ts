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
  /**
   * Display name, unique within one list: a name shared by several cameras
   * is numbered (" (2)", " (3)"). This is the name Settings shows and the
   * name stored in the saved {@link CameraChoice}.
   */
  readonly label: string;
  /**
   * The name as the webview reported it (never numbered). Absent on the E2E
   * fake list, where `label` is the raw name.
   */
  readonly rawLabel?: string;
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

/** Labels that say the camera is an infrared / face-unlock sensor. */
const INFRARED_LABEL = /\b(ir|infrared)\b/i;

/**
 * Name duplicate labels apart: the first keeps its name, the next ones get
 * " (2)", " (3)" in enumeration order (stable while the device order is), so
 * the Settings list never shows two identical entries. A number is skipped
 * when it would collide with another camera's own name or an earlier number
 * ("Cam", "Cam", "Cam (2)" -> "Cam", "Cam (3)", "Cam (2)"). The reported
 * name stays in `rawLabel`.
 */
function numberDuplicateLabels(
  cameras: readonly { deviceId: string; label: string }[],
): CameraDevice[] {
  const reserved = new Set(cameras.map((c) => c.label));
  const used = new Set<string>();
  const seen = new Set<string>();
  return cameras.map((c) => {
    if (!seen.has(c.label)) {
      seen.add(c.label);
      used.add(c.label);
      return { ...c, rawLabel: c.label };
    }
    let n = 2;
    while (reserved.has(`${c.label} (${n})`) || used.has(`${c.label} (${n})`)) {
      n += 1;
    }
    const label = `${c.label} (${n})`;
    used.add(label);
    return { deviceId: c.deviceId, label, rawLabel: c.label };
  });
}

/**
 * The `videoinput` devices, with numbered names for unlabelled ones and for
 * duplicates. A camera whose name says infrared is listed after the others;
 * otherwise the enumeration order is kept (laptops list the colour node
 * first, but both nodes often share one name, so the order is all there is).
 */
async function enumerateVideoInputs(
  media: MediaDevices,
): Promise<CameraDevice[]> {
  const devices = await media.enumerateDevices();
  const named = devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label.trim() || `${t('settings.camera.unnamed')} ${i + 1}`,
    }));
  const colourFirst = [
    ...named.filter((c) => !INFRARED_LABEL.test(c.label)),
    ...named.filter((c) => INFRARED_LABEL.test(c.label)),
  ];
  return numberDuplicateLabels(colourFirst);
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
 * Saved choice -> deviceId to request. Settings saves the display name of the
 * picked entry (`CameraDevice.label`, numbered when a name is shared), so:
 *   1. the saved id still present -> exactly that camera;
 *   2. else the saved name as the reported (raw) name of exactly one camera;
 *   3. else the saved name as the display name of exactly one camera (a saved
 *      "HP Camera (2)" finds that node);
 *   4. else undefined (system default).
 * A name reported by several cameras is never guessed between (step 2 fails
 * and step 3 is skipped): that could pick the infrared node.
 */
export function resolvePreferredCamera(
  saved: CameraChoice | null,
  cameras: readonly CameraDevice[],
): string | undefined {
  if (!saved) return undefined;
  const byId = cameras.find((c) => c.deviceId === saved.deviceId);
  if (byId) return byId.deviceId;
  if (saved.label.trim() === '') return undefined;
  const byRaw = cameras.filter((c) => (c.rawLabel ?? c.label) === saved.label);
  if (byRaw.length > 0)
    return byRaw.length === 1 ? byRaw[0]?.deviceId : undefined;
  const byDisplay = cameras.filter((c) => c.label === saved.label);
  return byDisplay.length === 1 ? byDisplay[0]?.deviceId : undefined;
}
