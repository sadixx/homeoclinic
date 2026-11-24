<#
.SYNOPSIS
  Install gsudo (pinned) and export its path as HC_GSUDO for later steps.

.DESCRIPTION
  GitHub-hosted Windows runners run every step as an elevated administrator
  (High integrity, UAC off). WebView2 ignores the WEBVIEW2_* environment
  overrides at High integrity, which is how msedgedriver tells the app's
  WebView2 to open its DevTools port. Without them msedgedriver fails with
  "session not created: DevToolsActivePort file doesn't exist". gsudo lets
  win-e2e-run.ps1 start wdio (and so tauri-driver, msedgedriver and the app)
  at Medium integrity instead.

  This step fails fast (seconds, before the 12 minute app build) when gsudo
  cannot be installed or does not really lower the integrity level.

  Source order: already present, the pinned portable zip from the gsudo
  GitHub release, then Chocolatey (preinstalled on the runner image).
#>
$ErrorActionPreference = 'Stop'
$version = '2.6.1'

function Find-Gsudo {
  $candidates = @("$env:ProgramFiles\gsudo\Current\gsudo.exe")
  if ($env:ChocolateyInstall) { $candidates += (Join-Path $env:ChocolateyInstall 'bin\gsudo.exe') }
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  $cmd = Get-Command gsudo.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

$gsudo = Find-Gsudo
if (-not $gsudo) {
  try {
    $zip = Join-Path $env:RUNNER_TEMP "gsudo-$version.zip"
    $dir = Join-Path $env:RUNNER_TEMP "gsudo-$version"
    $url = "https://github.com/gerardog/gsudo/releases/download/v$version/gsudo.portable.zip"
    Write-Host "Downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $dir -Force
    $all = @(Get-ChildItem -Path $dir -Recurse -Filter gsudo.exe)
    $x64 = $all | Where-Object { $_.FullName -match '[\\/]x64[\\/]' } | Select-Object -First 1
    $pick = if ($x64) { $x64 } else { $all | Select-Object -First 1 }
    if ($pick) { $gsudo = $pick.FullName }
  } catch {
    Write-Host "::warning::gsudo portable download failed: $_"
  }
}
if (-not $gsudo -and (Get-Command choco -ErrorAction SilentlyContinue)) {
  Write-Host "Falling back to Chocolatey gsudo $version"
  choco install gsudo --version $version -y --no-progress
  $gsudo = Find-Gsudo
}
if (-not $gsudo) { Write-Host '::error::gsudo could not be installed'; exit 1 }

Write-Host "gsudo: $gsudo"
& $gsudo --version

# Prove it does what the E2E run needs: current level vs. Medium.
$current = (whoami /groups | Select-String 'Mandatory Label' | Select-Object -First 1)
$lowered = (& $gsudo --direct --integrity Medium whoami /groups | Select-String 'Mandatory Label' | Select-Object -First 1)
Write-Host "this step     : $current"
Write-Host "via gsudo -i Medium: $lowered"
if ("$lowered" -notmatch 'Medium') {
  Write-Host '::error::gsudo --integrity Medium did not lower the integrity level'
  exit 1
}

"HC_GSUDO=$gsudo" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
