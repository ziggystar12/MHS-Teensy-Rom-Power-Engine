# Doom adapter

This is the Teensy host adapter for the GBADoom/PrBoom engine.

- core.c connects Doom startup and game ticks.
- episode.inc handles exits, inventory carryover and oversized-map skipping.
- platform.cpp provides memory, files and the framebuffer.
- w_wad.c streams converted game resources from SD.
- video.c and status.c draw the game and HUD.
- sound.c and sid_stream.h provide SID effects and optional music.
- doomvm.cpp connects the engine to the shared VM host.

The engine renders at 320x200. Firmware converts that image for the C64
display. The normal route is E1M1 → E1M4 → E1M5 → E1M8, skipping maps that
exceed memory. E1M4 uses a 96 KiB texture cache and E1M5 uses 80 KiB; other
maps retain 128 KiB. The existing firmware 1.1.9 layout is unchanged.

[Build instructions](../../../../README.md) ·
[Setup and controls](../../../../../README.md)
