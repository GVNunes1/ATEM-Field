# Compatibilidade: Windows 7 SP1 e PowerShell 2.0.
Set-StrictMode -Version 2.0

function Get-ATEMScriptDirectory {
    $invocationPath = $MyInvocation.ScriptName
    if ([String]::IsNullOrEmpty($invocationPath)) {
        $invocationPath = $MyInvocation.MyCommand.Path
    }
    return Split-Path -Parent $invocationPath
}

function Test-ATEMStringBlank {
    param([Object]$Value)
    if ($null -eq $Value) { return $true }
    return ([String]$Value).Trim().Length -eq 0
}

function Get-ATEMErrorDetails {
    param($ErrorRecord)
    if ($null -eq $ErrorRecord) { return 'Erro desconhecido.' }
    $message = ''
    try {
        if ($ErrorRecord -is [System.Exception]) {
            $message = $ErrorRecord.Message
        }
        elseif ($null -ne $ErrorRecord.Exception -and -not [String]::IsNullOrEmpty($ErrorRecord.Exception.Message)) {
            $message = $ErrorRecord.Exception.Message
        }
        else {
            $message = [String]$ErrorRecord
        }
    }
    catch {
        $message = [String]$ErrorRecord
    }

    $stack = ''
    try {
        if ($ErrorRecord.PSObject.Properties['ScriptStackTrace'] -and $null -ne $ErrorRecord.ScriptStackTrace) {
            $stack = [String]$ErrorRecord.ScriptStackTrace
        }
    } catch { }

    if ([String]::IsNullOrEmpty($stack)) {
        try {
            if ($null -ne $ErrorRecord.InvocationInfo -and $null -ne $ErrorRecord.InvocationInfo.PositionMessage) {
                $stack = [String]$ErrorRecord.InvocationInfo.PositionMessage
            }
        } catch { }
    }

    if ([String]::IsNullOrEmpty($stack)) {
        try {
            if ($null -ne $ErrorRecord.Exception -and $null -ne $ErrorRecord.Exception.StackTrace) {
                $stack = [String]$ErrorRecord.Exception.StackTrace
            }
        } catch { }
    }

    if (-not (Test-ATEMStringBlank $stack)) {
        return ($message + [Environment]::NewLine + $stack)
    }
    return $message
}

function Get-ATEMExcelMatrixDimensions {
    param($Values)
    $rowCount = 1
    $columnCount = 1
    if ($Values -is [Array] -and $Values.Rank -eq 2) {
        $rowCount = [Int32]$Values.GetLength(0)
        $columnCount = [Int32]$Values.GetLength(1)
    }
    return @{ RowCount = $rowCount; ColumnCount = $columnCount }
}

function Get-ATEMJsonSerializer {
    try {
        Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
    }
    catch {
        [void][System.Reflection.Assembly]::LoadWithPartialName('System.Web.Extensions')
    }
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength = 67108864
    $serializer.RecursionLimit = 100
    return $serializer
}

function ConvertTo-ATEMJson {
    param([Parameter(Mandatory = $true)]$Value)
    $serializer = Get-ATEMJsonSerializer
    return $serializer.Serialize($Value)
}

function ConvertFrom-ATEMJson {
    param([Parameter(Mandatory = $true)][String]$Json)
    $serializer = Get-ATEMJsonSerializer
    return $serializer.DeserializeObject($Json)
}

function ConvertTo-ATEMNormalizedKey {
    param([Object]$Value)
    if ($null -eq $Value) { return '' }
    $text = ([String]$Value).Trim().ToUpperInvariant().Normalize([Text.NormalizationForm]::FormD)
    $builder = New-Object Text.StringBuilder
    foreach ($character in $text.ToCharArray()) {
        $category = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($character)
        if ($category -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$builder.Append($character)
        }
    }
    return ([Regex]::Replace($builder.ToString(), '[^A-Z0-9]+', ' ')).Trim()
}

function Get-ATEMSha256 {
    param([Parameter(Mandatory = $true)][String]$Value)
    $sha = New-Object Security.Cryptography.SHA256Managed
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        $hash = $sha.ComputeHash($bytes)
        return ([BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Protect-ATEMCredential {
    param(
        [Parameter(Mandatory = $true)]$Credential,
        [Parameter(Mandatory = $true)][String]$Path
    )
    try { Add-Type -AssemblyName System.Security -ErrorAction Stop }
    catch { [void][Reflection.Assembly]::LoadWithPartialName('System.Security') }
    $json = ConvertTo-ATEMJson $Credential
    $plainBytes = [Text.Encoding]::UTF8.GetBytes($json)
    $entropy = [Text.Encoding]::UTF8.GetBytes('ATEM-Field-Excel-Watchdog-v1')
    $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
        $plainBytes,
        $entropy,
        [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [IO.File]::WriteAllText($Path, [Convert]::ToBase64String($protectedBytes), [Text.Encoding]::ASCII)
}

function Unprotect-ATEMCredential {
    param([Parameter(Mandatory = $true)][String]$Path)
    try { Add-Type -AssemblyName System.Security -ErrorAction Stop }
    catch { [void][Reflection.Assembly]::LoadWithPartialName('System.Security') }
    if (-not [IO.File]::Exists($Path)) {
        throw "Credencial protegida não encontrada: $Path"
    }
    $encoded = [IO.File]::ReadAllText($Path, [Text.Encoding]::ASCII).Trim()
    $protectedBytes = [Convert]::FromBase64String($encoded)
    $entropy = [Text.Encoding]::UTF8.GetBytes('ATEM-Field-Excel-Watchdog-v1')
    try {
        $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
            $protectedBytes,
            $entropy,
            [Security.Cryptography.DataProtectionScope]::CurrentUser
        )
    }
    catch {
        throw 'A credencial não pode ser aberta por este usuário do Windows. Execute o instalador novamente com a conta que rodará o watchdog.'
    }
    return ConvertFrom-ATEMJson ([Text.Encoding]::UTF8.GetString($plainBytes))
}

function Get-ATEMConfiguration {
    param([Parameter(Mandatory = $true)][String]$Path)
    if (-not [IO.File]::Exists($Path)) {
        throw "Configuração ausente: $Path. Execute instalar-watchdog.bat."
    }
    $configuration = & $Path
    if ($null -eq $configuration -or -not ($configuration -is [Collections.IDictionary])) {
        throw 'O arquivo de configuração deve retornar uma Hashtable do PowerShell.'
    }
    return $configuration
}

function Write-ATEMLog {
    param(
        [Parameter(Mandatory = $true)][String]$Path,
        [Parameter(Mandatory = $true)][String]$Message,
        [String]$Level = 'INFO'
    )
    $directory = Split-Path -Parent $Path
    if (-not [IO.Directory]::Exists($directory)) { [void][IO.Directory]::CreateDirectory($directory) }
    if ([IO.File]::Exists($Path) -and (Get-Item -LiteralPath $Path).Length -gt 5242880) {
        $archive = $Path + '.1'
        if ([IO.File]::Exists($archive)) { [IO.File]::Delete($archive) }
        [IO.File]::Move($Path, $archive)
    }
    $line = '{0} [{1}] {2}' -f ([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss')), $Level.ToUpperInvariant(), $Message
    [IO.File]::AppendAllText($Path, $line + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
    Write-Host $line
}

function Invoke-ATEMSupabaseRequest {
    param(
        [Parameter(Mandatory = $true)]$Credential,
        [Parameter(Mandatory = $true)][String]$Method,
        [Parameter(Mandatory = $true)][String]$Path,
        $Body = $null,
        [String]$Prefer = '',
        [Int32]$MaxAttempts = 3
    )
    $baseUrl = ([String]$Credential.SupabaseUrl).TrimEnd('/')
    if (-not $baseUrl.StartsWith('https://')) { throw 'URL do Supabase invalida ou insegura.' }
    if (Test-ATEMStringBlank $Credential.ServiceKey) { throw 'Credencial do Supabase vazia.' }
    $uri = $baseUrl + '/rest/v1/' + $Path.TrimStart('/')
    $attempt = 0

    while ($attempt -lt $MaxAttempts) {
        $attempt++
        $request = $null
        $statusCode = 0
        $responseBody = ''
        $networkError = ''
        try {
            # WinHTTP 5.1 faz parte do Windows 7. A opcao 9 recebe apenas TLS 1.2 (0x0800).
            $request = New-Object -ComObject WinHttp.WinHttpRequest.5.1
            $request.Open($Method.ToUpperInvariant(), $uri, $false)
            try { $request.Option(9) = 2048 }
            catch { throw 'WinHTTP nao conseguiu habilitar TLS 1.2. Instale as atualizacoes de TLS do Windows 7 SP1.' }
            $request.SetTimeouts(15000, 15000, 45000, 45000)
            $request.SetRequestHeader('Accept', 'application/json')
            $request.SetRequestHeader('apikey', [String]$Credential.ServiceKey)
            $request.SetRequestHeader('Authorization', 'Bearer ' + [String]$Credential.ServiceKey)
            if (-not [String]::IsNullOrEmpty($Prefer)) { $request.SetRequestHeader('Prefer', $Prefer) }
            if ($null -ne $Body) {
                $request.SetRequestHeader('Content-Type', 'application/json; charset=utf-8')
                $jsonBytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-ATEMJson $Body))
                $request.Send($jsonBytes)
            }
            else { $request.Send() }
            $statusCode = [Int32]$request.Status
            try { $responseBody = [String]$request.ResponseText }
            catch { $responseBody = '' }
        }
        catch { $networkError = $_.Exception.Message }
        finally { Release-ATEMComObject $request }

        if ($statusCode -ge 200 -and $statusCode -lt 300) {
            if (Test-ATEMStringBlank $responseBody) { return $null }
            return ConvertFrom-ATEMJson $responseBody
        }

        $retryable = ($statusCode -eq 0 -or $statusCode -eq 408 -or $statusCode -eq 429 -or $statusCode -ge 500)
        if ($retryable -and $attempt -lt $MaxAttempts) {
            Start-Sleep -Seconds ([Math]::Pow(2, $attempt - 1))
            continue
        }
        if ($statusCode -gt 0) {
            if (Test-ATEMStringBlank $responseBody) { $responseBody = 'Resposta sem detalhes.' }
            throw "Supabase REST falhou (HTTP $statusCode, tentativa $attempt): $responseBody"
        }
        if (Test-ATEMStringBlank $networkError) { $networkError = 'Falha desconhecida de rede ou TLS.' }
        throw "Supabase REST falhou (rede/TLS, tentativa $attempt): $networkError"
    }
}

function Get-ATEMRestItems {
    param($Value)
    if ($null -eq $Value) { return @() }
    if ($Value -is [Collections.IEnumerable] -and -not ($Value -is [String]) -and -not ($Value -is [Collections.IDictionary])) {
        return @($Value)
    }
    return @($Value)
}

function Release-ATEMComObject {
    param($Value)
    if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) {
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value) }
        catch { }
    }
}
