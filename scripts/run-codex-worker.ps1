param(
  [string]$LogDirectory
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$tsxCommand = Join-Path $projectRoot "node_modules\.bin\tsx.cmd"
if ([string]::IsNullOrWhiteSpace($LogDirectory)) {
  $LogDirectory = Join-Path $projectRoot ".local\logs"
}

New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$logPath = Join-Path $LogDirectory "codex-worker.log"

function Write-WorkerLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Value "[$([DateTimeOffset]::Now.ToString("o"))] $Message"
}

try {
  if (-not (Test-Path -LiteralPath $tsxCommand -PathType Leaf)) {
    throw "Worker dependencies are missing. Run npm ci in $projectRoot."
  }
  if ([string]::IsNullOrWhiteSpace($env:THREADWISE_CODEX_URL)) {
    throw "THREADWISE_CODEX_URL is not configured for this Windows user."
  }
  if (
    [string]::IsNullOrWhiteSpace($env:THREADWISE_CODEX_WORKER_TOKEN) -and
    [string]::IsNullOrWhiteSpace($env:CODEX_WORKER_TOKEN)
  ) {
    throw "THREADWISE_CODEX_WORKER_TOKEN or CODEX_WORKER_TOKEN is not configured for this Windows user."
  }

  while ($true) {
    Write-WorkerLog "Starting Threadwise local worker."
    Push-Location -LiteralPath $projectRoot
    try {
      & $tsxCommand "src\codexWorker.ts" *>> $logPath
      $workerExitCode = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    Write-WorkerLog "Worker exited with code $workerExitCode. Restarting in 15 seconds."
    Start-Sleep -Seconds 15
  }
} catch {
  Write-WorkerLog "Startup failed: $($_.Exception.Message)"
  Write-Error $_
  exit 1
}
