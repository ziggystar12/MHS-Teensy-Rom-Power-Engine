# MPE firmware 1.2.5

Download [MPE_Firmware-V1.2.5.hex](MPE_Firmware-V1.2.5.hex) for TeensyROM+
v0.4 / Teensy 4.1. This combines the latest desktop, graphical Clock,
Appearance/Input fixes, NUFLIX host and MHS Doom F1 colour converter.

Copy the HEX to the SD root, select it in the firmware updater, confirm the
installation and leave power connected until restart. About should show 1.2.5.
Reinstall manually if you used an earlier test with the same version label.
Automatic discovery only offers strictly newer versions.

The two-button startup flasher is removed. Normal manual updates remain;
if the firmware cannot start, use the PJRC hardware loader over USB.

Install the full DoomVM 1.2 package for the new F1 picture and solid status
bar. Keep existing music. F7 Sharp and the other display profiles are unchanged.
The source builds and software checks pass; physical testing is still needed.
