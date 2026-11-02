// Content zoom state (M3-RW Slice C3; SET-005 extended to a layout zoom).
//
// A single clamped scale factor drives the `--hc-font-scale` CSS variable on
// the content root; because the app sizes text and spacing in rem, scaling the
// root font size scales BOTH text and layout (ADR 0018 "root font-scale/CSS
// zoom var"), not just the font. The value is clamped to a sane band and
// persisted so the doctor's preference survives a restart (the deferred SET-005
// setting, extended to zoom). Persistence is local to the machine via
// `localStorage`; it makes NO network call and stores no patient data
// (R-PRIV-001). If storage is unavailable the hook still works session-local.
import { useCallback, useState } from 'react';

/** The 1.0 baseline (normal size). */
export const ZOOM_BASELINE = 1;
/** One zoom step. */
export const ZOOM_STEP = 0.1;
/** Lower clamp — stays comfortably positive (never 0 or negative). */
export const ZOOM_MIN = 0.7;
/** Upper clamp — a real bound, not an absurd value (<= 3 per the design). */
export const ZOOM_MAX = 2;

const STORAGE_KEY = 'hc.content.fontScale';

/** Round to one decimal so repeated steps stay on a clean grid (no 1.0000002). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Clamp a scale into the allowed band. */
function clampScale(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return ZOOM_BASELINE;
  return round1(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)));
}

/** Read the persisted scale, falling back to the baseline. */
function readStored(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return ZOOM_BASELINE;
    return clampScale(Number(raw));
  } catch {
    return ZOOM_BASELINE;
  }
}

/** Best-effort persist; never throws into the UI. */
function writeStored(scale: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(scale));
  } catch {
    /* storage unavailable (private mode / quota) — stay session-local */
  }
}

/** The zoom controller the shell wires to the app-bar + keyboard shortcuts. */
export interface ZoomController {
  /** The current clamped scale (1.0 = normal). */
  readonly scale: number;
  /** Step up one notch (clamped at the maximum). */
  readonly zoomIn: () => void;
  /** Step down one notch (clamped at the minimum, always positive). */
  readonly zoomOut: () => void;
  /** Return to the 1.0 baseline. */
  readonly reset: () => void;
}

/**
 * Content zoom: a clamped, persisted scale plus in/out/reset actions. The
 * caller applies `scale` to the content root as the `--hc-font-scale` variable.
 */
export function useZoom(): ZoomController {
  const [scale, setScale] = useState<number>(() => readStored());

  const apply = useCallback((next: number): void => {
    const clamped = clampScale(next);
    setScale(clamped);
    writeStored(clamped);
  }, []);

  const zoomIn = useCallback(
    () => apply(round1(scale + ZOOM_STEP)),
    [apply, scale],
  );
  const zoomOut = useCallback(
    () => apply(round1(scale - ZOOM_STEP)),
    [apply, scale],
  );
  const reset = useCallback(() => apply(ZOOM_BASELINE), [apply]);

  return { scale, zoomIn, zoomOut, reset };
}
