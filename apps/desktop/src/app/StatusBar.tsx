// Status bar of the app shell (00-conventions §2): autosave state, last backup,
// licence state. At M0 these are placeholders; it also surfaces the app
// name+version from the typed `commands.appInfo()` binding as a harmless proof
// of the IPC path (design §3e).
import { t } from '@/shared/strings';
import { useAppInfo } from '@/shared/useAppInfo';

/** Thin bottom status bar (~24px). */
export function StatusBar(): JSX.Element {
  const info = useAppInfo();

  return (
    <footer
      data-testid="status-bar"
      className="flex h-6 items-center gap-4 border-t border-slate-200 bg-slate-50 px-3 text-xs text-slate-600"
    >
      <span data-testid="status-autosave">Saved —</span>
      <span data-testid="status-backup">Last backup: —</span>
      <span data-testid="status-licence">Licence: —</span>
      <span className="flex-1" />
      <span data-testid="status-appinfo">
        {info
          ? `${info.name} v${info.version} (${info.build_profile})`
          : `${t('app.name')} …`}
      </span>
    </footer>
  );
}
