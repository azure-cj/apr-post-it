# APG Post-It: build a signed release that installed copies update to.
#
# Before running: raise "version" in src-tauri/tauri.conf.json, package.json and
# src-tauri/Cargo.toml (all three the same), and commit.
#
#   .\release.ps1 "What changed, in a sentence"
#
# Needs the signing key at %USERPROFILE%\.tauri\apg-post-it.key and its password.
# The key never goes in the repo. Lose it and installed copies can't update.

param([string]$Notes = '')

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$key = Join-Path $env:USERPROFILE '.tauri\apg-post-it.key'
if (-not (Test-Path $key)) { throw "The signing key isn't at $key." }

$secure = Read-Host 'Signing key password' -AsSecureString
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw $key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

try {
  Write-Host '[1/3] Running the tests...'
  npx vitest run
  if ($LASTEXITCODE -ne 0) { throw 'The tests failed, so nothing was built.' }

  Write-Host '[2/3] Building the signed installer. This takes several minutes...'
  npx tauri build
  if ($LASTEXITCODE -ne 0) { throw 'The build stopped. Read the messages above.' }

  Write-Host '[3/3] Writing the files to upload...'
  node scripts/release-files.mjs $Notes
  if ($LASTEXITCODE -ne 0) { throw 'The files to upload were not written.' }
} finally {
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}
