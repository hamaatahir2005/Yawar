@echo off
setlocal
set "YAWAR_ENTRY=%~f0"
powershell.exe -NoLogo -NoProfile -Command "$raw=[IO.File]::ReadAllText($env:YAWAR_ENTRY); $parts=$raw -split '(?m)^:__YAWAR_POWERSHELL__\r?$',2; if($parts.Length -ne 2){Write-Error 'Launcher is incomplete. Download it again.'; exit 1}; & ([scriptblock]::Create($parts[1]))"
set "YAWAR_EXIT=%ERRORLEVEL%"
if not "%YAWAR_EXIT%"=="0" pause
exit /b %YAWAR_EXIT%
:__YAWAR_POWERSHELL__
$ErrorActionPreference = 'Stop'
try {
    Write-Host 'Yawar Dental Clinic - Windows launcher'
    $entryDirectory = [IO.Path]::GetDirectoryName($env:YAWAR_ENTRY)
    function Test-ClinicFolder([string]$directory) {
        return ((Test-Path -LiteralPath (Join-Path $directory 'scripts\launch.js')) -and
                (Test-Path -LiteralPath (Join-Path $directory 'server.js')) -and
                (Test-Path -LiteralPath (Join-Path $directory 'package.json')) -and
                (Test-Path -LiteralPath (Join-Path $directory 'public\index.html')))
    }
    if (Test-ClinicFolder $entryDirectory) {
        $appDirectory = $entryDirectory
    } else {
        # Explorer may extract only this CMD into Temp when opened inside a ZIP.
        # Install the full source to a stable, versioned folder without touching
        # any existing clinic database or installing system-wide software.
        if (-not $env:LOCALAPPDATA) { throw 'Windows LOCALAPPDATA folder is unavailable.' }
        $homeDirectory = Join-Path $env:LOCALAPPDATA 'YawarClinic'
        $installDirectory = Join-Path $homeDirectory 'app-launcher-v4'
        New-Item -ItemType Directory -Path $homeDirectory -Force | Out-Null
        if (-not (Test-ClinicFolder $installDirectory)) {
            Write-Host 'Full application files are missing (often caused by opening a ZIP directly).'
            Write-Host 'Downloading the complete clinic application from your GitHub repository...'
            $temporaryDirectory = Join-Path $homeDirectory ('download-' + [guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
            try {
                $archive = Join-Path $temporaryDirectory 'Yawar.zip'
                [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
                Invoke-WebRequest -Uri 'https://github.com/hamaatahir2005/Yawar/archive/refs/heads/main.zip' -OutFile $archive -UseBasicParsing -TimeoutSec 120
                $expanded = Join-Path $temporaryDirectory 'expanded'
                Expand-Archive -LiteralPath $archive -DestinationPath $expanded
                $candidates = @(Get-ChildItem -LiteralPath $expanded -Directory | Where-Object { Test-ClinicFolder $_.FullName })
                if ($candidates.Count -ne 1) { throw 'Downloaded archive does not contain a complete clinic application.' }
                if (Test-Path -LiteralPath $installDirectory) {
                    # Preserve incomplete installations for inspection rather than
                    # deleting a folder which could contain someone's files.
                    $preserved = $installDirectory + '.preserved-' + [guid]::NewGuid().ToString('N')
                    Move-Item -LiteralPath $installDirectory -Destination $preserved
                }
                Move-Item -LiteralPath $candidates[0].FullName -Destination $installDirectory
            } finally {
                if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force }
            }
        }
        $appDirectory = $installDirectory
        if (-not $env:DATA_DIR) { $env:DATA_DIR = Join-Path $homeDirectory 'data' }
        Write-Host ('Clinic files: ' + $appDirectory)
        Write-Host ('Persistent clinic data: ' + $env:DATA_DIR)
        Write-Host 'Existing data in another folder is not moved or overwritten.'
    }
    $node = Join-Path $appDirectory 'runtime\node.exe'
    if (-not (Test-Path -LiteralPath $node)) {
        $command = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $command) { throw 'Install Node.js 24 or newer from https://nodejs.org, then reopen this launcher.' }
        $node = $command.Source
    }
    $major = & $node -p "process.versions.node.split('.')[0]"
    if ($LASTEXITCODE -ne 0 -or [int]$major -lt 24) { throw 'Node.js 24 or newer is required. Install it from https://nodejs.org.' }
    Write-Host 'Keep this window open. The browser will open automatically.'
    Write-Host 'If needed, open http://127.0.0.1:3000 on this computer.'
    Push-Location -LiteralPath $appDirectory
    try {
        & $node (Join-Path $appDirectory 'scripts\launch.js')
        $result = $LASTEXITCODE
    } finally { Pop-Location }
    exit $result
} catch {
    Write-Host ''
    Write-Host ('Unable to start Yawar: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'For an automatic first-time download, Internet access to GitHub is required.'
    Write-Host 'Alternatively extract the ENTIRE project ZIP, then reopen Start-Clinic.cmd inside that folder.'
    exit 1
}
