# MPE firmware 1.2.6

This update brings in Travis's latest TeensyROM 0.8.0.5 changes, including
Final Cartridge III support by Paul Harker, the Alternate-button default
correction and a firmware-update space check.

A shared video fix lets NUFLIX-capable clients switch back to F1/F3/F7
without restarting. Invalid timing values remain rejected.

The graphical desktop and Clock, Appearance/Input fixes, Popcorn improvements,
NUFLIX display support and MHS Doom F1 colour fitting remain included.
F7 Sharp is unchanged. There is no two-button startup firmware-recovery
option; the normal firmware updater and PJRC hardware loader remain available.

Install [MPE_Firmware-V1.2.6.hex](../firmware/MPE_Firmware-V1.2.6.hex) through
the firmware updater and confirm V1.2.6 in About after restarting.
Keep your existing VM packages, saves and music. DoomVM remains version 1.2;
no VM engine or game-data changes are included in this firmware update.
Firmware is downloaded separately from the full VM ZIPs.

The private and public source builds are checked for matching firmware, with
software tests for startup, updating, launch routing and shared video.
Physical C64 testing of this combined build is still needed, including
Final Cartridge III/freezer behavior.
