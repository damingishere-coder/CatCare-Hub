$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$backendDir = Join-Path $projectRoot "backend"
$env:PYTHONUTF8 = "1"

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "Python environment is missing. Run setup.bat first."
}

Push-Location $backendDir
try {
    & $venvPython -m app.db.preflight_cli
    if ($LASTEXITCODE -ne 0) {
        throw "Database migration failed."
    }
}
finally {
    Pop-Location
}

Write-Host "Database migration and integrity checks completed."
