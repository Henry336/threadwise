param(
  [string]$TaskName = "Threadwise Codex Worker",
  [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$pidPath = Join-Path $ProjectRoot ".local\codex-worker.pid"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if ($null -eq $task) {
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  return
}

$processIds = @()
if ($task.State -eq "Running") {
  if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) {
    throw "The running worker did not publish its PID. Stop it manually once before updating."
  }

  $workerPid = 0
  $rawPid = (Get-Content -Raw -LiteralPath $pidPath).Trim()
  if (-not [int]::TryParse($rawPid, [ref]$workerPid) -or $workerPid -le 0) {
    throw "The worker PID file is invalid."
  }

  $workerProcess = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
  if ($null -eq $workerProcess -or $workerProcess.ProcessName -notin @("powershell", "pwsh")) {
    throw "The worker PID does not identify the expected PowerShell runner."
  }

  $taskInfo = $task | Get-ScheduledTaskInfo
  if (
    $taskInfo.LastRunTime -gt [datetime]::MinValue -and
    (
      $workerProcess.StartTime -lt $taskInfo.LastRunTime.AddMinutes(-1) -or
      $workerProcess.StartTime -gt $taskInfo.LastRunTime.AddMinutes(2)
    )
  ) {
    throw "The worker PID does not belong to the current scheduled-task run."
  }

  $processRows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
  $pendingParents = [System.Collections.Generic.Queue[int]]::new()
  $pendingParents.Enqueue($workerPid)
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  [void]$seen.Add($workerPid)

  while ($pendingParents.Count -gt 0) {
    $parentPid = $pendingParents.Dequeue()
    foreach ($row in $processRows | Where-Object { [int]$_.ParentProcessId -eq $parentPid }) {
      $childPid = [int]$row.ProcessId
      if ($seen.Add($childPid)) {
        $pendingParents.Enqueue($childPid)
      }
    }
  }
  $processIds = @($seen)
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  $state = (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State
  if ($state -ne "Running") { break }
  Start-Sleep -Milliseconds 250
}

foreach ($processId in @($processIds | Sort-Object -Descending)) {
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
  $remaining = @($processIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
  if ($remaining.Count -eq 0) { break }
  Start-Sleep -Milliseconds 250
}
$remaining = @($processIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
if ($remaining.Count -gt 0) {
  throw "Worker processes did not stop: $($remaining -join ', ')."
}

Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
