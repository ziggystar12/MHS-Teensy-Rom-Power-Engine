# NESVM for TeensyROM+

Download [NESVM.zip](https://github.com/ziggystar12/MHS-Teensy-Rom-Power-Engine/raw/refs/heads/main/vms/NESVM.zip). Extract into the SD card root, replacing
the supplied runtime files while keeping your ROMs and saves, then exit
and relaunch NESVM. Use **MPE firmware V1.1.13 or later** with TeensyROM+ v0.4 and a Teensy 4.1.
The current public firmware is available in the project Downloads section. The ZIP does not contain firmware.

This build includes the committed held-fire input fixes, pulse pitch sweeps
and envelopes, and the SID correction for Mario's jump sound cutting off.
Input is forwarded while waiting for video/audio, and pending sound restarts
survive delayed transfers. The accepted F3 crop renderer is retained.

Launch `NESVM.crt`, or select a `.nes` file in the GUI. Your ROMs belong in
`/VMS/NESVM/ROMS/`. The ZIP includes only the authorized Crossbow demo.
Current support remains NTSC mapper 0/11 with approximate SID sound.

Port-2 Fire is A (jump), and the C64GS-compatible second button on POTX/pin 9
(including the Cheetah Annihilator base button) is B (run/fire). Space remains
keyboard B; Return is Start, and standalone Shift is Select. Start+Select
returns to the picker. Joystick Up/Down changes rows and Left/Right changes
pages. Keyboard cursor Down/Right does the same; either Shift reverses those
directions without also sending Select. Reset returns to the GUI.

Hold **Commodore + Control** and press an unshifted function key:

- **F1:** Fast full-frame multicolor view.
- **F3:** Centered 160x200 native-pixel crop; hold WASD to pan the camera.
- **F5:** Experimental enhanced view, with the NES image centered.
- **F7:** Normal hires view, with the NES image centered.

The released engine and client previously passed the NES module, input/audio,
video-control and PAL/NTSC boot regressions. The C64GS two-button mapping has
also passed the supplied hardware test; this does not claim new physical
audio/display measurements. Noise shares SID voice 3 with triangle; triangle
linear-counter and DMC support remain outside these fixes.

The ZIP contains runtime files, the Crossbow demo, installation notes and
licences. Corresponding engine source and rebuild instructions are available
separately in [Source/NESEngine](https://github.com/ziggystar12/MHS-Teensy-Rom-Power-Engine/tree/main/Source/NESEngine);
launcher source is in [Source/NESClient](https://github.com/ziggystar12/MHS-Teensy-Rom-Power-Engine/tree/main/Source/NESClient).
The [build record](https://github.com/ziggystar12/MHS-Teensy-Rom-Power-Engine/blob/main/docs/NESVM-build.json) identifies the
released binaries. Firmware is downloaded separately.

NES emulation uses NTSC timing even when the C64 display is PAL. Compatibility
is limited to mapper 0 and mapper 11; this release does not claim full NES
compatibility. Use your own compatible ROMs in addition to the included demo.

MHS developed the MPE platform and NESVM integration. TeensyROM hardware and
original firmware are by Travis Smith / Sensorium Embedded. The engine uses
Matthew Conte's Nofrendo, ported through Jean-Marc Harvengt's MCUME. See
NOTICES.md and LICENSE-Nofrendo.txt for the retained notices and licence.
