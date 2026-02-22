# Factory Release — Builds, tags, and uploads to GitHub Releases
#
# Usage:  .\scripts\factory-release.ps1 -Version "0.2.0" [-Draft] [-Notes "Release notes"]
# Requires: gh CLI authenticated (gh auth status)
#
# What it does:
#   1. Validates version format
#   2. Runs factory-build.ps1
#   3. Creates a Git tag
#   4. Creates a GitHub Release with installer artifacts

param(
    [Parameter(Mandatory=$true)]
    [string]$Version,

    [switch]$Draft,

    [string]$Notes = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $root

Write-Host "=== Factory Release v$Version ===" -ForegroundColor Cyan
Write-Host ""

# --- Validate version format ---
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Error "Version must be semver (e.g., 1.0.0). Got: $Version"
    exit 1
}

# --- Verify gh CLI ---
$ghAuth = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "GitHub CLI not authenticated. Run: gh auth login"
    exit 1
}
Write-Host "[OK] gh CLI authenticated" -ForegroundColor Green

# --- Verify clean working tree ---
$gitStatus = git status --porcelain 2>&1
if ($gitStatus) {
    Write-Host "WARNING: Working tree has uncommitted changes:" -ForegroundColor Yellow
    Write-Host $gitStatus
    $confirm = Read-Host "Continue anyway? (y/N)"
    if ($confirm -ne 'y') { Write-Host "Aborted."; exit 0 }
}

# --- Update version in configs ---
Write-Host ""
Write-Host "[1/5] Updating version to $Version..." -ForegroundColor Yellow

$pkgJson = Get-Content "$root\package.json" -Raw | ConvertFrom-Json
$pkgJson.version = $Version
$pkgJson | ConvertTo-Json -Depth 10 | Set-Content "$root\package.json" -Encoding UTF8

$tauriConf = Get-Content "$root\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$tauriConf.version = $Version
$tauriConf | ConvertTo-Json -Depth 10 | Set-Content "$root\src-tauri\tauri.conf.json" -Encoding UTF8

Write-Host "  package.json: $Version"
Write-Host "  tauri.conf.json: $Version"

# --- Build ---
Write-Host ""
Write-Host "[2/5] Running production build..." -ForegroundColor Yellow
& "$root\scripts\factory-build.ps1"
if ($LASTEXITCODE -ne 0) { Write-Error "Build failed."; exit 1 }

# --- Collect artifacts ---
Write-Host ""
Write-Host "[3/5] Collecting release artifacts..." -ForegroundColor Yellow

$artifacts = @()
$msiDir = "$root\src-tauri\target\release\bundle\msi"
$nsisDir = "$root\src-tauri\target\release\bundle\nsis"

if (Test-Path $msiDir) {
    Get-ChildItem $msiDir -Filter "*.msi" | ForEach-Object { $artifacts += $_.FullName }
}
if (Test-Path $nsisDir) {
    Get-ChildItem $nsisDir -Filter "*.exe" | ForEach-Object { $artifacts += $_.FullName }
}

if ($artifacts.Count -eq 0) {
    Write-Error "No installer artifacts found. Build may have failed silently."
    exit 1
}

Write-Host "  Found $($artifacts.Count) artifact(s):"
$artifacts | ForEach-Object { Write-Host "    $_" }

# --- Generate SHA-256 manifest ---
$hashManifest = "$root\src-tauri\target\release\bundle\release-hashes.txt"
$hashLines = @("NeoXten Factory v$Version - Release Hashes", "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss UTC' -AsUTC)", "")
$artifacts | ForEach-Object {
    $hash = (Get-FileHash $_ -Algorithm SHA256).Hash
    $name = Split-Path $_ -Leaf
    $hashLines += "SHA-256: $hash  $name"
}
$hashLines -join "`n" | Set-Content $hashManifest -Encoding UTF8
$artifacts += $hashManifest
Write-Host "  Hash manifest: $hashManifest"

# --- Tag + Release ---
Write-Host ""
Write-Host "[4/5] Creating Git tag v$Version..." -ForegroundColor Yellow
git tag -a "v$Version" -m "Release v$Version"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Tag already exists or failed. Continuing..." -ForegroundColor Yellow
}
git push origin "v$Version" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Tag push failed. Continuing to create release..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[5/5] Creating GitHub Release..." -ForegroundColor Yellow

$releaseNotes = if ($Notes) { $Notes } else { "NeoXten Factory v$Version`n`nSee release-hashes.txt for artifact SHA-256 checksums." }
$draftFlag = if ($Draft) { "--draft" } else { "" }

$ghArgs = @("release", "create", "v$Version", "--title", "NeoXten Factory v$Version", "--notes", $releaseNotes)
if ($Draft) { $ghArgs += "--draft" }
$artifacts | ForEach-Object { $ghArgs += $_ }

gh @ghArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "GitHub Release creation failed."
    exit 1
}

Write-Host ""
Write-Host "=== Release v$Version Published ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps for wife's laptop:" -ForegroundColor Yellow
Write-Host "  1. Download installer from GitHub Releases"
Write-Host "  2. Install NeoXten Factory"
Write-Host "  3. git pull (to get latest source + specs)"
Write-Host "  4. npm install && npm run build (Factory Core)"
Write-Host "  5. Copy .env.example to .env and fill secrets"
Write-Host "  6. Ready to run: neoxten factory run --spec <path>"
