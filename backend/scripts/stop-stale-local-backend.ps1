param(
  [int]$Port = 3001
)

$ErrorActionPreference = 'Stop'
$connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $connection) {
  exit 0
}

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
  $appPageResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 3
} catch {
  Write-Host "[ERRO] A porta $Port está ocupada por outro serviço."
  exit 1
}

$process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)"
$isQuickTuring = $health.status -eq 'ok' -and $appPageResponse.Content -match 'ATEM Field'
$isNodeBackend = $process.Name -eq 'node.exe' -and $process.CommandLine -match 'dist[\\/]server\.js'

if (-not $isQuickTuring -or -not $isNodeBackend) {
  Write-Host "[ERRO] A porta $Port está ocupada por um processo que não foi reconhecido como Quick Turing."
  exit 1
}

Write-Host "Encerrando backend desatualizado (PID $($connection.OwningProcess))..."
Stop-Process -Id $connection.OwningProcess -Force

for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 250
  $stillListening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $stillListening) {
    exit 0
  }
}

Write-Host '[ERRO] O backend antigo não liberou a porta a tempo.'
exit 1
