# VM downloads

Use **MPE GUI firmware 1.2.23 or later** with these releases on TeensyROM+
v0.4 and a Teensy 4.1. [Download the firmware separately](../firmware/).
Extract each ZIP to the SD card root, replacing its matching engine and
launcher together. Keep your existing ROMs, game data and saves.

## NESVM 1.2.0

[Download NESVM 1.2.0](NESVM.zip)

NESVM runs compatible NTSC mapper 0/1/2/3/4/7/11 NES games. This release adds
the current core timing improvements, MHS Prism+ F5 graphics and continuing
SID updates during picture transfers. Prism+ keeps a complete picture visible
while preparing the next display bank and reuses unchanged conversion work.
F5 shows all 256 NES columns between black side margins. C64 palette and
display constraints still apply; no particular hardware frame rate is promised.

Hold Control + Commodore and press unshifted F1 for Standard, F3 for pan and
scan, or F5 for Prism+. F7 is ignored. Port-2 Fire is A, a C64GS-compatible
second button or Space is B, Return is Start, and standalone Shift is Select.

Launch NESVM.crt or select a compatible .nes file in the GUI or classic text
SD browser. The ZIP contains only the authorized Crossbow demo. Put other
compatible ROMs in /VMS/NESVM/ROMS/ for the picker and keep /VMS/NESVM/SAVES/.
Sound uses the SID; DMC sample timing is emulated but samples are not mixed
into SID sound. MMC3 timing remains approximate, and Battletoads stalls
after its intro. [Setup, controls and compatibility limits](../docs/NESVM.md).

## DoomVM 1.2.1

[Download DoomVM 1.2.1](DOOMVM.zip)

Launch DOOMVM.crt after extracting the complete ZIP. It includes the engine,
universal PAL/NTSC C64 launcher, notices, and ready-to-use doom1.gbd game data
from Doom shareware 1.9. Keep the shareware license with that data.
The package retains status-read recovery and its separate display modes,
including F1 multicolor and F7 Sharp. **DOOMVM does not use Prism+.**

Music is optional; gameplay and sound effects work without music files.
The normal route is E1M1 → E1M4 → E1M5 → E1M8; oversized maps are skipped.
Host checks and VICE captures do not establish physical gameplay performance.
[Setup, controls and optional music](../docs/DOOM.md).

## GBVM — Game Boy and Game Boy Color

[Download GBVM](GBVM.zip) · [SHA-256 checksums](SHA256SUMS.txt)

Extract the ZIP to the SD root and open `GBVM.crt`. Put your own compatible
`.gb` and `.gbc` ROMs in `/VMS/GBVM/ROMS/`, or select one directly in the
firmware SD browser. No game ROMs or saves are included.

GBVM supports cartridges up to **2 MiB**, using SD bank caching, with cartridge
type 00 and the supported MBC1, MBC3 and MBC5 variants. Cartridge RAM may be
0, 8 or 32 KiB; MBC1 ROMs above 512 KiB require 0/8 KiB RAM. MBC1M and other
mapper types are unsupported. The included README lists exact cartridge types
and save behavior. MBC3 clocks advance only while the game is running.

F1 displays all 160×144 source pixels at double width, centered vertically.
Game Boy Color colors are reduced to the C64 palette; sound is a SID
approximation. F1 is the only supported gameplay display mode.

Use joystick port 2 or cursors to move, Fire for A, Space or the C64GS second
button for B, Return for Start, and Shift for Select. Start + Select saves and
returns to the picker. Keep `/VMS/GBVM/SAVES/` when updating, and return to the
picker before powering off. Other emulators' `.sav` files are not imported.

## GGVM — Game Gear

[Download GGVM](GGVM.zip) · [SHA-256 checksums](SHA256SUMS.txt)

Extract the ZIP to the SD root and open `GGVM.crt`. Put your own compatible
`.gg` cartridges in `/VMS/GGVM/ROMS/`, or select one directly in the firmware
SD browser. The picker lists up to 256 games. No game ROMs or BIOS are included.

GGVM supports standard Sega-mapper Game Gear cartridges up to **1 MiB** through
SD bank caching. Codemasters cartridges, Master System mode, link cable, FM
and save states are unsupported. F1 displays all 160×144 Game Gear pixels at
double width, centered vertically, with colors converted to the C64 palette.
Sound is a PSG-to-SID approximation. The package includes bounded Sonic 2
boot-time "SEGA" speech support; replace the engine and client together.

Use joystick port 2 or cursors to move, Fire for button 1, Space or the C64GS
second button for button 2, and Return for Start. Shift + Return saves and
returns to the picker. Keep `/VMS/GGVM/SAVES/` when updating, and return to the
picker before powering off. Battery saves are separate from save states.

Both handheld VM packages retain their existing development validation status:
host/core/client checks are recorded, while physical C64 performance, audio
and full-game compatibility remain unverified. Each ZIP includes runtime files,
installation notes and component licenses, with no bundled source tree.

## Source and licenses

Each download retains its component licenses and notices. Complete
corresponding engine source and rebuild instructions are available for
[NESVM](../Source/NESEngine/) and [DoomVM](../Source/DoomEngine/). Nofrendo
and the NES engine adapter retain GNU Library GPL version 2 rights.

The new MHS Prism+ C64 receiving and relocation implementation is supplied as
compiled code with its implementation source private. Its restricted license
applies only to the identified new MHS contributions and preserves earlier
MIT grants and third-party rights. [Source/NESClient](../Source/NESClient/)
is the historical NESVM 1.1.2 client source, not this Prism+ client's source.

The current firmware has separate [relinking materials and build instructions](../docs/BUILDING.md)
for its LGPL libraries. Rebuilding a VM engine does not require relinking the
firmware. [License and component boundaries](../docs/PRISM-PLUS-LICENSE.md).
