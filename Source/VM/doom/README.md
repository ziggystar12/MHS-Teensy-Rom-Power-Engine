# Doom source

The `gba` directory adapts GBADoom/PrBoom for TeensyROM+.
The complete edited engine source is available separately in
[Source/DoomEngine](../../DoomEngine/). [Build instructions](../../../docs/BUILDING.md).

The engine is GPL-2.0-or-later. See `COPYING.GPL-2.0`; individual source files
retain their original notices. The runtime ZIP includes converted Doom shareware
1.9 game data under its separate [notices](../../../docs/DOOM-SHAREWARE-LICENSE.txt).

## Optional SID music

The converter runs a supported SID player offline and saves its register
updates. Doom reads those updates from SD without running a second emulator.

From the repository root:

```powershell
node scripts/convert-doom-sid.mjs input.sid doom-e1m1-pal.s3m pal
node scripts/convert-doom-sid.mjs input.sid doom-e1m1-ntsc.s3m ntsc
```

Copy both files into `VMS/DOOMVM/`. Doom chooses the right pitch for PAL or
NTSC automatically. Both versions keep the original 50 Hz music tempo.

The converter supports a limited class of single-song, single-SID PAL PSID
players. CIA-timed, sampled/digi, RSID and multi-SID tunes are not supported.
Only distribute converted music when you have permission to do so.
