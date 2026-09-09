# VM downloads

## NESVM 1.1.1

[Download NESVM 1.1.1](NESVM.zip)

NESVM runs compatible NTSC mapper 0/1/2/3/4/7/11 NES games through MPE on TeensyROM+
v0.4 with a Teensy 4.1. F5 now centers the native 256-pixel image with black
side margins, trims eight overscan rows at each end, and fits the remaining
224 rows into 200. Changed-cell tracking reduces conversion work; the C64
NUFLIX display and transfer protocol remain the same. F5 green tones are improved
across games. Standard F1, pan and scan F3, Sharp F7, supported
mappers and cartridge saves are retained. Use **firmware 1.2.6 or later**,
downloaded separately.

Extract to the SD root and launch `NESVM.crt`. The authorized Crossbow demo
is included; put compatible ROMs in `/VMS/NESVM/ROMS/`. Keep existing saves
in `/VMS/NESVM/SAVES/`. Install the matching engine and launcher together.

Port-2 Fire is A; a C64GS-compatible second button or Space is B. Return is
Start and Shift is Select. Sound is approximated through the SID; DMC sample
playback is emulated for game operation but is not mixed into SID sound.
MMC3 timing remains approximate, and Battletoads still stalls after its intro.
Host and VICE checks do not establish physical gameplay speed.
[Setup, controls, display modes and exact compatibility limits](../docs/NESVM.md).

Licenses and notices are included. Corresponding source and build instructions
are separate: [NES engine](../Source/NESEngine/) and [C64 launcher](../Source/NESClient/).

## DoomVM

[Download DoomVM 1.2](DOOMVM.zip)

DoomVM is versioned separately from the firmware. This is DoomVM **1.2**,
paired with current firmware **1.2.6**. The download keeps the name `DOOMVM.zip`;
its README and `VMS/DOOMVM/version.json` identify the installed VM version.

Extract the ZIP to the root of your SD card and launch `DOOMVM.crt`.
It includes the engine, launcher and ready-to-use `doom1.gbd` game data from
Doom shareware 1.9 (the free demo). The same launcher works on PAL and NTSC
C64s with TeensyROM+.

Install the [current GUI firmware](../firmware/) and this full ZIP for improved
F1 multicolor shading. F7 Sharp is unchanged. The package retains the
status-read recovery launcher and existing shareware game data.
Music is optional: gameplay and sound effects work with no music files
installed. [Optional music instructions](../docs/DOOM.md#music).

Only the engine's video-profile negotiation changes; gameplay is unchanged.
Complete corresponding source and build tools are available separately in
[Source/DoomEngine](../Source/DoomEngine/).

The normal route is E1M1 → E1M4 → E1M5 → E1M8. Oversized maps are skipped.
The added levels pass host tests; physical gameplay testing is still needed.

[Setup and controls](../docs/DOOM.md)
