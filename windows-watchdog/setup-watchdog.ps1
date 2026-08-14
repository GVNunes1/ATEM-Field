param(
    [String]$DetectPath = '',
    [Switch]$DetectOnly
)

# Instalador interativo compativel com PowerShell 2.0.
Set-StrictMode -Version 2.0
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDirectory = Split-Path -Parent $scriptDirectory
$installationStage = 'inicializacao'
. (Join-Path $scriptDirectory 'ATEM.Watchdog.Common.ps1')

function Read-ATEMValue {
    param([String]$Prompt, [String]$DefaultValue)
    $label = $Prompt
    if (-not [String]::IsNullOrEmpty($DefaultValue)) { $label += " [$DefaultValue]" }
    $answer = Read-Host $label
    if (Test-ATEMStringBlank $answer) { return $DefaultValue }
    return $answer.Trim()
}

function Read-ATEMEnvFile {
    param([String]$Path)
    $values = @{}
    if (-not [IO.File]::Exists($Path)) { return $values }
    foreach ($line in [IO.File]::ReadAllLines($Path)) {
        if ($line -match '^\s*#' -or (Test-ATEMStringBlank $line)) { continue }
        $separator = $line.IndexOf('=')
        if ($separator -le 0) { continue }
        $name = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $values[$name] = $value
    }
    return $values
}

function ConvertFrom-ATEMSecureString {
    param([Security.SecureString]$Value)
    $pointer = [IntPtr]::Zero
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    }
}

function Escape-ATEMPowerShellLiteral {
    param([String]$Value)
    return $Value.Replace("'", "''")
}

function Test-ATEMExcelInstallation {
    $excel = $null
    try {
        $excel = New-Object -ComObject Excel.Application
        return $true
    }
    catch { return $false }
    finally {
        if ($null -ne $excel) { try { $excel.Quit() } catch { }; Release-ATEMComObject $excel }
    }
}

function Resolve-ATEMExcelPath {
    param([String]$Path)
    $expandedPath = [Environment]::ExpandEnvironmentVariables($Path).Trim()
    if ($expandedPath.Length -ge 2) {
        if (($expandedPath.StartsWith('"') -and $expandedPath.EndsWith('"')) -or ($expandedPath.StartsWith("'") -and $expandedPath.EndsWith("'"))) {
            $expandedPath = $expandedPath.Substring(1, $expandedPath.Length - 2).Trim()
        }
    }
    if (Test-ATEMStringBlank $expandedPath) { throw 'O caminho da planilha nao foi informado.' }

    $fullPath = [IO.Path]::GetFullPath($expandedPath)
    if (-not [IO.File]::Exists($fullPath)) { throw ("Planilha nao encontrada: {0}" -f $fullPath) }
    $isNetwork = $fullPath.StartsWith('\\')

    if ($fullPath -match '^[A-Za-z]:\\') {
        $driveId = $fullPath.Substring(0, 2).ToUpperInvariant()
        $logicalDisk = $null
        try { $logicalDisk = Get-WmiObject -Class Win32_LogicalDisk -Filter ("DeviceID='{0}'" -f $driveId) -ErrorAction Stop }
        catch { $logicalDisk = $null }
        if ($null -ne $logicalDisk -and [Int32]$logicalDisk.DriveType -eq 4) {
            $isNetwork = $true
            $providerName = [String]$logicalDisk.ProviderName
            if (-not (Test-ATEMStringBlank $providerName)) {
                $relativePath = $fullPath.Substring(3)
                $uncPath = $providerName.TrimEnd([Char[]]@('\'))
                if (-not (Test-ATEMStringBlank $relativePath)) { $uncPath += '\' + $relativePath }
                if ([IO.File]::Exists($uncPath)) { $fullPath = $uncPath }
            }
        }
    }
    return @{ Path = $fullPath; IsNetwork = $isNetwork }
}

function Get-ATEMWorkbookProfile {
    param([String]$Path)
    $excel = $null
    $workbook = $null
    $worksheets = $null
    $profile = @{ SyncMode = 'Unknown'; WorksheetName = ''; HeaderRow = 1 }
    try {
        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $false
        $excel.DisplayAlerts = $false
        $workbook = $excel.Workbooks.Open($Path, 0, $true)
        $worksheets = $workbook.Worksheets
        $sheetIndex = 1
        while ($true) {
            $worksheet = $null
            $usedRange = $null
            $detectedMode = 'Unknown'
            $detectedRow = 1
            $detectedName = ''
            try { $worksheet = $worksheets.Item($sheetIndex) }
            catch { break }
            try {
                $detectedName = [String]$worksheet.Name
                $usedRange = $worksheet.UsedRange
                $values = $usedRange.Value2
                $dimensions = Get-ATEMExcelMatrixDimensions $values
                $rowCount = [Int32]$dimensions.RowCount
                $columnCount = [Int32]$dimensions.ColumnCount
                $maxRows = [Math]::Min(30, $rowCount)
                $maxColumns = [Math]::Min(40, $columnCount)
                for ($row = 1; $row -le $maxRows; $row++) {
                    $headers = @{}
                    for ($column = 1; $column -le $maxColumns; $column++) {
                        if ($rowCount -eq 1 -and $columnCount -eq 1) { $value = $values }
                        else { $value = $values.GetValue($row, $column) }
                        $key = ConvertTo-ATEMNormalizedKey $value
                        if (-not [String]::IsNullOrEmpty($key)) { $headers[$key] = $true }
                    }
                    $hasPat = $headers.ContainsKey('PAT') -or $headers.ContainsKey('NOVO PAT')
                    $hasDescription = $headers.ContainsKey('DESCRICAO MARCA') -or $headers.ContainsKey('DESCRICAO')
                    $hasCalibrationDue = $headers.ContainsKey('PROXIMA CALIBRACAO') -or $headers.ContainsKey('VENCIMENTO CALIBRACAO')
                    if ($hasPat -and $hasDescription -and $hasCalibrationDue) {
                        $detectedMode = 'Analyzers'
                        $detectedRow = [Int32]$usedRange.Row + $row - 1
                        break
                    }
                    $hasAppointmentDate = $headers.ContainsKey('DATA') -or $headers.ContainsKey('DATA ATENDIMENTO')
                    $hasAppointmentName = $headers.ContainsKey('CLIENTE') -or $headers.ContainsKey('HOSPITAL') -or $headers.ContainsKey('ATENDIMENTO') -or $headers.ContainsKey('TITULO')
                    if ($hasAppointmentDate -and $hasAppointmentName -and $detectedMode -eq 'Unknown') {
                        $detectedMode = 'Appointments'
                        $detectedRow = [Int32]$usedRange.Row + $row - 1
                    }
                }
            }
            finally {
                Release-ATEMComObject $usedRange
                Release-ATEMComObject $worksheet
            }
            if ($detectedMode -eq 'Analyzers') {
                return @{ SyncMode = $detectedMode; WorksheetName = $detectedName; HeaderRow = $detectedRow }
            }
            if ($detectedMode -eq 'Appointments' -and $profile.SyncMode -eq 'Unknown') {
                $profile = @{ SyncMode = $detectedMode; WorksheetName = $detectedName; HeaderRow = $detectedRow }
            }
            $sheetIndex++
        }
        return $profile
    }
    finally {
        if ($null -ne $workbook) { try { $workbook.Close($false) } catch { } }
        if ($null -ne $excel) { try { $excel.Quit() } catch { } }
        Release-ATEMComObject $worksheets
        Release-ATEMComObject $workbook
        Release-ATEMComObject $excel
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}

function Invoke-ATEMChildPowerShell {
    param([String[]]$Arguments)
    $powerShellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $powerShellPath $Arguments | Out-Host
    $exitCode = $LASTEXITCODE
    return $exitCode
}

if ($DetectOnly) {
    if (Test-ATEMStringBlank $DetectPath) { Write-Error 'Informe -DetectPath.'; exit 1 }
    $detectedPath = Resolve-ATEMExcelPath $DetectPath
    Write-Host (ConvertTo-ATEMJson (Get-ATEMWorkbookProfile ([String]$detectedPath.Path)))
    exit 0
}

try {
    Write-Host ''
    Write-Host 'ATEM Field - Instalacao do Watchdog Excel -> Supabase' -ForegroundColor Cyan
    Write-Host 'Este processo nao depende do backend Node nem do Google Agenda.'
    Write-Host 'Informe somente o arquivo e as credenciais; os demais parametros serao detectados automaticamente.'
    Write-Host ''

    $os = [Environment]::OSVersion.Version
    if ($os.Major -lt 6 -or ($os.Major -eq 6 -and $os.Minor -lt 1)) { throw 'Requer Windows 7 SP1 ou superior.' }
    if ($PSVersionTable.PSVersion.Major -lt 2) { throw 'Requer PowerShell 2.0 ou superior.' }
    if ($os.Major -eq 6 -and $os.Minor -eq 1) {
        $operatingSystem = Get-WmiObject Win32_OperatingSystem
        if ([Int32]$operatingSystem.ServicePackMajorVersion -lt 1) { throw 'Instale o Service Pack 1 do Windows 7.' }
    }
    try { [void](ConvertTo-ATEMJson @{ test = $true }) }
    catch { throw 'O componente System.Web.Extensions do .NET 3.5 nao esta disponivel.' }
    if (-not (Test-ATEMExcelInstallation)) { throw 'Microsoft Excel nao foi encontrado. A leitura nativa da planilha usa a automacao COM do Excel.' }

    $requestedExcelPath = Read-ATEMValue 'Caminho completo da planilha Excel' ''
    $resolvedExcelPath = Resolve-ATEMExcelPath $requestedExcelPath
    $excelPath = [String]$resolvedExcelPath.Path
    $isNetworkPath = [Boolean]$resolvedExcelPath.IsNetwork
    if ($excelPath -ne $requestedExcelPath.Trim().Trim('"').Trim("'")) {
        Write-Host ("Caminho persistente detectado: {0}" -f $excelPath) -ForegroundColor DarkGray
    }
    $extension = [IO.Path]::GetExtension($excelPath).ToLowerInvariant()
    if (@('.xlsx', '.xlsm', '.xls', '.xlsb') -notcontains $extension) { throw 'Use uma planilha .xlsx, .xlsm, .xls ou .xlsb.' }

    $installationStage = 'analise da estrutura da planilha'
    Write-Host 'Analisando a estrutura da planilha...' -ForegroundColor DarkGray
    $profile = Get-ATEMWorkbookProfile $excelPath
    $syncMode = [String]$profile.SyncMode
    if ($syncMode -eq 'Unknown') {
        throw 'O layout da planilha nao foi reconhecido. Para calibracao, sao necessarios os cabecalhos PAT, Descricao / Marca e Proxima calibracao.'
    }
    $modeLabel = 'agenda de atendimentos'
    if ($syncMode -eq 'Analyzers') { $modeLabel = 'controle de calibracao de padroes/analisadores' }
    $worksheetName = [String]$profile.WorksheetName
    $headerRow = [Int32]$profile.HeaderRow
    if (Test-ATEMStringBlank $worksheetName -or $headerRow -lt 1) { throw 'A aba ou a linha do cabecalho nao puderam ser identificadas automaticamente.' }
    Write-Host ("OK - layout: {0}" -f $modeLabel) -ForegroundColor Green
    Write-Host ("OK - aba: {0}" -f $worksheetName) -ForegroundColor Green
    Write-Host ("OK - cabecalho: linha {0}" -f $headerRow) -ForegroundColor Green

    $sourceId = 'CALIBRATION-ASSETS'
    $defaultAnalyzerLocation = 'Matriz'
    if ($syncMode -eq 'Appointments') { $sourceId = 'AGENDA-LOCAL' }
    $pollSeconds = 30
    $stableSeconds = 10
    if ($isNetworkPath) {
        $pollSeconds = 60
        $stableSeconds = 15
    }
    $retrySeconds = 60
    Write-Host ("OK - monitoramento: verificacao a cada {0}s, estabilidade de {1}s" -f $pollSeconds, $stableSeconds) -ForegroundColor Green

    $backendEnvPath = Join-Path $projectDirectory 'backend\.env'
    $envValues = Read-ATEMEnvFile $backendEnvPath
    $credentialPath = Join-Path $scriptDirectory 'watchdog.credential'
    $supabaseUrl = ''
    $serviceKey = ''
    $credentialSource = ''
    if ($envValues.ContainsKey('SUPABASE_URL')) { $supabaseUrl = [String]$envValues['SUPABASE_URL'] }
    if ($envValues.ContainsKey('SUPABASE_SERVICE_ROLE_KEY')) {
        $serviceKey = [String]$envValues['SUPABASE_SERVICE_ROLE_KEY']
        $credentialSource = 'backend/.env'
    }
    if ((Test-ATEMStringBlank $serviceKey) -and [IO.File]::Exists($credentialPath)) {
        try {
            $existingCredential = Unprotect-ATEMCredential $credentialPath
            $supabaseUrl = [String]$existingCredential.SupabaseUrl
            $serviceKey = [String]$existingCredential.ServiceKey
            $credentialSource = 'credencial protegida existente'
        }
        catch { Write-Host 'A credencial existente nao pode ser reutilizada; informe-a novamente.' -ForegroundColor Yellow }
    }

    $supabaseUrl = (Read-ATEMValue 'URL do projeto Supabase' $supabaseUrl).Trim().TrimEnd([Char[]]@('/'))
    if (Test-ATEMStringBlank $serviceKey) {
        $secureKey = Read-Host 'Service role key do Supabase (entrada protegida)' -AsSecureString
        $serviceKey = (ConvertFrom-ATEMSecureString $secureKey).Trim()
    }
    else { Write-Host ("Service role key carregada de {0}." -f $credentialSource) -ForegroundColor DarkGray }
    if (-not $supabaseUrl.StartsWith('https://')) { throw 'A URL do Supabase deve comecar com https://.' }
    if (Test-ATEMStringBlank $serviceKey) { throw 'A service role key nao foi informada.' }

    Protect-ATEMCredential @{ SupabaseUrl = $supabaseUrl; ServiceKey = $serviceKey } $credentialPath
    $serviceKey = $null

    $configurationPath = Join-Path $scriptDirectory 'watchdog.config.ps1'
    $configurationText = @"
# Gerado por setup-watchdog.ps1. Nao armazena segredos.
@{
    SyncMode = '$(Escape-ATEMPowerShellLiteral $syncMode)'
    ExcelPath = '$(Escape-ATEMPowerShellLiteral ([IO.Path]::GetFullPath($excelPath)))'
    WorksheetName = '$(Escape-ATEMPowerShellLiteral $worksheetName)'
    HeaderRow = $headerRow
    SourceId = '$(Escape-ATEMPowerShellLiteral $sourceId)'
    DefaultAnalyzerLocation = '$(Escape-ATEMPowerShellLiteral $defaultAnalyzerLocation)'
    PollSeconds = $pollSeconds
    StableSeconds = $stableSeconds
    RetrySeconds = $retrySeconds
    SyncTechnicians = `$true
    SyncEquipments = `$true
    MarkMissingAsCancelled = `$false
    CredentialPath = 'watchdog.credential'
    LogPath = 'logs\watchdog.log'
    StatePath = 'state'
}
"@
    [IO.File]::WriteAllText($configurationPath, $configurationText, (New-Object Text.UTF8Encoding($true)))

    Write-Host ''
    $installationStage = 'teste de acesso ao Supabase'
    Write-Host '1/2 Testando acesso ao Supabase...' -ForegroundColor Cyan
    $syncScript = Join-Path $scriptDirectory 'run-sync.ps1'
    $testArguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $syncScript, '-ConfigPath', $configurationPath, '-TestConnection')
    if ((Invoke-ATEMChildPowerShell $testArguments) -ne 0) { throw 'Falha no teste de conexao com o Supabase.' }

    Write-Host ''
    $installationStage = 'simulacao da leitura da planilha'
    Write-Host '2/2 Simulando a leitura completa (nenhum dado sera gravado)...' -ForegroundColor Cyan
    $dryRunArguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $syncScript, '-ConfigPath', $configurationPath, '-DryRun')
    if ((Invoke-ATEMChildPowerShell $dryRunArguments) -ne 0) { throw 'A simulacao falhou. Revise os cabecalhos da planilha e tente novamente.' }

    $installationStage = 'criacao da tarefa do Windows'
    Write-Host ''
    Write-Host 'Configuracao validada. Instalando e iniciando automaticamente...' -ForegroundColor Cyan
    $taskName = 'ATEM Field - Excel Supabase Watchdog'
    $launcherPath = Join-Path $scriptDirectory 'watchdog-start.vbs'
    $taskRun = 'wscript.exe //B //NoLogo "' + $launcherPath + '"'
    & schtasks.exe /Create /TN $taskName /SC ONLOGON /TR $taskRun /RL LIMITED /F
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel criar a tarefa no Agendador do Windows.' }

    $stateDirectory = Join-Path $scriptDirectory 'state'
    if (-not [IO.Directory]::Exists($stateDirectory)) { [void][IO.Directory]::CreateDirectory($stateDirectory) }
    $stopPath = Join-Path $stateDirectory 'stop.requested'
    if ([IO.File]::Exists($stopPath)) { [IO.File]::Delete($stopPath) }
    & schtasks.exe /Run /TN $taskName
    if ($LASTEXITCODE -ne 0) { throw 'A tarefa foi instalada, mas nao foi possivel inicia-la.' }

    Write-Host ''
    Write-Host 'OK - Watchdog instalado e iniciado.' -ForegroundColor Green
    Write-Host ("Log: {0}" -f (Join-Path $scriptDirectory 'logs\watchdog.log'))
}
catch {
    Write-Host ''
    Write-Host ('ERRO: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host ('Etapa: ' + $installationStage) -ForegroundColor Yellow
    exit 1
}
