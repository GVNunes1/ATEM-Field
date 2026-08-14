@echo off
setlocal
title ATEM Field - Reconfigurar Watchdog Excel Supabase
set "WATCHDOG_DIR=%~dp0windows-watchdog"

if not exist "%WATCHDOG_DIR%\setup-watchdog.ps1" (
    echo.
    echo ERRO: O pacote esta incompleto.
    echo Arquivo ausente: %WATCHDOG_DIR%\setup-watchdog.ps1
    echo Extraia novamente o ZIP inteiro para uma pasta nova.
    echo Se o arquivo voltar a desaparecer, verifique a quarentena do antivirus.
    echo.
    pause
    exit /b 2
)

call "%WATCHDOG_DIR%\instalar-watchdog.bat"
exit /b %ERRORLEVEL%
