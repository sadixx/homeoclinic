// Shell-wide app preferences: font size, auto-lock, default camera (MS,
// SET-004/005/007; design §5).
//
// The provider reads `settingsGet()` once on mount. ShellFrame remounts after
// every unlock (/lock is outside the shell route), so the persisted values
// apply after a relaunch and after an unlock. A failed read keeps the
// defaults. The font size is mirrored in localStorage (`hc.fontSize`, not
// secret) so the first paint uses the last saved size (no 14 -> 16 px flash);
// the database stays the source of truth.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { commands } from '@/bindings';
import type { AppPrefs, CameraChoice, FontSize } from '@/bindings';
import { run } from '@/shared/command';

export interface AppPrefsState {
  readonly fontSize: FontSize;
  readonly autolockMinutes: number;
  readonly defaultCamera: CameraChoice | null;
  /** True once the saved prefs were read (or pushed by a Save). */
  readonly loaded: boolean;
  /** Push the saved prefs (from settings_save_general) into the shell. */
  readonly applySaved: (app: AppPrefs) => void;
}

/** localStorage key of the font-size mirror (first-paint seed only). */
export const FONT_SIZE_STORAGE_KEY = 'hc.fontSize';

const DEFAULT_AUTOLOCK_MINUTES = 15;

const DEFAULTS: AppPrefsState = {
  fontSize: 'normal',
  autolockMinutes: DEFAULT_AUTOLOCK_MINUTES,
  defaultCamera: null,
  loaded: false,
  applySaved: () => undefined,
};

const AppPrefsContext = createContext<AppPrefsState | null>(null);

function isFontSize(value: unknown): value is FontSize {
  return value === 'normal' || value === 'large' || value === 'xlarge';
}

/** The mirrored font size, or `normal` (storage unavailable / unset). */
function readMirroredFontSize(): FontSize {
  try {
    const stored = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    return isFontSize(stored) ? stored : 'normal';
  } catch {
    return 'normal';
  }
}

function writeMirroredFontSize(size: FontSize): void {
  try {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, size);
  } catch {
    // Storage unavailable: the DB read still applies the size.
  }
}

interface PrefsValues {
  readonly fontSize: FontSize;
  readonly autolockMinutes: number;
  readonly defaultCamera: CameraChoice | null;
  readonly loaded: boolean;
}

function valuesFrom(app: AppPrefs): PrefsValues {
  return {
    fontSize: isFontSize(app.fontSize) ? app.fontSize : 'normal',
    autolockMinutes: app.autolockMinutes,
    defaultCamera: app.defaultCamera ?? null,
    loaded: true,
  };
}

/** Provides {@link useAppPrefs}; reads `settingsGet()` once on mount. */
export function AppPrefsProvider(props: {
  readonly children: ReactNode;
}): JSX.Element {
  const [values, setValues] = useState<PrefsValues>(() => ({
    fontSize: readMirroredFontSize(),
    autolockMinutes: DEFAULT_AUTOLOCK_MINUTES,
    defaultCamera: null,
    loaded: false,
  }));

  const applySaved = useCallback((app: AppPrefs) => {
    const next = valuesFrom(app);
    writeMirroredFontSize(next.fontSize);
    setValues(next);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async (): Promise<void> => {
      try {
        const view = await run(commands.settingsGet());
        if (alive && view?.app) {
          applySaved(view.app);
        }
      } catch {
        // Keep the defaults; the shell never crashes on a failed read.
      }
    })();
    return () => {
      alive = false;
    };
  }, [applySaved]);

  const state = useMemo<AppPrefsState>(
    () => ({ ...values, applySaved }),
    [values, applySaved],
  );

  return (
    <AppPrefsContext.Provider value={state}>
      {props.children}
    </AppPrefsContext.Provider>
  );
}

/** Outside a provider returns defaults (normal, 15, null). */
export function useAppPrefs(): AppPrefsState {
  return useContext(AppPrefsContext) ?? DEFAULTS;
}
