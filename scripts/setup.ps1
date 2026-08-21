$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $projectRoot "frontend"
$backendRequirements = Join-Path $projectRoot "backend\requirements-dev.txt"
$venvDir = Join-Path $projectRoot ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"

Write-Host "[1/5] Checking required tools..."
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $nodeCommand -or -not $npmCommand) {
    throw "Node.js and npm are required. Install Node.js 20.19 or newer, then run setup.bat again."
}

$pythonLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
$pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
if (-not $pythonLauncher -and -not $pythonCommand) {
    throw "Python 3 is required. Install Python, then run setup.bat again."
}

Write-Host "[2/5] Preparing the Python virtual environment..."
if (-not (Test-Path -LiteralPath $venvPython)) {
    if ($pythonLauncher) {
        & $pythonLauncher.Source -3 -m venv $venvDir
    }
    else {
        & $pythonCommand.Source -m venv $venvDir
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Could not create the Python virtual environment."
    }
}

Write-Host "[3/5] Installing backend dependencies..."
& $venvPython -m pip install --disable-pip-version-check -r $backendRequirements
if ($LASTEXITCODE -ne 0) {
    throw "Backend dependency installation failed."
}

Write-Host "[4/5] Applying database migrations..."
Push-Location $projectRoot
try {
    & $venvPython -m alembic -c (Join-Path $projectRoot "backend\alembic.ini") upgrade head
    if ($LASTEXITCODE -ne 0) {
        throw "Database migration failed."
    }
}
finally {
    Pop-Location
}

Write-Host "[5/5] Installing frontend dependencies..."
$packageLock = Join-Path $frontendDir "package-lock.json"
Push-Location $frontendDir
try {
    if (Test-Path -LiteralPath $packageLock) {
        & $npmCommand.Source ci
    }
    else {
        & $npmCommand.Source install
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Frontend dependency installation failed."
    }
}
finally {
    Pop-Location
}

Write-Host "Setup is ready. Run start.bat to open CatCare-Hub."
