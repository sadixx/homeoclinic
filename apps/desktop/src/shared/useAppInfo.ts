// useAppInfo: the single backend call at M0. It goes through the GENERATED
// typed wrapper `commands.appInfo()` from @/bindings (R-UI-002, contract §1d) —
// raw `invoke` is forbidden. Used to prove the UI -> IPC path end to end by
// rendering the app version in the top bar / status bar.
import { useEffect, useState } from 'react';

import { commands, type AppInfo } from '@/bindings';

/**
 * Loads the running build's {@link AppInfo} once, via the typed command
 * binding. Returns `null` until the first result resolves.
 */
export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let active = true;
    void commands.appInfo().then((result) => {
      if (active) {
        setInfo(result);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return info;
}
