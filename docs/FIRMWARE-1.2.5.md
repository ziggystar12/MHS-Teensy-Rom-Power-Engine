# MPE firmware 1.2.5 and DoomVM 1.2

The desktop gains a graphical Clock page and fixes for Appearance, Input,
Control Panel navigation, Popcorn and saved music pause/play. The shared
NUFLIX host is included.

Doom F1 uses MHS colour fitting with cached palette mixtures and a solid-colour
status bar. F7 Sharp, the launcher, sound and game data are unchanged.

The two-button startup firmware flasher is removed. Install firmware through
the normal menu. If the firmware cannot start, use the PJRC hardware loader.

Copy [MPE_Firmware-V1.2.5.hex](../firmware/MPE_Firmware-V1.2.5.hex) to the SD
root and install it manually, even if About already shows 1.2.5 from an earlier
test. Restart, then extract the full [DOOMVM.zip](../vms/DOOMVM.zip) onto the
card. Preserve your music files. There is no separate update-only package.

The source builds and automated rendering, transfer and updater checks pass.
This replacement build still needs physical C64 testing.
