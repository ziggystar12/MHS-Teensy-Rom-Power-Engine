# MPE GUI firmware 1.2.23

This release combines the latest desktop and MPE services with the hardened
updater and upstream TeensyROM DMA/MIDI changes. It is the current firmware
pairing for NESVM 1.2.0 and DoomVM 1.2.1.

## Changes since the public 1.2.6 firmware

- **Prism+ host:** an independent renderer with motion updates, quiet-picture
  refinement, two complete display banks and changed-data transfers. NESVM's
  constant side margins avoid unnecessary fitting work.
- **Remembered drive:** Main, SD or USB is reopened at its root after restart.
  An unavailable drive falls back to Main without erasing the saved preference.
- **Desktop shortcuts:** File > Add Desktop or Shift+S adds the selected SD/USB
  file or folder. Seven shortcuts fit beside the eight built-in icons.
- **Direct NES launch:** opening a supported .nes file from SD starts the
  installed NESVM package with that file, including nested paths and spaces.
- **.MPE game files:** finished self-contained MPE games can use .MPE. Existing
  MGC1 games named .CRT, ordinary CRTs and installed-VM launchers still work.
- **Upstream fixes:** separate PAL/NTSC DMA setup/hold timing, improved expansion
  diagnostics and unique USB MIDI device identities.
- **Updater checks:** the GUI retains malformed-HEX checks and its confirmed-file
  stream CRC. Build-time HEX validation also checks bounds, identity and headroom.

The GUI may retain features that differ from Travis's stock text firmware.
No Prism+ implementation source is added to the public repository.

Version 1.2.23 replaces the old GPL button-debounce dependency with an
independently implemented MIT helper. It keeps the 35 ms press/release
qualification and existing button callbacks.

## Install

Copy [MPE_Firmware-V1.2.23.hex](../firmware/MPE_Firmware-V1.2.23.hex) to the SD
root, install through the normal updater, restart and confirm 1.2.23 in About.
Update each VM with its complete matching package. Preserve ROMs, game data,
music and saves. [Desktop shortcuts](DESKTOP-SHORTCUTS.md).

## Evidence

The combined build and linked checks passed. The HEX has 2,334,716 loaded bytes;
all 459 source inputs matched. The C64 GUI suite passed 343 tests and the Teensy
suite passed 24. The host retains its 16 KiB heap, 48 KiB execution stack and
192 KiB module data region; GUI aligned stack capacity is 20,736 bytes.
Ten focused button scenarios passed, including contact bounce, startup press
and timer wraparound. These checks do not establish physical button,
reboot, media or shortcut acceptance.
[Machine-readable firmware checks](FIRMWARE-1.2.23-build.json).

SHA-256: `3009715813faec679688fc939be20f6ed2271ebc9309744567520541819d4606`.

[License and source availability](PRISM-PLUS-LICENSE.md).
