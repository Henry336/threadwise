[CmdletBinding()]
param(
  [switch]$Migrate,
  [switch]$SourceQuiesced,
  [switch]$Ci,
  [string]$EnvFile,
  [string]$PostgresBin,
  [string]$ReportDirectory
)

$migrationScript = Join-Path $PSScriptRoot 'migrate-render-to-supabase.ps1'
$arguments = @{
  SourceKind          = 'Supabase'
  ExpectedSourceRegion = 'ap-northeast-2'
  ExpectedTargetRegion = 'ap-southeast-1'
}

foreach ($name in 'Migrate', 'SourceQuiesced', 'Ci', 'EnvFile', 'PostgresBin', 'ReportDirectory') {
  if ($PSBoundParameters.ContainsKey($name)) {
    $arguments[$name] = $PSBoundParameters[$name]
  }
}

& $migrationScript @arguments
