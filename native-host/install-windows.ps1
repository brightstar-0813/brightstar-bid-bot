# Install Brightstar CSV native messaging host (Windows)
# Usage (PowerShell as current user):
#   .\install-windows.ps1 -ExtensionId <id-from-chrome-extensions> -CsvPath "D:\path\jobs_latest.csv"
#
# Get Extension ID: chrome://extensions → Brightstar Bid bot → Developer mode → ID

param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionId,

  [Parameter(Mandatory = $false)]
  [string]$CsvPath = "",

  [Parameter(Mandatory = $false)]
  [string]$Python = ""
)

$ErrorActionPreference = "Stop"
$HostName = "com.brightstar.bidbot.csvwatch"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PyScript = Join-Path $Root "csv_watcher.py"

if (-not (Test-Path -LiteralPath $PyScript)) {
  throw "Missing csv_watcher.py in $Root"
}

if (-not $Python) {
  $candidates = @(
    "$env:LOCALAPPDATA\Python\bin\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "python"
  )
  foreach ($c in $candidates) {
    try {
      $v = & $c -c "import sys; print(sys.executable)" 2>$null
      if ($v) { $Python = $v.Trim(); break }
    } catch {}
  }
}
if (-not $Python) { throw "Python not found. Pass -Python path\to\python.exe" }

& $Python -m pip install --user watchdog | Out-Host

# Wrapper .bat so Chrome launches Python with the script (and optional env)
$Bat = Join-Path $Root "csv_watcher_host.bat"
$envLine = if ($CsvPath) { "set BRIGHTSTAR_CSV_PATH=$CsvPath" } else { "rem no default csv path" }
@"
@echo off
$envLine
"$Python" "$PyScript" %*
"@ | Set-Content -LiteralPath $Bat -Encoding ASCII

$ManifestDir = Join-Path $env:LOCALAPPDATA "BrightstarBidBot\NativeMessagingHosts"
New-Item -ItemType Directory -Force -Path $ManifestDir | Out-Null
$ManifestPath = Join-Path $ManifestDir "$HostName.json"

$batEscaped = $Bat.Replace('\', '\\')
$origin = "chrome-extension://$ExtensionId/"
$json = @"
{
  "name": "$HostName",
  "description": "Brightstar Bid bot CSV file watcher",
  "path": "$batEscaped",
  "type": "stdio",
  "allowed_origins": [
    "$origin"
  ]
}
"@
Set-Content -LiteralPath $ManifestPath -Value $json -Encoding UTF8

$RegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
New-Item -Path $RegPath -Force | Out-Null
Set-ItemProperty -Path $RegPath -Name "(default)" -Value $ManifestPath

Write-Host "Installed native host: $HostName"
Write-Host "Manifest: $ManifestPath"
Write-Host "Default CSV: $(if ($CsvPath) { $CsvPath } else { '(set via extension / watch message)' })"
Write-Host "Reload the Brightstar extension, enable Native watcher, and Save settings."
