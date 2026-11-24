<#
.SYNOPSIS
  Run the Windows WebdriverIO suite (or one spec) at Medium integrity.

.DESCRIPTION
  Run from tests/e2e. wdio, tauri-driver, msedgedriver and the app all
  inherit the integrity level of this process, so the whole chain is started
  through `gsudo --direct --integrity Medium` (see win-e2e-install-gsudo.ps1
  for why High integrity breaks WebView2 automation). Environment variables,
  the working directory and the exit code are passed through.

  HC_E2E_INTEGRITY (default Medium) selects the level. `High` runs wdio
  directly, which only the ci-windows-debug workflow uses, to reproduce the
  original failure for comparison.

.PARAMETER Spec
  Optional spec path relative to tests/e2e (wdio --spec). Empty = whatever
  HC_E2E_TARGET selects.
#>
param([string]$Spec = '')
$ErrorActionPreference = 'Stop'

$integrity = if ($env:HC_E2E_INTEGRITY) { $env:HC_E2E_INTEGRITY } else { 'Medium' }
# Relative paths without spaces on purpose: gsudo --direct hands the command
# line to cmd, so nothing here needs quoting.
$wdio = 'node_modules/@wdio/cli/bin/wdio.js'
if (-not (Test-Path $wdio)) { throw "wdio CLI not found at $wdio (run from tests/e2e after npm ci)" }
$wdioArgs = @($wdio, 'run', 'wdio.conf.ts')
if ($Spec) { $wdioArgs += @('--spec', $Spec) }

if ($integrity -eq 'High') {
  Write-Host "Running wdio at the runner's native (High) integrity level"
  & node @wdioArgs
} else {
  $gsudo = $env:HC_GSUDO
  if (-not $gsudo -or -not (Test-Path $gsudo)) {
    $cmd = Get-Command gsudo.exe -ErrorAction SilentlyContinue
    if ($cmd) { $gsudo = $cmd.Source }
  }
  if (-not $gsudo) { throw 'gsudo not found: run win-e2e-install-gsudo.ps1 first' }
  Write-Host "Running wdio at $integrity integrity via $gsudo"
  & $gsudo --direct --integrity $integrity node @wdioArgs
}
exit $LASTEXITCODE
