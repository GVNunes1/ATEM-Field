param(
    [Parameter(Mandatory = $true)][string]$Destination,
    [string]$JdkPath
)

$ErrorActionPreference = 'Stop'
$sourceKey = Join-Path $PSScriptRoot '.signing/atem-field-release.p12'
$passwordFile = Join-Path $PSScriptRoot '.signing/password.xml'
if (-not (Test-Path $sourceKey) -or -not (Test-Path $passwordFile)) { throw 'Assinatura local não encontrada.' }
if (Test-Path -LiteralPath $Destination) { throw 'O destino já existe; nenhum backup será sobrescrito.' }
if (-not $JdkPath) {
    $toolsDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) '.codex/tmp/android-tools/jdk'
    $jdkDirectory = Get-ChildItem $toolsDirectory -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    $JdkPath = if ($jdkDirectory) { $jdkDirectory.FullName } else { $env:JAVA_HOME }
}
$keyTool = Join-Path $JdkPath 'bin/keytool.exe'
if (-not (Test-Path $keyTool)) { throw 'Informe -JdkPath para um JDK instalado.' }
$newPassword = Read-Host 'Senha para proteger o backup portável (guarde em um gerenciador de senhas)' -AsSecureString
$confirmation = Read-Host 'Confirme a senha do backup' -AsSecureString
$targetCredential = New-Object System.Management.Automation.PSCredential('backup', $newPassword)
$confirmationCredential = New-Object System.Management.Automation.PSCredential('backup', $confirmation)
if ($newPassword.Length -lt 12 -or $targetCredential.GetNetworkCredential().Password -cne $confirmationCredential.GetNetworkCredential().Password) {
    throw 'Use uma senha de pelo menos 12 caracteres e confirme exatamente a mesma senha.'
}
$sourceCredential = New-Object System.Management.Automation.PSCredential('source', (Import-Clixml -LiteralPath $passwordFile))
try {
    $env:ATEM_BACKUP_SOURCE_PASSWORD = $sourceCredential.GetNetworkCredential().Password
    $env:ATEM_BACKUP_TARGET_PASSWORD = $targetCredential.GetNetworkCredential().Password
    & $keyTool -importkeystore -noprompt -srckeystore $sourceKey -srcstoretype PKCS12 `
        -srcalias atem-field -srcstorepass:env ATEM_BACKUP_SOURCE_PASSWORD `
        -srckeypass:env ATEM_BACKUP_SOURCE_PASSWORD -destkeystore $Destination -deststoretype PKCS12 `
        -destalias atem-field -deststorepass:env ATEM_BACKUP_TARGET_PASSWORD -destkeypass:env ATEM_BACKUP_TARGET_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao exportar o backup da chave.' }
    Write-Host 'Backup portável criado. Guarde o arquivo em local seguro e a senha separadamente.'
} finally {
    Remove-Item Env:ATEM_BACKUP_SOURCE_PASSWORD, Env:ATEM_BACKUP_TARGET_PASSWORD -ErrorAction SilentlyContinue
}
