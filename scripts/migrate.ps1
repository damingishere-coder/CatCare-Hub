$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
$alembicConfig = Join-Path $projectRoot "backend\alembic.ini"
$env:PYTHONUTF8 = "1"

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "Python environment is missing. Run setup.bat first."
}

Push-Location $projectRoot
try {
    & $venvPython -m alembic -c $alembicConfig upgrade head
    if ($LASTEXITCODE -ne 0) {
        throw "Database migration failed."
    }
}
finally {
    Pop-Location
}

Write-Host "Database migration completed."
