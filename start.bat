@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"
if errorlevel 1 (
  echo.
  echo CatCare-Hub 启动失败，请查看上方诊断信息。
  pause
  exit /b 1
)
endlocal
