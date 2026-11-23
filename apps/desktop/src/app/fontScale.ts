// Root font size = chosen font-size base x zoom (MS, SET-005; design §6).
//
// The font size is the doctor's persisted accessibility preference; the zoom
// (useZoom, Ctrl+= / Ctrl+- / Ctrl+0) is a quick per-machine adjustment that
// multiplies on top, so Ctrl+0 returns to the chosen size, not to 14 px.
import type { FontSize } from '@/bindings';

/** Base px per font size (00-conventions §1). */
export const FONT_BASE_PX: Readonly<Record<FontSize, number>> = {
  normal: 14,
  large: 16,
  xlarge: 18,
};

/** Document-root font size in px for a font size and a zoom scale. */
export function rootFontPx(size: FontSize, scale: number): number {
  return FONT_BASE_PX[size] * scale;
}
