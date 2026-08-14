# Copie para watchdog.config.ps1 ou execute instalar-watchdog.bat.
# Este arquivo nao contem a chave do Supabase.
@{
    SyncMode = 'Analyzers'
    ExcelPath = 'C:\Calibracao\PAT03-F1 - Controle de Calibracao.xls'
    WorksheetName = 'CONTROLE DE CALIBRACAO - MATRIZ'
    HeaderRow = 4
    SourceId = 'CALIBRATION-ASSETS'
    DefaultAnalyzerLocation = 'Matriz'
    PollSeconds = 15
    StableSeconds = 8
    RetrySeconds = 60
    SyncTechnicians = $true
    SyncEquipments = $true
    MarkMissingAsCancelled = $false
    CredentialPath = 'watchdog.credential'
    LogPath = 'logs\watchdog.log'
    StatePath = 'state'
}
