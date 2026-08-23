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
$adminUrl = "http://127.0.0.1:5180/admin"
$backendReadyUrl = "http://127.0.0.1:8000/api/ready"
$frontendReadyUrl = "http://127.0.0.1:5180/api/ready"

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
        Write-Warning "无法清理本次启动的进程 $($Process.Id)：$($_.Exception.Message)"
    }
}

function Get-EndpointResult {
    param(
        [string]$Uri,
        [string]$ExpectedPattern = ""
    )

    try {
        $request = [System.Net.HttpWebRequest]::Create($Uri)
        $request.Method = "GET"
        $request.Proxy = $null
        $request.Timeout = 1000
        $response = $request.GetResponse()
        $statusCode = [int]$response.StatusCode
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        try {
            $body = $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
            $response.Dispose()
        }
        $matches = -not $ExpectedPattern -or $body -match $ExpectedPattern
        return [pscustomobject]@{
            Ready = $statusCode -ge 200 -and $statusCode -lt 300 -and $matches
            StatusCode = $statusCode
            Error = $null
        }
    }
    catch {
        $statusCode = $null
        if ($_.Exception.Message -match '\((?<status>\d{3})\)') {
            $statusCode = [int]$Matches.status
        }
        return [pscustomobject]@{
            Ready = $false
            StatusCode = $statusCode
            Error = if ($null -eq $statusCode) { "无法连接本机服务" } else { $null }
        }
    }
}

function Wait-ForEndpoint {
    param(
        [string]$Uri,
        [System.Diagnostics.Process]$Process,
        [string]$ExpectedPattern = "",
        [int]$TimeoutSeconds = 15
    )

    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        $Process.Refresh()
        if ($Process.HasExited) {
            return $false
        }

        $result = Get-EndpointResult -Uri $Uri -ExpectedPattern $ExpectedPattern
        if ($result.Ready) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }

    return $false
}

function Get-PortListeners {
    param([int[]]$Port)

    return @(
        Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Sort-Object LocalPort, OwningProcess -Unique
    )
}

function Get-ProcessChain {
    param([int]$ProcessId)

    $chain = @()
    $currentId = $ProcessId
    for ($depth = 0; $depth -lt 8 -and $currentId -gt 0; $depth++) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$currentId" -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            break
        }
        $chain += $process
        $currentId = [int]$process.ParentProcessId
    }
    return $chain
}

function Test-ProjectPortOwner {
    param([object[]]$Listeners)

    foreach ($listener in $Listeners) {
        $owned = $false
        foreach ($process in (Get-ProcessChain -ProcessId ([int]$listener.OwningProcess))) {
            $commandLine = [string]$process.CommandLine
            if ($commandLine.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $owned = $true
                break
            }
        }
        if (-not $owned) {
            return $false
        }
    }
    return $true
}

function Test-LoopbackOnly {
    param([object[]]$Listeners)

    foreach ($listener in $Listeners) {
        if ($listener.LocalAddress -notin @("127.0.0.1", "::1")) {
            return $false
        }
    }
    return $true
}

function Format-PortOwners {
    param(
        [int]$Port,
        [object[]]$Listeners
    )

    if ($Listeners.Count -eq 0) {
        return "端口 $Port：未监听"
    }

    $descriptions = foreach ($listener in $Listeners) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
        $name = if ($process) { $process.Name } else { "未知进程" }
        "地址=$($listener.LocalAddress)，PID=$($listener.OwningProcess)，进程=$name"
    }
    return "端口 ${Port}：" + ($descriptions -join "；")
}

function Format-ReadinessResult {
    param(
        [string]$Label,
        [object]$Result
    )

    if ($Result.Ready) {
        return "${Label}：已就绪"
    }
    if ($null -ne $Result.StatusCode) {
        return "${Label}：未就绪（HTTP $($Result.StatusCode)）"
    }
    return "${Label}：未就绪（$($Result.Error)）"
}

function Open-AdminPage {
    if (-not $NoBrowser) {
        Start-Process $adminUrl
    }
}

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "Python 环境缺失，请先运行 setup.bat。"
}
if (-not (Test-Path -LiteralPath (Join-Path $frontendDir "node_modules"))) {
    throw "前端依赖缺失，请先运行 setup.bat。"
}

$projectPortListeners = Get-PortListeners -Port @(8000, 5180)
$backendListeners = @($projectPortListeners | Where-Object LocalPort -eq 8000)
$frontendListeners = @($projectPortListeners | Where-Object LocalPort -eq 5180)
if ($backendListeners.Count -gt 0 -or $frontendListeners.Count -gt 0) {
    $backendReady = Get-EndpointResult -Uri $backendReadyUrl -ExpectedPattern '"status"\s*:\s*"ready"'
    $frontendReady = Get-EndpointResult -Uri $frontendReadyUrl -ExpectedPattern '"status"\s*:\s*"ready"'
    $bothPresent = $backendListeners.Count -gt 0 -and $frontendListeners.Count -gt 0
    $ownedByProject = $bothPresent `
        -and (Test-ProjectPortOwner -Listeners $backendListeners) `
        -and (Test-ProjectPortOwner -Listeners $frontendListeners)
    $loopbackOnly = $bothPresent `
        -and (Test-LoopbackOnly -Listeners $backendListeners) `
        -and (Test-LoopbackOnly -Listeners $frontendListeners)

    if ($bothPresent -and $ownedByProject -and $loopbackOnly -and $backendReady.Ready -and $frontendReady.Ready) {
        Write-Host "CatCare-Hub 已由当前项目的运行器启动，无需重复创建进程。"
        Write-Host "后台地址：$adminUrl"
        Open-AdminPage
        exit 0
    }

    $details = @(
        Format-PortOwners -Port 8000 -Listeners $backendListeners
        Format-PortOwners -Port 5180 -Listeners $frontendListeners
        Format-ReadinessResult -Label "API 业务检查" -Result $backendReady
        Format-ReadinessResult -Label "前端代理检查" -Result $frontendReady
    ) -join [Environment]::NewLine
    throw "检测到端口被部分、未知或非本机监听的服务占用，已停止启动，且没有终止任何现有进程。`n$details`n请先在对应运行器中停止冲突服务，再重新启动 CatCare-Hub。"
}

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

$backendState = Join-Path $runtimeDir "backend.json"
$frontendState = Join-Path $runtimeDir "frontend.json"
$existingBackend = Test-ManagedProcess -StatePath $backendState
$existingFrontend = Test-ManagedProcess -StatePath $frontendState
if ($existingBackend -or $existingFrontend) {
    throw "检测到 start.bat 上次记录的进程仍存在，但端口未就绪。请先运行 stop.bat，再重新启动。"
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
    Write-Host "正在检查数据库并启动 CatCare-Hub API..."
    $backendProcess = Start-Process `
        -FilePath $venvPython `
        -ArgumentList @("-m", "app.runtime") `
        -WorkingDirectory $backendDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $backendOutput `
        -RedirectStandardError $backendError `
        -PassThru
    Save-ManagedProcess -Process $backendProcess -StatePath $backendState

    if (-not (Wait-ForEndpoint -Uri $backendReadyUrl -Process $backendProcess -ExpectedPattern '"status"\s*:\s*"ready"')) {
        throw "API 未达到业务就绪状态，请查看 .runtime\backend.error.log。"
    }

    Write-Host "正在启动 CatCare-Hub 网页..."
    $frontendProcess = Start-Process `
        -FilePath $env:ComSpec `
        -ArgumentList @("/d", "/s", "/c", "npm run dev -- --host 127.0.0.1 --port 5180 --strictPort") `
        -WorkingDirectory $frontendDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $frontendOutput `
        -RedirectStandardError $frontendError `
        -PassThru
    Save-ManagedProcess -Process $frontendProcess -StatePath $frontendState

    if (-not (Wait-ForEndpoint -Uri $frontendReadyUrl -Process $frontendProcess -ExpectedPattern '"status"\s*:\s*"ready"')) {
        throw "网页或前端代理未达到业务就绪状态，请查看 .runtime\frontend.error.log。"
    }

    Write-Host "CatCare-Hub 已就绪：$adminUrl"
    Open-AdminPage
}
catch {
    Stop-StartedProcess -Process $frontendProcess
    Stop-StartedProcess -Process $backendProcess
    Remove-Item -LiteralPath $backendState, $frontendState -Force -ErrorAction SilentlyContinue
    throw
}
