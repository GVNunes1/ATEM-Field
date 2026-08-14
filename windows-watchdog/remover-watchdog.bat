@echo off
setlocal
title ATEM Field - Remover Watchdog
set /p "CONFIRM=Remover a tarefa do watchdog? Digite SIM para confirmar: "
if /I not "%CONFIRM%"=="SIM" exit /b 0
set "SCRIPT_DIR=%~dp0"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%watchdog-control.ps1" -Action Uninstall
pause
