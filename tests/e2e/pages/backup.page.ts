// Page object for the S17 Backup and restore screen (docs/ui/S17-backup-restore.md,
// route /backup). hc-e2e-testing rule: specs use page objects; selectors are
// data-testid only, never raw CSS/XPath in specs. No sleeps — all waits go
// through waitUntil / waitForDisplayed.
//
// IMPORTANT (headless-box constraint, recorded by the orchestrator):
// the shipped S17 "Choose folder" / "Use USB" / "Choose backup file" buttons
// derive their path from the `list_removable_drives` typed command, which on
// Linux enumerates only /run/media/$USER, /media/$USER and /media. On this
// headless CI box those roots are absent or read-only, so the picker returns an
// EMPTY list and the readOnly destination field cannot be filled through the
// button. The real OS folder/file dialog that returns a writable path is wired
// behind the same typed command at the Tauri layer and is not reachable under
// WebKitWebDriver here.
//
// So this page object exercises the REAL screen for everything the webview can
// observe (health status, the 3-step restore wizard chrome, the preview panel),
// and drives the DESTINATION + backup/restore ACTIONS through the SAME typed
// command bindings the screen itself calls — invoked over the genuine Tauri IPC
// channel (window.__TAURI_INTERNALS__.invoke, which is exactly what
// `@tauri-apps/api` `invoke` uses). That is the real IPC -> hc-app -> hc-storage
// engine -> encrypted-DB path, not a mock; only the OS native-dialog click is
// substituted by a direct typed-command call with a test /tmp path.
import { $, browser } from '@wdio/globals';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

/** The typed-command result envelope the generated bindings resolve to. */
interface OkEnvelope {
  status: 'ok';
  data: unknown;
}
interface ErrEnvelope {
  status: 'error';
  error: { code?: string; message?: string };
}
type Envelope = OkEnvelope | ErrEnvelope;

export class BackupPage {
  get screen(): ChainablePromiseElement {
    return byTestId('backup-screen');
  }

  get statusLast(): ChainablePromiseElement {
    return byTestId('backup-status-last');
  }

  get retention(): ChainablePromiseElement {
    return byTestId('backup-retention');
  }

  get staleBanner(): ChainablePromiseElement {
    return byTestId('backup-stale-banner');
  }

  get restoreChoose(): ChainablePromiseElement {
    return byTestId('backup-restore-choose');
  }

  get restorePreviewPanel(): ChainablePromiseElement {
    return byTestId('backup-restore-preview');
  }

  get restoreDone(): ChainablePromiseElement {
    return byTestId('backup-restore-done');
  }

  get moveStart(): ChainablePromiseElement {
    return byTestId('backup-move-start');
  }

  /**
   * Navigate the HashRouter to #/backup and wait for the real screen. The app
   * is served from a tauri:// origin, so we drive the route by setting
   * location.hash in-page (browser.url rejects a bare "#/backup"), matching the
   * Slice C pattern.
   */
  async open(timeout = 20000): Promise<void> {
    await browser.execute(() => {
      window.location.hash = '#/backup';
    });
    await this.screen.waitForExist({ timeout });
    await this.screen.waitForDisplayed({ timeout });
  }

  /**
   * Invoke a typed Tauri command over the real IPC channel and unwrap the
   * generated `{ status: 'ok' | 'error' }` envelope — the same contract the
   * screen's `run(commands.*)` helper enforces. Throws the mapped user-facing
   * error on `status: 'error'` so a spec can assert failure paths too.
   */
  async invokeCommand<T>(
    cmd: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const result = (await browser.executeAsync(
      (c: string, a: Record<string, unknown>, done: (v: unknown) => void) => {
        // window.__TAURI_INTERNALS__.invoke is exactly what @tauri-apps/api's
        // `invoke` calls; using it keeps this on the production IPC path.
        const internals = (
          window as unknown as {
            __TAURI_INTERNALS__?: {
              invoke: (cmd: string, args: unknown) => Promise<unknown>;
            };
          }
        ).__TAURI_INTERNALS__;
        if (internals === undefined) {
          done({ status: 'error', error: { message: 'no __TAURI_INTERNALS__' } });
          return;
        }
        internals
          .invoke(c, a)
          .then((v) => done(v))
          .catch((e) => done({ status: 'error', error: { message: String(e) } }));
      },
      cmd,
      args,
    )) as Envelope | T;

    if (
      result !== null &&
      typeof result === 'object' &&
      'status' in (result as Record<string, unknown>)
    ) {
      const env = result as Envelope;
      if (env.status === 'ok') {
        return env.data as T;
      }
      throw new Error(
        `command ${cmd} failed: ${env.error.code ?? ''} ${env.error.message ?? ''}`,
      );
    }
    // Bare value (infallible command): return as-is.
    return result as T;
  }

  /** Read the real backup health via the typed command the screen uses. */
  async getStatus(): Promise<{
    lastBackupAt: string | null;
    lastBackupOk: boolean;
    autoEnabled: boolean;
    retention: { daily: number; weekly: number; monthly: number };
    stale: boolean;
  }> {
    return this.invokeCommand('get_backup_status');
  }

  /**
   * Run a real backup into `outDir` with `password` through the typed
   * `backup_now` command (real engine, writes a real .hcbak). Returns the
   * written archive path and whether the post-backup integrity check passed.
   */
  async backupNow(
    outDir: string,
    password: string,
    rememberPassword = true,
  ): Promise<{ ok: boolean; filePath: string; verified: boolean }> {
    return this.invokeCommand('backup_now', {
      outDir,
      password,
      rememberPassword,
    });
  }

  /** Real restore preview (reads the plaintext header; mutates nothing). */
  async restorePreview(
    filePath: string,
    password: string,
  ): Promise<{
    patientCount: number;
    visitCount: number;
    createdAt: string;
    appVersion: string;
  }> {
    return this.invokeCommand('restore_preview', { filePath, password });
  }

  /**
   * Real restore apply: safety copy -> atomic swap -> re-key under THIS
   * install's DEK. Requires the app to be unlocked (retained target DEK).
   * Returns the pre-restore safety-copy path.
   */
  async restoreApply(
    filePath: string,
    password: string,
  ): Promise<{ ok: boolean; preRestoreBackupPath: string }> {
    return this.invokeCommand('restore_apply', { filePath, password });
  }

  /** Real setup-state read-back (completed flag + resolved data dir). */
  async setupState(): Promise<{
    completed: boolean;
    currentStep: number;
    dataDir: string;
  }> {
    return this.invokeCommand('setup_get_state');
  }
}

export const backupPage = new BackupPage();
