# No installation, downloads, elevation, execution-policy change or environment import.
# PowerShell 7.4+; Windows x64 only. This file has NOT been executed on Windows here.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet("Prepare","Start","Check","Stop","DeleteData","BuildDesktop","LaunchDesktop","VerifyCandidate")]
  [string]$Action,
  [string]$RunDirectory,
  [switch]$ConfirmSyntheticDataDeletion
)
$ErrorActionPreference = "Stop"
if (-not $IsWindows -or $PSVersionTable.PSVersion -lt [version]"7.4") {
  throw "Windows x64 and PowerShell 7.4+ required; no system changes were made."
}
if (-not [Environment]::Is64BitOperatingSystem) { throw "Windows x64 required." }
$Node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
$ArgsList = @((Join-Path $PSScriptRoot "control.mjs"), $Action)
if ($RunDirectory) { $ArgsList += @("--run", $RunDirectory) }
if ($ConfirmSyntheticDataDeletion) { $ArgsList += "--confirm-synthetic-data-deletion" }
& $Node @ArgsList
if ($LASTEXITCODE -ne 0) { throw "Isolated tool stopped with exit code $LASTEXITCODE (no automatic retry)." }
