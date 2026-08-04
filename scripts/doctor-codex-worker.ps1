param(
  [string]$TaskName = "Threadwise Codex Worker"
)

$ErrorActionPreference = "Continue"

function User-Value([string]$Name) {
  return [Environment]::GetEnvironmentVariable($Name, "User")
}

function Result([string]$Label, [bool]$Ready, [string]$Detail) {
  $mark = if ($Ready) { "OK" } else { "MISSING" }
  Write-Output "[$mark] $Label - $Detail"
}

$codexHome = User-Value "CODEX_HOME"
$workerUrl = User-Value "THREADWISE_CODEX_URL"
$workerToken = User-Value "THREADWISE_CODEX_WORKER_TOKEN"
if ([string]::IsNullOrWhiteSpace($workerToken)) { $workerToken = User-Value "CODEX_WORKER_TOKEN" }
$network = User-Value "CODEX_WORKER_NETWORK_ACCESS"
$additionalRoots = User-Value "THREADWISE_CODEX_ADDITIONAL_ROOTS"
$fileRoots = User-Value "THREADWISE_FILE_ROOTS"
$deployTargets = User-Value "THREADWISE_DEPLOY_TARGETS"

Result "Worker URL" (-not [string]::IsNullOrWhiteSpace($workerUrl)) "Windows User environment"
Result "Worker token" (-not [string]::IsNullOrWhiteSpace($workerToken)) "presence only; value is never printed"
Result "CODEX_HOME" (
  -not [string]::IsNullOrWhiteSpace($codexHome) -and
  (Test-Path -LiteralPath (Join-Path $codexHome "config.toml") -PathType Leaf) -and
  (Test-Path -LiteralPath (Join-Path $codexHome "auth.json") -PathType Leaf)
) "desktop config and authentication"

$gh = Get-Command "gh.exe" -ErrorAction SilentlyContinue
$ghReady = $false
if ($gh) {
  & $gh.Source auth status --hostname github.com *> $null
  $ghReady = $LASTEXITCODE -eq 0
}
Result "GitHub CLI" $ghReady "authenticated for the worker Windows account"
Result "Internet capability" ($network -match '^(1|true|yes|on)$') "still requires one-task Telegram approval"
Result "Additional Codex roots" (-not [string]::IsNullOrWhiteSpace($additionalRoots)) "still requires one-task Telegram approval"
Result "Private file courier roots" (-not [string]::IsNullOrWhiteSpace($fileRoots)) "used only by /files"
Result "Deploy targets" (-not [string]::IsNullOrWhiteSpace($deployTargets)) "Git-connected health verification map"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Result "Startup task" ($null -ne $task) $(if ($task) { $task.State.ToString() } else { "not installed" })
