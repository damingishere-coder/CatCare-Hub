@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
if errorlevel 1 (
  echo.
  echo CatCare-Hub setup failed. Please review the error above.
  pause
  exit /b 1
)
echo.
echo CatCare-Hub setup completed successfully.
pause
endlocal
