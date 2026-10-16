@echo off
chcp 65001 >nul
setlocal EnableExtensions
pushd "%~dp0" >nul || exit /b 1
set "PROJECT_ROOT=%CD%"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%\backend\scripts\renew-google-drive-token.ps1" -ProjectRoot "%PROJECT_ROOT%"
if errorlevel 1 (
  echo.
  echo [ERRO] Nao foi possivel renovar o acesso ao Google Drive.
  popd
  pause
  exit /b 1
)

echo.
echo Renovacao concluida.
popd
pause
