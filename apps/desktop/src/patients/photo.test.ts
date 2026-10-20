// Unit tests for the photo helpers' camera determinism seam (HC-MVP1-038).
// CUT: the real `simulateCameraAccess()`; there is no faked dependency — the
// only inputs are `window.__HC_E2E_CAMERA__` (the E2E override) and
// `Math.random` (the production random path).
//
// The seam lets an E2E (headless, no camera) force a deterministic grant/deny
// while production keeps the random simulation. These assert both branches of
// the override and that the random path is still reachable when it is unset.

import { describe, it, expect, afterEach, vi } from 'vitest';

import { simulateCameraAccess } from './photo';

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
