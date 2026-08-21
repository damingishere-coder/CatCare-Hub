@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\migrate.ps1"
if errorlevel 1 (
  echo.
  echo CatCare-Hub database migration failed. Please review the error above.
  pause
  exit /b 1
)
echo.
echo CatCare-Hub database migration completed successfully.
pause
endlocal
