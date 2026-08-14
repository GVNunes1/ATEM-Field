@echo off
setlocal
title ATEM Field - Instalar Watchdog Excel Supabase
set "TASK_NAME=ATEM Field - Excel Supabase Watchdog"
set "WATCHDOG_DIR=%~dp0windows-watchdog"

schtasks.exe /Query /TN "%TASK_NAME%" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ATEM Field Watchdog ja esta instalado neste computador.
    echo Nao e necessario executar o instalador novamente.
    echo.
    schtasks.exe /Query /TN "%TASK_NAME%" /FO LIST
    echo.
    echo Para trocar o caminho do Excel ou as chaves, execute reconfigurar-watchdog-excel.bat.
    echo Para forcar uma leitura, execute windows-watchdog\sincronizar-agora.bat.
    echo.
    pause
    exit /b 0
)

if not exist "%WATCHDOG_DIR%\instalar-watchdog.bat" (
    echo.
    echo ERRO: O pacote esta incompleto.
    echo Arquivo ausente: %WATCHDOG_DIR%\instalar-watchdog.bat
    echo Extraia novamente o ZIP inteiro para uma pasta nova.
    echo.
    pause
    exit /b 2
)

if not exist "%WATCHDOG_DIR%\setup-watchdog.ps1" (
    echo.
    echo ERRO: O pacote esta incompleto ou o PowerShell foi bloqueado pelo Windows/antivirus.
    echo Arquivo ausente: %WATCHDOG_DIR%\setup-watchdog.ps1
    echo Extraia novamente o ZIP inteiro para uma pasta nova.
    echo Se o arquivo voltar a desaparecer, verifique a quarentena do antivirus.
    echo.
    pause
    exit /b 2
)

call "%WATCHDOG_DIR%\instalar-watchdog.bat"
exit /b %ERRORLEVEL%
