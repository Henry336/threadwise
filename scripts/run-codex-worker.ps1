param(
  [string]$LogDirectory
)

$ErrorActionPreference = "Stop"

function Import-UserVariable([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name, "User")
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    Set-Item -LiteralPath "Env:$Name" -Value $value
  }
}

@(
  "THREADWISE_CODEX_URL",
  "THREADWISE_CODEX_WORKER_TOKEN",
  "CODEX_WORKER_TOKEN",
  "CODEX_HOME",
  "CODEX_WORKER_NETWORK_ACCESS",
  "THREADWISE_CODEX_ADDITIONAL_ROOTS",
  "THREADWISE_FILE_ROOTS",
  "THREADWISE_DEPLOY_TARGETS",
  "CODEX_WORKER_WORKTREE_ROOT",
  "CODEX_WORKER_CREDENTIAL_ENV_ALLOWLIST",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "API_KEY_21ST"
) | ForEach-Object { Import-UserVariable $_ }

$credentialAllowlist = [Environment]::GetEnvironmentVariable("CODEX_WORKER_CREDENTIAL_ENV_ALLOWLIST", "User")
if (-not [string]::IsNullOrWhiteSpace($credentialAllowlist)) {
  $credentialAllowlist -split '[;,]' | ForEach-Object {
    $credentialName = $_.Trim().ToUpperInvariant()
    if (
      $credentialName -match '^[A-Z][A-Z0-9_]{1,79}$' -and
      $credentialName -notmatch '^(THREADWISE_|CODEX_WORKER_|DATABASE_URL$|DIRECT_URL$|TELEGRAM_|GH_|GITHUB_|RENDER_|VERCEL_|CODEX_HOME$)'
    ) {
      Import-UserVariable $credentialName
    }
  }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$tsxCommand = Join-Path $projectRoot "node_modules\.bin\tsx.cmd"
if ([string]::IsNullOrWhiteSpace($LogDirectory)) {
  $LogDirectory = Join-Path $projectRoot ".local\logs"
}

New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
$logPath = Join-Path $LogDirectory "codex-worker.log"
$pidPath = Join-Path $projectRoot ".local\codex-worker.pid"
New-Item -ItemType Directory -Path (Split-Path -Parent $pidPath) -Force | Out-Null
Set-Content -LiteralPath $pidPath -Value $PID -NoNewline -Encoding Ascii

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
  if ([string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
    throw "CODEX_HOME is not configured for this Windows user."
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
} finally {
  $publishedPid = Get-Content -Raw -LiteralPath $pidPath -ErrorAction SilentlyContinue
  if (-not [string]::IsNullOrWhiteSpace($publishedPid) -and $publishedPid.Trim() -eq "$PID") {
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  }
}
