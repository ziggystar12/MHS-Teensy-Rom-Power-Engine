[CmdletBinding()]
param(
    [string]$AcmePath = $env:ACME_EXE,
    [string]$PythonPath = 'python'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$menuRoot = Join-Path $repositoryRoot 'Source\C64\MainMenuCRT'
$romRoot = Join-Path $repositoryRoot 'Source\Teensy\TRMenuFiles\ROMs'

if ([string]::IsNullOrWhiteSpace($AcmePath)) { $AcmePath = 'acme' }
$assembler = (Get-Command $AcmePath -CommandType Application -ErrorAction Stop).Source
$python = (Get-Command $PythonPath -CommandType Application -ErrorAction Stop).Source

function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable failed with exit code $LASTEXITCODE"
    }
}

# Menu_Regs.h is the source of truth for both sides of the cartridge protocol.
Invoke-Checked $python @((Join-Path $repositoryRoot 'Source\C64\gen_menu_regs_i.py'))
$null = New-Item -ItemType Directory -Path (Join-Path $menuRoot 'build') -Force
Push-Location -LiteralPath $menuRoot
try {
    # The wrapper embeds the desktop and apps; the cartridge embeds MainMenu.
    # Build every dependency before either wrapper or firmware header is made.
    Invoke-Checked $assembler @('--msvc', '--format', 'plain',
        '--vicelabels', 'build/MainSymbols', '--outfile', 'build/MainMenu.bin', 'source/MainMenu.asm')
    Invoke-Checked $assembler @('--msvc', '--format', 'plain',
        '--symbollist', 'build/DesktopSymbols', '--vicelabels', 'build/DesktopShellCodeSymbols',
        '--outfile', 'build/DesktopShellCode.bin', 'source/DesktopShellCode.asm')
    Invoke-Checked $assembler @('--msvc', '--format', 'plain',
        '--symbollist', 'build/AppSymbols', '--outfile', 'build/GeosApps.bin', 'source/GeosApps.asm')
    Invoke-Checked $assembler @('--msvc', '--format', 'plain',
        '--symbollist', 'build/SettingsSymbols', '--outfile', 'build/GeosSettings.bin', 'source/GeosSettings.asm')
    Invoke-Checked $assembler @('--msvc', '--format', 'cbm',
        '--symbollist', 'build/DesktopSnakeSymbols', '--outfile', 'build/DesktopSnake.prg', 'source/DesktopSnake.asm')
    Invoke-Checked $assembler @('--msvc', '--format', 'cbm',
        '--symbollist', 'build/DesktopCalculatorSymbols', '--outfile', 'build/DesktopCalculator.prg', 'source/DesktopCalculator.asm')
    Invoke-Checked $assembler @('--msvc', '--format', 'cbm',
        '--symbollist', 'build/DesktopTextViewerSymbols', '--outfile', 'build/DesktopTextViewer.prg', 'source/DesktopTextViewer.asm')
    Invoke-Checked $assembler @('--msvc', '--format', 'cbm',
        '--vicelabels', 'build/DesktopShellSymbols', '--outfile', 'build/DesktopShell.prg', 'source/DesktopShell.asm')
    Invoke-Checked $assembler @('--msvc', '--format', 'plain',
        '--vicelabels', 'build/CartSymbols', '--outfile', 'build/TeensyROMC64.bin', 'source/TeensyROMC64.asm')

    foreach ($bound in @(
        @{ File = 'TeensyROMC64.bin'; Maximum = 8192 },
        @{ File = 'DesktopShellCode.bin'; Maximum = 22528 },
        @{ File = 'GeosApps.bin'; Maximum = 4096 },
        @{ File = 'GeosSettings.bin'; Maximum = 4096 },
        @{ File = 'DesktopSnake.prg'; Maximum = 4098 },
        @{ File = 'DesktopCalculator.prg'; Maximum = 4098 },
        @{ File = 'DesktopTextViewer.prg'; Maximum = 4098 }
    )) {
        $size = (Get-Item -LiteralPath (Join-Path 'build' $bound.File)).Length
        if ($size -le 0 -or $size -gt $bound.Maximum) {
            throw "$($bound.File): $size bytes exceeds its $($bound.Maximum)-byte reservation"
        }
        Write-Output "$($bound.File): $size / $($bound.Maximum) bytes"
    }

    Invoke-Checked $python @('../bin2header.py', 'build/TeensyROMC64.bin')
    Invoke-Checked $python @('../bin2header.py', '-t', 'PROGMEM ', 'build/DesktopShell.prg')
    Invoke-Checked $python @('../bin2header.py', '-t', 'PROGMEM ', 'build/DesktopSnake.prg')
    Invoke-Checked $python @('../bin2header.py', '-t', 'PROGMEM ', 'build/DesktopCalculator.prg')
    Invoke-Checked $python @('../bin2header.py', '-t', 'PROGMEM ', 'build/DesktopTextViewer.prg')
    Copy-Item -LiteralPath 'build/TeensyROMC64.bin.h' -Destination (Join-Path $romRoot 'TeensyROMC64.h') -Force
    Copy-Item -LiteralPath 'build/DesktopShell.prg.h' -Destination (Join-Path $romRoot 'DesktopShell.prg.h') -Force
    Copy-Item -LiteralPath 'build/DesktopSnake.prg.h' -Destination (Join-Path $romRoot 'DesktopSnake.prg.h') -Force
    Copy-Item -LiteralPath 'build/DesktopCalculator.prg.h' -Destination (Join-Path $romRoot 'DesktopCalculator.prg.h') -Force
    Copy-Item -LiteralPath 'build/DesktopTextViewer.prg.h' -Destination (Join-Path $romRoot 'DesktopTextViewer.prg.h') -Force
}
finally {
    Pop-Location
}
Push-Location -LiteralPath (Join-Path $repositoryRoot 'Source\C64\TRHelpScreens')
try {
    $null = New-Item -ItemType Directory -Path 'build' -Force
    Invoke-Checked $assembler @('--format', 'cbm', '--outfile', 'build/TRHelpScreens.prg', 'source/TRHelpScreens.asm')
    Invoke-Checked $python @('../bin2header.py', '-t', 'PROGMEM ', 'build/TRHelpScreens.prg')
    Copy-Item -LiteralPath 'build/TRHelpScreens.prg.h' -Destination (Join-Path $romRoot 'TRHelpScreens.prg.h') -Force
}
finally { Pop-Location }
Write-Output 'C64 menu, Help and firmware headers rebuilt. Build the complete TeensyROM+ firmware next.'
