param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Start', 'Stop', 'Status', 'Uninstall')]
    [String]$Action
)

Set-StrictMode -Version 2.0
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateDirectory = Join-Path $scriptDirectory 'state'
$stopPath = Join-Path $stateDirectory 'stop.requested'
$taskName = 'ATEM Field - Excel Supabase Watchdog'

function Test-WatchdogRunning {
    $mutex = $null
    try {
        $mutex = [Threading.Mutex]::OpenExisting('Global\ATEMFieldExcelSupabaseWatchdog')
        $acquired = $mutex.WaitOne(0, $false)
        if ($acquired) { $mutex.ReleaseMutex(); return $false }
        return $true
    }
    catch { return $false }
    finally { if ($null -ne $mutex) { $mutex.Close() } }
}

if (-not [IO.Directory]::Exists($stateDirectory)) { [void][IO.Directory]::CreateDirectory($stateDirectory) }

switch ($Action) {
    'Start' {
        if ([IO.File]::Exists($stopPath)) { [IO.File]::Delete($stopPath) }
        if (Test-WatchdogRunning) { Write-Host 'Watchdog ja esta em execucao.'; exit 0 }
        & schtasks.exe /Run /TN $taskName 2>$null
        if ($LASTEXITCODE -ne 0) {
            $launcher = Join-Path $scriptDirectory 'watchdog-start.vbs'
            & wscript.exe //B //NoLogo $launcher
        }
        Start-Sleep -Seconds 2
        if (Test-WatchdogRunning) { Write-Host 'OK - watchdog iniciado.'; exit 0 }
        Write-Error 'O watchdog nao iniciou. Execute instalar-watchdog.bat e consulte logs\watchdog.log.'
        exit 1
    }
    'Stop' {
        [IO.File]::WriteAllText($stopPath, [DateTime]::Now.ToString('o'), (New-Object Text.UTF8Encoding($false)))
        Write-Host 'Pedido de parada enviado. O watchdog encerrara no proximo ciclo.'
        exit 0
    }
    'Status' {
        if (Test-WatchdogRunning) { Write-Host 'ATIVO'; exit 0 }
        Write-Host 'PARADO'
        exit 1
    }
    'Uninstall' {
        [IO.File]::WriteAllText($stopPath, [DateTime]::Now.ToString('o'), (New-Object Text.UTF8Encoding($false)))
        & schtasks.exe /Delete /TN $taskName /F 2>$null
        Write-Host 'Tarefa removida. Configuracao e credencial foram preservadas para recuperacao.'
        exit 0
    }
}
