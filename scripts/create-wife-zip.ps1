# Create wife ZIP: full framework for deployment on wife's laptop.
# Excludes: node_modules, .git, build artifacts, secrets, run data.
# Includes: source, templates, configs, scripts, .env.example.
#
# Usage:  .\scripts\create-wife-zip.ps1
# Output: NeoXten-Factory-Wife.zip in parent directory

$ErrorActionPreference = "Stop"
$src = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$out = Join-Path (Split-Path -Parent $src) "NeoXten-Factory-Wife.zip"
$temp = Join-Path $env:TEMP "neoxten_wife_zip_$(Get-Random)"

Write-Host "=== Creating Wife ZIP ===" -ForegroundColor Cyan
Write-Host "  Source: $src"
Write-Host "  Output: $out"

if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
New-Item -ItemType Directory -Path $temp -Force | Out-Null

$excludeDirs = @("node_modules", ".git", ".neoxten", ".neoxten-out", "dist", "target", "ui\node_modules", "ui\dist", "src-tauri\target", "src-tauri\gen")
$excludeFiles = @("sample-pack.zip", ".env", "*.keystore", "*.pem", "*.key")

$excludeArgs = ($excludeDirs | ForEach-Object { "/XD" ; $_ }) + ($excludeFiles | ForEach-Object { "/XF" ; $_ })

robocopy $src $temp /E @excludeArgs /NFL /NDL /NJH /NJS /NC /NS | Out-Null

if (Test-Path (Join-Path $temp "ops\bugs\cases")) {
    Get-ChildItem (Join-Path $temp "ops\bugs\cases") -Directory |
        Where-Object { $_.Name -match '^BUG-' } |
        Remove-Item -Recurse -Force
}

if (Test-Path (Join-Path $temp "ops\factory\runs")) {
    Remove-Item (Join-Path $temp "ops\factory\runs") -Recurse -Force
    New-Item -ItemType Directory -Path (Join-Path $temp "ops\factory\runs") -Force | Out-Null
}

$cmPath = Join-Path $temp "ops\factory\consequence-memory.ndjson"
if (Test-Path $cmPath) { Remove-Item $cmPath -Force }

if (Test-Path $out) { Remove-Item $out -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($temp, $out)
Remove-Item $temp -Recurse -Force

$hash = (Get-FileHash $out -Algorithm SHA256).Hash
$sizeMB = [math]::Round((Get-Item $out).Length / 1MB, 2)

Write-Host ""
Write-Host "=== ZIP Created ===" -ForegroundColor Cyan
Write-Host "  File:    $out"
Write-Host "  Size:    $sizeMB MB"
Write-Host "  SHA-256: $hash"
Write-Host ""
Write-Host "Wife setup:" -ForegroundColor Yellow
Write-Host "  1. Extract ZIP"
Write-Host "  2. cd NeoXten-Automation-Framework"
Write-Host "  3. .\scripts\factory-setup.ps1"
