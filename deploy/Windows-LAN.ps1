# Optional: run only when several devices need access. Caddy must already be
# installed from its official distribution and present on PATH.
param([Parameter(Mandatory=$true)][string]$ClinicHost)
$ErrorActionPreference = 'Stop'
if ($ClinicHost -notmatch '^[A-Za-z0-9.-]+$') { throw 'Use a private IP address or local hostname only.' }
if (-not (Get-Command caddy -ErrorAction SilentlyContinue)) { throw 'Install Caddy from https://caddyserver.com/docs/install first.' }
$env:CLINIC_HOST=$ClinicHost
$env:PUBLIC_ORIGIN="https://$ClinicHost"
$env:COOKIE_SECURE='1'
$env:HOST='127.0.0.1'
$root=Split-Path $PSScriptRoot -Parent
Set-Location $root
# Close the existing single-PC server before switching to LAN mode.
if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 3000 is in use. Close the existing clinic server before starting LAN mode.' }
$node=Join-Path $root 'runtime\node.exe'
if (-not (Test-Path $node)) { $node='node' }
$app=Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root -PassThru -NoNewWindow
try { caddy run --config deploy/Caddyfile --adapter caddyfile }
finally { if (-not $app.HasExited) { Stop-Process -Id $app.Id } }
