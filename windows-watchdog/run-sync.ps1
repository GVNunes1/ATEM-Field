param(
    [String]$ConfigPath = '',
    [Switch]$DryRun,
    [Switch]$TestConnection,
    [Switch]$SelfTest
)

Set-StrictMode -Version 2.0
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDirectory 'ATEM.Watchdog.Common.ps1')

try {
    if (Test-ATEMStringBlank $ConfigPath) { $ConfigPath = Join-Path $scriptDirectory 'watchdog.config.ps1' }
    $configuration = Get-ATEMConfiguration $ConfigPath
    $syncMode = 'Appointments'
    if ($configuration.ContainsKey('SyncMode') -and -not (Test-ATEMStringBlank $configuration.SyncMode)) { $syncMode = [String]$configuration.SyncMode }
    if ($syncMode -eq 'Analyzers') { $syncScript = Join-Path $scriptDirectory 'sync-analyzers-supabase.ps1' }
    elseif ($syncMode -eq 'Appointments') { $syncScript = Join-Path $scriptDirectory 'sync-excel-supabase.ps1' }
    else { throw ("SyncMode invalido: {0}. Use Analyzers ou Appointments." -f $syncMode) }

    $powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $syncScript, '-ConfigPath', $ConfigPath)
    if ($DryRun) { $arguments += '-DryRun' }
    if ($TestConnection) { $arguments += '-TestConnection' }
    if ($SelfTest) { $arguments += '-SelfTest' }
    & $powerShellPath $arguments
    exit $LASTEXITCODE
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
