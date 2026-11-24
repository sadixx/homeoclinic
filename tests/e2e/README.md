# tests/e2e

WebdriverIO + tauri-driver end-to-end specs, page objects, index.json.

Owner role: `hc-e2e-editor`. Conventions in hc-agents/skills/hc-e2e-testing/SKILL.md.

Placeholder until its milestone (see docs/CODE-LAYOUT.md); build files are created by the M0 task.

## Windows (CI) notes

- **Integrity level.** WebView2 ignores the `WEBVIEW2_*` environment overrides
  at High integrity, and msedgedriver depends on them to open the app's
  DevTools port. GitHub-hosted Windows steps run at High, so the Windows jobs
  start wdio through `.github/scripts/win-e2e-run.ps1`, which uses
  `gsudo --direct --integrity Medium`. Symptom of getting this wrong:
  `session not created: DevToolsActivePort file doesn't exist`. wdio logs
  `[wdio] process integrity: ...` at load time.
- **Data-dir isolation.** Linux isolates each spec with `XDG_DATA_HOME`.
  Windows `app_data_dir()` ignores the environment, so the `e2e-test-keys`
  build honours `HC_E2E_APP_DATA_BASE` (home = `<base>/<identifier>`);
  `helpers/launch.ts` sets it on win32 only.
- **Fast loop.** Push the branch to `ci-debug/<name>` (or run the
  `ci-windows-debug` workflow manually) to build once and run a single spec
  with direct-launch diagnostics, a verbose msedgedriver log and a 30 minute
  cap. See the header of `.github/workflows/ci-windows-debug.yml`.
- **CI knobs** (all optional): `HC_E2E_BAIL`, `HC_E2E_CONNECTION_RETRY_COUNT`,
  `HC_E2E_CONNECTION_RETRY_TIMEOUT`, `HC_E2E_INTEGRITY` (`Medium` | `High`).
