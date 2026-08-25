@echo off
setlocal EnableExtensions

rem Inicia a aplicacao local e valida a conexao com o Supabase.
rem Requer: Node.js/npm e backend\.env configurado a partir de backend\.env.example.

set "ROOT_DIR=%~dp0"
pushd "%ROOT_DIR%" >nul || (
  echo [ERRO] Nao foi possivel acessar a pasta do projeto.
  exit /b 1
)

set "BACKEND_DIR=%CD%\backend"
set "FRONTEND_DIR=%CD%\frontend"

where node >nul 2>&1 || goto :node_missing
where npm.cmd >nul 2>&1 || goto :npm_missing

if not exist "%BACKEND_DIR%\.env" goto :env_missing

echo.
echo === Quick Turing: preparando ambiente local ===

if not exist "%BACKEND_DIR%\node_modules" (
  echo Instalando dependencias do backend...
  call npm.cmd --prefix "%BACKEND_DIR%" ci || goto :failed
)

if not exist "%FRONTEND_DIR%\node_modules" (
  echo Instalando dependencias do frontend...
  call npm.cmd --prefix "%FRONTEND_DIR%" ci || goto :failed
)

set "BACKEND_PYTHON=%BACKEND_DIR%\.venv\Scripts\python.exe"
if not exist "%BACKEND_PYTHON%" (
  echo Preparando Python para Agenda e geracao de PDFs...
  where py >nul 2>&1 || goto :python_missing
  py -3 -m venv "%BACKEND_DIR%\.venv" || goto :failed
)

echo Instalando dependencias Python do backend...
"%BACKEND_PYTHON%" -m pip install --disable-pip-version-check -r "%BACKEND_DIR%\requirements-google-calendar.txt" || goto :failed

echo.
echo Compilando backend...
call npm.cmd --prefix "%BACKEND_DIR%" run build || goto :failed

echo.
echo Compilando frontend...
call npm.cmd --prefix "%FRONTEND_DIR%" run build || goto :failed

echo.
echo Verificando conexao direta com o Supabase...
node "%BACKEND_DIR%\scripts\verify_schema.js" || goto :supabase_failed

echo.
echo Reiniciando o backend para carregar a compilacao e as configuracoes atuais...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%BACKEND_DIR%\scripts\stop-stale-local-backend.ps1" -Port 3001 || goto :backend_failed
start "Quick Turing Backend" /D "%BACKEND_DIR%" cmd.exe /k "set PORT=3001&& set PYTHON_EXECUTABLE=%BACKEND_PYTHON%&& npm.cmd start"
call :wait_for_backend || goto :backend_failed

echo.
echo Verificando a API local integrada ao Supabase...
powershell.exe -NoProfile -Command "try { $stats = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/dashboard/stats' -TimeoutSec 5; if (-not $stats.success) { throw 'A API retornou success=false.' }; Write-Host ('OK - API local conectada. Tecnicos ativos: ' + $stats.stats.activeTechnicians + '; analisadores: ' + $stats.stats.totalAnalyzers); exit 0 } catch { Write-Host ('ERRO - Falha ao consultar a API local: ' + $_.Exception.Message); exit 1 }" || goto :backend_failed

echo.
echo Projeto pronto: http://localhost:3001
start "" "http://localhost:3001"
popd >nul
exit /b 0

:health_check
powershell.exe -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 }; exit 1 } catch { exit 1 }"
exit /b %errorlevel%

:wait_for_backend
set /a ATTEMPT=0
:wait_loop
set /a ATTEMPT+=1
call :health_check
if not errorlevel 1 exit /b 0
if %ATTEMPT% GEQ 20 exit /b 1
timeout /t 1 /nobreak >nul
goto :wait_loop

:node_missing
echo [ERRO] Node.js nao foi encontrado no PATH. Instale uma versao LTS e tente novamente.
goto :error_exit

:npm_missing
echo [ERRO] npm.cmd nao foi encontrado no PATH. Reinstale o Node.js e tente novamente.
goto :error_exit

:python_missing
echo [ERRO] Python 3 nao foi encontrado. Instale o Python com o launcher 'py' e tente novamente.
goto :error_exit

:env_missing
echo [ERRO] Arquivo ausente: backend\.env
echo Copie backend\.env.example para backend\.env e preencha as credenciais do Supabase.
goto :error_exit

:supabase_failed
echo [ERRO] A verificacao direta do Supabase falhou. O backend nao foi iniciado.
goto :error_exit

:backend_failed
echo [ERRO] O backend local nao respondeu corretamente em http://localhost:3001.
goto :error_exit

:failed
echo [ERRO] Nao foi possivel preparar o projeto local.

:error_exit
popd >nul
pause
exit /b 1
