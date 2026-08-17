param(
    [String]$ConfigPath = '',
    [Switch]$DryRun,
    [Switch]$TestConnection,
    [Switch]$SelfTest
)

# Não usar recursos posteriores ao PowerShell 2.0 neste arquivo.
Set-StrictMode -Version 2.0
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptDirectory 'ATEM.Watchdog.Common.ps1')

function Get-WorksheetValue {
    param($Values, [Int32]$RowCount, [Int32]$ColumnCount, [Int32]$Row, [Int32]$Column)
    if ($RowCount -eq 1 -and $ColumnCount -eq 1) { return $Values }
    return $Values.GetValue($Row, $Column)
}

function ConvertTo-ExcelDateString {
    param($Value)
    if (Test-ATEMStringBlank $Value) { return '' }
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
    throw "Data inválida na planilha: '$Value'."
}

function ConvertTo-ExcelTimeString {
    param($Value)
    if (Test-ATEMStringBlank $Value) { return '08:00' }
    if ($Value -is [Double] -or $Value -is [Decimal]) {
        try { return [DateTime]::FromOADate([Double]$Value).ToString('HH:mm') }
        catch { }
    }
    $parsed = New-Object DateTime
    $cultures = @([Globalization.CultureInfo]::GetCultureInfo('pt-BR'), [Globalization.CultureInfo]::InvariantCulture)
    foreach ($culture in $cultures) {
        if ([DateTime]::TryParse([String]$Value, $culture, [Globalization.DateTimeStyles]::AllowWhiteSpaces, [ref]$parsed)) {
            return $parsed.ToString('HH:mm')
        }
    }
    throw "Horário inválido na planilha: '$Value'."
}

function Get-ColumnAliases {
    return @{
        ExternalId = @('ID', 'ID EXTERNO', 'CODIGO', 'CODIGO ATENDIMENTO', 'ID EVENTO', 'CHAVE')
        Title = @('TITULO', 'SERVICO', 'EVENTO', 'ATENDIMENTO', 'ASSUNTO', 'DESCRICAO')
        ClientName = @('CLIENTE', 'NOME CLIENTE', 'HOSPITAL', 'UNIDADE', 'LOCAL')
        ClientAddress = @('ENDERECO', 'ENDERECO CLIENTE', 'LOCALIZACAO', 'ENDERECO DO CLIENTE')
        ClientContact = @('CONTATO', 'CONTATO CLIENTE', 'TELEFONE', 'RESPONSAVEL CLIENTE')
        AppointmentDate = @('DATA', 'DATA ATENDIMENTO', 'DIA', 'DATA DO ATENDIMENTO')
        AppointmentTime = @('HORA', 'HORARIO', 'HORA INICIO', 'INICIO', 'HORARIO ATENDIMENTO')
        Technicians = @('TECNICO', 'TECNICOS', 'RESPONSAVEL', 'EQUIPE', 'TECNICO RESPONSAVEL')
        Status = @('STATUS', 'SITUACAO', 'SITUACAO ATENDIMENTO')
        EquipmentName = @('EQUIPAMENTO', 'EQUIPAMENTO CLIENTE', 'DESCRICAO EQUIPAMENTO')
        Category = @('CATEGORIA', 'TIPO EQUIPAMENTO', 'CATEGORIA EQUIPAMENTO')
        Model = @('MODELO', 'MODELO EQUIPAMENTO')
        SerialNumber = @('SERIAL', 'NUMERO SERIE', 'N SERIE', 'SN')
        Sector = @('SETOR', 'DEPARTAMENTO', 'LOCAL EQUIPAMENTO')
        Tag = @('TAG', 'PATRIMONIO CLIENTE', 'PATRIMONIO EQUIPAMENTO')
    }
}

function Resolve-ColumnMap {
    param($Values, [Int32]$RowCount, [Int32]$ColumnCount, [Int32]$HeaderRow, $CustomColumnMap)
    $normalizedHeaders = @{}
    for ($column = 1; $column -le $ColumnCount; $column++) {
        $header = Get-WorksheetValue $Values $RowCount $ColumnCount $HeaderRow $column
        $normalized = ConvertTo-ATEMNormalizedKey $header
        if (-not [String]::IsNullOrEmpty($normalized) -and -not $normalizedHeaders.ContainsKey($normalized)) {
            $normalizedHeaders[$normalized] = $column
        }
    }

    $columnMap = @{}
    $aliases = Get-ColumnAliases
    foreach ($field in $aliases.Keys) {
        foreach ($alias in $aliases[$field]) {
            $normalizedAlias = ConvertTo-ATEMNormalizedKey $alias
            if ($normalizedHeaders.ContainsKey($normalizedAlias)) {
                $columnMap[$field] = [Int32]$normalizedHeaders[$normalizedAlias]
                break
            }
        }
    }
    if ($null -ne $CustomColumnMap -and $CustomColumnMap -is [Collections.IDictionary]) {
        foreach ($field in $CustomColumnMap.Keys) {
            $customHeader = ConvertTo-ATEMNormalizedKey $CustomColumnMap[$field]
            if (-not [String]::IsNullOrEmpty($customHeader) -and $normalizedHeaders.ContainsKey($customHeader)) {
                $columnMap[[String]$field] = [Int32]$normalizedHeaders[$customHeader]
            }
        }
    }
    return $columnMap
}

function Get-MappedValue {
    param($Values, [Int32]$RowCount, [Int32]$ColumnCount, $ColumnMap, [Int32]$Row, [String]$Field)
    if (-not $ColumnMap.ContainsKey($Field)) { return $null }
    return Get-WorksheetValue $Values $RowCount $ColumnCount $Row ([Int32]$ColumnMap[$Field])
}

function Get-SourceKey {
    param([String]$SourceId)
    $source = (ConvertTo-ATEMNormalizedKey $SourceId).Replace(' ', '-')
    if ([String]::IsNullOrEmpty($source)) { throw 'SourceId invalido na configuracao.' }
    if ($source.Length -gt 30) { $source = $source.Substring(0, 30) }
    return $source
}

function New-ExternalId {
    param([String]$SourceId, $RawId, [String]$Identity)
    $source = Get-SourceKey $SourceId
    $raw = ''
    if ($null -ne $RawId) { $raw = ([String]$RawId).Trim() }
    if (-not [String]::IsNullOrEmpty($raw)) {
        $safeRaw = [Regex]::Replace($raw, '[^A-Za-z0-9_.-]+', '-')
        $safeRaw = $safeRaw.Trim([Char[]]@('-', '.'))
        if ([String]::IsNullOrEmpty($safeRaw) -or $safeRaw.Length -gt 80) { $safeRaw = (Get-ATEMSha256 $raw).Substring(0, 32) }
        return "EXCEL-$source-$safeRaw"
    }
    return "EXCEL-$source-" + (Get-ATEMSha256 $Identity).Substring(0, 32)
}

function Read-ExcelAgenda {
    param([Parameter(Mandatory = $true)]$Configuration, [String]$LogPath)
    $excelPath = [Environment]::ExpandEnvironmentVariables([String]$Configuration.ExcelPath)
    if (-not [IO.File]::Exists($excelPath)) { throw "Planilha não encontrada: $excelPath" }

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
        if (Test-ATEMStringBlank $worksheetName) { $worksheet = $workbook.Worksheets.Item(1) }
        else {
            try { $worksheet = $workbook.Worksheets.Item($worksheetName) }
            catch { throw "A aba '$worksheetName' não existe em $excelPath." }
        }
        $usedRange = $worksheet.UsedRange
        $values = $usedRange.Value2
        $dimensions = Get-ATEMExcelMatrixDimensions $values
        $rowCount = [Int32]$dimensions.RowCount
        $columnCount = [Int32]$dimensions.ColumnCount
        $headerRow = [Int32]$Configuration.HeaderRow
        $usedStartRow = [Int32]$usedRange.Row
        $headerIndex = $headerRow - $usedStartRow + 1
        if ($headerIndex -lt 1 -or $headerIndex -gt $rowCount) { throw ("A linha de cabecalho {0} esta fora da area usada da planilha." -f $headerRow) }
        if ($rowCount -le $headerIndex) { throw 'A planilha não possui linhas de dados após o cabeçalho.' }

        $customColumnMap = $null
        if ($Configuration.ContainsKey('ColumnMap')) { $customColumnMap = $Configuration.ColumnMap }
        $columnMap = Resolve-ColumnMap $values $rowCount $columnCount $headerIndex $customColumnMap
        if (-not $columnMap.ContainsKey('AppointmentDate')) { throw "Coluna obrigatória de data não encontrada. Use um cabeçalho como 'Data' ou 'Data Atendimento'." }
        if (-not $columnMap.ContainsKey('ClientName') -and -not $columnMap.ContainsKey('Title')) {
            throw "Informe uma coluna 'Cliente', 'Hospital', 'Título' ou 'Atendimento'."
        }
        $hasEquipmentColumns = $columnMap.ContainsKey('EquipmentName') -or $columnMap.ContainsKey('Category') -or $columnMap.ContainsKey('Model') -or $columnMap.ContainsKey('SerialNumber')
        $groups = @{}

        for ($row = $headerIndex + 1; $row -le $rowCount; $row++) {
            $sheetRow = $usedStartRow + $row - 1
            $clientName = ([String](Get-MappedValue $values $rowCount $columnCount $columnMap $row 'ClientName')).Trim()
            $title = ([String](Get-MappedValue $values $rowCount $columnCount $columnMap $row 'Title')).Trim()
            $rawDate = Get-MappedValue $values $rowCount $columnCount $columnMap $row 'AppointmentDate'
            if ((Test-ATEMStringBlank $clientName) -and (Test-ATEMStringBlank $title) -and (Test-ATEMStringBlank $rawDate)) {
                continue
            }
            if (Test-ATEMStringBlank $clientName) { $clientName = $title }
            if (Test-ATEMStringBlank $title) { $title = $clientName }
            if (Test-ATEMStringBlank $clientName) { throw ("Linha {0}: cliente/titulo nao informado." -f $sheetRow) }

            $date = ConvertTo-ExcelDateString $rawDate
            if (Test-ATEMStringBlank $date) { throw ("Linha {0}: data nao informada." -f $sheetRow) }
            $rawTime = Get-MappedValue $values $rowCount $columnCount $columnMap $row 'AppointmentTime'
            if ((Test-ATEMStringBlank $rawTime) -and (([String]$rawDate).Contains(':') -or $rawDate -is [Double])) {
                $rawTime = $rawDate
            }
            $time = ConvertTo-ExcelTimeString $rawTime
            $address = ([String](Get-MappedValue $values $rowCount $columnCount $columnMap $row 'ClientAddress')).Trim()
            $contact = ([String](Get-MappedValue $values $rowCount $columnCount $columnMap $row 'ClientContact')).Trim()
            $technicians = ([String](Get-MappedValue $values $rowCount $columnCount $columnMap $row 'Technicians')).Trim()
            $status = ([String](Get-MappedValue $values $rowCount $columnCount $columnMap $row 'Status')).Trim()
            if (Test-ATEMStringBlank $status) { $status = 'Agendado' }
            $identity = "$date|$time|$clientName|$title"
            $externalId = New-ExternalId ([String]$Configuration.SourceId) (Get-MappedValue $values $rowCount $columnCount $columnMap $row 'ExternalId') $identity

            if (-not $groups.ContainsKey($externalId)) {
                $groups[$externalId] = @{
                    ExternalId = $externalId
                    Title = $title
                    ClientName = $clientName
                    ClientAddress = $address
                    ClientContact = $contact
                    AppointmentDate = $date
                    AppointmentTime = $time
                    TechniciansRaw = $technicians
                    Status = $status
                    Equipments = New-Object Collections.ArrayList
                    SourceRows = New-Object Collections.ArrayList
                    HasEquipmentColumns = $hasEquipmentColumns
                }
            }
            elseif ([String]$groups[$externalId].AppointmentDate -ne $date -or [String]$groups[$externalId].AppointmentTime -ne $time -or (ConvertTo-ATEMNormalizedKey $groups[$externalId].ClientName) -ne (ConvertTo-ATEMNormalizedKey $clientName)) {
                throw ("Linha {0}: o mesmo ID foi usado em atendimentos com data, hora ou cliente diferentes." -f $sheetRow)
            }
            elseif (-not (Test-ATEMStringBlank $technicians)) {
                $alreadyListed = $false
                $newTechnicianKey = ConvertTo-ATEMNormalizedKey $technicians
                foreach ($knownTechnician in [Regex]::Split([String]$groups[$externalId].TechniciansRaw, '(?i)\s+e\s+|[,;/&]+')) {
                    if ((ConvertTo-ATEMNormalizedKey $knownTechnician) -eq $newTechnicianKey) { $alreadyListed = $true; break }
                }
                if (-not $alreadyListed) {
                    if (Test-ATEMStringBlank $groups[$externalId].TechniciansRaw) { $groups[$externalId].TechniciansRaw = $technicians }
                    else { $groups[$externalId].TechniciansRaw = ([String]$groups[$externalId].TechniciansRaw) + '; ' + $technicians }
                }
            }
            [void]$groups[$externalId].SourceRows.Add($sheetRow)

            if ($hasEquipmentColumns) {
                $equipmentName = ([String](Get-MappedValue $values $rowCount $columnCount $columnMap $row 'EquipmentName')).Trim()
                $category = ([String](Get-MappedValue $values $rowCount $columnCount $columnMap $row 'Category')).Trim()
                $model = ([String](Get-MappedValue $values $rowCount $columnCount $columnMap $row 'Model')).Trim()
                $serial = ([String](Get-MappedValue $values $rowCount $columnCount $columnMap $row 'SerialNumber')).Trim()
                $sector = ([String](Get-MappedValue $values $rowCount $columnCount $columnMap $row 'Sector')).Trim()
                $tag = ([String](Get-MappedValue $values $rowCount $columnCount $columnMap $row 'Tag')).Trim()
                if (-not (Test-ATEMStringBlank ($equipmentName + $category + $model + $serial + $sector + $tag))) {
                    [void]$groups[$externalId].Equipments.Add(@{
                        EquipmentName = $equipmentName
                        Category = $category
                        Model = $model
                        SerialNumber = $serial
                        Sector = $sector
                        Tag = $tag
                    })
                }
            }
        }
        return @($groups.Values)
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

function Resolve-Technicians {
    param([String]$RawNames, $TechnicianByName)
    $ids = New-Object Collections.ArrayList
    $names = New-Object Collections.ArrayList
    $unknown = New-Object Collections.ArrayList
    if (Test-ATEMStringBlank $RawNames) {
        return @{ Ids = @(); Names = @(); Unknown = @() }
    }
    $parts = [Regex]::Split($RawNames, '(?i)\s+e\s+|[,;/&]+')
    foreach ($part in $parts) {
        $trimmed = $part.Trim()
        if ((Test-ATEMStringBlank $trimmed) -or $trimmed -match '(?i)^equipe de campo$') { continue }
        $key = ConvertTo-ATEMNormalizedKey $trimmed
        if ($TechnicianByName.ContainsKey($key)) {
            $technician = $TechnicianByName[$key]
            if (-not $ids.Contains([Int32]$technician['id'])) {
                [void]$ids.Add([Int32]$technician['id'])
                [void]$names.Add([String]$technician['name'])
            }
        }
        else { [void]$unknown.Add($trimmed) }
    }
    return @{ Ids = @($ids); Names = @($names); Unknown = @($unknown) }
}

function Resolve-CategoryId {
    param([String]$ExplicitCategory, [String]$SearchText, $CategoryByName)
    $explicitKey = ConvertTo-ATEMNormalizedKey $ExplicitCategory
    if (-not [String]::IsNullOrEmpty($explicitKey)) {
        if ($CategoryByName.ContainsKey($explicitKey)) { return [Int32]$CategoryByName[$explicitKey]['id'] }
        foreach ($key in $CategoryByName.Keys) {
            if ($key.Contains($explicitKey) -or $explicitKey.Contains($key)) { return [Int32]$CategoryByName[$key]['id'] }
        }
    }
    $normalizedSearch = ConvertTo-ATEMNormalizedKey $SearchText
    $synonyms = @{
        'DESFIBRIL' = @('DESFIBRIL', 'CARDIOVERSOR', 'DEA')
        'BISTURI' = @('BISTURI', 'ELETROCIR')
        'VENTIL' = @('VENTILADOR', 'RESPIRADOR')
        'MONITOR' = @('MONITOR', 'MULTIPARAM')
        'BOMBA' = @('BOMBA', 'INFUSAO')
        'INCUB' = @('INCUBADORA')
    }
    foreach ($categoryHint in $synonyms.Keys) {
        $matched = $false
        foreach ($term in $synonyms[$categoryHint]) { if ($normalizedSearch.Contains($term)) { $matched = $true; break } }
        if ($matched) {
            foreach ($key in $CategoryByName.Keys) { if ($key.Contains($categoryHint)) { return [Int32]$CategoryByName[$key]['id'] } }
        }
    }
    return $null
}

function Get-FirstRestItem {
    param($Response)
    $items = @(Get-ATEMRestItems $Response)
    if ($items.Count -eq 0 -or $null -eq $items[0]) { return $null }
    return $items[0]
}

function Invoke-AgendaSynchronization {
    param($Configuration, $Credential, [Switch]$Simulation, [String]$LogPath)
    $appointments = @(Read-ExcelAgenda $Configuration $LogPath)
    Write-ATEMLog $LogPath ("Planilha lida: {0} atendimento(s) agrupado(s)." -f $appointments.Count)

    $sourcePrefix = 'EXCEL-' + (Get-SourceKey ([String]$Configuration.SourceId)) + '-*'
    $escapedPrefix = [Uri]::EscapeDataString($sourcePrefix)
    $existingResponse = Invoke-ATEMSupabaseRequest $Credential 'GET' ("appointments?select=id,external_id&external_id=like.$escapedPrefix")
    $technicianResponse = Invoke-ATEMSupabaseRequest $Credential 'GET' 'technicians?select=id,name,status&status=eq.Ativo'
    $categoryResponse = Invoke-ATEMSupabaseRequest $Credential 'GET' 'equipment_categories?select=id,name'

    $existingByExternalId = @{}
    foreach ($item in (Get-ATEMRestItems $existingResponse)) {
        if ($null -ne $item -and $item.ContainsKey('external_id')) { $existingByExternalId[[String]$item['external_id']] = $item }
    }
    $technicianByName = @{}
    foreach ($item in (Get-ATEMRestItems $technicianResponse)) {
        if ($null -ne $item) { $technicianByName[(ConvertTo-ATEMNormalizedKey $item['name'])] = $item }
    }
    $categoryByName = @{}
    foreach ($item in (Get-ATEMRestItems $categoryResponse)) {
        if ($null -ne $item) { $categoryByName[(ConvertTo-ATEMNormalizedKey $item['name'])] = $item }
    }

    $created = 0
    $updated = 0
    $equipmentCount = 0
    $linkCount = 0
    $warnings = 0
    $sourceIds = @{}

    foreach ($appointment in $appointments) {
        $externalId = [String]$appointment.ExternalId
        $sourceIds[$externalId] = $true
        $resolved = Resolve-Technicians ([String]$appointment.TechniciansRaw) $technicianByName
        if ($resolved.Unknown.Count -gt 0) {
            $warnings++
            Write-ATEMLog $LogPath ("{0}: técnico(s) não encontrado(s): {1}" -f $externalId, ([String]::Join(', ', [String[]]$resolved.Unknown))) 'WARN'
        }
        $technicianNames = [String]$appointment.TechniciansRaw
        if ($resolved.Names.Count -gt 0) { $technicianNames = [String]::Join(', ', [String[]]$resolved.Names) }
        if (Test-ATEMStringBlank $technicianNames) { $technicianNames = 'Equipe de Campo' }

        $clientAddress = [String]$appointment.ClientAddress
        if (Test-ATEMStringBlank $clientAddress) { $clientAddress = [String]$appointment.ClientName }
        $clientContact = [String]$appointment.ClientContact
        if (Test-ATEMStringBlank $clientContact) { $clientContact = 'Sincronizado da planilha local' }

        $payload = @{
            external_id = $externalId
            title = [String]$appointment.Title
            client_name = [String]$appointment.ClientName
            client_address = $clientAddress
            client_contact = $clientContact
            technician_names = $technicianNames
            technician_id = $null
            appointment_date = [String]$appointment.AppointmentDate
            appointment_time = [String]$appointment.AppointmentTime
            status = [String]$appointment.Status
        }
        if ($resolved.Ids.Count -gt 0) { $payload['technician_id'] = [Int32]$resolved.Ids[0] }

        $existing = $null
        if ($existingByExternalId.ContainsKey($externalId)) { $existing = $existingByExternalId[$externalId] }
        if ($Simulation) {
            if ($null -eq $existing) { $created++ } else { $updated++ }
            $equipmentCount += $appointment.Equipments.Count
            $linkCount += $resolved.Ids.Count
            continue
        }

        # external_id possui UNIQUE no schema. O upsert e atomico e torna repeticoes seguras.
        $saved = Get-FirstRestItem (Invoke-ATEMSupabaseRequest $Credential 'POST' 'appointments?on_conflict=external_id&select=id,external_id' $payload 'resolution=merge-duplicates,return=representation')
        if ($null -eq $existing) { $created++ } else { $updated++ }
        if ($null -eq $saved) { throw ("{0}: Supabase nao retornou o atendimento salvo." -f $externalId) }
        $savedId = [Int32]$saved['id']

        if ([Boolean]$Configuration.SyncTechnicians) {
            [void](Invoke-ATEMSupabaseRequest $Credential 'DELETE' ("appointment_technicians?appointment_id=eq.$savedId"))
            if ($resolved.Ids.Count -gt 0) {
                $junctionRows = New-Object Collections.ArrayList
                foreach ($technicianId in $resolved.Ids) {
                    [void]$junctionRows.Add(@{ appointment_id = $savedId; technician_id = [Int32]$technicianId })
                }
                [void](Invoke-ATEMSupabaseRequest $Credential 'POST' 'appointment_technicians' @($junctionRows) 'return=minimal')
                $linkCount += $resolved.Ids.Count
            }
        }

        if ([Boolean]$Configuration.SyncEquipments -and [Boolean]$appointment.HasEquipmentColumns) {
            [void](Invoke-ATEMSupabaseRequest $Credential 'DELETE' ("appointment_equipments?appointment_id=eq.$savedId"))
            if ($appointment.Equipments.Count -gt 0) {
                $equipmentRows = New-Object Collections.ArrayList
                foreach ($equipment in $appointment.Equipments) {
                    $searchText = ([String]$equipment.EquipmentName) + ' ' + ([String]$equipment.Model) + ' ' + ([String]$appointment.Title)
                    $categoryId = Resolve-CategoryId ([String]$equipment.Category) $searchText $categoryByName
                    $model = [String]$equipment.Model
                    if (Test-ATEMStringBlank $model) { $model = [String]$equipment.EquipmentName }
                    [void]$equipmentRows.Add(@{
                        appointment_id = $savedId
                        category_id = $categoryId
                        model = $model
                        serial_number = [String]$equipment.SerialNumber
                        sector = [String]$equipment.Sector
                        tag = [String]$equipment.Tag
                    })
                }
                [void](Invoke-ATEMSupabaseRequest $Credential 'POST' 'appointment_equipments' @($equipmentRows) 'return=minimal')
                $equipmentCount += $equipmentRows.Count
            }
        }
    }

    $cancelled = 0
    if ([Boolean]$Configuration.MarkMissingAsCancelled) {
        foreach ($externalId in $existingByExternalId.Keys) {
            if (-not $sourceIds.ContainsKey($externalId)) {
                if (-not $Simulation) {
                    $remoteId = [Int32]$existingByExternalId[$externalId]['id']
                    [void](Invoke-ATEMSupabaseRequest $Credential 'PATCH' ("appointments?id=eq.$remoteId") @{ status = 'Cancelado' } 'return=minimal')
                }
                $cancelled++
            }
        }
    }

    $result = @{
        Success = $true
        DryRun = [Boolean]$Simulation
        AppointmentsRead = $appointments.Count
        Created = $created
        Updated = $updated
        Cancelled = $cancelled
        TechnicianLinks = $linkCount
        Equipments = $equipmentCount
        Warnings = $warnings
    }
    Write-ATEMLog $LogPath ("Sincronização concluída. Lidos={0}; novos={1}; atualizados={2}; vínculos={3}; equipamentos={4}; avisos={5}; simulação={6}." -f $appointments.Count, $created, $updated, $linkCount, $equipmentCount, $warnings, [Boolean]$Simulation)
    return $result
}

function Invoke-ATEMSelfTest {
    $failures = New-Object Collections.ArrayList
    if ((ConvertTo-ATEMNormalizedKey 'Tecnico Responsavel') -ne 'TECNICO RESPONSAVEL') { [void]$failures.Add('normalizacao de cabecalho') }
    if ((ConvertTo-ExcelDateString '12/08/2026') -ne '2026-08-12') { [void]$failures.Add('conversao de data') }
    if ((ConvertTo-ExcelTimeString '07:30') -ne '07:30') { [void]$failures.Add('conversao de horario') }
    $first = New-ExternalId 'AGENDA LOCAL' 'ABC 123' 'x'
    $second = New-ExternalId 'AGENDA LOCAL' 'ABC 123' 'y'
    if ($first -ne $second -or -not $first.StartsWith('EXCEL-AGENDA-LOCAL-')) { [void]$failures.Add('ID idempotente') }
    $json = ConvertTo-ATEMJson @{ title = 'Clinica Sao Jose'; active = $true }
    if (-not $json.Contains('Clinica Sao Jose')) { [void]$failures.Add('JSON UTF-8') }
    $rows = New-Object Collections.ArrayList
    [void]$rows.Add(@{ appointment_id = 1; technician_id = 2 })
    $arrayJson = ConvertTo-ATEMJson @($rows)
    if (-not $arrayJson.StartsWith('[') -or -not $arrayJson.Contains('technician_id')) { [void]$failures.Add('JSON de lote') }
    if ($failures.Count -gt 0) { throw ('Autoteste falhou: ' + [String]::Join(', ', [String[]]$failures)) }
    Write-Host 'OK - autoteste nativo aprovado.'
}

$syncMutex = $null
$hasMutex = $false
try {
    if ($SelfTest) { Invoke-ATEMSelfTest; exit 0 }
    if (Test-ATEMStringBlank $ConfigPath) { $ConfigPath = Join-Path $scriptDirectory 'watchdog.config.ps1' }
    $configuration = Get-ATEMConfiguration $ConfigPath
    $credentialPath = [String]$configuration.CredentialPath
    if (-not [IO.Path]::IsPathRooted($credentialPath)) { $credentialPath = Join-Path $scriptDirectory $credentialPath }
    $credential = Unprotect-ATEMCredential $credentialPath
    $logPath = [String]$configuration.LogPath
    if (-not [IO.Path]::IsPathRooted($logPath)) { $logPath = Join-Path $scriptDirectory $logPath }

    $syncMutex = New-Object Threading.Mutex($false, 'Global\ATEMFieldExcelSupabaseSync')
    $hasMutex = $syncMutex.WaitOne(0, $false)
    if (-not $hasMutex) { throw 'Já existe uma sincronização da planilha em andamento.' }

    if ($TestConnection) {
        $response = Invoke-ATEMSupabaseRequest $credential 'GET' 'appointments?select=id&limit=1'
        $testRows = @(Get-ATEMRestItems $response)
        Write-Host ('OK - Supabase acessível. Linhas de teste retornadas: ' + $testRows.Count)
        exit 0
    }

    $result = Invoke-AgendaSynchronization -Configuration $configuration -Credential $credential -Simulation:$DryRun -LogPath $logPath
    Write-Host (ConvertTo-ATEMJson $result)
}
catch {
    Write-Error (Get-ATEMErrorDetails $_)
    exit 1
}
finally {
    if ($hasMutex -and $null -ne $syncMutex) { try { $syncMutex.ReleaseMutex() } catch { } }
    if ($null -ne $syncMutex) { $syncMutex.Close() }
}
