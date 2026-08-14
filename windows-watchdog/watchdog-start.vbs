Option Explicit

Dim shell, fileSystem, scriptDirectory, powerShellPath, watchdogPath, configPath, command
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
watchdogPath = scriptDirectory & "\watchdog.ps1"
configPath = scriptDirectory & "\watchdog.config.ps1"

command = Chr(34) & powerShellPath & Chr(34) & _
    " -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & _
    Chr(34) & watchdogPath & Chr(34) & " -ConfigPath " & Chr(34) & configPath & Chr(34)

shell.Run command, 0, False
