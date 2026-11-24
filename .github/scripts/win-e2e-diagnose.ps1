<#
.SYNOPSIS
  Windows E2E diagnostics (ci-windows-debug workflow only): answers in about
  a minute why msedgedriver cannot create a WebView2 session.

.DESCRIPTION
  1. Prints identity, integrity level, UAC, session, WebView2 runtime and
     driver versions, and an allow-listed environment.
  2. Launches the debug exe DIRECTLY (no wdio, no tauri-driver) twice, with
     the same mechanism msedgedriver uses for a WebView2 app: environment
     variables WEBVIEW2_USER_DATA_FOLDER and
     WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>.
       probe-high   : at the runner's own (High) integrity
       probe-medium : at Medium integrity through gsudo
     For each it waits, then records: did the exe exit (exit code, stdout,
     stderr), did the DevTools endpoint answer, did a DevToolsActivePort file
     appear, which msedgewebview2 processes exist, what the app wrote to its
     (isolated) data dir logs. The interesting result is high=NO / medium=YES,
     which confirms the integrity-level root cause.
  3. Dumps Application-log crash events and WER reports for the exe.

  No patient data is involved: fresh empty data dirs, synthetic nothing. The
  DevTools port is bound by WebView2 on loopback for the probe only, in CI.

.PARAMETER OutDir   Directory for all diagnostics output (uploaded as artifact).
.PARAMETER App      Absolute path of the debug exe.
.PARAMETER WaitSeconds  How long each probe waits for the DevTools endpoint.
#>
param(
  [Parameter(Mandatory = $true)][string]$OutDir,
  [Parameter(Mandatory = $true)][string]$App,
  [int]$WaitSeconds = 15
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Start-Transcript -Path (Join-Path $OutDir 'diagnose-transcript.txt') -Force | Out-Null
$started = Get-Date
$summary = New-Object System.Collections.Generic.List[object]

function Section([string]$title) { Write-Host "`n===== $title =====" }

function Get-IntegrityLine {
  (whoami /groups | Select-String 'Mandatory Label' | Select-Object -First 1)
}

# ---------------------------------------------------------------- 1. system
Section 'IDENTITY AND INTEGRITY'
whoami /user
Write-Host "integrity of this step: $(Get-IntegrityLine)"
$lua = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -ErrorAction SilentlyContinue).EnableLUA
Write-Host "UAC EnableLUA: $lua"
Write-Host "session id: $((Get-Process -Id $PID).SessionId); interactive: $([Environment]::UserInteractive)"
Write-Host "explorer running: $([bool](Get-Process explorer -ErrorAction SilentlyContinue))"
Write-Host "OS: $([Environment]::OSVersion.VersionString)"

Section 'VERSIONS'
$wv2Guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
foreach ($k in @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$wv2Guid",
                 "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$wv2Guid",
                 "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$wv2Guid")) {
  if (Test-Path $k) { Write-Host "WebView2 runtime: $((Get-ItemProperty $k).pv)  ($k)" }
}
if ($env:HC_NATIVE_DRIVER) { Write-Host "HC_NATIVE_DRIVER=$env:HC_NATIVE_DRIVER" }
if ($env:HC_NATIVE_DRIVER -and (Test-Path $env:HC_NATIVE_DRIVER) -and $env:HC_NATIVE_DRIVER -like '*.exe') {
  Write-Host "msedgedriver: $(& $env:HC_NATIVE_DRIVER --version)"
}
$td = Get-Command tauri-driver -ErrorAction SilentlyContinue
if ($td) { Write-Host "tauri-driver: $($td.Source) $(& $td.Source --version 2>&1)" }
Write-Host "node: $(node --version)"
if (Test-Path $App) {
  $item = Get-Item $App
  Write-Host "app exe: $App ($([math]::Round($item.Length / 1MB, 1)) MB)"
} else {
  Write-Host "::error::app exe not found at $App"
  Stop-Transcript | Out-Null
  exit 1
}

Section 'ENVIRONMENT (values only for a short allow-list; secret-like names never)'
$allow = '^(PATH|TEMP|TMP|OS|PROCESSOR_ARCHITECTURE|COMPUTERNAME|HC_E2E_.*|HC_GSUDO|HC_NATIVE_DRIVER|RUNNER_OS|RUNNER_ARCH|RUNNER_TEMP)$'
$secretLike = 'KEY|TOKEN|SECRET|PASSWORD|^TAURI_'
$vars = @(Get-ChildItem Env: | Sort-Object Name)
$vars | Where-Object { $_.Name -match $allow -and $_.Name -notmatch $secretLike } | ForEach-Object { Write-Host "$($_.Name)=$($_.Value)" }
Write-Host ('names only (values hidden): ' + (($vars | Where-Object { $_.Name -notmatch $allow -or $_.Name -match $secretLike } | ForEach-Object Name) -join ', '))

# ---------------------------------------------------------------- 2. probes
$gsudo = $env:HC_GSUDO
if (-not $gsudo -or -not (Test-Path $gsudo)) {
  $c = Get-Command gsudo.exe -ErrorAction SilentlyContinue
  $gsudo = if ($c) { $c.Source } else { $null }
}

function Stop-AppProcesses {
  & taskkill /F /T /IM (Split-Path $App -Leaf) 2>&1 | Out-Null
  Get-Process msedgewebview2 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Invoke-Probe([string]$Label, [string]$Integrity, [int]$Port) {
  Section "PROBE $Label (integrity=$Integrity, devtools port $Port)"
  Stop-AppProcesses
  $base = Join-Path $env:RUNNER_TEMP "probe-$Label-base"
  $ud = Join-Path $env:RUNNER_TEMP "probe-$Label-wv2"
  Remove-Item -Recurse -Force $base, $ud -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $base, $ud | Out-Null
  $stdout = Join-Path $OutDir "probe-$Label.stdout.txt"
  $stderr = Join-Path $OutDir "probe-$Label.stderr.txt"

  $vars = [ordered]@{
    HC_E2E_APP_DATA_BASE                 = $base
    WEBVIEW2_USER_DATA_FOLDER            = $ud
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
    TAURI_WEBVIEW_AUTOMATION             = 'true'
  }
  $saved = @{}
  foreach ($k in $vars.Keys) {
    $saved[$k] = [Environment]::GetEnvironmentVariable($k)
    [Environment]::SetEnvironmentVariable($k, $vars[$k])
  }
  $proc = $null
  $cdp = $false
  $cdpBody = ''
  try {
    if ($Integrity -eq 'High') {
      $proc = Start-Process -FilePath $App -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    } else {
      $proc = Start-Process -FilePath $gsudo -ArgumentList @('--direct', '--integrity', $Integrity, $App) `
        -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    }
    Write-Host "started pid $($proc.Id)"
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 500
      try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 1 -UseBasicParsing
        $cdp = $true
        $cdpBody = $r.Content
        break
      } catch { }
      if ($proc.HasExited) { break }
    }
  } finally {
    foreach ($k in $vars.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  }

  $exited = $proc.HasExited
  $exitCode = if ($exited) { $proc.ExitCode } else { 'running' }
  $portFiles = @(Get-ChildItem -Path $ud -Recurse -Filter DevToolsActivePort -ErrorAction SilentlyContinue)
  Write-Host "launcher exited: $exited (exit code: $exitCode)"
  Write-Host "DevTools endpoint answered: $cdp"
  if ($cdpBody) { Write-Host ($cdpBody.Substring(0, [Math]::Min(400, $cdpBody.Length))) }
  Write-Host "DevToolsActivePort files under WEBVIEW2_USER_DATA_FOLDER: $($portFiles.Count)"
  $portFiles | ForEach-Object { Write-Host "  $($_.FullName)" }
  Write-Host 'processes:'
  Get-Process (Split-Path $App -LeafBase), msedgewebview2 -ErrorAction SilentlyContinue |
    Select-Object Id, ProcessName, SessionId, StartTime | Format-Table -AutoSize | Out-String | Write-Host
  Write-Host "WEBVIEW2_USER_DATA_FOLDER contents (top level): $((Get-ChildItem $ud -ErrorAction SilentlyContinue | ForEach-Object Name) -join ', ')"
  Write-Host 'isolated data dir (HC_E2E_APP_DATA_BASE) tree:'
  Get-ChildItem -Path $base -Recurse -Depth 3 -ErrorAction SilentlyContinue |
    ForEach-Object { "  $($_.FullName.Substring($base.Length))  $($_.Length)" } | Write-Host
  $logs = @(Get-ChildItem -Path $base -Recurse -Filter 'app.log*' -ErrorAction SilentlyContinue)
  foreach ($l in $logs | Select-Object -First 2) {
    Write-Host "--- tail of $($l.Name) (no patient data: fresh empty dir) ---"
    Get-Content $l.FullName -Tail 40 | Write-Host
  }
  foreach ($f in @($stdout, $stderr)) {
    if ((Test-Path $f) -and (Get-Item $f).Length -gt 0) {
      Write-Host "--- tail of $(Split-Path $f -Leaf) ---"
      Get-Content $f -Tail 40 | Write-Host
    }
  }

  $summary.Add([pscustomobject]@{
      Probe              = $Label
      Integrity          = $Integrity
      LauncherExited     = $exited
      ExitCode           = $exitCode
      DevToolsAnswered   = $cdp
      DevToolsActivePort = ($portFiles.Count -gt 0)
      HomeDirSeamWorked  = ($logs.Count -gt 0)
    })
  Stop-AppProcesses
}

Invoke-Probe -Label 'high' -Integrity 'High' -Port 9333
if ($gsudo) {
  Invoke-Probe -Label 'medium' -Integrity 'Medium' -Port 9334
} else {
  Write-Host '::warning::gsudo not available: skipping the Medium probe'
}

# ----------------------------------------------------------- 3. crash events
Section 'APPLICATION LOG CRASH EVENTS SINCE START'
try {
  $names = 'Application Error', 'Windows Error Reporting', '.NET Runtime', 'SideBySide'
  Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $started.AddMinutes(-1) } -ErrorAction SilentlyContinue |
    Where-Object { $_.ProviderName -in $names -or $_.Message -match 'homeoclinic|msedgewebview2|WebView2' } |
    ForEach-Object {
      $m = $_.Message
      "[$($_.TimeCreated)] $($_.ProviderName) id=$($_.Id): $($m.Substring(0, [Math]::Min(600, $m.Length)))"
    } | Tee-Object -FilePath (Join-Path $OutDir 'winevent-application.txt') | Write-Host
} catch { Write-Host "Get-WinEvent failed: $_" }
Write-Host 'WER report archive entries for the app:'
Get-ChildItem 'C:\ProgramData\Microsoft\Windows\WER\ReportArchive', 'C:\ProgramData\Microsoft\Windows\WER\ReportQueue' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'homeoclinic' } | ForEach-Object { Write-Host "  $($_.FullName)" }

# --------------------------------------------------------------- 4. summary
Section 'SUMMARY'
$table = ($summary | Format-Table -AutoSize | Out-String)
Write-Host $table
if ($env:GITHUB_STEP_SUMMARY) {
  "### Direct-launch probes (WebView2 DevTools reachability)`n" | Out-File $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
  "Step integrity: ``$(Get-IntegrityLine)```n" | Out-File $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
  "~~~`n$table`n~~~`n" | Out-File $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
  "Root-cause signature: ``high`` DevToolsAnswered=False and ``medium`` DevToolsAnswered=True." |
    Out-File $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
}
$summary | ConvertTo-Json | Out-File (Join-Path $OutDir 'probe-summary.json') -Encoding utf8
Stop-Transcript | Out-Null
exit 0
