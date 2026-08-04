param(
  [string]$TaskName = "Threadwise Codex Worker",
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"
$runnerPath = Join-Path $PSScriptRoot "run-codex-worker.ps1"

if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
  throw "Worker runner was not found: $runnerPath"
}

$currentCodexHome = [Environment]::GetEnvironmentVariable("CODEX_HOME", "Process")
$userCodexHome = [Environment]::GetEnvironmentVariable("CODEX_HOME", "User")
if ([string]::IsNullOrWhiteSpace($userCodexHome) -and -not [string]::IsNullOrWhiteSpace($currentCodexHome)) {
  [Environment]::SetEnvironmentVariable("CODEX_HOME", $currentCodexHome, "User")
}

$requiredUserVariables = @("THREADWISE_CODEX_URL", "CODEX_HOME")
$missing = @($requiredUserVariables | Where-Object {
  [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_, "User"))
})
$workerToken = [Environment]::GetEnvironmentVariable("THREADWISE_CODEX_WORKER_TOKEN", "User")
if ([string]::IsNullOrWhiteSpace($workerToken)) {
  $workerToken = [Environment]::GetEnvironmentVariable("CODEX_WORKER_TOKEN", "User")
}
if ([string]::IsNullOrWhiteSpace($workerToken)) {
  $missing += "THREADWISE_CODEX_WORKER_TOKEN"
}
if ($missing.Count -gt 0) {
  throw "Configure these Windows user environment variables first: $($missing -join ', ')"
}

$windowsPowerShell = (Get-Command "powershell.exe" -ErrorAction Stop).Source
$arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerPath`""
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$startupCommand = "`"$windowsPowerShell`" $arguments"
$installedMethod = "Scheduled Task"

if ($StartNow -and $null -ne (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
  $stopperPath = Join-Path $PSScriptRoot "stop-codex-worker.ps1"
  & $stopperPath -TaskName $TaskName -ProjectRoot (Split-Path -Parent $PSScriptRoot)
}

try {
  $action = New-ScheduledTaskAction -Execute $windowsPowerShell -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Keeps the owner-only Threadwise Codex and Gemini worker running while this Windows user is signed in." `
    -Force | Out-Null

  if ($StartNow) {
    Start-ScheduledTask -TaskName $TaskName
  }
} catch {
  $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  if (-not (Test-Path -LiteralPath $runKey)) {
    New-Item -Path $runKey -Force | Out-Null
  }
  Set-ItemProperty `
    -LiteralPath $runKey `
    -Name "ThreadwiseCodexWorker" `
    -Value $startupCommand `
    -Type String
  $installedMethod = "Windows user Run key"

  if ($StartNow) {
    Start-Process `
      -FilePath $windowsPowerShell `
      -ArgumentList $arguments `
      -WindowStyle Hidden
  }
}

Write-Output "Installed startup method: $installedMethod"
Write-Output "Worker log: $(Join-Path (Split-Path -Parent $PSScriptRoot) '.local\logs\codex-worker.log')"
