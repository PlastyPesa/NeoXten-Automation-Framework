# One-time Play install-stats setup: save bucket, probe GCS access, run play:install-stats
param(
  [Parameter(Mandatory = $true)]
  [string]$Bucket
)

$ErrorActionPreference = "Stop"
$NeoXtenRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$EnvDir = Join-Path $NeoXtenRoot ".local"
$EnvFile = Join-Path $EnvDir "play-stats.env"

# Normalize gs://pubsite_prod_rev_.../stats/... → bucket name only
$Bucket = $Bucket.Trim()
if ($Bucket -match "^gs://([^/]+)") { $Bucket = $Matches[1] }
$Bucket = $Bucket -replace "/.*$", ""

if ($Bucket -notmatch "^pubsite_prod") {
  Write-Warning "Expected bucket name like pubsite_prod_<developerId> (got: $Bucket)"
}

New-Item -ItemType Directory -Force -Path $EnvDir | Out-Null
@"
# Play install CSV bucket — created $(Get-Date -Format "yyyy-MM-dd HH:mm")
PLASTYPESA_PLAY_STATS_BUCKET=$Bucket
"@ | Set-Content -Path $EnvFile -Encoding utf8

Write-Host "Saved: $EnvFile"
Write-Host ""
Write-Host "If GCS probe fails, in Play Console ensure play-publisher@plastypesa-f5274.iam.gserviceaccount.com has"
Write-Host "'View app information and download bulk reports', OR grant Storage Object Viewer on gs://$Bucket/"
Write-Host ""

Push-Location $NeoXtenRoot
try {
  npm run play:install-stats
  $report = Join-Path $NeoXtenRoot ".neoxten\plastypesa-play-install-stats.json"
  if (Test-Path $report) {
    $j = Get-Content $report -Raw | ConvertFrom-Json
    if ($j.error) {
      Write-Host "`nGCS error: $($j.error)" -ForegroundColor Red
      exit 1
    }
    if ($j.dailyUserInstalls.Count -gt 0) {
      Write-Host "`nOK: $($j.dailyUserInstalls.Count) day(s) of install data cached for Daily Check." -ForegroundColor Green
    } else {
      Write-Host "`nBucket access OK (or pending). Install CSV may lag 24-48h after first Play exports." -ForegroundColor Yellow
    }
  }
} finally {
  Pop-Location
}
