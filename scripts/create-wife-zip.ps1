# Create wife ZIP: framework without node_modules, .git, .neoxten, and case output.
# Usage: .\scripts\create-wife-zip.ps1
# Output: C:\Users\Bobby\Documents\NeoXten-Automation-Framework__WIFE_ZIP.zip

$src = "C:\Users\Bobby\Documents\NeoXten-Automation-Framework"
$out = "C:\Users\Bobby\Documents\NeoXten-Automation-Framework__WIFE_ZIP.zip"
$temp = Join-Path $env:TEMP "neoxten_wife_zip_$(Get-Random)"

if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
New-Item -ItemType Directory -Path $temp -Force | Out-Null

robocopy $src $temp /E /XD node_modules .git .neoxten /XF sample-pack.zip /NFL /NDL /NJH /NJS /NC /NS | Out-Null
if (Test-Path (Join-Path $temp "ops\bugs\cases")) {
  Get-ChildItem (Join-Path $temp "ops\bugs\cases") -Directory | Where-Object { $_.Name -match '^BUG-' } | Remove-Item -Recurse -Force
}
if (Test-Path $out) { Remove-Item $out -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($temp, $out)
Remove-Item $temp -Recurse -Force
Write-Host "WROTE: $out"
