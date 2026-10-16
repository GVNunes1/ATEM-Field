param(
    [string]$ProjectRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$secretsFile = Join-Path $ProjectRoot 'northflank-secrets.txt'
$backendEnv = Join-Path $ProjectRoot 'backend\.env'
$sourceFile = if (Test-Path -LiteralPath $secretsFile) { $secretsFile } else { $backendEnv }
$pythonScript = Join-Path $ProjectRoot 'backend\src\services\reauthorize_google_drive.py'
$dataDir = Join-Path $ProjectRoot 'backend\data'

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
    throw 'Nenhum arquivo local de configuração foi encontrado.'
}

$credentialsJson = Get-EnvValue $sourceFile 'GOOGLE_DRIVE_CREDENTIALS_JSON'
if ([string]::IsNullOrWhiteSpace($credentialsJson)) {
    $credentialsJson = Get-EnvValue $sourceFile 'GOOGLE_CALENDAR_CREDENTIALS_JSON'
}
if ([string]::IsNullOrWhiteSpace($credentialsJson)) {
    throw 'Credenciais OAuth do Google não foram encontradas na configuração local.'
}

$env:GOOGLE_DRIVE_CREDENTIALS_JSON = $credentialsJson
$unsignedFolder = Get-EnvValue $sourceFile 'GOOGLE_DRIVE_OS_UNSIGNED_FOLDER_ID'
$signedFolder = Get-EnvValue $sourceFile 'GOOGLE_DRIVE_OS_SIGNED_FOLDER_ID'
if (-not [string]::IsNullOrWhiteSpace($unsignedFolder)) { $env:GOOGLE_DRIVE_OS_UNSIGNED_FOLDER_ID = $unsignedFolder }
if (-not [string]::IsNullOrWhiteSpace($signedFolder)) { $env:GOOGLE_DRIVE_OS_SIGNED_FOLDER_ID = $signedFolder }

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fffffff'
$outputFile = Join-Path $dataDir "google-drive-token-$stamp.json"

Write-Host ''
Write-Host 'ATEM Field - Renovação do Google Drive' -ForegroundColor Cyan
Write-Host 'Autorize no navegador a conta que possui as duas pastas de ordens de serviço.'
Write-Host 'O token atual não será alterado; nenhum segredo será exibido no terminal.'
Write-Host ''

& python $pythonScript --output $outputFile
if ($LASTEXITCODE -ne 0) {
    throw 'A autorização ou a validação das pastas do Google Drive falhou.'
}

Write-Host ''
Write-Host 'Token validado com as duas pastas do Google Drive.' -ForegroundColor Green
Write-Host "Novo arquivo local: $outputFile"
Write-Host 'Para Northflank, configure GOOGLE_DRIVE_OAUTH_TOKEN_JSON_BASE64 com o conteúdo JSON codificado em Base64 e reinicie o serviço.'
