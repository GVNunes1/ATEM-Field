param(
    [string]$ProjectRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
)

$ErrorActionPreference = 'Stop'
$secretsFile = Join-Path $ProjectRoot 'northflank-secrets.txt'
$backendEnv = Join-Path $ProjectRoot 'backend\.env'
$sourceFile = if (Test-Path -LiteralPath $secretsFile) { $secretsFile } else { $backendEnv }
$outputFile = Join-Path $ProjectRoot 'google-calendar-token-northflank.txt'
$pythonScript = Join-Path $ProjectRoot 'backend\src\services\reauthorize_google_calendar.py'

function Get-EnvValue([string]$Path, [string]$Name) {
    $prefix = $Name + '='
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line.StartsWith($prefix)) {
            return $line.Substring($prefix.Length)
        }
    }
    return $null
}

if (-not (Test-Path -LiteralPath $sourceFile)) {
    throw 'Nenhum arquivo de configuração foi encontrado.'
}

$credentialsJson = Get-EnvValue $sourceFile 'GOOGLE_CALENDAR_CREDENTIALS_JSON'
if ([string]::IsNullOrWhiteSpace($credentialsJson)) {
    throw "GOOGLE_CALENDAR_CREDENTIALS_JSON não foi encontrado em $sourceFile"
}

$env:GOOGLE_CALENDAR_CREDENTIALS_JSON = $credentialsJson
$env:GOOGLE_CALENDAR_TOKEN_PATH = Join-Path $ProjectRoot 'backend\data\google-calendar-token.json'

Write-Host ''
Write-Host 'ATEM Field - Renovação do Google Agenda' -ForegroundColor Cyan
Write-Host 'O navegador será aberto para autorizar a conta que possui as agendas.'
Write-Host 'Nenhuma credencial será exibida no terminal.'
Write-Host ''

& python $pythonScript --output $outputFile
if ($LASTEXITCODE -ne 0) {
    throw 'A autorização ou a validação do Google falhou.'
}

Write-Host ''
Write-Host 'Token validado com o Google Calendar.' -ForegroundColor Green
Write-Host "Arquivo para a Northflank: $outputFile"
Write-Host 'Copie o valor desse arquivo para GOOGLE_CALENDAR_TOKEN_JSON e reinicie o serviço.'
