# Factory Build — Produces a signed Windows installer (.msi + .exe)
#
# Usage:  .\scripts\factory-build.ps1
# Output: src-tauri/target/release/bundle/msi/*.msi
#         src-tauri/target/release/bundle/nsis/*.exe
#
# Prerequisites: Node.js 18+, Rust toolchain, Tauri CLI (cargo-tauri)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $root

Write-Host "=== Factory Build ===" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Verify tooling ---
Write-Host "[1/6] Verifying tooling..." -ForegroundColor Yellow

$nodeVer = node --version 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "Node.js not found. Install Node.js 18+."; exit 1 }
Write-Host "  Node.js: $nodeVer"

$rustVer = rustc --version 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "Rust not found. Install via rustup."; exit 1 }
Write-Host "  Rust:    $rustVer"

$cargoTauri = cargo tauri --version 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "Tauri CLI not found. Run: cargo install tauri-cli --locked"; exit 1 }
Write-Host "  Tauri:   $cargoTauri"

# --- Step 2: Install Node dependencies ---
Write-Host ""
Write-Host "[2/6] Installing Node.js dependencies..." -ForegroundColor Yellow
npm ci --prefix $root
if ($LASTEXITCODE -ne 0) { Write-Error "npm ci failed for root."; exit 1 }

npm ci --prefix "$root\ui"
if ($LASTEXITCODE -ne 0) { Write-Error "npm ci failed for ui/."; exit 1 }

# --- Step 3: Build Factory Core TypeScript ---
Write-Host ""
Write-Host "[3/6] Building Factory Core (TypeScript)..." -ForegroundColor Yellow
npx tsc
if ($LASTEXITCODE -ne 0) { Write-Error "TypeScript compilation failed."; exit 1 }
Write-Host "  Factory Core compiled to dist/"

# --- Step 4: Build UI frontend ---
Write-Host ""
Write-Host "[4/6] Building UI frontend (Vite)..." -ForegroundColor Yellow
Set-Location "$root\ui"
npx vite build
if ($LASTEXITCODE -ne 0) { Write-Error "Vite build failed."; exit 1 }
Set-Location $root
Write-Host "  UI built to ui/dist/"

# --- Step 5: Build Tauri app ---
Write-Host ""
Write-Host "[5/6] Building Tauri desktop app (release)..." -ForegroundColor Yellow
Set-Location "$root\src-tauri"
cargo tauri build 2>&1
$tauriBuildExit = $LASTEXITCODE
Set-Location $root

if ($tauriBuildExit -ne 0) {
    Write-Error "Tauri build failed with exit code $tauriBuildExit."
    exit 1
}

# --- Step 6: Report outputs ---
Write-Host ""
Write-Host "[6/6] Build artifacts:" -ForegroundColor Yellow

$msiDir = "$root\src-tauri\target\release\bundle\msi"
$nsisDir = "$root\src-tauri\target\release\bundle\nsis"

if (Test-Path $msiDir) {
    Get-ChildItem $msiDir -Filter "*.msi" | ForEach-Object {
        $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
        Write-Host "  MSI:  $($_.Name) ($([math]::Round($_.Length/1MB, 2)) MB)" -ForegroundColor Green
        Write-Host "        SHA-256: $hash"
    }
}

if (Test-Path $nsisDir) {
    Get-ChildItem $nsisDir -Filter "*.exe" | ForEach-Object {
        $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
        Write-Host "  EXE:  $($_.Name) ($([math]::Round($_.Length/1MB, 2)) MB)" -ForegroundColor Green
        Write-Host "        SHA-256: $hash"
    }
}

Write-Host ""
Write-Host "=== Build Complete ===" -ForegroundColor Cyan
