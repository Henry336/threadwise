param(
  [string]$TaskName = "Threadwise Codex Worker"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$workerStopped = $false

Push-Location -LiteralPath $projectRoot
try {
  $root = (& git rev-parse --show-toplevel).Trim()
  if ($LASTEXITCODE -ne 0 -or [IO.Path]::GetFullPath($root) -ne [IO.Path]::GetFullPath($projectRoot)) {
    throw "The worker checkout is not the selected Git repository root."
  }
  $remote = (& git remote get-url origin).Trim()
  if ($LASTEXITCODE -ne 0 -or $remote -notmatch '^(https://github\.com/|git@github\.com:)') {
    throw "The worker checkout does not use a supported GitHub origin."
  }
  $dirty = & git status --porcelain=v1 --untracked-files=normal
  if ($LASTEXITCODE -ne 0 -or -not [string]::IsNullOrWhiteSpace(($dirty -join "`n"))) {
    throw "The dedicated worker checkout has local changes. Update stopped without modifying them."
  }
  $branch = (& git branch --show-current).Trim()
  if ($branch -ne "main") {
    throw "The dedicated worker checkout must be on main; found '$branch'."
  }

  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  $workerStopped = $true
  & git fetch --no-tags origin main
  if ($LASTEXITCODE -ne 0) { throw "git fetch origin main failed." }
  & git merge --ff-only origin/main
  if ($LASTEXITCODE -ne 0) { throw "The worker checkout could not fast-forward to origin/main." }
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed in the worker checkout." }

  $installerPath = Join-Path $PSScriptRoot "install-codex-worker-startup.ps1"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installerPath -TaskName $TaskName -StartNow
  if ($LASTEXITCODE -ne 0) { throw "The updated startup installer failed." }
  Write-Output "Worker updated to $((& git rev-parse --short HEAD).Trim()) and restarted."
} finally {
  Pop-Location
  if ($workerStopped) {
    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }
}
