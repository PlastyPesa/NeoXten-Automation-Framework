# Factory Setup — Initializes a new machine for Factory operation
#
# Usage:  .\scripts\factory-setup.ps1
#
# Run this after cloning the repo on a new machine.
# It verifies prerequisites, installs dependencies, builds,
# creates .env from template, and validates the installation.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Set-Location $root

$pass = 0
$fail = 0

function Test-Prereq($name, $command) {
    try {
        $result = Invoke-Expression $command 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] $name`: $result" -ForegroundColor Green
            $script:pass++
            return $true
        } else {
            Write-Host "  [FAIL] $name" -ForegroundColor Red
            $script:fail++
            return $false
        }
    } catch {
        Write-Host "  [FAIL] $name`: not found" -ForegroundColor Red
        $script:fail++
        return $false
    }
}

Write-Host "=== Factory Setup ===" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Verify prerequisites ---
Write-Host "[1/6] Checking prerequisites..." -ForegroundColor Yellow

$hasNode = Test-Prereq "Node.js 18+" "node --version"
Test-Prereq "npm" "npm --version" | Out-Null
Test-Prereq "Git" "git --version" | Out-Null
Test-Prereq "ImageMagick" "magick --version" | Out-Null

$hasRust = Test-Prereq "Rust" "rustc --version"
if ($hasRust) {
    Test-Prereq "Cargo" "cargo --version" | Out-Null
    Test-Prereq "Tauri CLI" "cargo tauri --version" | Out-Null
}

$hasGh = Test-Prereq "GitHub CLI" "gh --version"

if (-not $hasNode) {
    Write-Error "Node.js is required. Install from https://nodejs.org/"
    exit 1
}

# --- Step 2: Install Node dependencies ---
Write-Host ""
Write-Host "[2/6] Installing dependencies..." -ForegroundColor Yellow

npm install --prefix $root
if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed."; exit 1 }
Write-Host "  [OK] Root dependencies installed" -ForegroundColor Green

if (Test-Path "$root\ui\package.json") {
    npm install --prefix "$root\ui"
    if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed for ui/."; exit 1 }
    Write-Host "  [OK] UI dependencies installed" -ForegroundColor Green
}

# --- Step 3: Build Factory Core ---
Write-Host ""
Write-Host "[3/6] Building Factory Core..." -ForegroundColor Yellow

npx tsc
if ($LASTEXITCODE -ne 0) { Write-Error "TypeScript compilation failed."; exit 1 }
Write-Host "  [OK] Factory Core compiled to dist/" -ForegroundColor Green

# --- Step 4: Create .env if missing ---
Write-Host ""
Write-Host "[4/6] Environment configuration..." -ForegroundColor Yellow

$envPath = "$root\.env"
$envExamplePath = "$root\.env.example"

if (Test-Path $envPath) {
    Write-Host "  [OK] .env already exists" -ForegroundColor Green
} elseif (Test-Path $envExamplePath) {
    Copy-Item $envExamplePath $envPath
    Write-Host "  [CREATED] .env from .env.example" -ForegroundColor Yellow
    Write-Host "  ACTION REQUIRED: Edit .env and fill in your secrets" -ForegroundColor Yellow
} else {
    Write-Host "  [WARN] No .env.example found. Create .env manually." -ForegroundColor Yellow
}

# --- Step 5: Create ops directories ---
Write-Host ""
Write-Host "[5/6] Creating ops directories..." -ForegroundColor Yellow

$opsDirs = @(
    "$root\ops\factory\runs",
    "$root\ops\bugs\cases"
)

foreach ($dir in $opsDirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "  [CREATED] $dir" -ForegroundColor Yellow
    } else {
        Write-Host "  [OK] $dir" -ForegroundColor Green
    }
}

# --- Step 6: Validate installation ---
Write-Host ""
Write-Host "[6/6] Validating installation..." -ForegroundColor Yellow

$doctorResult = node dist/cli/index.js doctor 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] neoxten doctor: PASS" -ForegroundColor Green
    $pass++
} else {
    Write-Host "  [FAIL] neoxten doctor failed:" -ForegroundColor Red
    Write-Host $doctorResult
    $fail++
}

$factoryHelp = node dist/cli/index.js factory --help 2>&1
if ($factoryHelp -match 'factory') {
    Write-Host "  [OK] factory CLI available" -ForegroundColor Green
    $pass++
} else {
    Write-Host "  [FAIL] factory CLI not found" -ForegroundColor Red
    $fail++
}

# --- Summary ---
Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host "  Passed: $pass" -ForegroundColor Green
if ($fail -gt 0) {
    Write-Host "  Failed: $fail" -ForegroundColor Red
} else {
    Write-Host "  Failed: 0" -ForegroundColor Green
}
Write-Host ""

if (-not (Test-Path $envPath) -or ((Get-Content $envPath -Raw) -match 'LLM_API_KEY=$')) {
    Write-Host "NEXT STEPS:" -ForegroundColor Yellow
    Write-Host "  1. Edit .env with your API keys and paths"
    Write-Host "  2. Download model files to MODEL_DIR"
    Write-Host "  3. Run: neoxten factory run --spec <your-spec.yaml>"
} else {
    Write-Host "Ready to run: neoxten factory run --spec <your-spec.yaml>" -ForegroundColor Green
}
