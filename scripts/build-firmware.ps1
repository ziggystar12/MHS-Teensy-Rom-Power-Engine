# Build the desktop and shared VM host; no hardware is flashed.
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'build-gui-firmware.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Firmware build failed.' }
