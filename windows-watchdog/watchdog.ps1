param(
    [String]$ConfigPath = ''
)

# Compativel com Windows 7 SP1 e PowerShell 2.0.
Set-StrictMode -Version 2.0
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDirectory 'ATEM.Watchdog.Common.ps1')

function Resolve-ATEMLocalPath {
    param([String]$Path, [String]$BasePath)
    $expanded = [Environment]::ExpandEnvironmentVariables($Path)
    if ([IO.Path]::IsPathRooted($expanded)) { return [IO.Path]::GetFullPath($expanded) }
    return [IO.Path]::GetFullPath((Join-Path $BasePath $expanded))
}

function Get-ATEMFileSignature {
    param([String]$Path)
    if (-not [IO.File]::Exists($Path)) { return '' }
    $item = Get-Item -LiteralPath $Path
    return ('{0}:{1}' -f $item.Length, $item.LastWriteTimeUtc.Ticks)
}

function Invoke-ATEMSyncProcess {
    param([String]$PowerShellPath, [String]$SyncScript, [String]$ConfigurationPath, [String]$LogPath)
    $output = & $PowerShellPath -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $SyncScript -ConfigPath $ConfigurationPath 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $details = [String]::Join(' | ', [String[]]@($output))
        if ($details.Length -gt 1800) { $details = $details.Substring(0, 1800) }
        Write-ATEMLog $LogPath ("Sincronizacao falhou (codigo {0}): {1}" -f $exitCode, $details) 'ERROR'
        return $false
    }
    return $true
}

$watchdogMutex = $null
$hasMutex = $false
try {
    if (Test-ATEMStringBlank $ConfigPath) { $ConfigPath = Join-Path $scriptDirectory 'watchdog.config.ps1' }
    $ConfigPath = [IO.Path]::GetFullPath($ConfigPath)
    $configuration = Get-ATEMConfiguration $ConfigPath

    $excelPath = Resolve-ATEMLocalPath ([String]$configuration.ExcelPath) $scriptDirectory
    $logPath = Resolve-ATEMLocalPath ([String]$configuration.LogPath) $scriptDirectory
    $stateDirectory = Resolve-ATEMLocalPath ([String]$configuration.StatePath) $scriptDirectory
    if (-not [IO.Directory]::Exists($stateDirectory)) { [void][IO.Directory]::CreateDirectory($stateDirectory) }
    $successStatePath = Join-Path $stateDirectory 'last-success.txt'
    $stopPath = Join-Path $stateDirectory 'stop.requested'

    $pollSeconds = [Math]::Min(60, [Math]::Max(2, [Int32]$configuration.PollSeconds))
    $stableSeconds = [Math]::Max(2, [Int32]$configuration.StableSeconds)
    $retrySeconds = [Math]::Max(10, [Int32]$configuration.RetrySeconds)
    $powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $syncScript = Join-Path $scriptDirectory 'run-sync.ps1'

    $watchdogMutex = New-Object Threading.Mutex($false, 'Global\ATEMFieldExcelSupabaseWatchdog')
    $hasMutex = $watchdogMutex.WaitOne(0, $false)
    if (-not $hasMutex) { throw 'O watchdog ja esta em execucao.' }

    if ([IO.File]::Exists($stopPath)) {
        Write-ATEMLog $logPath 'Watchdog nao iniciado: existe um pedido de parada.' 'WARN'
        exit 0
    }

    $lastSuccessfulSignature = ''
    if ([IO.File]::Exists($successStatePath)) {
        $lastSuccessfulSignature = [IO.File]::ReadAllText($successStatePath, [Text.Encoding]::UTF8).Trim()
    }
    $pendingSignature = ''
    $pendingSince = [DateTime]::MinValue
    $nextAttempt = [DateTime]::MinValue
    $lastHeartbeat = [DateTime]::MinValue
    $missingWasLogged = $false

    Write-ATEMLog $logPath ("Watchdog iniciado. Planilha: {0}; intervalo: {1}s; estabilidade: {2}s." -f $excelPath, $pollSeconds, $stableSeconds)

    while (-not [IO.File]::Exists($stopPath)) {
        $now = [DateTime]::Now
        $signature = Get-ATEMFileSignature $excelPath
        if ([String]::IsNullOrEmpty($signature)) {
            if (-not $missingWasLogged) {
                Write-ATEMLog $logPath ("Planilha nao encontrada: {0}" -f $excelPath) 'WARN'
                $missingWasLogged = $true
            }
        }
        else {
            $missingWasLogged = $false
            if ($signature -ne $pendingSignature) {
                $pendingSignature = $signature
                $pendingSince = $now
                $nextAttempt = [DateTime]::MinValue
                Write-ATEMLog $logPath 'Alteracao detectada; aguardando a planilha estabilizar.'
            }

            $isStable = (($now - $pendingSince).TotalSeconds -ge $stableSeconds)
            $needsSync = ($signature -ne $lastSuccessfulSignature)
            if ($isStable -and $needsSync -and $now -ge $nextAttempt) {
                Write-ATEMLog $logPath 'Iniciando sincronizacao da planilha com o Supabase.'
                if (Invoke-ATEMSyncProcess $powerShellPath $syncScript $ConfigPath $logPath) {
                    $lastSuccessfulSignature = $signature
                    [IO.File]::WriteAllText($successStatePath, $signature, (New-Object Text.UTF8Encoding($false)))
                    Write-ATEMLog $logPath 'Sincronizacao confirmada; estado salvo.'
                }
                else {
                    $nextAttempt = $now.AddSeconds($retrySeconds)
                    Write-ATEMLog $logPath ("Nova tentativa em {0} segundo(s)." -f $retrySeconds) 'WARN'
                }
            }
        }

        if (($now - $lastHeartbeat).TotalHours -ge 1) {
            Write-ATEMLog $logPath 'Watchdog ativo.'
            $lastHeartbeat = $now
        }
        Start-Sleep -Seconds $pollSeconds
    }

    Write-ATEMLog $logPath 'Watchdog encerrado por solicitacao.'
}
catch {
    $fallbackLog = Join-Path $scriptDirectory 'logs\watchdog.log'
    try { Write-ATEMLog $fallbackLog $_.Exception.Message 'ERROR' }
    catch { Write-Error $_.Exception.Message }
    exit 1
}
finally {
    if ($hasMutex -and $null -ne $watchdogMutex) { try { $watchdogMutex.ReleaseMutex() } catch { } }
    if ($null -ne $watchdogMutex) { $watchdogMutex.Close() }
}
