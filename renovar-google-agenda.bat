@echo off
chcp 65001 >nul
setlocal EnableExtensions
pushd "%~dp0" >nul || exit /b 1
set "PROJECT_ROOT=%CD%"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%\backend\scripts\renew-google-calendar-token.ps1" -ProjectRoot "%PROJECT_ROOT%"
if errorlevel 1 (
  echo.
  echo [ERRO] Nao foi possivel renovar o acesso ao Google Agenda.
  popd
  pause
  exit /b 1
)

echo.
echo Renovacao concluida.
popd
pause
