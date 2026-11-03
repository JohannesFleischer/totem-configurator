# Starts TOTEM Overlay (used by "Start Overlay (Windows).cmd"). The first time, it downloads
# the app's runtime (Electron 44.9.0, about 120 MB) from GitHub into the "runtime" folder next
# to this script and checks it against the SHA-256 Electron publishes.
param([switch]$NoStart)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # the progress bar makes Invoke-WebRequest very slow
$Ver = '44.9.0'
$Dir = $PSScriptRoot
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
    $Arch = 'arm64'; $Sha = '4156e90faf61e2534f1c1cb10c8f05d38d199db8f788cc0c19f671a6ef881dce'
} else {
    $Arch = 'x64'; $Sha = '88e08039d0ef359bab9f674e8051fa103bd8628ea7c5a5e1daaa610a8a0c6931'
}
$Name = "electron-v$Ver-win32-$Arch"
$Runtime = Join-Path $Dir 'runtime'
$Rt = Join-Path $Runtime $Name
$Exe = Join-Path $Rt 'electron.exe'
if (-not (Test-Path $Exe)) {
    New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
    $Zip = Join-Path $Runtime "$Name.zip"
    $Part = "$Zip.part"
    $Url = "https://github.com/electron/electron/releases/download/v$Ver/$Name.zip"
    Write-Host "Downloading the overlay's runtime, Electron $Ver (about 120 MB, only this once)..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Url -OutFile $Part -UseBasicParsing
    $Got = (Get-FileHash -Algorithm SHA256 -Path $Part).Hash.ToLower()
    if ($Got -ne $Sha) {
        Remove-Item -Force $Part
        throw "The download doesn't match Electron's published checksum; nothing was installed."
    }
    Move-Item -Force $Part $Zip
    $Tmp = "$Rt.tmp"
    if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp }
    New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
    Write-Host 'Unpacking...'
    $Tar = Get-Command tar.exe -ErrorAction SilentlyContinue
    if ($Tar) { & $Tar.Source -xf $Zip -C $Tmp } # much faster than Expand-Archive (Windows 10 1803+)
    if (-not $Tar -or $LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $Tmp 'electron.exe'))) {
        Remove-Item -Recurse -Force $Tmp
        Expand-Archive -Path $Zip -DestinationPath $Tmp
    }
    Move-Item $Tmp $Rt
    Remove-Item -Force $Zip
}
if ($NoStart) { Write-Host "Runtime ready: $Exe"; exit 0 }
$App = Join-Path $Dir 'app'
Start-Process -FilePath $Exe -ArgumentList ('"' + $App + '"')
Write-Host 'TOTEM Overlay is running: its icon is in the system tray (click it for the settings).'
