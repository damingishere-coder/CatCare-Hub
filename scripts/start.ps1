[CmdletBinding()]
param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $projectRoot "frontend"
$backendDir = Join-Path $projectRoot "backend"
$runtimeDir = Join-Path $projectRoot ".runtime"
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"

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

function Test-ManagedProcess {
    param([string]$StatePath)

    if (-not (Test-Path -LiteralPath $StatePath)) {
        return $null
    }

    try {
        $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
        $process = Get-Process -Id ([int]$state.pid) -ErrorAction Stop
        $recordedStart = ConvertTo-UtcDateTime -Value $state.startedAtUtc
        $actualStart = $process.StartTime.ToUniversalTime()
        if ([Math]::Abs(($actualStart - $recordedStart).TotalSeconds) -le 2) {
            return $process
        }
    }
    catch {
        return $null
    }

    return $null
}

function Save-ManagedProcess {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$StatePath
    )

    $state = @{
        pid = $Process.Id
        startedAtUtc = $Process.StartTime.ToUniversalTime().ToString("o")
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

function Stop-StartedProcess {
    param([System.Diagnostics.Process]$Process)

    if ($null -eq $Process) {
        return
    }

    try {
        & taskkill.exe /PID $Process.Id /T /F | Out-Null
    }
    catch {
        Write-Warning "Could not clean up process $($Process.Id): $($_.Exception.Message)"
    }
}

function Wait-ForEndpoint {
    param(
        [string]$Uri,
        [System.Diagnostics.Process]$Process,
        [int]$Attempts = 30
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $Process.Refresh()
        if ($Process.HasExited) {
            return $false
        }

        try {
            $request = [System.Net.HttpWebRequest]::Create($Uri)
            $request.Method = "GET"
            $request.Proxy = $null
            $request.Timeout = 2000
            $response = $request.GetResponse()
            $statusCode = [int]$response.StatusCode
            $response.Dispose()
            if ($statusCode -ge 200 -and $statusCode -lt 500) {
                return $true
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    return $false
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "Python environment is missing. Run setup.bat first."
}
& $venvPython (Join-Path $projectRoot "backend\scripts\manage_access.py") `
    --check `
    --env-file (Join-Path $projectRoot ".env")
if ($LASTEXITCODE -ne 0) {
    throw "Local access codes are missing or invalid. Run setup.bat first."
}
if (-not (Test-Path -LiteralPath (Join-Path $frontendDir "node_modules"))) {
    throw "Frontend dependencies are missing. Run setup.bat first."
}

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

$backendState = Join-Path $runtimeDir "backend.json"
$frontendState = Join-Path $runtimeDir "frontend.json"
$existingBackend = Test-ManagedProcess -StatePath $backendState
$existingFrontend = Test-ManagedProcess -StatePath $frontendState
if ($existingBackend -or $existingFrontend) {
    throw "CatCare-Hub is already running, or only partially running. Run stop.bat before starting it again."
}

Remove-Item -LiteralPath $backendState, $frontendState -Force -ErrorAction SilentlyContinue

$backendOutput = Join-Path $runtimeDir "backend.log"
$backendError = Join-Path $runtimeDir "backend.error.log"
$frontendOutput = Join-Path $runtimeDir "frontend.log"
$frontendError = Join-Path $runtimeDir "frontend.error.log"
Remove-Item -LiteralPath $backendOutput, $backendError, $frontendOutput, $frontendError -Force -ErrorAction SilentlyContinue

$backendProcess = $null
$frontendProcess = $null
try {
    Write-Host "Starting CatCare-Hub API..."
    $backendProcess = Start-Process `
        -FilePath $venvPython `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000") `
        -WorkingDirectory $backendDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $backendOutput `
        -RedirectStandardError $backendError `
        -PassThru
    Save-ManagedProcess -Process $backendProcess -StatePath $backendState

    Write-Host "Starting CatCare-Hub web app..."
    $frontendProcess = Start-Process `
        -FilePath $env:ComSpec `
        -ArgumentList @("/d", "/s", "/c", "npm run dev -- --host 0.0.0.0 --port 5180 --strictPort") `
        -WorkingDirectory $frontendDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $frontendOutput `
        -RedirectStandardError $frontendError `
        -PassThru
    Save-ManagedProcess -Process $frontendProcess -StatePath $frontendState

    if (-not (Wait-ForEndpoint -Uri "http://127.0.0.1:8000/api/health" -Process $backendProcess)) {
        throw "The API did not become ready. Review .runtime\backend.error.log."
    }
    if (-not (Wait-ForEndpoint -Uri "http://127.0.0.1:5180/admin" -Process $frontendProcess)) {
        throw "The web app did not become ready. Review .runtime\frontend.error.log."
    }

    Write-Host "CatCare-Hub is running at http://localhost:5180/admin"
    if (-not $NoBrowser) {
        Start-Process "http://localhost:5180/admin"
    }
}
catch {
    Stop-StartedProcess -Process $frontendProcess
    Stop-StartedProcess -Process $backendProcess
    Remove-Item -LiteralPath $backendState, $frontendState -Force -ErrorAction SilentlyContinue
    throw
}
