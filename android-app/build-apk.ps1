param(
    [string]$JdkPath,
    [string]$SdkPath,
    [switch]$InitializeSigning
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$portableTools = Join-Path $projectRoot '.codex/tmp/android-tools'
$signingDirectory = Join-Path $PSScriptRoot '.signing'
$keyStore = Join-Path $signingDirectory 'atem-field-release.p12'
$passwordFile = Join-Path $signingDirectory 'password.xml'
$outputDirectory = Join-Path $projectRoot 'output/android'

if (-not $JdkPath) {
    $portableJdk = Get-ChildItem (Join-Path $portableTools 'jdk') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
    $JdkPath = if ($portableJdk) { $portableJdk.FullName } else { $env:JAVA_HOME }
}
if (-not $SdkPath) {
    $portableSdk = Join-Path $portableTools 'sdk'
    $SdkPath = if (Test-Path $portableSdk) { $portableSdk } else { $env:ANDROID_HOME }
}
if (-not $JdkPath -or -not (Test-Path (Join-Path $JdkPath 'bin/java.exe'))) {
    throw 'Informe -JdkPath para um JDK 17 instalado.'
}
if (-not $SdkPath -or -not (Test-Path (Join-Path $SdkPath 'platforms/android-36/android.jar'))) {
    throw 'Informe -SdkPath para um Android SDK com platforms;android-36 e build-tools;35.0.0.'
}
foreach ($requiredTool in @((Join-Path $JdkPath 'bin/keytool.exe'),
    (Join-Path $SdkPath 'build-tools/35.0.0/apksigner.bat'), (Join-Path $PSScriptRoot 'gradlew.bat'))) {
    if (-not (Test-Path $requiredTool)) { throw "Ferramenta de compilação ausente: $requiredTool" }
}

$environmentKeys = @('JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ATEM_ANDROID_KEYSTORE',
    'ATEM_ANDROID_STORE_PASSWORD', 'ATEM_ANDROID_KEY_PASSWORD', 'JAVA_TOOL_OPTIONS')
$previousEnvironment = @{}
foreach ($name in $environmentKeys) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
Push-Location $PSScriptRoot
try {
    $env:JAVA_HOME = $JdkPath
    $env:ANDROID_HOME = $SdkPath
    $env:ANDROID_SDK_ROOT = $SdkPath
    # Some Windows desktop runtimes reject Java AF_UNIX selector pipes. A missing
    # socket directory makes OpenJDK use its normal TCP loopback fallback instead.
    # This is process-local: no firewall, system environment or JVM is modified.
    $socketFallbackDirectory = Join-Path $PSScriptRoot '.gradle/unused-unix-socket-directory'
    if (-not (Test-Path $socketFallbackDirectory)) {
        $env:JAVA_TOOL_OPTIONS = ($env:JAVA_TOOL_OPTIONS + ' -Djdk.net.unixdomain.tmpdir="' + $socketFallbackDirectory + '"').Trim()
    }
    if (-not (Test-Path $keyStore) -or -not (Test-Path $passwordFile)) {
        if (-not $InitializeSigning) {
            throw 'Assinatura ausente. Na primeira compilação, use -InitializeSigning. Nunca substitua uma chave já usada.'
        }
        if ((Test-Path $keyStore) -or (Test-Path $passwordFile)) {
            throw 'Assinatura incompleta: restaure o backup. A chave existente não será sobrescrita.'
        }
        New-Item -ItemType Directory -Force $signingDirectory | Out-Null
        $pendingKey = Join-Path $signingDirectory 'pending-release.p12'
        $pendingPassword = Join-Path $signingDirectory 'pending-password.xml'
        if ((Test-Path $pendingKey) -or (Test-Path $pendingPassword)) {
            throw 'Há uma inicialização interrompida em .signing. Revise os arquivos privados antes de tentar novamente.'
        }
        $randomBytes = New-Object byte[] 48
        $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $randomGenerator.GetBytes($randomBytes) } finally { $randomGenerator.Dispose() }
        $generatedPassword = [Convert]::ToBase64String($randomBytes)
        $securePassword = ConvertTo-SecureString $generatedPassword -AsPlainText -Force
        # DPAPI protects the password for this Windows account; never commit this file.
        $env:ATEM_ANDROID_STORE_PASSWORD = $generatedPassword
        $env:ATEM_ANDROID_KEY_PASSWORD = $generatedPassword
        & (Join-Path $JdkPath 'bin/keytool.exe') -genkeypair -keystore $pendingKey -storetype PKCS12 `
            -alias atem-field -keyalg RSA -keysize 3072 -validity 10000 `
            -dname 'CN=ATEM Field, OU=Operacao de Campo, O=Mult Med, C=BR' `
            -storepass:env ATEM_ANDROID_STORE_PASSWORD -keypass:env ATEM_ANDROID_KEY_PASSWORD
        if ($LASTEXITCODE -ne 0) { throw 'Não foi possível gerar a chave de assinatura.' }
        $securePassword | Export-Clixml -LiteralPath $pendingPassword
        Move-Item -LiteralPath $pendingKey -Destination $keyStore
        Move-Item -LiteralPath $pendingPassword -Destination $passwordFile
        $generatedPassword = $null
    }
    $savedPassword = Import-Clixml -LiteralPath $passwordFile
    $credential = New-Object System.Management.Automation.PSCredential('atem-field', $savedPassword)
    $env:ATEM_ANDROID_STORE_PASSWORD = $credential.GetNetworkCredential().Password
    $env:ATEM_ANDROID_KEY_PASSWORD = $env:ATEM_ANDROID_STORE_PASSWORD
    $env:ATEM_ANDROID_KEYSTORE = $keyStore

    & (Join-Path $PSScriptRoot 'gradlew.bat') --no-daemon --console=plain --max-workers=1 `
        '-Dorg.gradle.jvmargs=-Xmx1024m -Dfile.encoding=UTF-8' `
        :app:testDebugUnitTest :app:assembleRelease :app:lintRelease
    if ($LASTEXITCODE -ne 0) { throw 'Os testes, a compilação ou a verificação Android falharam.' }
    $builtApk = Join-Path $PSScriptRoot 'app/build/outputs/apk/release/app-release.apk'
    $apkSigner = Join-Path $SdkPath 'build-tools/35.0.0/apksigner.bat'
    & $apkSigner verify --verbose --print-certs $builtApk
    if ($LASTEXITCODE -ne 0) { throw 'A assinatura do APK não é válida.' }
    New-Item -ItemType Directory -Force $outputDirectory | Out-Null
    $version = [regex]::Match((Get-Content (Join-Path $PSScriptRoot 'app/build.gradle') -Raw), 'versionName\s+["'']([^"'']+)').Groups[1].Value
    if (-not $version) { throw 'Versão do aplicativo ausente.' }
    $deliveryPath = Join-Path $outputDirectory "ATEM-Field-$version.apk"
    Copy-Item -LiteralPath $builtApk -Destination $deliveryPath -Force
    $apkHash = (Get-FileHash -LiteralPath $deliveryPath -Algorithm SHA256).Hash
    Write-Host "APK assinado: $deliveryPath"
    Write-Host "SHA-256: $apkHash"
    Write-Host 'Guarde um backup seguro da chave .signing. Nunca inclua essa pasta em arquivos compartilhados.'
} finally {
    foreach ($name in $environmentKeys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
    Pop-Location
}
