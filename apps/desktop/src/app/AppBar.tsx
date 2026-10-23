// Shared app-bar (M3-RW Slice C, 00-conventions §3): ONE consistent place for
// the common Back control and the zoom (text + layout) controls, rendered once
// by the shell so every screen (case / follow-up / dashboard / list / Today)
// shares the SAME Back slot instead of an ad-hoc per-screen button.
//
// - Back walks one step up the logical parent chain (the shell owns the chain;
//   this component just reports the intent via `onBack`). It never discards
//   data — the clinical forms autosave (CASE-005). Alt+Left is the keyboard
//   twin, handled in the shell.
// - Zoom in / out / reset scale TEXT AND LAYOUT by driving a root
//   `--hc-font-scale` CSS variable on the content root (SET-005 extended to a
//   layout zoom; ADR 0018 "root font-scale/CSS zoom var"). Ctrl+= / Ctrl+- /
//   Ctrl+0 are the keyboard twins, handled in the shell.
//
// Accessibility (00-conventions §5): every control is a real <button> with an
// accessible name and a visible focus ring; the zoom cluster is grouped and
// labelled. UI -> typed commands only is not relevant here (pure chrome, no
// IPC). All visible and accessible text comes from en.json (R-UI-007).
import { ArrowLeft, Minus, Plus, RotateCcw } from 'lucide-react';

import { t } from '@/shared/strings';

export interface AppBarProps {
  /** Walk one step up the parent chain (the shell owns the chain logic). */
  readonly onBack: () => void;
  /** Increase the content zoom by one clamped step. */
  readonly onZoomIn: () => void;
  /** Decrease the content zoom by one clamped step. */
  readonly onZoomOut: () => void;
  /** Reset the content zoom to the 1.0 baseline. */
  readonly onZoomReset: () => void;
}

/** The single shared app-bar: common Back on the left, zoom cluster on the right. */
export function AppBar({
  onBack,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: AppBarProps): JSX.Element {
  return (
    <div
      data-testid="app-bar"
      className="flex h-10 flex-none items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3"
    >
      <button
        type="button"
        data-testid="app-bar-back"
        aria-label={t('app.bar.back')}
        onClick={onBack}
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('app.bar.back')}
      </button>

      <div
        role="group"
        aria-label={t('app.bar.zoom.group')}
        className="inline-flex items-center gap-1"
      >
        <button
          type="button"
          data-testid="app-bar-zoom-out"
          aria-label={t('app.bar.zoomOut')}
          title={t('app.bar.zoomOut')}
          aria-keyshortcuts="Control+-"
          onClick={onZoomOut}
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="app-bar-zoom-reset"
          aria-label={t('app.bar.zoomReset')}
          title={t('app.bar.zoomReset')}
          aria-keyshortcuts="Control+0"
          onClick={onZoomReset}
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="app-bar-zoom-in"
          aria-label={t('app.bar.zoomIn')}
          title={t('app.bar.zoomIn')}
          aria-keyshortcuts="Control+="
          onClick={onZoomIn}
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
