# NESVM 1.2.1 for TeensyROM+

This release fixes **STAGE 03 ERROR 09: SID OR END BEFORE BASE IMAGE** when
opening a `.nes` file directly. Startup now establishes the first picture
before sound packets, including when the emulation needs to catch up. The
picker, current core timing improvements, MHS Prism+ graphics and continuing
SID updates during later picture transfers remain available.
Use **MPE GUI firmware 1.2.23 or later**, or Travis's **MPE integration 1.2.24**
with host library 1.2.23, on TeensyROM+ v0.4 and a Teensy 4.1.
Download the [current GUI firmware](../firmware/) separately.
See the [Prism+ overview](MHS-PRISM.md) and [release build record](NESVM-build.json).
The [startup verification](CONSOLE-STARTUP-UPDATE.md) reproduces the old direct
launch failure and checks the corrected route and picker on PAL and NTSC.

Download [NESVM.zip](../vms/NESVM.zip)
and extract it to the SD card root, replacing the supplied runtime files while
keeping your ROMs and saves. Exit and relaunch NESVM after installing.
The engine and client must be installed together.

Launch `NESVM.crt`, or select a compatible `.nes` file directly in the GUI or
classic text SD browser. Direct launching retains the selected file's full
path, including nested folders and spaces. The installed NESVM package must
be present and valid. For the built-in picker, put compatible ROMs in
`/VMS/NESVM/ROMS/`. Only the authorized Crossbow demo is included.

## Controls and display

Port-2 Fire is A. A C64GS-compatible second button on POTX/pin 9 or Space is B.
Return is Start; standalone Shift is Select. Start+Select returns to the picker.
Joystick Up/Down changes rows and Left/Right changes pages. Keyboard cursor
Down/Right does the same; Shift reverses direction without sending Select.

Hold **Commodore + Control** and press an unshifted function key:

- **F1 Standard:** full-frame multicolor view.
- **F3 Pan and scan:** a 160x200 native-pixel crop; hold WASD to pan.
- **F5 MHS Prism+:** all 256 NES columns, centered between 32-pixel black side
  borders. Eight source lines are trimmed from the top and bottom, then the
  remaining 224 lines are squeezed into 200.

F7 Sharp has been removed and is ignored. It is not an alternate mode.

MHS Prism+ is an independent MHS renderer for the C64's 320x200 display and
16-color palette. It keeps a complete picture visible while preparing the
next picture in the inactive display bank, then flips at the border. Cached
conversion and changed-area updates reduce repeated work; quiet pictures can
receive additional refinement. NESVM requests a shortcut for its known black
side margins. Actual pixel color choices still follow C64 display constraints.

Once the initial picture is established, SID changes can continue while the
next picture is being transferred. This avoids making audio updates wait for
every new video frame. Picture data transfer can still limit motion smoothness;
these changes do not promise a particular hardware frame rate.

The C64 palette approximates NES colors. Green shades remain green across
games; very dark green is brighter because the C64 has no darker green.
**DOOMVM does not use Prism+.**

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

## Validation

The release engine passed 12 focused host suites covering CPU/PPU, APU/DMC
timing, mapper behavior, input, saves, and video/audio acknowledgements. The
compiled C64 receiver passed F1/F3/F5 controls, ignored-F7, memory-isolation
and packet-ownership checks. All 16 PAL/NTSC VICE display checks passed.
Seven generated-ROM cases passed direct-launch path and failure checks.
The standalone engine source rebuilds byte-for-byte to the supplied engine.
These are software checks, not new physical hardware measurements or a claim
that every game is compatible.

## Source and credits

The ZIP contains runtime files, the Crossbow demo, installation notes and
licenses. Complete corresponding NES engine source and rebuild instructions
are provided in [Source/NESEngine](../Source/NESEngine/).
Nofrendo and the MPE engine adapter retain GNU Library GPL version 2 rights.

The new MHS Prism+ C64 receiving and relocation implementation is distributed
as compiled code under LICENSE-PRISM-PLUS.txt; its implementation source is
private. Earlier MHS infrastructure retains its MIT rights. The older
Source/NESClient directory is a historical source snapshot for NESVM 1.1.x,
not corresponding source for this release's Prism+ client. The ZIP includes NOTICES.md and COMPONENTS.json with the component boundaries
and existing rights. See the [license overview](PRISM-PLUS-LICENSE.md) for
firmware relinking and separately licensed engine source.

MHS developed the MPE platform and NESVM integration. TeensyROM hardware
and original firmware are by Travis Smith / Sensorium Embedded. NESVM uses
Matthew Conte's Nofrendo, ported through Jean-Marc Harvengt's MCUME.
