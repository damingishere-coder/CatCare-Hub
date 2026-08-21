$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $projectRoot "backend"
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$env:PYTHONUTF8 = "1"

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "Python environment is missing. Run setup.bat first."
}

& (Join-Path $PSScriptRoot "migrate.ps1")

Push-Location $backendDir
try {
    & $venvPython -m app.db.seed
    if ($LASTEXITCODE -ne 0) {
        throw "Development Seed failed."
    }
}
finally {
    Pop-Location
}
