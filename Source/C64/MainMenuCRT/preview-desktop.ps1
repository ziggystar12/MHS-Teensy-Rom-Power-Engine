[CmdletBinding()]
param(
    [string]$AcmePath = 'C:\Users\john\AppData\Local\Temp\teensyrom-acme-0.97\unpacked\acme0.97win\acme\acme.exe',
    [string]$VicePath = 'E:\MHS-Repository\AGI-64\tools\VICE-3.10\GTK3VICE-3.10-win64\bin\x64sc.exe',
    [switch]$Capture,
    [switch]$Menu,
    [switch]$Loading,
    [switch]$Browser,
    [switch]$Control,
    [switch]$Music,
    [switch]$LoadingMessage,
    [switch]$LoadingError,
    [ValidateRange(-1, 2)]
    [int]$App = -1,
    [ValidateSet(0, 8, 9)]
    [int]$IECDevice = 0,
    [string]$Drive8Image,
    [string]$Drive9Image
)

# This preview reuses the desktop renderer without TeensyROM hardware services.
# It never runs the firmware/header build or opens an interactive emulator window.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($LoadingMessage -or $LoadingError) { $Loading = $true }

foreach ($requiredFile in @(
    $AcmePath,
    (Join-Path $PSScriptRoot 'source\DesktopShellCode.asm'),
    (Join-Path $PSScriptRoot 'source\DesktopPreview.asm')
)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required preview file not found: $requiredFile"
    }
}
if ($Capture -and -not (Test-Path -LiteralPath $VicePath -PathType Leaf)) {
    throw "VICE executable not found: $VicePath"
}
if ($Menu -and $IECDevice -ne 0) {
    throw 'Choose either -Menu or -IECDevice for the initial preview surface.'
}
if ($App -ge 0 -and ($Menu -or $IECDevice -ne 0)) {
    throw 'Choose one initial surface: App, Menu, or IECDevice.'
}
if ($Loading -and ($App -ge 0 -or $Menu -or $IECDevice -ne 0)) {
    throw 'Choose Loading with an optional Browser background.'
}
if ($Browser -and ($App -ge 0 -or $Menu -or $IECDevice -ne 0)) {
    throw 'Choose Browser with an optional Loading panel.'
}
foreach ($imagePath in @($Drive8Image, $Drive9Image)) {
    if ($imagePath -and -not (Test-Path -LiteralPath $imagePath -PathType Leaf)) {
        throw "Drive image not found: $imagePath"
    }
}
if ($Drive8Image) { $Drive8Image = (Resolve-Path -LiteralPath $Drive8Image).Path }
if ($Drive9Image) { $Drive9Image = (Resolve-Path -LiteralPath $Drive9Image).Path }

$AcmePath = (Resolve-Path -LiteralPath $AcmePath).Path
if ($Capture) {
    $VicePath = (Resolve-Path -LiteralPath $VicePath).Path
}
$previewDirectory = Join-Path $PSScriptRoot 'build\vice-preview'
$null = New-Item -ItemType Directory -Path $previewDirectory -Force
$previewDirectory = (Resolve-Path -LiteralPath $previewDirectory).Path
$previewName = if ($Menu) { 'DesktopPreviewMenu' } else { 'DesktopPreview' }
$captureName = if ($Menu) { 'desktop-menu' } else { 'desktop' }
$logName = if ($Menu) { 'vice-menu' } else { 'vice' }
if ($Loading) {
    $previewName = 'DesktopPreviewLoading'
    $captureName = 'desktop-loading'
    $logName = 'vice-loading'
}
if ($LoadingMessage) {
    $previewName += 'Message'
    $captureName += '-message'
    $logName += '-message'
}
if ($LoadingError) {
    $previewName += 'Error'
    $captureName += '-error'
    $logName += '-error'
}
if ($Browser) {
    $previewName += 'Browser'
    $captureName += '-browser'
    $logName += '-browser'
}
if ($Control -or $Music) {
    $previewName = if ($Music) { 'DesktopPreviewMusic' } else { 'DesktopPreviewControl' }
    $captureName = if ($Music) { 'desktop-music' } else { 'desktop-control' }
    $logName = if ($Music) { 'vice-music' } else { 'vice-control' }
}
if ($App -ge 0) {
    $previewName = "DesktopPreviewApp$App"
    $captureName = "desktop-app$App"
    $logName = "vice-app$App"
}
if ($IECDevice -ne 0) {
    $previewName = "DesktopPreviewIEC$IECDevice"
    $captureName = "desktop-iec$IECDevice"
    $logName = "vice-iec$IECDevice"
    if (($IECDevice -eq 8 -and -not $Drive8Image) -or ($IECDevice -eq 9 -and -not $Drive9Image)) {
        $captureName += '-missing'
        $logName += '-missing'
    }
}
$programPath = Join-Path $previewDirectory "$previewName.prg"
$screenshotPath = Join-Path $previewDirectory "$captureName.png"

Push-Location -LiteralPath $PSScriptRoot
try {
    & $AcmePath --msvc --format plain `
        --symbollist 'build/vice-preview/DesktopSymbols' `
        --outfile 'build/vice-preview/DesktopShellCode.bin' `
        'source/DesktopShellCode.asm'
    if ($LASTEXITCODE -ne 0) {
        throw "Desktop payload assembly failed (exit $LASTEXITCODE)."
    }

    & $AcmePath --msvc --format plain '-DPreviewApps=1' `
        --symbollist 'build/vice-preview/SettingsSymbols' `
        --outfile 'build/vice-preview/GeosSettings.bin' 'source/GeosSettings.asm'
    if ($LASTEXITCODE -ne 0) { throw 'Desktop settings assembly failed.' }

    $previewArguments = @(
        '--msvc', '--format', 'cbm',
        '--symbollist', "build/vice-preview/${previewName}Symbols",
        '--vicelabels', "build/vice-preview/${previewName}Labels",
        '--outfile', "build/vice-preview/$previewName.prg"
    )
    & $AcmePath --msvc --format plain '-DPreviewApps=1' `
        --symbollist 'build/vice-preview/AppSymbols' `
        --outfile 'build/vice-preview/GeosApps.bin' 'source/GeosApps.asm'
    if ($LASTEXITCODE -ne 0) { throw 'Desktop apps assembly failed.' }
    if ($Menu) { $previewArguments += '-DPreviewMenu=1' }
    if ($Loading) { $previewArguments += '-DPreviewLoading=1' }
    if ($Browser) { $previewArguments += '-DPreviewBrowser=1' }
    if ($Control) { $previewArguments += '-DPreviewControl=1' }
    if ($Music) { $previewArguments += '-DPreviewMusic=1' }
    if ($LoadingMessage -or $LoadingError) { $previewArguments += '-DPreviewLoadingMessage=1' }
    if ($LoadingError) { $previewArguments += '-DPreviewLoadingError=1' }
    if ($App -ge 0) { $previewArguments += "-DPreviewApp=$App" }
    if ($IECDevice -ne 0) { $previewArguments += "-DPreviewIEC=$IECDevice" }
    $previewArguments += 'source/DesktopPreview.asm'
    & $AcmePath @previewArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Desktop preview assembly failed (exit $LASTEXITCODE)."
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $programPath -PathType Leaf)) {
    throw "Assembly did not produce the preview program: $programPath"
}
Write-Output "Preview program: $programPath"
Write-Output "Preview symbols: $(Join-Path $previewDirectory 'DesktopSymbols')"

if (-not $Capture) {
    Write-Output 'Build only; no emulator launched. Add -Capture to save a hidden VICE screenshot.'
    return
}

$stdoutPath = Join-Path $previewDirectory "$logName-stdout.log"
$stderrPath = Join-Path $previewDirectory "$logName-stderr.log"
$viceLogPath = Join-Path $previewDirectory "$logName.log"
$cycleLimit = if ($IECDevice -ne 0) { '30000000' } else { '12000000' }
$viceArguments = @(
    '-default', '+save', '-console', '+sound', '-warp', '-pal',
    '-limitcycles', $cycleLimit,
    '-autostartprgmode', '1', '-autostart-delay', '0',
    '-logfile', $viceLogPath,
    '-exitscreenshot', $screenshotPath,
    '-autostart', $programPath
)
# Test media are always attached read-only. An omitted device is explicitly
# disabled so the missing-drive case cannot pick up a saved drive definition.
if ($Drive8Image) {
    $viceArguments += @('-drive8type', '1541', '-attach8ro', '-8', $Drive8Image)
} elseif ($IECDevice -eq 8) {
    $viceArguments += @('-drive8type', '0')
}
if ($Drive9Image) {
    $viceArguments += @('-drive9type', '1541', '-attach9ro', '-9', $Drive9Image)
} elseif ($IECDevice -eq 9) {
    $viceArguments += @('-drive9type', '0')
}
# Start-Process joins ArgumentList with spaces; quote each argument so paths with
# spaces remain single arguments. Windows filenames cannot contain a double quote.
$viceArgumentLine = ($viceArguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
$captureStartedUtc = [DateTime]::UtcNow
$viceProcess = Start-Process -FilePath $VicePath `
    -WorkingDirectory $previewDirectory -ArgumentList $viceArgumentLine `
    -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
try {
    if (-not $viceProcess.WaitForExit(45000)) {
        $viceProcess.Kill()
        $null = $viceProcess.WaitForExit(5000)
        throw "VICE capture timed out; only this preview process was stopped. Logs: $previewDirectory"
    }
    $viceProcess.Refresh()
    # VICE 3.10 reports its requested cycle-limit shutdown as exit code 1.
    # Accept only that explicit condition; a fresh screenshot is checked below.
    $reachedCycleLimit = $false
    if ($viceProcess.ExitCode -eq 1 -and (Test-Path -LiteralPath $viceLogPath -PathType Leaf)) {
        $reachedCycleLimit = [bool](Select-String -LiteralPath $viceLogPath -SimpleMatch 'Main CPU: Error - cycle limit reached.' -Quiet)
    }
    if ($viceProcess.ExitCode -ne 0 -and -not $reachedCycleLimit) {
        throw "VICE capture failed (exit $($viceProcess.ExitCode)). Logs: $previewDirectory"
    }
}
finally {
    $viceProcess.Dispose()
}

if (-not (Test-Path -LiteralPath $screenshotPath -PathType Leaf)) {
    throw "VICE did not produce a screenshot. Logs: $previewDirectory"
}
$screenshotFile = Get-Item -LiteralPath $screenshotPath
if ($screenshotFile.Length -eq 0 -or $screenshotFile.LastWriteTimeUtc -lt $captureStartedUtc) {
    throw "VICE did not produce a fresh screenshot. Logs: $previewDirectory"
}
Write-Output "Preview screenshot: $screenshotPath"
Write-Output 'Capture complete; VICE exited without saving user settings.'
