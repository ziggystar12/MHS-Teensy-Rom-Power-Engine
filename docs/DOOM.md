# DoomVM 1.2.1

DoomVM brings Doom shareware to TeensyROM+ v0.4 with a Teensy 4.1.
Use **MPE GUI firmware 1.2.23**. Firmware and DoomVM have separate versions.

## Setup

Extract [DoomVM 1.2.1](../vms/DOOMVM.zip) to the root of your SD card, then
launch `DOOMVM.crt`. The download includes the engine, launcher and
ready-to-use `doom1.gbd` game data from Doom shareware 1.9 (the free demo).

Use the current [GUI firmware](../firmware/) on TeensyROM+ v0.4 with a
Teensy 4.1. The same Doom launcher works on PAL and NTSC C64s.
Music is optional; gameplay and sound effects work without music files.

## Controls

| Control | Action |
| --- | --- |
| W/S or Up/Down | Move |
| Left/Right | Turn |
| A/D | Strafe |
| Control or joystick fire | Shoot |
| Space | Open doors / use |
| Return | Run / accept menu choice |
| Tab | Map |
| Escape | Menu |
| M | Music on/off |
| Reset | Return to the desktop |

Use the joystick in port 2.

## Display

**MHS Prism and Prism+ do not apply to DoomVM.** DoomVM uses the separate display
modes listed below.

Hold Commodore + Control and press an unshifted function key:

| Key | Display |
| --- | --- |
| F1 | Multicolor, wide pixels |
| F3 | Auto-8 |
| F5 | Enhanced colour detail |
| F7 | Sharp |

These select a mode rather than toggle it. F3 and F5 can update less smoothly
than the simpler modes.

F1 improves shading and colour selection without FLI or alternating frames.
Install the current firmware and the full Doom ZIP to enable it; older firmware
falls back to the previous F1 picture. F7 Sharp is unchanged.

## Music

Optional music uses two files in `VMS/DOOMVM/`:

- `doom-e1m1-pal.s3m`
- `doom-e1m1-ntsc.s3m`

The VM picks the right one automatically. Press M to turn music on or off.
Sound effects briefly use one of the three SID voices, then return it to the
music. Without music files, sound effects still work normally.

You can get a great music file here: https://csdb.dk/release/?id=205284

These are converted SID-register files, not ordinary S3M tracker songs.
The [source notes](../Source/VM/doom/README.md) explain how to prepare them.

## Current limits

The normal route is **E1M1 → E1M4 → E1M5 → E1M8**. Maps 2, 3, 6 and 7 exceed
the current memory budget and are skipped automatically. Weapons, ammunition,
health and armor carry over. There is no intermission screen between maps.
The secret E1M9 also fits, but its entrance is inaccessible when E1M3 is skipped.

E1M4 and E1M5 use smaller texture caches to make room for map data. Other
maps retain the original cache. The tradeoff is more SD reads, so smoothness
and stability on real hardware still need testing. Rendering, combat,
transitions and all four video modes pass the host tests.

Optional music continues with the same tune across levels and can also be
included in a self-contained `.MPE` game.
Saving is not supported. Display and sound are adapted to the C64's capabilities.

Physical gameplay and custom-bus timing remain unverified for this release.

[Credits and licenses](../README.md#credits)
