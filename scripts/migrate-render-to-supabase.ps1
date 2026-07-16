[CmdletBinding()]
param(
  [switch]$Migrate,
  [string]$EnvFile,
  [string]$PostgresBin
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:PGCONNECT_TIMEOUT = '20'
$env:PGSSLMODE = 'require'

if ([string]::IsNullOrWhiteSpace($PostgresBin)) {
  $PostgresBin = Join-Path ([IO.Path]::GetTempPath()) 'threadwise-postgresql-18.4-clean\pgsql\bin'
}

if ([string]::IsNullOrWhiteSpace($EnvFile)) {
  $EnvFile = Join-Path $PSScriptRoot '..\.env.migration'
}

function Read-MigrationEnvironment {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Migration environment file not found: $Path"
  }

  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^([^#=]+)=(.*)$') {
      $values[$matches[1].Trim()] = $matches[2].Trim()
    }
  }

  foreach ($name in 'SOURCE_DATABASE_URL', 'TARGET_DATABASE_URL') {
    if ([string]::IsNullOrWhiteSpace($values[$name])) {
      throw "$name is missing from $Path"
    }
    if ($values[$name] -match 'YOUR-PASSWORD|\[.*PASSWORD.*\]') {
      throw "$name still contains a password placeholder."
    }
  }

  return $values
}

function Invoke-PsqlScalar {
  param(
    [string]$Url,
    [string]$Query
  )

  $previousErrorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = $Query | & $script:PsqlPath -X -w -A -t -v 'ON_ERROR_STOP=1' --dbname $Url 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorPreference
  }
  if ($exitCode -ne 0) {
    throw ($output -join [Environment]::NewLine)
  }
  return (($output | ForEach-Object { "$_".Trim() }) -join "`n").Trim()
}

function Invoke-NativeCommand {
  param(
    [string]$Path,
    [string[]]$Arguments,
    [string]$FailureMessage
  )

  $previousErrorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $Path @Arguments
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorPreference
  }
  if ($exitCode -ne 0) {
    throw $FailureMessage
  }
}

function Get-DatabaseSummary {
  param([string]$Url)

  $result = Invoke-PsqlScalar -Url $Url -Query @'
select current_setting('server_version')
  || '|' || pg_database_size(current_database())
  || '|' || (select count(*) from pg_tables where schemaname = 'public');
'@
  $parts = $result -split '\|'
  return [pscustomobject]@{
    Version      = $parts[0]
    SizeBytes    = [int64]$parts[1]
    PublicTables = [int]$parts[2]
  }
}

function Quote-PostgresIdentifier {
  param([string]$Value)
  return '"' + $Value.Replace('"', '""') + '"'
}

function Get-TableCounts {
  param(
    [string]$Url,
    [string[]]$Exclude = @()
  )

  $names = Invoke-PsqlScalar -Url $Url -Query "select tablename from pg_tables where schemaname = 'public' order by tablename;"
  $counts = [ordered]@{}
  $includedNames = @($names -split "`n" | Where-Object { $_ -and $_ -notin $Exclude })
  if ($includedNames.Count -eq 0) {
    return $counts
  }

  $countQueries = foreach ($name in $includedNames) {
    $identifier = Quote-PostgresIdentifier -Value $name
    $literal = $name.Replace("'", "''")
    "select '$literal', count(*)::bigint from public.$identifier"
  }
  $results = Invoke-PsqlScalar -Url $Url -Query (($countQueries -join "`nunion all`n") + ';')
  foreach ($row in ($results -split "`n" | Where-Object { $_ })) {
    $parts = $row -split '\|', 2
    $counts[$parts[0]] = [int64]$parts[1]
  }
  return $counts
}

function Get-SequenceStates {
  param([string]$Url)

  $names = Invoke-PsqlScalar -Url $Url -Query "select sequencename from pg_sequences where schemaname = 'public' order by sequencename;"
  $states = [ordered]@{}
  foreach ($name in ($names -split "`n" | Where-Object { $_ })) {
    $identifier = Quote-PostgresIdentifier -Value $name
    $states[$name] = Invoke-PsqlScalar -Url $Url -Query "select last_value || '|' || is_called from public.$identifier;"
  }
  return $states
}

function Assert-EqualMaps {
  param(
    [System.Collections.IDictionary]$Source,
    [System.Collections.IDictionary]$Target,
    [string]$Label
  )

  $sourceKeys = @($Source.Keys)
  $targetKeys = @($Target.Keys)
  if (Compare-Object $sourceKeys $targetKeys) {
    throw "$Label names differ between Render and Supabase."
  }

  foreach ($key in $sourceKeys) {
    if ("$($Source[$key])" -ne "$($Target[$key])") {
      throw "$Label mismatch for ${key}: Render=$($Source[$key]), Supabase=$($Target[$key])"
    }
  }
}

$values = Read-MigrationEnvironment -Path $EnvFile
$sourceUrl = $values['SOURCE_DATABASE_URL']
$targetUrl = $values['TARGET_DATABASE_URL']

$sourceUri = [Uri]$sourceUrl
$targetUri = [Uri]$targetUrl
if ($sourceUri.Host -notlike '*.render.com') {
  throw 'SOURCE_DATABASE_URL does not point to a Render hostname.'
}
if ($targetUri.Host -notlike '*.pooler.supabase.com' -or $targetUri.Port -ne 5432) {
  throw 'TARGET_DATABASE_URL must use the Supabase session pooler on port 5432.'
}

$script:PsqlPath = Join-Path $PostgresBin 'psql.exe'
$pgDumpPath = Join-Path $PostgresBin 'pg_dump.exe'
$pgRestorePath = Join-Path $PostgresBin 'pg_restore.exe'
foreach ($path in $script:PsqlPath, $pgDumpPath, $pgRestorePath) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Required PostgreSQL client not found: $path"
  }
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$prismaPath = Join-Path $projectRoot 'node_modules\.bin\prisma.cmd'
$prismaSchemaPath = Join-Path $projectRoot 'prisma\schema.prisma'
foreach ($path in $prismaPath, $prismaSchemaPath) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Required Prisma file not found: $path"
  }
}

Write-Host 'Checking Render database...' -ForegroundColor Cyan
$sourceSummary = Get-DatabaseSummary -Url $sourceUrl
Write-Host 'Checking Supabase database...' -ForegroundColor Cyan
$targetSummary = Get-DatabaseSummary -Url $targetUrl

[pscustomobject]@{
  Database     = 'Render source'
  Version      = $sourceSummary.Version
  Size         = ('{0:N2} MB' -f ($sourceSummary.SizeBytes / 1MB))
  PublicTables = $sourceSummary.PublicTables
}, [pscustomobject]@{
  Database     = 'Supabase target'
  Version      = $targetSummary.Version
  Size         = ('{0:N2} MB' -f ($targetSummary.SizeBytes / 1MB))
  PublicTables = $targetSummary.PublicTables
} | Format-Table -AutoSize

if (-not $Migrate) {
  Write-Host 'Preflight passed. No database data was changed.' -ForegroundColor Green
  if ([int]($sourceSummary.Version -split '\.')[0] -gt [int]($targetSummary.Version -split '\.')[0]) {
    Write-Host 'A cross-version migration is required; the script will use Prisma for the schema and a portable data-only dump.' -ForegroundColor Yellow
  }
  Write-Host 'Next: suspend the Render web service, then rerun this script with -Migrate.'
  exit 0
}

if ($targetSummary.PublicTables -ne 0) {
  $sourceExistingTables = Get-TableCounts -Url $sourceUrl -Exclude @('_prisma_migrations')
  $targetExistingTables = Get-TableCounts -Url $targetUrl -Exclude @('_prisma_migrations')
  $differentTableNames = Compare-Object @($sourceExistingTables.Keys) @($targetExistingTables.Keys)
  $targetHasData = @($targetExistingTables.Values | Where-Object { $_ -ne 0 }).Count -ne 0
  if ($differentTableNames -or $targetHasData) {
    throw 'Supabase already contains a different schema or application data. Migration stopped without overwriting it.'
  }
  Write-Host 'Found the empty Prisma schema from the previous attempt; resuming safely.' -ForegroundColor Yellow
}

Write-Host 'Checking that Supabase permits a transaction-local trigger bypass...' -ForegroundColor Cyan
[void](Invoke-PsqlScalar -Url $targetUrl -Query 'begin; set local session_replication_role = replica; rollback; select 1;')

$confirmation = Read-Host 'Confirm the Render bot is suspended, then type MIGRATE'
if ($confirmation -cne 'MIGRATE') {
  throw 'Migration canceled. Nothing was changed.'
}

$backupDirectory = Join-Path $PSScriptRoot '..\backups'
$backupDirectory = [IO.Path]::GetFullPath($backupDirectory)
[void](New-Item -ItemType Directory -Path $backupDirectory -Force)
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $backupDirectory "threadwise-render-$timestamp.dump"
$dataPath = Join-Path $backupDirectory "threadwise-render-$timestamp-data.sql"

Write-Host "Creating a complete transaction-consistent backup at $backupPath..." -ForegroundColor Cyan
$dumpArguments = @(
  '--dbname', $sourceUrl,
  '--format', 'custom',
  '--no-owner',
  '--no-privileges',
  '--no-subscriptions',
  '--schema', 'public',
  '--file', $backupPath
)
Invoke-NativeCommand -Path $pgDumpPath -Arguments $dumpArguments -FailureMessage 'Render backup failed. Supabase was not changed.'
if (-not (Test-Path -LiteralPath $backupPath)) { throw 'Render backup file was not created.' }

$contents = & $pgRestorePath --list $backupPath 2>&1
if ($LASTEXITCODE -ne 0 -or -not $contents) {
  throw 'Backup verification failed. Supabase was not changed.'
}
$hash = Get-FileHash -LiteralPath $backupPath -Algorithm SHA256
Write-Host "Backup verified: $($hash.Hash)" -ForegroundColor Green

Write-Host "Creating a cross-version portable data dump at $dataPath..." -ForegroundColor Cyan
$dataDumpArguments = @(
  '--dbname', $sourceUrl,
  '--format', 'plain',
  '--data-only',
  '--no-owner',
  '--no-privileges',
  '--no-subscriptions',
  '--schema', 'public',
  '--exclude-table', 'public._prisma_migrations',
  '--file', $dataPath
)
Invoke-NativeCommand -Path $pgDumpPath -Arguments $dataDumpArguments -FailureMessage 'Portable Render data dump failed. Supabase was not changed.'
if (-not (Test-Path -LiteralPath $dataPath) -or (Get-Item -LiteralPath $dataPath).Length -eq 0) {
  throw 'Portable Render data dump is empty. Supabase was not changed.'
}
$dataHash = Get-FileHash -LiteralPath $dataPath -Algorithm SHA256
Write-Host "Portable data dump verified: $($dataHash.Hash)" -ForegroundColor Green

Write-Host 'Creating the Supabase schema from the repository Prisma migrations...' -ForegroundColor Cyan
$previousDatabaseUrl = $env:DATABASE_URL
try {
  $env:DATABASE_URL = $targetUrl
  Invoke-NativeCommand -Path $prismaPath -Arguments @('migrate', 'deploy', '--schema', $prismaSchemaPath) -FailureMessage 'Prisma migration deployment to Supabase failed. No Render data was imported.'
} finally {
  $env:DATABASE_URL = $previousDatabaseUrl
}

$sourceTables = Get-TableCounts -Url $sourceUrl -Exclude @('_prisma_migrations')
$emptyTargetTables = Get-TableCounts -Url $targetUrl -Exclude @('_prisma_migrations')
if (Compare-Object @($sourceTables.Keys) @($emptyTargetTables.Keys)) {
  throw 'Application table names differ between the Render database and the repository Prisma migrations. No Render data was imported.'
}

Write-Host 'Importing Render data into Supabase in a single transaction...' -ForegroundColor Cyan
$restoreArguments = @(
  '-X',
  '-w',
  '--single-transaction',
  '--variable', 'ON_ERROR_STOP=1',
  '--dbname', $targetUrl,
  '--command', 'SET session_replication_role = replica;',
  '--file', $dataPath
)
Invoke-NativeCommand -Path $script:PsqlPath -Arguments $restoreArguments -FailureMessage 'Supabase data import failed and was rolled back. The local Render backups remain available.'

[void](Invoke-PsqlScalar -Url $targetUrl -Query 'analyze;')

Write-Host 'Comparing exact row counts...' -ForegroundColor Cyan
$sourceRows = Get-TableCounts -Url $sourceUrl -Exclude @('_prisma_migrations')
$targetRows = Get-TableCounts -Url $targetUrl -Exclude @('_prisma_migrations')
Assert-EqualMaps -Source $sourceRows -Target $targetRows -Label 'Table row counts'

$sourceSequences = Get-SequenceStates -Url $sourceUrl
$targetSequences = Get-SequenceStates -Url $targetUrl
Assert-EqualMaps -Source $sourceSequences -Target $targetSequences -Label 'Sequence states'

Write-Host "Migration verified: $($sourceRows.Count) tables and $($sourceSequences.Count) sequences match exactly." -ForegroundColor Green
Write-Host "Keep these backups until the live bot is fully verified: $backupPath and $dataPath" -ForegroundColor Yellow
