@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\seed.ps1"
if errorlevel 1 (
  echo.
  echo CatCare-Hub development Seed failed. Please review the error above.
  pause
  exit /b 1
)
echo.
echo CatCare-Hub development Seed completed successfully.
pause
endlocal
