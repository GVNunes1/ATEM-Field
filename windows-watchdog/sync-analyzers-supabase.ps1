param(
    [String]$ConfigPath = '',
    [Switch]$DryRun,
    [Switch]$TestConnection,
    [Switch]$SelfTest
)

# Compativel com Windows 7 SP1 e PowerShell 2.0.
Set-StrictMode -Version 2.0
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDirectory 'ATEM.Watchdog.Common.ps1')

function Get-CalibrationMatrixValue {
    param($Values, [Int32]$RowCount, [Int32]$ColumnCount, [Int32]$Row, [Int32]$Column)
    if ($RowCount -eq 1 -and $ColumnCount -eq 1) { return $Values }
    return $Values.GetValue($Row, $Column)
}

function ConvertTo-CalibrationDateString {
    param($Value)
    if (Test-ATEMStringBlank $Value) { return $null }
    if ($Value -is [Double] -or $Value -is [Decimal] -or $Value -is [Int32]) {
        try { return [DateTime]::FromOADate([Double]$Value).ToString('yyyy-MM-dd') }
        catch { }
    }
    $parsed = New-Object DateTime
    $cultures = @([Globalization.CultureInfo]::GetCultureInfo('pt-BR'), [Globalization.CultureInfo]::InvariantCulture)
    foreach ($culture in $cultures) {
        if ([DateTime]::TryParse([String]$Value, $culture, [Globalization.DateTimeStyles]::AllowWhiteSpaces, [ref]$parsed)) {
            return $parsed.ToString('yyyy-MM-dd')
        }
    }
    throw ("Data de calibracao invalida: '{0}'." -f $Value)
}

function Get-CalibrationColumnAliases {
    return @{
        AssetTag = @('PAT', 'NOVO PAT', 'PATRIMONIO', 'TAG', 'ASSET TAG')
        Name = @('DESCRICAO MARCA', 'DESCRICAO', 'NOME', 'EQUIPAMENTO', 'PADRAO')
        BrandModel = @('MODELO', 'MODELO EQUIPAMENTO')
        SerialNumber = @('N SERIE', 'NUMERO SERIE', 'SERIE', 'SERIAL', 'SN')
        CalibrationDate = @('DATA CALIBRACAO', 'ULTIMA CALIBRACAO', 'DATA DA CALIBRACAO')
        Certificate = @('N CERTIFICADO', 'NUMERO CERTIFICADO', 'CERTIFICADO')
        Executor = @('EXECUTOR', 'LABORATORIO', 'FORNECEDOR CALIBRACAO')
        CalibrationDue = @('PROXIMA CALIBRACAO', 'VENCIMENTO CALIBRACAO', 'VALIDADE CALIBRACAO', 'CALIBRACAO DEVIDA')
        ApprovedBy = @('APROVADO POR', 'APROVADOR')
        Location = @('LOCALIZACAO', 'LOCAL', 'UNIDADE')
        Periodicity = @('PERIODICIDADE', 'PERIODO CALIBRACAO')
        Exclusivity = @('EXCLUSIVIDADE DA MARCA', 'EXCLUSIVIDADE')
        Type = @('TIPO', 'TIPO DO PADRAO')
    }
}

function Resolve-CalibrationColumnMap {
    param($Values, [Int32]$RowCount, [Int32]$ColumnCount, [Int32]$HeaderIndex, $CustomColumnMap)
    $headers = @{}
    for ($column = 1; $column -le $ColumnCount; $column++) {
        $key = ConvertTo-ATEMNormalizedKey (Get-CalibrationMatrixValue $Values $RowCount $ColumnCount $HeaderIndex $column)
        if (-not [String]::IsNullOrEmpty($key) -and -not $headers.ContainsKey($key)) { $headers[$key] = $column }
    }
    $map = @{}
    $aliases = Get-CalibrationColumnAliases
    foreach ($field in $aliases.Keys) {
        foreach ($alias in $aliases[$field]) {
            $key = ConvertTo-ATEMNormalizedKey $alias
            if ($headers.ContainsKey($key)) { $map[$field] = [Int32]$headers[$key]; break }
        }
    }
    if ($null -ne $CustomColumnMap -and $CustomColumnMap -is [Collections.IDictionary]) {
        foreach ($field in $CustomColumnMap.Keys) {
            $key = ConvertTo-ATEMNormalizedKey $CustomColumnMap[$field]
            if ($headers.ContainsKey($key)) { $map[[String]$field] = [Int32]$headers[$key] }
        }
    }
    return $map
}

function Get-CalibrationHeaderRow {
    param($Worksheet)
    $usedRange = $null
    try {
        $usedRange = $Worksheet.UsedRange
        $values = $usedRange.Value2
        $dimensions = Get-ATEMExcelMatrixDimensions $values
        $rowCount = [Int32]$dimensions.RowCount
        $columnCount = [Int32]$dimensions.ColumnCount
        $maxRows = [Math]::Min(30, $rowCount)
        $maxColumns = [Math]::Min(40, $columnCount)
        for ($row = 1; $row -le $maxRows; $row++) {
            $headers = @{}
            for ($column = 1; $column -le $maxColumns; $column++) {
                $key = ConvertTo-ATEMNormalizedKey (Get-CalibrationMatrixValue $values $rowCount $columnCount $row $column)
                if (-not [String]::IsNullOrEmpty($key)) { $headers[$key] = $true }
            }
            $hasPat = $headers.ContainsKey('PAT') -or $headers.ContainsKey('NOVO PAT') -or $headers.ContainsKey('PATRIMONIO')
            $hasDescription = $headers.ContainsKey('DESCRICAO MARCA') -or $headers.ContainsKey('DESCRICAO') -or $headers.ContainsKey('EQUIPAMENTO') -or $headers.ContainsKey('PADRAO')
            $hasCalibrationDue = $headers.ContainsKey('PROXIMA CALIBRACAO') -or $headers.ContainsKey('VENCIMENTO CALIBRACAO') -or $headers.ContainsKey('VALIDADE CALIBRACAO')
            if ($hasPat -and $hasDescription -and $hasCalibrationDue) {
                return ([Int32]$usedRange.Row + $row - 1)
            }
        }
        return 0
    }
    finally { Release-ATEMComObject $usedRange }
}

function Resolve-CalibrationWorksheet {
    param($Workbook, [String]$RequestedName, [Int32]$ConfiguredHeaderRow, [String]$LogPath)
    $worksheets = $null
    try {
        $worksheets = $Workbook.Worksheets
        if (-not (Test-ATEMStringBlank $RequestedName)) {
            $requestedWorksheet = $null
            try { $requestedWorksheet = $worksheets.Item($RequestedName) }
            catch { $requestedWorksheet = $null }
            if ($null -ne $requestedWorksheet) {
                return @{ Worksheet = $requestedWorksheet; HeaderRow = $ConfiguredHeaderRow; Resolution = 'configured' }
            }

            $requestedKey = ConvertTo-ATEMNormalizedKey $RequestedName
            $sheetIndex = 1
            while ($true) {
                $candidate = $null
                try { $candidate = $worksheets.Item($sheetIndex) }
                catch { break }
                $candidateKey = ConvertTo-ATEMNormalizedKey ([String]$candidate.Name)
                if ($candidateKey -eq $requestedKey) {
                    Write-ATEMLog $LogPath ("Aba configurada encontrada por nome normalizado: '{0}'." -f [String]$candidate.Name) 'WARN'
                    return @{ Worksheet = $candidate; HeaderRow = $ConfiguredHeaderRow; Resolution = 'normalized-name' }
                }
                Release-ATEMComObject $candidate
                $sheetIndex++
            }
        }

        $availableNames = New-Object Collections.ArrayList
        $sheetIndex = 1
        while ($true) {
            $candidate = $null
            try { $candidate = $worksheets.Item($sheetIndex) }
            catch { break }
            $candidateName = [String]$candidate.Name
            [void]$availableNames.Add($candidateName)
            $detectedHeaderRow = Get-CalibrationHeaderRow $candidate
            if ($detectedHeaderRow -gt 0) {
                $requestedLabel = $RequestedName
                if (Test-ATEMStringBlank $requestedLabel) { $requestedLabel = '(nao informada)' }
                Write-ATEMLog $LogPath ("Aba '{0}' nao encontrada. Usando automaticamente '{1}', cabecalho na linha {2}." -f $requestedLabel, $candidateName, $detectedHeaderRow) 'WARN'
                return @{ Worksheet = $candidate; HeaderRow = $detectedHeaderRow; Resolution = 'headers' }
            }
            Release-ATEMComObject $candidate
            $sheetIndex++
        }

        $availableText = [String]::Join(', ', [String[]]$availableNames)
        if (Test-ATEMStringBlank $availableText) { $availableText = '(nenhuma aba encontrada)' }
        throw ("A aba '{0}' nao existe e nenhuma aba com os cabecalhos PAT, descricao e proxima calibracao foi localizada. Abas disponiveis: {1}." -f $RequestedName, $availableText)
    }
    finally { Release-ATEMComObject $worksheets }
}

function Get-CalibrationMappedValue {
    param($Values, [Int32]$RowCount, [Int32]$ColumnCount, $ColumnMap, [Int32]$Row, [String]$Field)
    if (-not $ColumnMap.ContainsKey($Field)) { return $null }
    return Get-CalibrationMatrixValue $Values $RowCount $ColumnCount $Row ([Int32]$ColumnMap[$Field])
}

function Get-CalibrationCellText {
    param($Worksheet, [Int32]$Row, [Int32]$Column)
    $cell = $null
    try {
        $cell = $Worksheet.Cells.Item($Row, $Column)
        return ([String]$cell.Text).Trim()
    }
    finally { Release-ATEMComObject $cell }
}

function Get-AnalyzerType {
    param([String]$ExplicitType, [String]$Name)
    if (-not (Test-ATEMStringBlank $ExplicitType)) { return $ExplicitType.Trim() }
    if ($Name.Contains('/')) {
        $candidate = $Name.Substring(0, $Name.IndexOf('/')).Trim()
        if (-not (Test-ATEMStringBlank $candidate)) { return $candidate }
    }
    return $Name.Trim()
}

function Get-AnalyzerNotes {
    param($Item)
    $parts = New-Object Collections.ArrayList
    [void]$parts.Add('Origem: PAT03-F1 Controle de Calibracao')
    if (-not (Test-ATEMStringBlank $Item.Certificate)) { [void]$parts.Add('Certificado: ' + [String]$Item.Certificate) }
    if (-not (Test-ATEMStringBlank $Item.Executor)) { [void]$parts.Add('Executor: ' + [String]$Item.Executor) }
    if (-not (Test-ATEMStringBlank $Item.ApprovedBy)) { [void]$parts.Add('Aprovado por: ' + [String]$Item.ApprovedBy) }
    if (-not (Test-ATEMStringBlank $Item.Periodicity)) { [void]$parts.Add('Periodicidade: ' + [String]$Item.Periodicity + ' ano(s)') }
    if (-not (Test-ATEMStringBlank $Item.Exclusivity)) { [void]$parts.Add('Exclusividade da marca: ' + [String]$Item.Exclusivity) }
    return [String]::Join(' | ', [String[]]$parts)
}

function Read-CalibrationAnalyzers {
    param([Parameter(Mandatory = $true)]$Configuration, [String]$LogPath)
    $excelPath = [Environment]::ExpandEnvironmentVariables([String]$Configuration.ExcelPath)
    if (-not [IO.File]::Exists($excelPath)) { throw ("Planilha nao encontrada: {0}" -f $excelPath) }

    $excel = $null
    $workbook = $null
    $worksheet = $null
    $usedRange = $null
    try {
        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $false
        $excel.DisplayAlerts = $false
        $workbook = $excel.Workbooks.Open($excelPath, 0, $true)
        $worksheetName = [String]$Configuration.WorksheetName
        $configuredHeaderRow = [Int32]$Configuration.HeaderRow
        $worksheetResolution = Resolve-CalibrationWorksheet $workbook $worksheetName $configuredHeaderRow $LogPath
        $worksheet = $worksheetResolution.Worksheet

        $usedRange = $worksheet.UsedRange
        $values = $usedRange.Value2
        $dimensions = Get-ATEMExcelMatrixDimensions $values
        $rowCount = [Int32]$dimensions.RowCount
        $columnCount = [Int32]$dimensions.ColumnCount
        $usedStartRow = [Int32]$usedRange.Row
        $usedStartColumn = [Int32]$usedRange.Column
        $headerRow = [Int32]$worksheetResolution.HeaderRow
        $headerIndex = $headerRow - $usedStartRow + 1
        if ($headerIndex -lt 1 -or $headerIndex -gt $rowCount) { throw ("A linha de cabecalho {0} esta fora da area usada." -f $headerRow) }

        $customMap = $null
        if ($Configuration.ContainsKey('AnalyzerColumnMap')) { $customMap = $Configuration.AnalyzerColumnMap }
        $columnMap = Resolve-CalibrationColumnMap $values $rowCount $columnCount $headerIndex $customMap
        foreach ($required in @('AssetTag', 'Name')) {
            if (-not $columnMap.ContainsKey($required)) { throw ("Coluna obrigatoria nao encontrada: {0}." -f $required) }
        }

        $defaultLocation = 'Matriz'
        if ($Configuration.ContainsKey('DefaultAnalyzerLocation') -and -not (Test-ATEMStringBlank $Configuration.DefaultAnalyzerLocation)) {
            $defaultLocation = [String]$Configuration.DefaultAnalyzerLocation
        }
        $items = New-Object Collections.ArrayList
        $assetTags = @{}
        $skipped = 0

        for ($row = $headerIndex + 1; $row -le $rowCount; $row++) {
            $sheetRow = $usedStartRow + $row - 1
            $name = ([String](Get-CalibrationMappedValue $values $rowCount $columnCount $columnMap $row 'Name')).Trim()
            $assetColumn = $usedStartColumn + [Int32]$columnMap['AssetTag'] - 1
            $assetTag = (Get-CalibrationCellText $worksheet $sheetRow $assetColumn).ToUpperInvariant()
            if ((Test-ATEMStringBlank $name) -and (Test-ATEMStringBlank $assetTag)) { continue }
            if ((Test-ATEMStringBlank $name) -or (Test-ATEMStringBlank $assetTag) -or $assetTag -match '^-+$') {
                $skipped++
                Write-ATEMLog $LogPath ("Linha {0} ignorada: PAT ou descricao ausente." -f $sheetRow) 'WARN'
                continue
            }
            if ($assetTags.ContainsKey($assetTag)) {
                throw ("PAT duplicado na planilha: {0}, linhas {1} e {2}." -f $assetTag, $assetTags[$assetTag], $sheetRow)
            }
            $assetTags[$assetTag] = $sheetRow

            $serialNumber = ''
            if ($columnMap.ContainsKey('SerialNumber')) {
                $serialColumn = $usedStartColumn + [Int32]$columnMap['SerialNumber'] - 1
                $serialNumber = Get-CalibrationCellText $worksheet $sheetRow $serialColumn
            }
            $location = ([String](Get-CalibrationMappedValue $values $rowCount $columnCount $columnMap $row 'Location')).Trim()
            if (Test-ATEMStringBlank $location) { $location = $defaultLocation }
            $explicitType = [String](Get-CalibrationMappedValue $values $rowCount $columnCount $columnMap $row 'Type')

            [void]$items.Add(@{
                SheetRow = $sheetRow
                AssetTag = $assetTag
                Name = $name
                Type = Get-AnalyzerType $explicitType $name
                BrandModel = ([String](Get-CalibrationMappedValue $values $rowCount $columnCount $columnMap $row 'BrandModel')).Trim()
                SerialNumber = $serialNumber
                CalibrationDate = ConvertTo-CalibrationDateString (Get-CalibrationMappedValue $values $rowCount $columnCount $columnMap $row 'CalibrationDate')
                CalibrationDue = ConvertTo-CalibrationDateString (Get-CalibrationMappedValue $values $rowCount $columnCount $columnMap $row 'CalibrationDue')
                Certificate = ([String](Get-CalibrationMappedValue $values $rowCount $columnCount $columnMap $row 'Certificate')).Trim()
                Executor = ([String](Get-CalibrationMappedValue $values $rowCount $columnCount $columnMap $row 'Executor')).Trim()
                ApprovedBy = ([String](Get-CalibrationMappedValue $values $rowCount $columnCount $columnMap $row 'ApprovedBy')).Trim()
                Location = $location
                Periodicity = ([String](Get-CalibrationMappedValue $values $rowCount $columnCount $columnMap $row 'Periodicity')).Trim()
                Exclusivity = ([String](Get-CalibrationMappedValue $values $rowCount $columnCount $columnMap $row 'Exclusivity')).Trim()
            })
        }
        return @{ Items = @($items); Skipped = $skipped }
    }
    finally {
        if ($null -ne $workbook) { try { $workbook.Close($false) } catch { } }
        if ($null -ne $excel) { try { $excel.Quit() } catch { } }
        Release-ATEMComObject $usedRange
        Release-ATEMComObject $worksheet
        Release-ATEMComObject $workbook
        Release-ATEMComObject $excel
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}

function Resolve-AnalyzerCategoryId {
    param([String]$Name, $CategoryByHint)
    $key = ConvertTo-ATEMNormalizedKey $Name
    $rules = @(
        @{ Hint = 'DESFIBRILADOR'; Terms = @('DESFIBRIL', 'CARDIOVERS') },
        @{ Hint = 'MONITOR'; Terms = @('MONITOR', 'SIMULADOR DE PACIENTE', 'SINAIS VITAIS', ' ECG') },
        @{ Hint = 'VENTILADOR'; Terms = @('FLUXO', 'VENTIL', 'RESPIRADOR') },
        @{ Hint = 'BOMBA'; Terms = @('BOMBA', 'INFUSAO') },
        @{ Hint = 'ULTRASSOM'; Terms = @('ULTRASS') },
        @{ Hint = 'AUTOCLAVE'; Terms = @('AUTOCLAVE', 'ESTERIL') },
        @{ Hint = 'BISTURI'; Terms = @('ELETROCIR', 'BISTURI') }
    )
    foreach ($rule in $rules) {
        $matched = $false
        foreach ($term in $rule.Terms) { if ($key.Contains([String]$term)) { $matched = $true; break } }
        if ($matched -and $CategoryByHint.ContainsKey([String]$rule.Hint)) { return [Int32]$CategoryByHint[[String]$rule.Hint] }
    }
    return $null
}

function Invoke-AnalyzerUpsertBatches {
    param($Credential, $Rows)
    $index = 0
    while ($index -lt $Rows.Count) {
        $count = [Math]::Min(100, $Rows.Count - $index)
        $batch = New-Object Collections.ArrayList
        for ($offset = 0; $offset -lt $count; $offset++) { [void]$batch.Add($Rows[$index + $offset]) }
        [void](Invoke-ATEMSupabaseRequest $Credential 'POST' 'analyzers?on_conflict=asset_tag' @($batch) 'resolution=merge-duplicates,return=minimal')
        $index += $count
    }
}

function Invoke-AnalyzerSynchronization {
    param($Configuration, $Credential, [Switch]$Simulation, [String]$LogPath)
    $readResult = Read-CalibrationAnalyzers $Configuration $LogPath
    $items = @($readResult.Items)
    if ($items.Count -eq 0) { throw 'Nenhum padrao/analisador valido foi encontrado na planilha.' }
    Write-ATEMLog $LogPath ("Planilha de calibracao lida: {0} padrao(oes); ignorados={1}." -f $items.Count, $readResult.Skipped)

    $existingRows = @(Get-ATEMRestItems (Invoke-ATEMSupabaseRequest $Credential 'GET' 'analyzers?select=id,asset_tag,status&limit=1000'))
    $categoryRows = @(Get-ATEMRestItems (Invoke-ATEMSupabaseRequest $Credential 'GET' 'equipment_categories?select=id,name&limit=1000'))
    $existingByTag = @{}
    foreach ($row in $existingRows) { $existingByTag[([String]$row['asset_tag']).Trim().ToUpperInvariant()] = $row }
    $categoryByHint = @{}
    foreach ($row in $categoryRows) {
        $nameKey = ConvertTo-ATEMNormalizedKey $row['name']
        foreach ($hint in @('DESFIBRILADOR', 'MONITOR', 'VENTILADOR', 'BOMBA', 'ULTRASSOM', 'AUTOCLAVE', 'BISTURI')) {
            if ($nameKey.Contains($hint) -and -not $categoryByHint.ContainsKey($hint)) { $categoryByHint[$hint] = [Int32]$row['id'] }
        }
    }

    $created = 0
    $updated = 0
    $categorized = 0
    $withoutCategory = New-Object Collections.ArrayList
    $withCategory = New-Object Collections.ArrayList
    foreach ($item in $items) {
        if ($existingByTag.ContainsKey([String]$item.AssetTag)) { $updated++ } else { $created++ }
        $payload = @{
            asset_tag = [String]$item.AssetTag
            name = [String]$item.Name
            type = [String]$item.Type
            serial_number = [String]$item.SerialNumber
            brand_model = [String]$item.BrandModel
            calibration_date = $item.CalibrationDate
            calibration_expiry = $item.CalibrationDue
            calibration_due = $item.CalibrationDue
            current_location = [String]$item.Location
            notes = Get-AnalyzerNotes $item
        }
        $categoryId = Resolve-AnalyzerCategoryId ([String]$item.Name) $categoryByHint
        if ($null -ne $categoryId) {
            $payload['category_id'] = [Int32]$categoryId
            [void]$withCategory.Add($payload)
            $categorized++
        }
        else { [void]$withoutCategory.Add($payload) }
    }

    if (-not $Simulation) {
        if ($withoutCategory.Count -gt 0) { Invoke-AnalyzerUpsertBatches $Credential $withoutCategory }
        if ($withCategory.Count -gt 0) { Invoke-AnalyzerUpsertBatches $Credential $withCategory }
    }

    $result = @{
        Success = $true
        DryRun = [Boolean]$Simulation
        AnalyzersRead = $items.Count
        Created = $created
        Updated = $updated
        Categorized = $categorized
        WithoutCategory = $items.Count - $categorized
        Skipped = [Int32]$readResult.Skipped
    }
    Write-ATEMLog $LogPath ("Sincronizacao de padroes concluida. Lidos={0}; novos={1}; atualizados={2}; categorizados={3}; ignorados={4}; simulacao={5}." -f $items.Count, $created, $updated, $categorized, $readResult.Skipped, [Boolean]$Simulation)
    return $result
}

function Invoke-AnalyzerSelfTest {
    $failures = New-Object Collections.ArrayList
    if ((ConvertTo-CalibrationDateString 45644) -ne '2024-12-18') { [void]$failures.Add('data Excel') }
    if ((Get-AnalyzerType '' 'Analisador de Fluxo / TSI') -ne 'Analisador de Fluxo') { [void]$failures.Add('tipo do padrao') }
    $notes = Get-AnalyzerNotes @{ Certificate = 'ABC'; Executor = 'LAB'; ApprovedBy = ''; Periodicity = '2'; Exclusivity = '' }
    if (-not $notes.Contains('Certificado: ABC')) { [void]$failures.Add('notas') }
    $rows = New-Object Collections.ArrayList
    [void]$rows.Add(@{ asset_tag = '000001'; name = 'Padrao' })
    if (-not (ConvertTo-ATEMJson @($rows)).StartsWith('[')) { [void]$failures.Add('JSON em lote') }
    if ($failures.Count -gt 0) { throw ('Autoteste de padroes falhou: ' + [String]::Join(', ', [String[]]$failures)) }
    Write-Host 'OK - autoteste de padroes aprovado.'
}

$syncMutex = $null
$hasMutex = $false
try {
    if ($SelfTest) { Invoke-AnalyzerSelfTest; exit 0 }
    if (Test-ATEMStringBlank $ConfigPath) { $ConfigPath = Join-Path $scriptDirectory 'watchdog.config.ps1' }
    $configuration = Get-ATEMConfiguration $ConfigPath
    $credentialPath = [String]$configuration.CredentialPath
    if (-not [IO.Path]::IsPathRooted($credentialPath)) { $credentialPath = Join-Path $scriptDirectory $credentialPath }
    $credential = Unprotect-ATEMCredential $credentialPath
    $logPath = [String]$configuration.LogPath
    if (-not [IO.Path]::IsPathRooted($logPath)) { $logPath = Join-Path $scriptDirectory $logPath }

    $syncMutex = New-Object Threading.Mutex($false, 'Global\ATEMFieldExcelSupabaseSync')
    $hasMutex = $syncMutex.WaitOne(0, $false)
    if (-not $hasMutex) { throw 'Ja existe uma sincronizacao da planilha em andamento.' }

    if ($TestConnection) {
        $response = @(Get-ATEMRestItems (Invoke-ATEMSupabaseRequest $credential 'GET' 'analyzers?select=id&limit=1'))
        Write-Host ('OK - tabela analyzers acessivel. Linhas de teste retornadas: ' + $response.Count)
        exit 0
    }

    $result = Invoke-AnalyzerSynchronization -Configuration $configuration -Credential $credential -Simulation:$DryRun -LogPath $logPath
    Write-Host (ConvertTo-ATEMJson $result)
}
catch {
    $details = $_.Exception.Message
    if (-not (Test-ATEMStringBlank $_.ScriptStackTrace)) { $details += [Environment]::NewLine + $_.ScriptStackTrace }
    Write-Error $details
    exit 1
}
finally {
    if ($hasMutex -and $null -ne $syncMutex) { try { $syncMutex.ReleaseMutex() } catch { } }
    if ($null -ne $syncMutex) { $syncMutex.Close() }
}
