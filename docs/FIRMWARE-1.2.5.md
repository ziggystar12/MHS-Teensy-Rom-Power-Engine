# MPE firmware 1.2.5 and DoomVM 1.2

The desktop gains a graphical Clock page and fixes for Appearance, Input,
Control Panel navigation, Popcorn and saved music pause/play. The shared
NUFLIX host is included.

Doom F1 uses MHS colour fitting with cached palette mixtures and a solid-colour
status bar. F7 Sharp, the launcher, sound and game data are unchanged.

The two-button startup firmware flasher is removed. Install firmware through
the normal menu. If the firmware cannot start, use the PJRC hardware loader.

These changes are retained in the [current firmware](../firmware/). Install
the current full HEX through the normal updater. Restart, then extract the
full [DOOMVM.zip](../vms/DOOMVM.zip) onto the
card. Preserve your music files. There is no separate update-only package.

The source builds and automated rendering, transfer and updater checks pass.
See the current release notes for the combined build's testing status.
