@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"
if errorlevel 1 (
  echo.
  echo CatCare-Hub failed to stop cleanly. Please review the error above.
  pause
  exit /b 1
)
endlocal
