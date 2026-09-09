# NESVM 1.1 for TeensyROM+

NESVM 1.1 adds mappers 1, 2, 3, 4 and 7, cartridge saves and the NUFLIX F5 display.
Use **MPE firmware 1.2.6 or later**, TeensyROM+ v0.4 and a Teensy 4.1.
Download [NESVM.zip](https://github.com/ziggystar12/MHS-Teensy-Rom-Power-Engine/raw/refs/heads/main/vms/NESVM.zip)
and extract it to the SD card root, replacing the supplied runtime files while
keeping your ROMs and saves. Exit and relaunch NESVM after installing.
Firmware is downloaded separately from the public MHS Power Engine project.

Launch `NESVM.crt`, or select a `.nes` file in the GUI. Put compatible ROMs
in `/VMS/NESVM/ROMS/`. Only the authorized Crossbow demo is included.

## Controls and display

Port-2 Fire is A. A C64GS-compatible second button on POTX/pin 9 or Space is B.
Return is Start; standalone Shift is Select. Start+Select returns to the picker.
Joystick Up/Down changes rows and Left/Right changes pages. Keyboard cursor
Down/Right does the same; Shift reverses direction without sending Select.

Hold **Commodore + Control** and press an unshifted function key:

- **F1 Standard:** full-frame multicolor view.
- **F3 Pan and scan:** a 160x200 native-pixel crop; hold WASD to pan.
- **F5 NUFLIX:** full-frame conversion using the MPE NUFLIX display service.
- **F7 Sharp:** centered hires view.

F5 uses a different display conversion and can take longer to update.
The new engine and launcher must be installed together.

## Compatibility and saves

NES emulation uses NTSC timing on either a PAL or NTSC C64. Supported
mappers are 0, 1, 2, 3, 4, 7 and 11, within these board limits:

| Mapper | Board | Maximum PRG ROM | CHR memory |
|---|---|---|---|
| 0 | NROM | 32 KiB | 8 KiB ROM or RAM |
| 1 | MMC1B/C | 256 KiB | Up to 128 KiB ROM or 8 KiB RAM |
| 2 | UxROM | 256 KiB | 8 KiB RAM |
| 3 | CNROM | 32 KiB | Up to 32 KiB ROM |
| 4 | MMC3 | 256 KiB | Up to 128 KiB ROM or 8 KiB RAM |
| 7 | AxROM | 256 KiB | 8 KiB RAM |
| 11 | Color Dreams | 128 KiB | Up to 128 KiB ROM |

Mapper 1 and 4 support up to 8 KiB cartridge RAM. Extended MMC1 boards
such as SUROM, SXROM and SOROM, MMC1A behavior, four-screen nametables
and larger RAM configurations are not supported. Mappers 2, 3 and 7
accept NES 2.0 submappers 1/2 for explicit bus-conflict behavior; other
nonzero submappers are excluded. The instruction/scanline core approximates
PPU fetch timing, including MMC3 interrupts; cycle-exact raster effects
are not guaranteed.

**Known limitation:** Battletoads currently stalls after its intro because
of sprite timing in the graphics core. It is not playable in this release.

Mapper 1/4 cartridge RAM is saved automatically about every five seconds and
when returning to the picker with Start+Select. Save before powering off.
NESVM creates `/VMS/NESVM/SAVES/` and keeps two verified records per ROM.
The previous valid record survives an interrupted write. Keep that folder
when installing an update. A save failure is shown in the picker; Fire
retries it. Do not power off while a failed save is pending.

Sound is approximated through the SID. Pulse sweeps/envelopes and held-input
fixes are retained. DMC sample timing, mapped reads and interrupts now run,
allowing games such as Dr. Mario to continue. DMC samples are not mixed into
SID sound. Noise shares SID voice 3 with triangle; the NES triangle linear
counter and cycle-exact DMA overlap/joypad quirks remain outside this build.

Mapper, DMC, save recovery, module input/audio, and PAL/NTSC VICE display
checks passed. Super Mario Bros., Zelda and Dr. Mario reached gameplay in
the actual module under a host harness; display captures use the C64 client
in VICE. These are software checks, not new physical hardware measurements
or a claim that every game is compatible.

## Source and credits

The ZIP contains runtime files, the Crossbow demo, installation notes and
licenses. Corresponding source and rebuild instructions are provided
separately in [Source/NESEngine](https://github.com/ziggystar12/MHS-Teensy-Rom-Power-Engine/tree/main/Source/NESEngine)
and [Source/NESClient](https://github.com/ziggystar12/MHS-Teensy-Rom-Power-Engine/tree/main/Source/NESClient).

MHS developed the MPE platform and NESVM integration. TeensyROM hardware
and original firmware are by Travis Smith / Sensorium Embedded. NESVM uses
Matthew Conte's Nofrendo, ported through Jean-Marc Harvengt's MCUME, and
the NUFLIX display template by Patai Gergely. See the included notices
and licenses for attribution and terms.
