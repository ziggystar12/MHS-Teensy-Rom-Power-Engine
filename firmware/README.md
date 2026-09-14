# GUI firmware 1.2.23

[Download MPE_Firmware-V1.2.23.hex](MPE_Firmware-V1.2.23.hex) for TeensyROM+
v0.4 / Teensy 4.1. This combines the desktop, current MPE host and Prism+.
Use it with NESVM 1.2.0 and DoomVM 1.2.1.

It remembers the selected drive, adds persistent desktop shortcuts, opens NES
ROMs directly through their installed package, and supports .MPE game files.
The hardened updater and September 13 upstream DMA/MIDI fixes remain.
[Changes, installation and validation](../docs/FIRMWARE-1.2.23.md).

Copy the HEX to the SD root, select it in the updater, leave power connected
until restart, and confirm 1.2.23 in About. Copying the file does not flash it.
Automatic discovery offers strictly newer versions; manual selection supports
reinstallation. Preserve existing VM packages, ROMs, music and saves.

SHA-256: `3009715813faec679688fc939be20f6ed2271ebc9309744567520541819d4606`.

[Firmware relinking SDK](MPE-Firmware-1.2.23-Relink-SDK.zip) ·
[Prism+ licensing](../docs/PRISM-PLUS-LICENSE.md) ·
[Older 1.2.6 firmware](MPE_Firmware-V1.2.6.hex)
