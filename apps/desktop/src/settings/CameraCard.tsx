// S18 camera card (SET-007; design §7). Lists the cameras the webview exposes
// and lets the doctor choose the one "Use webcam" on the patient form uses.
// The choice is part of the General form (saved by its Save). With no camera
// (headless / no webcam) it says so; "Choose file" on the form always works.
// Refresh asks the webview for a short camera grant so real names show.
import { useCallback, useEffect, useState } from 'react';

import type { CameraChoice } from '@/bindings';
import { listCameras } from '@/shared/camera';
import type { CameraList } from '@/shared/camera';
import { t } from '@/shared/strings';

/** Select value of the "System default" option. */
const SYSTEM_DEFAULT = '';

/** Props of {@link CameraCard}. */
export interface CameraCardProps {
  readonly value: CameraChoice | null;
  readonly onChange: (next: CameraChoice | null) => void;
}

/** Camera choice for patient photos. */
export function CameraCard({ value, onChange }: CameraCardProps): JSX.Element {
  const [list, setList] = useState<CameraList | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (unlockLabels: boolean): Promise<void> => {
    setBusy(true);
    try {
      setList(await listCameras({ unlockLabels }));
    } catch {
      setList({ status: 'none' });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const cameras = list?.status === 'ok' ? list.cameras : [];
  // Before a camera grant the webview lists cameras with empty ids. They
  // cannot be chosen (their value would equal System default) and the first
  // focus of the list asks for the grant so the real cameras show.
  const idsHidden = cameras.some((c) => c.deviceId === '');
  const onSelectFocus = (): void => {
    if (idsHidden && !busy) void load(true);
  };
  const savedMissing =
    value !== null && !cameras.some((c) => c.deviceId === value.deviceId);

  const onSelect = (deviceId: string): void => {
    if (deviceId === SYSTEM_DEFAULT) {
      onChange(null);
      return;
    }
    const cam = cameras.find((c) => c.deviceId === deviceId);
    if (cam) onChange({ deviceId: cam.deviceId, label: cam.label });
  };

  return (
    <fieldset className="flex flex-col gap-2 rounded border border-slate-200 p-4">
      <legend className="px-1 text-base font-semibold text-slate-900">
        {t('settings.section.camera')}
      </legend>
      {list?.status === 'ok' ? (
        <div className="flex flex-col">
          <label
            htmlFor="settings-camera-select-input"
            className="text-base text-slate-700"
          >
            {t('settings.camera.label')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="settings-camera-select-input"
              data-testid="settings-camera-select"
              aria-describedby="settings-camera-hint"
              value={value?.deviceId ?? SYSTEM_DEFAULT}
              onChange={(e) => onSelect(e.target.value)}
              onFocus={onSelectFocus}
              className="h-10 min-w-0 max-w-full rounded border border-slate-300 px-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value={SYSTEM_DEFAULT}>
                {t('settings.camera.systemDefault')}
              </option>
              {cameras.map((c, i) =>
                c.deviceId === '' ? (
                  <option key={`hidden-${i}`} value={`hidden-${i}`} disabled>
                    {c.label}
                  </option>
                ) : (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label}
                  </option>
                ),
              )}
              {savedMissing && value !== null ? (
                <option value={value.deviceId}>
                  {/* Ids hidden (no grant yet): it may well be connected. */}
                  {idsHidden
                    ? value.label.trim() || t('settings.camera.unnamed')
                    : missingLabel(value)}
                </option>
              ) : null}
            </select>
            <RefreshButton busy={busy} onClick={() => void load(true)} />
          </div>
        </div>
      ) : list?.status === 'none' ? (
        <div className="flex flex-wrap items-center gap-2">
          <p
            data-testid="settings-camera-none"
            role="status"
            className="text-base text-slate-700"
          >
            {t('settings.camera.none')}
          </p>
          <RefreshButton busy={busy} onClick={() => void load(true)} />
        </div>
      ) : (
        <p className="text-base text-slate-500" aria-busy="true">
          {t('common.loading')}
        </p>
      )}
      <p id="settings-camera-hint" className="text-base text-slate-500">
        {t('settings.camera.hint')}
      </p>
    </fieldset>
  );
}

/** Option text for a saved camera that is not connected now. */
function missingLabel(camera: CameraChoice): string {
  const name = camera.label.trim() || t('settings.camera.unnamed');
  return `${name} ${t('settings.camera.notConnected')}`;
}

function RefreshButton({
  busy,
  onClick,
}: {
  readonly busy: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-testid="settings-camera-refresh"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      className="h-10 rounded border border-slate-300 px-3 text-base text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
    >
      {t('settings.camera.refresh')}
    </button>
  );
}
