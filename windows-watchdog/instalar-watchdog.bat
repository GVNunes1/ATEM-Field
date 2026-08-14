@echo off
setlocal
title ATEM Field - Instalar Watchdog Excel Supabase
set "SCRIPT_DIR=%~dp0"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

if not exist "%SCRIPT_DIR%setup-watchdog.ps1" (
    echo.
    echo ERRO: Arquivo setup-watchdog.ps1 ausente.
    echo Extraia novamente o ZIP completo. Se o arquivo desaparecer, verifique a quarentena do antivirus.
    echo.
    pause
    exit /b 2
)

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup-watchdog.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXIT_CODE%
