$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectRoot ".runtime"

function ConvertTo-UtcDateTime {
    param([object]$Value)

    if ($Value -is [DateTime]) {
        return ([DateTime]$Value).ToUniversalTime()
    }
    if ($Value -is [DateTimeOffset]) {
        return ([DateTimeOffset]$Value).UtcDateTime
    }

    return [DateTimeOffset]::Parse(
        [string]$Value,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind
    ).UtcDateTime
}

function Stop-ManagedProcess {
    param(
        [string]$Name,
        [string]$StatePath
    )

    if (-not (Test-Path -LiteralPath $StatePath)) {
        Write-Host "$Name is not running."
        return
    }

    try {
        $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
        $process = Get-Process -Id ([int]$state.pid) -ErrorAction Stop
        $recordedStart = ConvertTo-UtcDateTime -Value $state.startedAtUtc
        $actualStart = $process.StartTime.ToUniversalTime()

        if ([Math]::Abs(($actualStart - $recordedStart).TotalSeconds) -gt 2) {
            throw "Stored process information is stale; refusing to stop an unrelated process."
        }

        & taskkill.exe /PID $process.Id /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "taskkill returned exit code $LASTEXITCODE."
        }
        Write-Host "$Name stopped."
    }
    catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
        Write-Host "$Name was already stopped."
    }
    finally {
        Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    }
}

$frontendState = Join-Path $runtimeDir "frontend.json"
$backendState = Join-Path $runtimeDir "backend.json"

Stop-ManagedProcess -Name "CatCare-Hub web app" -StatePath $frontendState
Stop-ManagedProcess -Name "CatCare-Hub API" -StatePath $backendState
