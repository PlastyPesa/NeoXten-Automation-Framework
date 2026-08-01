# PlastyPesa How to Sort storyboard to MP4 (ffmpeg, no Jitter)
# Usage:
#   .\scripts\plastypesa\build-sort-storyboard-video.ps1
#   .\scripts\plastypesa\build-sort-storyboard-video.ps1 -FramesDir "C:\path\to\frames"

param(
    [string]$FramesDir = "C:\Users\Bobby\Documents\PlastyPesa-sort-video\frames",
    [string]$OutDir = "C:\Users\Bobby\Documents\PlastyPesa-sort-video\output",
    [double]$HoldSec = 3.2,
    [double]$FadeSec = 0.8,
    [int]$Width = 1280,
    [int]$Height = 720,
    [int]$Fps = 30
)

$ErrorActionPreference = "Stop"

function Find-Ffmpeg {
    $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $winget = "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe"
    if (Test-Path $winget) { return $winget }
    $gyan = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter "ffmpeg.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($gyan) { return $gyan.FullName }
    throw "ffmpeg not found. Run: winget install Gyan.FFmpeg"
}

$ffmpeg = Find-Ffmpeg
Write-Host "ffmpeg: $ffmpeg"

if (-not (Test-Path $FramesDir)) {
    New-Item -ItemType Directory -Path $FramesDir -Force | Out-Null
    throw "Frames folder empty - add 01-hook.png through 08-endcard.png to:`n  $FramesDir"
}

$expected = @(
    "01-hook.png",
    "02-plastic-grades.png",
    "03-rinse.png",
    "04-same-grade.png",
    "05-add-item.png",
    "06-no-duplicate.png",
    "07-app-flow.png",
    "08-endcard.png"
)

$frames = @()
foreach ($name in $expected) {
    $path = Join-Path $FramesDir $name
    if (-not (Test-Path $path)) {
        # fallback: any 8 PNGs sorted by name
        $any = Get-ChildItem $FramesDir -Filter "*.png" | Sort-Object Name
        if ($any.Count -ge 8) {
            $frames = $any | Select-Object -First 8
            Write-Host "Using first 8 PNGs by name (not canonical names):"
            $frames | ForEach-Object { Write-Host "  $($_.Name)" }
            break
        }
        throw "Missing $name - put 8 numbered PNGs in $FramesDir (see README in output folder)."
    }
    $frames += Get-Item $path
}

if ($frames.Count -eq 0) {
    $frames = $expected | ForEach-Object { Get-Item (Join-Path $FramesDir $_) }
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$work = Join-Path $OutDir "_work"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Path $work | Out-Null

$clipDur = [math]::Round($HoldSec + $FadeSec, 3)
$i = 0
$clipPaths = @()

foreach ($frame in $frames) {
    $i++
    $outClip = Join-Path $work ("clip_{0:D2}.mp4" -f $i)
    $clipPaths += $outClip
    $fadeOutStart = [math]::Max(0, $clipDur - $FadeSec)

    $ffmpegArgs = @(
        "-y",
        "-loop", "1",
        "-i", $frame.FullName,
        "-vf", "scale=${Width}:${Height}:force_original_aspect_ratio=decrease,pad=${Width}:${Height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p,fade=t=in:st=0:d=${FadeSec},fade=t=out:st=${fadeOutStart}:d=${FadeSec}",
        "-t", "$clipDur",
        "-r", "$Fps",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        $outClip
    )
    Write-Host "Clip $i/$($frames.Count): $($frame.Name)"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & $ffmpeg @ffmpegArgs 2>&1 | Out-Null
    $ErrorActionPreference = $prevEap
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed on $($frame.Name)" }
}

$listFile = Join-Path $work "concat.txt"
$clipPaths | ForEach-Object { "file '$($_.Replace('\','/'))'" } | Set-Content -Path $listFile -Encoding ascii

$final = Join-Path $OutDir "plastypesa-how-to-sort.mp4"
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $ffmpeg -y -f concat -safe 0 -i $listFile -c copy $final 2>&1 | Out-Null
$ErrorActionPreference = $prevEap
if ($LASTEXITCODE -ne 0) { throw "ffmpeg concat failed" }

$totalSec = [math]::Round($clipDur * $frames.Count, 1)
Write-Host ""
Write-Host "Done: $final"
Write-Host "Duration: ~${totalSec}s ($($frames.Count) clips x ${clipDur}s each, ${FadeSec}s fade in/out)"
Write-Host "Open with: start `"$final`""
