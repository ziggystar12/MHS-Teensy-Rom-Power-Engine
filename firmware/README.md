# MPE GUI firmware

Current version: **1.2.23**, for TeensyROM+ v0.4 with a Teensy 4.1.

[Download the firmware](MPE_Firmware-V1.2.23.hex) · [VM downloads](../vms/README.md)

## Install

1. Copy the HEX file to the SD root and select it in the GUI updater.
2. Keep power connected until installation and restart finish.
3. Confirm **1.2.23** in About, then extract each chosen VM package to the SD root.

Preserve your existing ROMs, game data, music and saves. Automatic discovery
offers newer firmware versions; manual selection supports reinstallation.

## Desktop and games

The GUI remembers Main, SD or USB across restarts. If the saved drive is
unavailable, it opens Main and retains the saved preference for later.

Select an SD/USB file or folder and choose **File > Add Desktop** or press
**Shift+S** to create a persistent shortcut. Up to seven shortcuts fit beside
the built-in icons. [Desktop guide](../docs/DESKTOP-SHORTCUTS.md).

With the matching VM installed, select `.nes`, `.gb`, `.gbc`, `.gc` or
`.gg` files directly from the SD browser, including nested folders.
The NESVM, GBVM and GGVM `.crt` launchers open their ROM pickers.
`DOOMVM.crt` starts Doom directly.

A properly packed `.MPE` game contains its engine, client and content and
can launch from one file on SD. Existing MGC1 games named `.CRT` also work.
Games using host save services keep sidecar files beside the cartridge;
keep its filename and sidecars together when moving or backing up saves.
Renaming an ordinary ROM or CRT does not create an MPE game.

The firmware includes the [Prism+ display service](../docs/MHS-PRISM.md)
and checks firmware files before updating.
[Component licensing](../docs/PRISM-PLUS-LICENSE.md).

SHA-256: `3009715813faec679688fc939be20f6ed2271ebc9309744567520541819d4606`.
